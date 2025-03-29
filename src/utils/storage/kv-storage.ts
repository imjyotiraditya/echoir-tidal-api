import { StorageProvider } from "./storage-provider";
import { TokenData, SessionType, Env } from "../../types";

/**
 * KV storage provider for Tidal tokens
 */
export class KVStorage implements StorageProvider {
  constructor(private env: Env) {}

  /**
   * Get token key for KV storage
   * @param sessionType - Session type
   * @returns Formatted key string
   */
  getTokenKey(sessionType: SessionType): string {
    return `tidal_tokens:${sessionType}`;
  }

  /**
   * Get tokens from KV storage
   * @param sessionType - Session type
   * @returns Token data
   */
  async getTokens(sessionType: SessionType): Promise<TokenData> {
    const data = await this.env.TIDAL_TOKENS.get(this.getTokenKey(sessionType));

    if (!data) {
      throw {
        status: 404,
        message: `No tokens found for session type: ${sessionType}`,
      };
    }

    return JSON.parse(data);
  }

  /**
   * Update tokens in KV storage
   * @param tokens - Token data
   * @param sessionType - Session type
   */
  async updateTokens(
    tokens: TokenData,
    sessionType: SessionType,
  ): Promise<void> {
    await this.env.TIDAL_TOKENS.put(
      this.getTokenKey(sessionType),
      JSON.stringify(tokens),
    );
  }
}
