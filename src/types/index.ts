import { Redis } from "@upstash/redis/cloudflare";

// Environment interface
export interface Env {
  TIDAL_TOKENS: KVNamespace;
  REDIS?: Redis; // Redis instance
  UPSTASH_REDIS_URL?: string; // Redis URL
  UPSTASH_REDIS_TOKEN?: string; // Redis Token
  USE_REDIS?: boolean; // Flag to use Redis instead of KV
  STORAGE_PREFERENCE?: string; // 'kv', 'redis', or 'auto'
  APP_TITLE: string;
  APP_VERSION: string;
}

// Session types
export enum SessionType {
  TV = "TV",
  MOBILE_DEFAULT = "MOBILE_DEFAULT",
  MOBILE_ATMOS = "MOBILE_ATMOS",
}

// Token data interface
export interface TokenData {
  access_token: string;
  refresh_token: string;
  expires: string;
  country_code: string;
  updated_at: string;
}

// Track interface
export interface Track {
  id: number;
  quality: string;
  manifest: string;
  bit_depth: number | null;
  sample_rate: number | null;
  urls: string[];
  codec: string | null;
}

// Track playback request interface
export interface TrackPlaybackRequest {
  id: number;
  quality: string;
  country: string;
  ac4: boolean;
  immersive: boolean;
}

// Lyrics interface
export interface Lyrics {
  lyrics: string | null;
  subtitles: string | null;
  trackId: number;
}

// Search item interface
export interface SearchItem {
  id: number;
  title: string;
  duration: string;
  explicit: boolean;
  cover: string | null;
  artists: string[];
  modes: string[] | null;
  formats: string[] | null;
}

// Storage Statistics
export interface StorageStats {
  provider: string;
  reads: number;
  writes: number;
  errors: number;
  status: string;
}
