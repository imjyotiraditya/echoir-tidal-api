import { Context } from "hono";
import { Env, StorageStats } from "../types";
import { StorageFactory } from "../utils/storage/storage-factory";
import { TokenManager } from "../utils/token-manager";

/**
 * Controller for storage status endpoints
 */
export class StorageStatusController {
  /**
   * Get storage status information
   */
  static async getStorageStatus(
    c: Context<{ Bindings: Env }>,
  ): Promise<Response> {
    // Create a token manager to get stats
    const tokenManager = new TokenManager(c.env);
    const stats = tokenManager.getStorageStats();

    const status: {
      timestamp: string;
      storage: {
        primary: string;
        fallback: string | null;
        preference: string;
      };
      statistics: {
        kv: StorageStats;
        redis: StorageStats | null;
      };
      limits: {
        kv: {
          reads_per_day: number;
          writes_per_day: number;
          remaining_reads: number;
          remaining_writes: number;
        };
        redis: {
          reads_per_day: number | null;
          writes_per_day: number | null;
        } | null;
      };
      auto_switch: {
        enabled: boolean;
        threshold_reads: number;
        threshold_writes: number;
        error_threshold: number;
      };
    } = {
      timestamp: new Date().toISOString(),
      storage: {
        primary: c.env.USE_REDIS ? "redis" : "kv",
        fallback: c.env.REDIS && !c.env.USE_REDIS ? "redis" : null,
        preference: c.env.STORAGE_PREFERENCE || "auto",
      },
      statistics: {
        kv: {
          provider: "Cloudflare KV",
          reads: stats.provider === "kv" ? stats.reads : 0,
          writes: stats.provider === "kv" ? stats.writes : 0,
          errors: stats.provider === "kv" ? stats.errors : 0,
          status: "operational",
        },
        redis: c.env.REDIS
          ? {
              provider: "Upstash Redis",
              reads: stats.provider === "redis" ? stats.reads : 0,
              writes: stats.provider === "redis" ? stats.writes : 0,
              errors: stats.provider === "redis" ? stats.errors : 0,
              status: "operational",
            }
          : null,
      },
      limits: {
        kv: {
          reads_per_day: 100000, // Free plan limit
          writes_per_day: 1000, // Free plan limit
          remaining_reads: 100000 - (stats.provider === "kv" ? stats.reads : 0),
          remaining_writes: 1000 - (stats.provider === "kv" ? stats.writes : 0),
        },
        redis: c.env.REDIS
          ? {
              reads_per_day: null, // Depends on plan
              writes_per_day: null, // Depends on plan
            }
          : null,
      },
      auto_switch: {
        enabled:
          c.env.STORAGE_PREFERENCE === "auto" && c.env.REDIS !== undefined,
        threshold_reads: 95000, // 95% of free tier
        threshold_writes: 950, // 95% of free tier
        error_threshold: 3,
      },
    };

    // Perform a simple health check on KV
    try {
      const testKey = "storage_health_check";
      await c.env.TIDAL_TOKENS.put(testKey, "test");
      await c.env.TIDAL_TOKENS.get(testKey);
      await c.env.TIDAL_TOKENS.delete(testKey);
    } catch (error) {
      status.statistics.kv.status = "error";
      status.statistics.kv.errors += 1;
    }

    // Perform a simple health check on Redis if available
    if (c.env.REDIS) {
      try {
        const testKey = "storage_health_check";
        await c.env.REDIS.set(testKey, "test");
        await c.env.REDIS.get(testKey);
        await c.env.REDIS.del(testKey);
      } catch (error) {
        if (status.statistics.redis) {
          status.statistics.redis.status = "error";
          status.statistics.redis.errors += 1;
        }
      }
    }

    return c.json(status);
  }
}
