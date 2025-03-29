import { httpClient } from "./http-client";
import {
  CLIENT_IDS,
  CLIENT_SECRETS,
  API_URLS,
  KV_NAMESPACE,
} from "../config/constants";
import { TokenData, SessionType, Env } from "../types";

/**
 * Manages Tidal API authentication tokens
 */
export class TokenManager {
  constructor(private env: Env) {}

  /**
   * Get token key for KV storage
   * @param sessionType - Session type
   * @returns Formatted key string
   */
  private getTokenKey(sessionType: SessionType): string {
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
