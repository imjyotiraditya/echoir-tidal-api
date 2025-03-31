#!/usr/bin/env node

/**
 * Tidal Token Generator
 *
 * This script generates Tidal API tokens for use with Cloudflare Workers.
 * It authenticates with Tidal using device flow and provides the tokens
 * for storage in Cloudflare KV, D1, and Redis if configured.
 */

const https = require("https");
const readline = require("readline");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

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
 * Check if D1 is configured in wrangler.toml
 * @returns {Object|null} D1 configuration or null if not configured
 */
function getD1Config() {
  try {
    // Try to read wrangler.toml
    const wranglerPath = path.resolve(process.cwd(), "wrangler.toml");

    if (!fs.existsSync(wranglerPath)) {
      return null;
    }

    const wranglerContent = fs.readFileSync(wranglerPath, "utf8");

    // Simple TOML parsing for D1 database
    const d1Match = wranglerContent.match(/database_id\s*=\s*["']([^"']+)["']/);
    const d1NameMatch = wranglerContent.match(
      /database_name\s*=\s*["']([^"']+)["']/,
    );
    const storagePreference = wranglerContent.match(
      /STORAGE_PREFERENCE\s*=\s*["']([^"']+)["']/,
    );

    if (d1Match && d1NameMatch) {
      return {
        database_id: d1Match[1],
        database_name: d1NameMatch[1],
        preference: storagePreference ? storagePreference[1] : "auto",
      };
    }

    return null;
  } catch (error) {
    console.error(`Error reading D1 configuration: ${error.message}`);
    return null;
  }
}

/**
 * Check if Redis is configured in wrangler.toml
 * @returns {Object|null} Redis configuration or null if not configured
 */
function getRedisConfig() {
  try {
    // Try to read wrangler.toml
    const wranglerPath = path.resolve(process.cwd(), "wrangler.toml");

    if (!fs.existsSync(wranglerPath)) {
      return null;
    }

    const wranglerContent = fs.readFileSync(wranglerPath, "utf8");

    // Simple TOML parsing for Redis URL and token
    const redisUrlMatch = wranglerContent.match(
      /UPSTASH_REDIS_URL\s*=\s*["']([^"']+)["']/,
    );
    const redisTokenMatch = wranglerContent.match(
      /UPSTASH_REDIS_TOKEN\s*=\s*["']([^"']+)["']/,
    );
    const storagePreference = wranglerContent.match(
      /STORAGE_PREFERENCE\s*=\s*["']([^"']+)["']/,
    );

    if (redisUrlMatch && redisTokenMatch) {
      return {
        url: redisUrlMatch[1],
        token: redisTokenMatch[1],
        preference: storagePreference ? storagePreference[1] : "auto",
      };
    }

    return null;
  } catch (error) {
    console.error(`Error reading Redis configuration: ${error.message}`);
    return null;
  }
}

/**
 * Store tokens directly in D1 database
 * @param {string} databaseId - D1 database ID
 * @param {string} databaseName - D1 database name
 * @param {Array} tokens - Array of token objects with key and value
 * @returns {boolean} Success status
 */
async function storeTokensInD1(databaseId, databaseName, tokens) {
  try {
    // Ensure the tokens table exists
    try {
      execSync(
        `npx wrangler d1 execute ${databaseName} --remote --command "CREATE TABLE IF NOT EXISTS tokens (key TEXT PRIMARY KEY, value TEXT NOT NULL, expires TEXT NOT NULL, updated_at TEXT NOT NULL)"`,
        { stdio: "pipe" },
      );
    } catch (error) {
      console.error(`Error creating tokens table: ${error.message}`);
      return false;
    }

    // Store each token
    for (const t of tokens) {
      const tokenData = JSON.parse(t.value);
      const valueEscaped = t.value.replace(/"/g, '\\"');

      const sqlCommand = `INSERT OR REPLACE INTO tokens (key, value, expires, updated_at) VALUES ('${t.key}', '${valueEscaped}', '${tokenData.expires}', '${tokenData.updated_at}');`;

      try {
        execSync(
          `npx wrangler d1 execute ${databaseName} --remote --command "${sqlCommand}"`,
          { stdio: "pipe" },
        );
        console.log(`Stored ${t.key} in D1 database`);
      } catch (error) {
        console.error(`Error storing token in D1: ${error.message}`);
        return false;
      }
    }

    return true;
  } catch (error) {
    console.error(`Error storing tokens in D1: ${error.message}`);
    return false;
  }
}

/**
 * Store tokens directly in Redis
 * @param {string} url - Redis URL
 * @param {string} token - Redis token
 * @param {Array} tokens - Array of token objects with key and value
 * @returns {Promise<boolean>} Success status
 */
async function storeTokensInRedis(url, token, tokens) {
  try {
    // Check if @upstash/redis is installed
    try {
      require("@upstash/redis");
    } catch (e) {
      console.log("Installing @upstash/redis package...");
      execSync("npm install --no-save @upstash/redis", { stdio: "inherit" });
    }

    // Now import the Redis class
    const { Redis } = require("@upstash/redis");

    const redis = new Redis({
      url: url,
      token: token,
    });

    // Store each token
    for (const t of tokens) {
      await redis.set(
        t.key,
        JSON.parse(t.value),
        { ex: 86400 }, // 24 hour expiration
      );
      console.log(`Stored ${t.key} in Redis`);
    }

    return true;
  } catch (error) {
    console.error(`Error storing tokens in Redis: ${error.message}`);
    return false;
  }
}

/**
 * Tidal Auth Generator class
 */
class TidalAuthGenerator {
  constructor() {
    this.authBase = "https://auth.tidal.com/v1";
    this.scope = "r_usr w_usr";
    this.kvNamespace = "TIDAL_TOKENS"; // Make sure this matches your wrangler.toml
    this.d1Config = getD1Config();
    this.redisConfig = getRedisConfig();
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
   * Format token data for display and storing
   * @param {string} sessionType - Session type
   * @param {Object} tokenData - Token data
   * @returns {Object} Formatted token information
   */
  formatTokenData(sessionType, tokenData) {
    const key = `tidal_tokens:${sessionType}`;
    const value = JSON.stringify(tokenData, null, 2);
    return { key, value };
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

      console.log("\nToken generation successful!");

      // Collect all tokens
      const tokens = [];

      // Add TV token
      const tvToken = this.formatTokenData("TV", tvTokenData);
      tokens.push(tvToken);
      console.log("\n=== TV TOKEN ===");
      console.log(`Key: ${tvToken.key}`);
      console.log(`Value: ${tvToken.value}`);

      // Generate and display mobile tokens
      for (const sessionType of ["MOBILE_DEFAULT", "MOBILE_ATMOS"]) {
        const mobileResult = await this.getMobileToken(
          tvAuth.refresh_token,
          CLIENT_IDS[sessionType],
        );

        if (mobileResult.success) {
          const mobileToken = this.formatTokenData(
            sessionType,
            mobileResult.data,
          );
          tokens.push(mobileToken);
          console.log(`\n=== ${sessionType} TOKEN ===`);
          console.log(`Key: ${mobileToken.key}`);
          console.log(`Value: ${mobileToken.value}`);
        }
      }

      // Try to store tokens in D1 if configured
      let d1Success = false;
      if (this.d1Config) {
        if (
          this.d1Config.preference === "auto" ||
          this.d1Config.preference === "d1"
        ) {
          console.log("\n====== STORING TOKENS IN D1 ======");
          d1Success = await storeTokensInD1(
            this.d1Config.database_id,
            this.d1Config.database_name,
            tokens,
          );

          if (d1Success) {
            console.log("✅ Successfully stored tokens in D1");
          } else {
            console.log("❌ Failed to store tokens in D1");
          }
        } else {
          console.log(
            "\nD1 is configured but not active (preference set to 'kv' or 'redis')",
          );
          console.log("Tokens will not be automatically stored in D1");
        }
      }

      // Try to store tokens in Redis if configured
      let redisSuccess = false;
      if (this.redisConfig) {
        if (
          this.redisConfig.preference === "auto" ||
          this.redisConfig.preference === "redis"
        ) {
          console.log("\n====== STORING TOKENS IN REDIS ======");
          redisSuccess = await storeTokensInRedis(
            this.redisConfig.url,
            this.redisConfig.token,
            tokens,
          );

          if (redisSuccess) {
            console.log("✅ Successfully stored tokens in Redis");
          } else {
            console.log("❌ Failed to store tokens in Redis");
          }
        } else {
          console.log(
            "\nRedis is configured but not active (preference set to 'kv' or 'd1')",
          );
          console.log("Tokens will not be automatically stored in Redis");
        }
      }

      // Display KV instructions (always needed as KV is the primary or fallback)
      console.log("\n====== KV STORAGE INSTRUCTIONS ======");
      console.log("1. Go to your Cloudflare dashboard");
      console.log("2. Navigate to Storage & Databases → KV");
      console.log("3. Select your TIDAL_TOKENS namespace");
      console.log("4. Click 'Add entry'");
      console.log(
        "5. For each token above, create an entry with the Key and Value as shown",
      );
      console.log("==================================\n");

      console.log(
        "\nAfter adding all tokens to storage, deploy your Cloudflare Worker with: npm run deploy",
      );

      // Success summary
      console.log("\n====== TOKEN STORAGE SUMMARY ======");
      if (d1Success) {
        console.log("✅ Tokens have been automatically stored in D1");
      } else if (this.d1Config) {
        console.log("❌ Failed to store tokens in D1");
      } else {
        console.log("⚠️ D1 is not configured in your wrangler.toml");
      }

      if (redisSuccess) {
        console.log("✅ Tokens have been automatically stored in Redis");
      } else if (this.redisConfig) {
        console.log("❌ Failed to store tokens in Redis");
      } else {
        console.log("⚠️ Redis is not configured in your wrangler.toml");
      }

      console.log("⚠️ Don't forget to add tokens to KV (for backup/fallback)");
      console.log("==================================\n");
    } catch (error) {
      console.error(`\nError: ${error.message}`);
      process.exit(1);
    }
  }
}

// Run the token generator
new TidalAuthGenerator().generateTokens();
