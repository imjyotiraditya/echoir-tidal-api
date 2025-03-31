import { httpClient } from "./http-client";
import { CLIENT_IDS, CLIENT_SECRETS, API_URLS } from "../config/constants";
import {
  TokenData,
  SessionType,
  Env,
  StorageStats,
  StorageProviderType,
} from "../types";
import { StorageProvider } from "./storage/storage-provider";
import { StorageFactory } from "./storage/storage-factory";

/**
 * Manages Tidal API authentication tokens with tiered storage
 */
export class TokenManager {
  private storage: StorageProvider;
  private storageStats: StorageStats = {
    provider: "d1",
    reads: 0,
    writes: 0,
    errors: 0,
    status: "operational",
  };

  // Storage limits
  private storageLimits = {
    d1: {
      reads: 5000000, // 5 million reads/day
      writes: 100000, // 100,000 writes/day
      threshold: 0.95, // 95% threshold
    },
    kv: {
      reads: 100000, // 100,000 reads/day
      writes: 1000, // 1,000 writes/day
      threshold: 0.95, // 95% threshold
    },
  };

  private consecutiveErrors = 0;
  private errorThreshold = 3; // Number of consecutive errors before forcing switch

  constructor(private env: Env) {
    // Set initial storage preference if not already set
    if (!this.env.STORAGE_PREFERENCE) {
      this.env.STORAGE_PREFERENCE = "auto";
    }

    // Set initial USE_D1 flag based on storage preference and availability
    if (
      this.env.D1_DB &&
      (this.env.STORAGE_PREFERENCE === "d1" ||
        this.env.STORAGE_PREFERENCE === "auto")
    ) {
      this.env.USE_D1 = true;
    } else {
      this.env.USE_D1 = false;
    }

    // Set initial USE_REDIS flag if D1 is not being used
    if (
      !this.env.USE_D1 &&
      this.env.REDIS &&
      (this.env.STORAGE_PREFERENCE === "redis" ||
        this.env.STORAGE_PREFERENCE === "auto")
    ) {
      this.env.USE_REDIS = true;
    } else if (this.env.USE_D1) {
      this.env.USE_REDIS = false;
    }

    // Initialize storage provider using factory
    this.storage = StorageFactory.createStorage(this.env);

    // Set initial provider in stats
    if (this.env.USE_D1) {
      this.storageStats.provider = "d1";
    } else if (this.env.USE_REDIS) {
      this.storageStats.provider = "redis";
    } else {
      this.storageStats.provider = "kv";
    }
  }

  /**
   * Get storage statistics
   * @returns Storage statistics
   */
  getStorageStats(): StorageStats {
    return { ...this.storageStats };
  }

  /**
   * Check if D1 limits are approaching and we should switch to KV
   */
  private shouldSwitchFromD1ToKV(): boolean {
    // Only consider switching if we're using D1 and in auto mode
    if (!this.env.USE_D1 || this.env.STORAGE_PREFERENCE !== "auto") {
      return false;
    }

    const d1Limits = this.storageLimits.d1;
    const readThreshold = d1Limits.reads * d1Limits.threshold;
    const writeThreshold = d1Limits.writes * d1Limits.threshold;

    // Check if we're approaching D1 limits
    if (
      this.storageStats.reads >= readThreshold ||
      this.storageStats.writes >= writeThreshold
    ) {
      console.log(
        `Approaching D1 limits: ${this.storageStats.reads}/${readThreshold} reads, ${this.storageStats.writes}/${writeThreshold} writes`,
      );
      return true;
    }

    // Check if we've had too many consecutive errors
    if (this.consecutiveErrors >= this.errorThreshold) {
      console.log(`Too many consecutive D1 errors: ${this.consecutiveErrors}`);
      return true;
    }

    return false;
  }

  /**
   * Check if KV limits are approaching and we should switch to Redis
   */
  private shouldSwitchFromKVToRedis(): boolean {
    // Only consider switching if we're using KV (not D1, not Redis) and Redis is available and in auto mode
    if (
      this.env.USE_D1 ||
      this.env.USE_REDIS ||
      !this.env.REDIS ||
      this.env.STORAGE_PREFERENCE !== "auto"
    ) {
      return false;
    }

    const kvLimits = this.storageLimits.kv;
    const readThreshold = kvLimits.reads * kvLimits.threshold;
    const writeThreshold = kvLimits.writes * kvLimits.threshold;

    // Check if we're approaching KV limits
    if (
      this.storageStats.reads >= readThreshold ||
      this.storageStats.writes >= writeThreshold
    ) {
      console.log(
        `Approaching KV limits: ${this.storageStats.reads}/${readThreshold} reads, ${this.storageStats.writes}/${writeThreshold} writes`,
      );
      return true;
    }

    // Check if we've had too many consecutive errors
    if (this.consecutiveErrors >= this.errorThreshold) {
      console.log(`Too many consecutive KV errors: ${this.consecutiveErrors}`);
      return true;
    }

    return false;
  }

  /**
   * Switch storage from D1 to KV
   */
  private switchFromD1ToKV(): void {
    if (this.env.USE_D1) {
      console.log("Switching primary storage from D1 to KV");
      this.env.USE_D1 = false;
      this.env.USE_REDIS = false;
      this.storage = StorageFactory.createStorage(this.env, "kv");
      this.storageStats.provider = "kv";
      this.consecutiveErrors = 0;

      // Reset stats for the new provider
      this.storageStats.reads = 0;
      this.storageStats.writes = 0;
      this.storageStats.errors = 0;
    }
  }

  /**
   * Switch storage from KV to Redis
   */
  private switchFromKVToRedis(): void {
    if (!this.env.USE_D1 && !this.env.USE_REDIS && this.env.REDIS) {
      console.log("Switching primary storage from KV to Redis");
      this.env.USE_REDIS = true;
      this.storage = StorageFactory.createStorage(this.env, "redis");
      this.storageStats.provider = "redis";
      this.consecutiveErrors = 0;

      // Reset stats for the new provider
      this.storageStats.reads = 0;
      this.storageStats.writes = 0;
      this.storageStats.errors = 0;
    }
  }

  /**
   * Get token key for storage
   * @param sessionType - Session type
   * @returns Formatted key string
   */
  private getTokenKey(sessionType: SessionType): string {
    return this.storage.getTokenKey(sessionType);
  }

  /**
   * Get tokens from storage with tiered fallback
   * @param sessionType - Session type
   * @returns Token data
   */
  async getTokens(sessionType: SessionType): Promise<TokenData> {
    try {
      // Check if we should switch storage before proceeding
      if (this.env.USE_D1 && this.shouldSwitchFromD1ToKV()) {
        this.switchFromD1ToKV();
      } else if (
        !this.env.USE_D1 &&
        !this.env.USE_REDIS &&
        this.shouldSwitchFromKVToRedis()
      ) {
        this.switchFromKVToRedis();
      }

      this.storageStats.reads++;
      const currentProvider = this.storageStats.provider as
        | "d1"
        | "kv"
        | "redis";

      console.log(
        `[STORAGE] Using ${currentProvider.toUpperCase()} for reading ${sessionType} tokens`,
      );

      const tokens = await this.storage.getTokens(sessionType);
      this.consecutiveErrors = 0; // Reset error counter on success

      return tokens;
    } catch (error) {
      this.storageStats.errors++;
      this.consecutiveErrors++;

      const currentProvider = this.storageStats.provider as
        | "d1"
        | "kv"
        | "redis";
      console.error(
        `Storage error: ${error.message}, consecutive errors: ${this.consecutiveErrors}`,
      );

      // Implement tiered fallback logic
      if (this.env.USE_D1) {
        // If D1 fails, try KV
        try {
          console.log(
            `D1 storage failed, trying KV fallback for ${sessionType}`,
          );
          const kvStorage = StorageFactory.createStorage(this.env, "kv");
          const tokens = await kvStorage.getTokens(sessionType);

          // If auto mode and error threshold reached, switch to KV permanently
          if (
            this.env.STORAGE_PREFERENCE === "auto" &&
            (error.status === 429 ||
              this.consecutiveErrors >= this.errorThreshold)
          ) {
            this.switchFromD1ToKV();
          }

          return tokens;
        } catch (kvError) {
          // If KV also fails and Redis is available, try Redis
          if (this.env.REDIS) {
            try {
              console.log(
                `KV fallback failed, trying Redis for ${sessionType}`,
              );
              const redisStorage = StorageFactory.createStorage(
                this.env,
                "redis",
              );

              return await redisStorage.getTokens(sessionType);
            } catch (redisError) {
              // If all options fail, throw the original error
              console.error(
                `All storage options failed: ${error.message}, ${kvError.message}, ${redisError.message}`,
              );
              throw error;
            }
          } else {
            // If Redis is not available, throw the KV error
            throw kvError;
          }
        }
      } else if (!this.env.USE_REDIS) {
        // If using KV and it fails, try Redis if available
        if (this.env.REDIS) {
          try {
            console.log(
              `KV storage failed, trying Redis fallback for ${sessionType}`,
            );
            const redisStorage = StorageFactory.createStorage(
              this.env,
              "redis",
            );
            const tokens = await redisStorage.getTokens(sessionType);

            // If auto mode and error threshold reached, switch to Redis permanently
            if (
              this.env.STORAGE_PREFERENCE === "auto" &&
              (error.status === 429 ||
                this.consecutiveErrors >= this.errorThreshold)
            ) {
              this.switchFromKVToRedis();
            }

            return tokens;
          } catch (redisError) {
            // If Redis also fails, throw the original error
            console.error(`Redis fallback also failed: ${redisError.message}`);
            throw error;
          }
        }
      }

      // If no fallback options or all fallbacks failed, throw the original error
      throw error;
    }
  }

  /**
   * Update tokens in storage with tiered approach
   * @param tokens - Token data
   * @param sessionType - Session type
   */
  async updateTokens(
    tokens: TokenData,
    sessionType: SessionType,
  ): Promise<void> {
    try {
      // Check if we should switch storage before proceeding
      if (this.env.USE_D1 && this.shouldSwitchFromD1ToKV()) {
        this.switchFromD1ToKV();
      } else if (
        !this.env.USE_D1 &&
        !this.env.USE_REDIS &&
        this.shouldSwitchFromKVToRedis()
      ) {
        this.switchFromKVToRedis();
      }

      this.storageStats.writes++;
      const currentProvider = this.storageStats.provider as
        | "d1"
        | "kv"
        | "redis";

      console.log(
        `[STORAGE] Using ${currentProvider.toUpperCase()} for writing ${sessionType} tokens`,
      );

      await this.storage.updateTokens(tokens, sessionType);
      this.consecutiveErrors = 0; // Reset error counter on success

      // Implement tiered backup strategy
      if (this.env.STORAGE_PREFERENCE === "auto") {
        // If using D1, also update KV as a backup
        if (this.env.USE_D1) {
          try {
            console.log(`[STORAGE] Backing up tokens to KV`);
            const kvStorage = StorageFactory.createStorage(this.env, "kv");
            await kvStorage.updateTokens(tokens, sessionType);
          } catch (kvError) {
            console.error(`Failed to update KV backup: ${kvError.message}`);
          }

          // If Redis is available, also update it as a second backup
          if (this.env.REDIS) {
            try {
              console.log(`[STORAGE] Backing up tokens to Redis`);
              const redisStorage = StorageFactory.createStorage(
                this.env,
                "redis",
              );
              await redisStorage.updateTokens(tokens, sessionType);
            } catch (redisError) {
              console.error(
                `Failed to update Redis backup: ${redisError.message}`,
              );
            }
          }
        }
        // If using KV, also update Redis as a backup if available
        else if (!this.env.USE_REDIS && this.env.REDIS) {
          try {
            console.log(`[STORAGE] Backing up tokens to Redis`);
            const redisStorage = StorageFactory.createStorage(
              this.env,
              "redis",
            );
            await redisStorage.updateTokens(tokens, sessionType);
          } catch (redisError) {
            console.error(
              `Failed to update Redis backup: ${redisError.message}`,
            );
          }
        }
      }
    } catch (error) {
      this.storageStats.errors++;
      this.consecutiveErrors++;

      const currentProvider = this.storageStats.provider as
        | "d1"
        | "kv"
        | "redis";
      console.error(
        `Storage update error: ${error.message}, consecutive errors: ${this.consecutiveErrors}`,
      );

      // Implement tiered fallback for updates
      if (this.env.USE_D1) {
        // If D1 fails, try KV
        try {
          console.log(`D1 storage update failed, trying KV for ${sessionType}`);
          const kvStorage = StorageFactory.createStorage(this.env, "kv");
          await kvStorage.updateTokens(tokens, sessionType);

          // If auto mode and error threshold reached, switch to KV permanently
          if (
            this.env.STORAGE_PREFERENCE === "auto" &&
            (error.status === 429 ||
              this.consecutiveErrors >= this.errorThreshold)
          ) {
            this.switchFromD1ToKV();
          }

          return;
        } catch (kvError) {
          // If KV also fails and Redis is available, try Redis
          if (this.env.REDIS) {
            try {
              console.log(
                `KV fallback update failed, trying Redis for ${sessionType}`,
              );
              const redisStorage = StorageFactory.createStorage(
                this.env,
                "redis",
              );
              await redisStorage.updateTokens(tokens, sessionType);

              return;
            } catch (redisError) {
              // If all options fail, throw the original error
              console.error(
                `All storage update options failed: ${error.message}, ${kvError.message}, ${redisError.message}`,
              );
              throw error;
            }
          } else {
            // If Redis is not available, throw the KV error
            throw kvError;
          }
        }
      } else if (!this.env.USE_REDIS) {
        // If using KV and it fails, try Redis if available
        if (this.env.REDIS) {
          try {
            console.log(
              `KV storage update failed, trying Redis for ${sessionType}`,
            );
            const redisStorage = StorageFactory.createStorage(
              this.env,
              "redis",
            );
            await redisStorage.updateTokens(tokens, sessionType);

            // If auto mode and error threshold reached, switch to Redis permanently
            if (
              this.env.STORAGE_PREFERENCE === "auto" &&
              (error.status === 429 ||
                this.consecutiveErrors >= this.errorThreshold)
            ) {
              this.switchFromKVToRedis();
            }

            return;
          } catch (redisError) {
            // If Redis also fails, throw the original error
            console.error(
              `Redis fallback update also failed: ${redisError.message}`,
            );
            throw error;
          }
        }
      }

      // If no fallback options or all fallbacks failed, throw the original error
      throw error;
    }
  }

  /**
   * Get headers for API requests
   * @param sessionType - Session type
   * @param tokens - Token data
   * @returns Headers for API requests
   */
  getHeadersForSession(
    sessionType: SessionType,
    tokens: TokenData,
  ): HeadersInit {
    const headers: HeadersInit = {
      "X-Tidal-Token": CLIENT_IDS[sessionType],
      Authorization: `Bearer ${tokens.access_token}`,
      Connection: "Keep-Alive",
      "Accept-Encoding": "gzip",
      "User-Agent": "TIDAL_ANDROID/1039 okhttp/3.14.9",
    };

    if (sessionType !== SessionType.TV) {
      headers["Host"] = "api.tidal.com";
    }

    return headers;
  }

  /**
   * Refresh mobile token
   * @param refreshToken - Refresh token
   * @param sessionType - Session type
   * @returns New token data
   */
  async refreshMobileToken(
    refreshToken: string,
    sessionType: SessionType,
  ): Promise<TokenData> {
    try {
      const formData = new FormData();
      formData.append("client_id", CLIENT_IDS[sessionType]);
      formData.append("refresh_token", refreshToken);
      formData.append("grant_type", "refresh_token");

      const response = await fetch(API_URLS.AUTH, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`Failed to refresh token: ${response.statusText}`);
      }

      const data = await response.json();
      const now = new Date();
      const expires = new Date(now.getTime() + data.expires_in * 1000);

      return {
        access_token: data.access_token,
        refresh_token: refreshToken, // Keep original refresh token
        expires: expires.toISOString(),
        country_code: data.user.countryCode,
        updated_at: now.toISOString(),
      };
    } catch (error) {
      throw {
        status: 500,
        message: `Failed to refresh ${sessionType} token: ${error.message}`,
      };
    }
  }

  /**
   * Refresh tokens
   * @param sessionType - Session type
   * @param tokens - Current token data
   * @returns New token data
   */
  async refreshTokens(
    sessionType: SessionType,
    tokens: TokenData,
  ): Promise<TokenData> {
    try {
      const formData = new FormData();
      formData.append("client_id", CLIENT_IDS[SessionType.TV]);
      formData.append("client_secret", CLIENT_SECRETS[SessionType.TV]);
      formData.append("refresh_token", tokens.refresh_token);
      formData.append("grant_type", "refresh_token");

      const response = await fetch(API_URLS.AUTH, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`Failed to refresh TV token: ${response.statusText}`);
      }

      const tvData = await response.json();
      const now = new Date();
      const tvExpires = new Date(now.getTime() + tvData.expires_in * 1000);
      const tvRefreshToken = tvData.refresh_token || tokens.refresh_token;

      const tvTokens: TokenData = {
        access_token: tvData.access_token,
        refresh_token: tvRefreshToken,
        expires: tvExpires.toISOString(),
        country_code: tvData.user.countryCode,
        updated_at: now.toISOString(),
      };

      await this.updateTokens(tvTokens, SessionType.TV);

      if (sessionType !== SessionType.TV) {
        const mobileTokens = await this.refreshMobileToken(
          tvRefreshToken,
          sessionType,
        );
        await this.updateTokens(mobileTokens, sessionType);
        return mobileTokens;
      }

      return tvTokens;
    } catch (error) {
      throw {
        status: 500,
        message: `Token refresh failed: ${error.message}`,
      };
    }
  }
}
