import { TokenData, SessionType, Env } from "../../types";

/**
 * Interface for token storage providers
 */
export interface StorageProvider {
  /**
   * Get tokens from storage
   * @param sessionType - Session type
   * @returns Token data
   */
  getTokens(sessionType: SessionType): Promise<TokenData>;

  /**
   * Update tokens in storage
   * @param tokens - Token data
   * @param sessionType - Session type
   */
  updateTokens(tokens: TokenData, sessionType: SessionType): Promise<void>;

  /**
   * Get token key for storage
   * @param sessionType - Session type
   * @returns Formatted key string
   */
  getTokenKey(sessionType: SessionType): string;
}
