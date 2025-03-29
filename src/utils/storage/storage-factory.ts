import { StorageProvider } from "./storage-provider";
import { KVStorage } from "./kv-storage";
import { RedisStorage } from "./redis-storage";
import { Env } from "../../types";

/**
 * Factory for creating storage providers
 */
export class StorageFactory {
  /**
   * Create a storage provider
   * @param env - Environment
   * @param forceProvider - Force specific provider
   * @returns Storage provider
   */
  static createStorage(env: Env, forceProvider?: string): StorageProvider {
    // Use forced provider if specified
    if (forceProvider === "redis") {
      if (!env.REDIS) {
        throw new Error("Redis is not configured but was requested");
      }
      return new RedisStorage(env);
    } else if (forceProvider === "kv") {
      return new KVStorage(env);
    }

    // Default behavior: try KV first, fall back to Redis
    return env.USE_REDIS && env.REDIS
      ? new RedisStorage(env)
      : new KVStorage(env);
  }
}
