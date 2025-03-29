import { API_URLS } from "../config/constants";
import { httpClient } from "../utils/http-client";
import { TokenManager } from "../utils/token-manager";
import { Env, TokenData, SessionType } from "../types";

/**
 * Core API service for interacting with Tidal API
 */
export class TidalAPI {
  private tokenManager: TokenManager;

  constructor(private env: Env) {
    this.tokenManager = new TokenManager(env);
  }

  /**
   * Make an authenticated request to the Tidal API
   * @param endpoint - API endpoint path
   * @param sessionType - Session type to use
   * @param params - Query parameters
   * @returns API response
   */
  async makeRequest(
    endpoint: string,
    sessionType: SessionType,
    params?: Record<string, string>,
  ): Promise<any> {
    const url = `${API_URLS.BASE}/${endpoint}`;

    // Get tokens for the session type
    let tokens = await this.tokenManager.getTokens(sessionType);

    // Check if tokens are expired
    const expires = new Date(tokens.expires);
    if (new Date() > expires) {
      tokens = await this.tokenManager.refreshTokens(sessionType, tokens);
    }

    const headers = this.tokenManager.getHeadersForSession(sessionType, tokens);

    try {
      return await httpClient.makeRequest(url, "GET", headers, params);
    } catch (error) {
      // Try token refresh on auth errors
      if (error.status === 401 || error.status === 403) {
        tokens = await this.tokenManager.refreshTokens(sessionType, tokens);
        const newHeaders = this.tokenManager.getHeadersForSession(
          sessionType,
          tokens,
        );
        return await httpClient.makeRequest(url, "GET", newHeaders, params);
      }

      throw error;
    }
  }
}
