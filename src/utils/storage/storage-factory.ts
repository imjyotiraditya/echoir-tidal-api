import { StorageProvider } from "./storage-provider";
import { KVStorage } from "./kv-storage";
import { RedisStorage } from "./redis-storage";
import { D1Storage } from "./d1-storage";
import { Env, StorageProviderType } from "../../types";

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
  static createStorage(
    env: Env,
    forceProvider?: StorageProviderType,
  ): StorageProvider {
    // Use forced provider if specified
    if (forceProvider === "d1") {
      if (!env.D1_DB) {
        throw new Error("D1 is not configured but was requested");
      }
      return new D1Storage(env);
    } else if (forceProvider === "redis") {
      if (!env.REDIS) {
        throw new Error("Redis is not configured but was requested");
      }
      return new RedisStorage(env);
    } else if (forceProvider === "kv") {
      return new KVStorage(env);
    }

    // Default behavior based on configuration
    if (env.USE_D1 && env.D1_DB) {
      return new D1Storage(env);
    } else if (env.USE_REDIS && env.REDIS) {
      return new RedisStorage(env);
    } else {
      return new KVStorage(env);
    }
  }
}
