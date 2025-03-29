#!/usr/bin/env node

/**
 * Tidal Token Generator
 *
 * This script generates Tidal API tokens for use with Cloudflare Workers.
 * It authenticates with Tidal using device flow and provides the tokens
 * for manual entry into KV storage.
 */

const https = require("https");
const readline = require("readline");

// Client credentials
const CLIENT_IDS = {
  TV: "4N3n6Q1x95LL5K7p",
  MOBILE_DEFAULT: "6BDSRdpK9hqEBTgU",
  MOBILE_ATMOS: "km8T1xS355y7dd3H",
};

const CLIENT_SECRETS = {
  TV: "oKOXfJW371cX6xaZ0PyhgGNBdNLlBZd4AKKYougMjik=",
};

/**
 * Tidal Auth Generator class
 */
class TidalAuthGenerator {
  constructor() {
    this.authBase = "https://auth.tidal.com/v1";
    this.scope = "r_usr w_usr";
    this.kvNamespace = "TIDAL_TOKENS"; // Make sure this matches your wrangler.toml
  }

  /**
   * Make HTTP request
   * @param {Object} options - Request options
   * @param {string} data - Request body data
   * @returns {Promise<Object>} Response data
   */
  httpRequest(options, data = null) {
    return new Promise((resolve, reject) => {
      const req = https.request(options, (res) => {
        let responseData = "";
        res.on("data", (chunk) => {
          responseData += chunk;
        });

        res.on("end", () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(JSON.parse(responseData));
            } catch (e) {
              resolve(responseData);
            }
          } else {
            reject(
              new Error(
                `Request failed with status code ${res.statusCode}: ${responseData}`,
              ),
            );
          }
        });
      });

      req.on("error", reject);

      if (data) {
        req.write(data);
      }

      req.end();
    });
  }

  /**
   * Get device code for authorization
   * @param {string} clientId - Client ID
   * @returns {Promise<Array>} Device code and verification URL
   */
  async getDeviceCode(clientId) {
    const postData = `client_id=${clientId}&scope=${encodeURIComponent(this.scope)}`;

    const options = {
      hostname: "auth.tidal.com",
      port: 443,
      path: "/v1/oauth2/device_authorization",
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(postData),
      },
    };

    const result = await this.httpRequest(options, postData);
    return [result.deviceCode, result.verificationUriComplete];
  }

  /**
   * Wait for user to authorize the device
   * @param {string} clientId - Client ID
   * @param {string} clientSecret - Client secret
   * @param {string} deviceCode - Device code
   * @returns {Promise<Object>} Authorization data
   */
  async waitForAuth(clientId, clientSecret, deviceCode) {
    const postData = `client_id=${clientId}&device_code=${deviceCode}&client_secret=${encodeURIComponent(clientSecret)}&grant_type=urn:ietf:params:oauth:grant-type:device_code&scope=${encodeURIComponent(this.scope)}`;

    const options = {
      hostname: "auth.tidal.com",
      port: 443,
      path: "/v1/oauth2/token",
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(postData),
      },
    };

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    console.log("\nWaiting for authorization...");
    console.log(
      "Press Enter after you have completed the authorization in your browser",
    );

    // Wait for user to press Enter
    await new Promise((resolve) => rl.question("", resolve));
    rl.close();

    try {
      const auth = await this.httpRequest(options, postData);
      return auth;
    } catch (error) {
      console.error(`Authorization failed: ${error.message}`);
      process.exit(1);
    }
  }

  /**
   * Get user info
   * @param {string} accessToken - Access token
   * @returns {Promise<Object>} User info
   */
  async getUserInfo(accessToken) {
    const options = {
      hostname: "api.tidal.com",
      port: 443,
      path: "/v1/sessions",
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "X-Tidal-Token": CLIENT_IDS.TV,
      },
    };

    return await this.httpRequest(options);
  }

  /**
   * Get mobile token using refresh token
   * @param {string} refreshToken - Refresh token
   * @param {string} clientId - Client ID
   * @returns {Promise<Object>} Token data
   */
  async getMobileToken(refreshToken, clientId) {
    try {
      const postData = `refresh_token=${refreshToken}&client_id=${clientId}&grant_type=refresh_token`;

      const options = {
        hostname: "auth.tidal.com",
        port: 443,
        path: "/v1/oauth2/token",
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Content-Length": Buffer.byteLength(postData),
        },
      };

      const tokenData = await this.httpRequest(options, postData);

      const now = new Date();
      const expires = new Date(now.getTime() + tokenData.expires_in * 1000);

      return {
        success: true,
        data: {
          access_token: tokenData.access_token,
          refresh_token: refreshToken,
          expires: expires.toISOString(),
          country_code: tokenData.user.countryCode,
          updated_at: now.toISOString(),
        },
      };
    } catch (error) {
      console.error(`\tERROR: ${error.message}`);
      return { success: false };
    }
  }

  /**
   * Format token data for display
   * @param {string} sessionType - Session type
   * @param {Object} tokenData - Token data
   * @returns {string} Formatted token information
   */
  formatTokenData(sessionType, tokenData) {
    const key = `tidal_tokens:${sessionType}`;
    const value = JSON.stringify(tokenData, null, 2);
    return `Key: ${key}\nValue: ${value}`;
  }

  /**
   * Main method to generate and display tokens
   * @returns {Promise<void>}
   */
  async generateTokens() {
    try {
      console.log("Starting Tidal token generation...");

      const [deviceCode, verificationUrl] = await this.getDeviceCode(
        CLIENT_IDS.TV,
      );

      console.log(
        `\nPlease open this URL in your browser: https://${verificationUrl.replace(/^https?:\/\//, "")}`,
      );

      const tvAuth = await this.waitForAuth(
        CLIENT_IDS.TV,
        CLIENT_SECRETS.TV,
        deviceCode,
      );

      const tvUserInfo = await this.getUserInfo(tvAuth.access_token);

      const now = new Date();
      const tvExpires = new Date(now.getTime() + tvAuth.expires_in * 1000);

      const tvTokenData = {
        access_token: tvAuth.access_token,
        refresh_token: tvAuth.refresh_token,
        expires: tvExpires.toISOString(),
        country_code: tvUserInfo.countryCode,
        updated_at: now.toISOString(),
      };

      console.log(
        "\nToken generation successful! Now you need to manually add these tokens to your KV namespace.",
      );
      console.log("\n====== INSTRUCTIONS ======");
      console.log("1. Go to your Cloudflare dashboard");
      console.log("2. Navigate to Storage & Databases → KV");
      console.log("3. Select your TIDAL_TOKENS namespace");
      console.log("4. Click 'Add entry'");
      console.log(
        "5. For each token below, create an entry with the Key and Value as shown",
      );
      console.log("==========================\n");

      // Display TV token
      console.log("\n=== TV TOKEN ===");
      console.log(this.formatTokenData("TV", tvTokenData));

      // Generate and display mobile tokens
      for (const sessionType of ["MOBILE_DEFAULT", "MOBILE_ATMOS"]) {
        const mobileResult = await this.getMobileToken(
          tvAuth.refresh_token,
          CLIENT_IDS[sessionType],
        );

        if (mobileResult.success) {
          console.log(`\n=== ${sessionType} TOKEN ===`);
          console.log(this.formatTokenData(sessionType, mobileResult.data));
        }
      }

      console.log(
        "\nAfter adding all tokens to your KV namespace, deploy your Cloudflare Worker with: npm run deploy",
      );
    } catch (error) {
      console.error(`\nError: ${error.message}`);
      process.exit(1);
    }
  }
}

// Run the token generator
new TidalAuthGenerator().generateTokens();
