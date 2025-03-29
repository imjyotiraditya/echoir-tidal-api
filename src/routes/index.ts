import { Hono } from "hono";
import { Env } from "../types";
import { TrackController } from "../controllers/track";
import { AlbumController } from "../controllers/album";
import { SearchController } from "../controllers/search";
import { StatusController } from "../controllers/status";

/**
 * Configure all API routes
 * @param app - Hono app instance
 */
export function setupRoutes(app: Hono<{ Bindings: Env }>): void {
  // Track routes
  app.get("/api/track/info", TrackController.getTrackInfo);
  app.get("/api/track/metadata", TrackController.getTrackMetadata);
  app.post("/api/track/playback", TrackController.getTrackPlayback);
  app.get("/api/track/preview", TrackController.getTrackPreview);

  // Album routes
  app.get("/api/album/info", AlbumController.getAlbumInfo);
  app.get("/api/album/tracks", AlbumController.getAlbumTracks);

  // Search routes
  app.get("/api/search", SearchController.search);

  // Status route
  app.get("/api/status", StatusController.getStatus);
}
