import { StorageProvider } from "./storage-provider";
import { TokenData, SessionType, Env } from "../../types";

/**
 * D1 storage provider for Tidal tokens
 */
export class D1Storage implements StorageProvider {
  constructor(private env: Env) {
    if (!this.env.D1_DB) {
      throw new Error("D1 database binding is not available");
    }
  }

  /**
   * Initialize D1 database
   * Creates the tokens table if it doesn't exist
   */
  async initialize(): Promise<void> {
    try {
      const tableCheck = await this.env.D1_DB.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='tokens';",
      ).first();

      if (!tableCheck) {
        return;
      }
    } catch (error) {
      throw {
        status: 500,
        message: `D1 error checking database: ${error.message}`,
      };
    }
  }

  /**
   * Get token key for D1 storage
   * @param sessionType - Session type
   * @returns Formatted key string
   */
  getTokenKey(sessionType: SessionType): string {
    return `tidal_tokens:${sessionType}`;
  }

  /**
   * Get tokens from D1 storage
   * @param sessionType - Session type
   * @returns Token data
   */
  async getTokens(sessionType: SessionType): Promise<TokenData> {
    try {
      // Ensure database is initialized
      await this.initialize();

      const key = this.getTokenKey(sessionType);

      // Use parameterized query for safety
      const result = await this.env.D1_DB.prepare(
        "SELECT value FROM tokens WHERE key = ?",
      )
        .bind(key)
        .first();

      if (!result || !result.value) {
        throw {
          status: 404,
          message: `No tokens found for session type: ${sessionType}`,
        };
      }

      return JSON.parse(result.value as string);
    } catch (error) {
      if (error.status) throw error;

      throw {
        status: 500,
        message: `D1 error getting tokens: ${error.message}`,
      };
    }
  }

  /**
   * Update tokens in D1 storage
   * @param tokens - Token data
   * @param sessionType - Session type
   */
  async updateTokens(
    tokens: TokenData,
    sessionType: SessionType,
  ): Promise<void> {
    try {
      // Ensure database is initialized
      await this.initialize();

      const key = this.getTokenKey(sessionType);
      const value = JSON.stringify(tokens);
      const expires = tokens.expires;
      const updated_at = tokens.updated_at;

      // Use parameterized query for safety
      await this.env.D1_DB.prepare(
        `
        INSERT OR REPLACE INTO tokens (key, value, expires, updated_at)
        VALUES (?, ?, ?, ?)
      `,
      )
        .bind(key, value, expires, updated_at)
        .run();
    } catch (error) {
      throw {
        status: 500,
        message: `D1 error updating tokens: ${error.message}`,
      };
    }
  }
}
