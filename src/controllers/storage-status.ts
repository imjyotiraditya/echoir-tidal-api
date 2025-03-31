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
        secondary: string | null;
        tertiary: string | null;
        preference: string;
      };
      statistics: {
        d1: StorageStats | null;
        kv: StorageStats | null;
        redis: StorageStats | null;
      };
      limits: {
        d1: {
          reads_per_day: number;
          writes_per_day: number;
          remaining_reads: number;
          remaining_writes: number;
        } | null;
        kv: {
          reads_per_day: number;
          writes_per_day: number;
          remaining_reads: number;
          remaining_writes: number;
        } | null;
        redis: {
          reads_per_day: number | null;
          writes_per_day: number | null;
        } | null;
      };
      auto_switch: {
        enabled: boolean;
        thresholds: {
          d1_reads: number;
          d1_writes: number;
          kv_reads: number;
          kv_writes: number;
        };
        error_threshold: number;
      };
    } = {
      timestamp: new Date().toISOString(),
      storage: {
        primary: c.env.USE_D1 ? "d1" : c.env.USE_REDIS ? "redis" : "kv",
        secondary: c.env.USE_D1
          ? "kv"
          : c.env.USE_REDIS
            ? null
            : c.env.REDIS
              ? "redis"
              : null,
        tertiary: c.env.USE_D1 && c.env.REDIS ? "redis" : null,
        preference: c.env.STORAGE_PREFERENCE || "auto",
      },
      statistics: {
        d1: c.env.D1_DB
          ? {
              provider: "Cloudflare D1",
              reads: stats.provider === "d1" ? stats.reads : 0,
              writes: stats.provider === "d1" ? stats.writes : 0,
              errors: stats.provider === "d1" ? stats.errors : 0,
              status: "operational",
            }
          : null,
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
        d1: c.env.D1_DB
          ? {
              reads_per_day: 5000000, // Free plan limit
              writes_per_day: 100000, // Free plan limit
              remaining_reads:
                5000000 - (stats.provider === "d1" ? stats.reads : 0),
              remaining_writes:
                100000 - (stats.provider === "d1" ? stats.writes : 0),
            }
          : null,
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
        enabled: c.env.STORAGE_PREFERENCE === "auto",
        thresholds: {
          d1_reads: 4750000, // 95% of D1 free tier
          d1_writes: 95000, // 95% of D1 free tier
          kv_reads: 95000, // 95% of KV free tier
          kv_writes: 950, // 95% of KV free tier
        },
        error_threshold: 3,
      },
    };

    // Perform health checks on all available storage providers

    // D1 health check
    if (c.env.D1_DB) {
      try {
        const testKey = "storage_health_check";
        await c.env.D1_DB.prepare(
          "CREATE TABLE IF NOT EXISTS health_checks (key TEXT PRIMARY KEY, value TEXT)",
        ).run();
        await c.env.D1_DB.prepare(
          "INSERT OR REPLACE INTO health_checks (key, value) VALUES (?, ?)",
        )
          .bind(testKey, "test")
          .run();
        await c.env.D1_DB.prepare(
          "SELECT value FROM health_checks WHERE key = ?",
        )
          .bind(testKey)
          .first();
        await c.env.D1_DB.prepare("DELETE FROM health_checks WHERE key = ?")
          .bind(testKey)
          .run();
      } catch (error) {
        if (status.statistics.d1) {
          status.statistics.d1.status = "error";
          status.statistics.d1.errors += 1;
        }
      }
    }

    // KV health check
    try {
      const testKey = "storage_health_check";
      await c.env.TIDAL_TOKENS.put(testKey, "test");
      await c.env.TIDAL_TOKENS.get(testKey);
      await c.env.TIDAL_TOKENS.delete(testKey);
    } catch (error) {
      if (status.statistics.kv) {
        status.statistics.kv.status = "error";
        status.statistics.kv.errors += 1;
      }
    }

    // Redis health check
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
