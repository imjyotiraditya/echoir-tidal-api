import { httpClient } from "./http-client";
import { CLIENT_IDS, CLIENT_SECRETS, API_URLS } from "../config/constants";
import { TokenData, SessionType, Env, StorageStats } from "../types";
import { StorageProvider } from "./storage/storage-provider";
import { StorageFactory } from "./storage/storage-factory";

/**
 * Manages Tidal API authentication tokens
 */
export class TokenManager {
  private storage: StorageProvider;
  private storageStats: StorageStats = {
    provider: "kv",
    reads: 0,
    writes: 0,
    errors: 0,
    status: "operational",
  };
  private kvLimitThresholds = {
    reads: 95000, // 95% of free tier 100,000 reads/day
    writes: 950, // 95% of free tier 1,000 writes/day
  };
  private consecutiveErrors = 0;
  private errorThreshold = 3; // Number of consecutive errors before forcing switch

  constructor(private env: Env) {
    // Initialize storage provider using factory
    this.storage = StorageFactory.createStorage(env);
    this.storageStats.provider = this.env.USE_REDIS ? "redis" : "kv";
  }

  /**
   * Get storage statistics
   * @returns Storage statistics
   */
  getStorageStats(): StorageStats {
    return { ...this.storageStats };
  }

  /**
   * Check if KV limits are approaching and we should switch to Redis
   * @returns True if should switch, false otherwise
   */
  private shouldSwitchToRedis(): boolean {
    // Only consider switching if we're using KV and Redis is available
    if (
      this.env.USE_REDIS ||
      !this.env.REDIS ||
      this.env.STORAGE_PREFERENCE !== "auto"
    ) {
      return false;
    }

    // Check if we're approaching KV limits
    if (
      this.storageStats.reads >= this.kvLimitThresholds.reads ||
      this.storageStats.writes >= this.kvLimitThresholds.writes
    ) {
      console.log(
        `Approaching KV limits: ${this.storageStats.reads} reads, ${this.storageStats.writes} writes`,
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
   * Switch to Redis storage
   */
  private switchToRedis(): void {
    if (this.env.REDIS && !this.env.USE_REDIS) {
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
   * Get tokens from storage
   * @param sessionType - Session type
   * @returns Token data
   */
  async getTokens(sessionType: SessionType): Promise<TokenData> {
    try {
      // Check if we should switch to Redis before proceeding
      if (this.shouldSwitchToRedis()) {
        this.switchToRedis();
      }

      this.storageStats.reads++;
      const tokens = await this.storage.getTokens(sessionType);
      this.consecutiveErrors = 0; // Reset error counter on success
      return tokens;
    } catch (error) {
      this.storageStats.errors++;
      this.consecutiveErrors++;
      console.error(
        `Storage error: ${error.message}, consecutive errors: ${this.consecutiveErrors}`,
      );

      // If primary storage fails and we're not already using Redis as backup
      if (this.env.REDIS && !this.env.USE_REDIS) {
        try {
          // If auto mode and error is likely a limit issue or persistent error, switch to Redis
          if (
            this.env.STORAGE_PREFERENCE === "auto" &&
            (error.status === 429 ||
              this.consecutiveErrors >= this.errorThreshold)
          ) {
            this.switchToRedis();
            return await this.storage.getTokens(sessionType);
          }

          // Otherwise just try Redis as backup without switching
          console.log(
            `KV storage failed, trying Redis backup for ${sessionType}`,
          );
          const redisStorage = StorageFactory.createStorage(this.env, "redis");
          return await redisStorage.getTokens(sessionType);
        } catch (redisError) {
          // If Redis also fails, throw the original error
          console.error(`Redis backup also failed: ${redisError.message}`);
          throw error;
        }
      }
      throw error;
    }
  }

  /**
   * Update tokens in storage
   * @param tokens - Token data
   * @param sessionType - Session type
   */
  async updateTokens(
    tokens: TokenData,
    sessionType: SessionType,
  ): Promise<void> {
    try {
      // Check if we should switch to Redis before proceeding
      if (this.shouldSwitchToRedis()) {
        this.switchToRedis();
      }

      this.storageStats.writes++;
      await this.storage.updateTokens(tokens, sessionType);
      this.consecutiveErrors = 0; // Reset error counter on success

      // If we're not using Redis as primary but it's available, also store there as backup
      if (
        this.env.REDIS &&
        !this.env.USE_REDIS &&
        this.env.STORAGE_PREFERENCE === "auto"
      ) {
        try {
          const redisStorage = StorageFactory.createStorage(this.env, "redis");
          await redisStorage.updateTokens(tokens, sessionType);
        } catch (redisError) {
          // Log but don't fail if backup storage fails
          console.error(`Failed to update Redis backup: ${redisError.message}`);
        }
      }
    } catch (error) {
      this.storageStats.errors++;
      this.consecutiveErrors++;
      console.error(
        `Storage update error: ${error.message}, consecutive errors: ${this.consecutiveErrors}`,
      );

      // If primary storage fails and Redis is available as fallback
      if (this.env.REDIS && this.env.STORAGE_PREFERENCE === "auto") {
        try {
          console.log(
            `Switching to Redis storage after KV failure: ${error.message}`,
          );
          this.switchToRedis();
          await this.storage.updateTokens(tokens, sessionType);
          console.log(
            `Successfully switched to Redis storage for ${sessionType}`,
          );
        } catch (redisError) {
          throw {
            status: 500,
            message: `All storage options failed: ${error.message}, Redis: ${redisError.message}`,
          };
        }
      } else {
        throw error;
      }
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
