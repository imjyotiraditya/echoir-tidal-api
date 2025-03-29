import { StorageProvider } from "./storage-provider";
import { TokenData, SessionType, Env } from "../../types";

/**
 * Redis storage provider for Tidal tokens
 */
export class RedisStorage implements StorageProvider {
  constructor(private env: Env) {
    if (!this.env.REDIS) {
      throw new Error("Redis binding is not available");
    }
  }

  /**
   * Get token key for Redis storage
   * @param sessionType - Session type
   * @returns Formatted key string
   */
  getTokenKey(sessionType: SessionType): string {
    return `tidal_tokens:${sessionType}`;
  }

  /**
   * Get tokens from Redis storage
   * @param sessionType - Session type
   * @returns Token data
   */
  async getTokens(sessionType: SessionType): Promise<TokenData> {
    try {
      const data = await this.env.REDIS.get(this.getTokenKey(sessionType));

      if (!data) {
        throw {
          status: 404,
          message: `No tokens found for session type: ${sessionType}`,
        };
      }

      return data as TokenData;
    } catch (error) {
      if (error.status) throw error;

      throw {
        status: 500,
        message: `Redis error getting tokens: ${error.message}`,
      };
    }
  }

  /**
   * Update tokens in Redis storage
   * @param tokens - Token data
   * @param sessionType - Session type
   */
  async updateTokens(
    tokens: TokenData,
    sessionType: SessionType,
  ): Promise<void> {
    try {
      // Store with 24-hour expiration
      const expiryInSeconds = 24 * 60 * 60;
      await this.env.REDIS.set(this.getTokenKey(sessionType), tokens, {
        ex: expiryInSeconds,
      });
    } catch (error) {
      throw {
        status: 500,
        message: `Redis error updating tokens: ${error.message}`,
      };
    }
  }
}
