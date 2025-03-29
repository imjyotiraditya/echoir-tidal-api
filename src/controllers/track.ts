import { Context } from "hono";
import { TidalAPI } from "../services/tidal-api";
import { TidalService } from "../services/tidal-service";
import { TrackMetadataService } from "../services/track-metadata-service";
import { Env, TrackPlaybackRequest } from "../types";
import { DEFAULT_COUNTRY } from "../config/constants";

/**
 * Controller for track-related endpoints
 */
export class TrackController {
  /**
   * Get track info
   */
  static async getTrackInfo(c: Context<{ Bindings: Env }>): Promise<Response> {
    const id = c.req.query("id");
    const country = c.req.query("country") || DEFAULT_COUNTRY;

    if (!id) {
      return c.json({ detail: "Track ID is required" }, 400);
    }

    try {
      const tidalApi = new TidalAPI(c.env);
      const service = new TidalService(tidalApi);
      const result = await service.getTrackInfo(parseInt(id), country);

      return c.json(result);
    } catch (error) {
      return c.json({ detail: error.message }, error.status || 500);
    }
  }

  /**
   * Get track metadata
   */
  static async getTrackMetadata(
    c: Context<{ Bindings: Env }>,
  ): Promise<Response> {
    const id = c.req.query("id");
    const country = c.req.query("country") || DEFAULT_COUNTRY;

    if (!id) {
      return c.json({ detail: "Track ID is required" }, 400);
    }

    try {
      const tidalApi = new TidalAPI(c.env);
      const service = new TrackMetadataService(tidalApi);
      const result = await service.getTrackMetadata(parseInt(id), country);

      return c.json(result);
    } catch (error) {
      return c.json({ detail: error.message }, error.status || 500);
    }
  }

  /**
   * Get track playback info
   */
  static async getTrackPlayback(
    c: Context<{ Bindings: Env }>,
  ): Promise<Response> {
    try {
      const body = (await c.req.json()) as TrackPlaybackRequest;

      // Validate request
      if (!body.id) {
        return c.json({ detail: "Track ID is required" }, 400);
      }

      // Validate atmos params
      if (body.quality !== "DOLBY_ATMOS" && (body.ac4 || !body.immersive)) {
        return c.json(
          {
            detail:
              "ac4 and immersive parameters are only valid with DOLBY_ATMOS quality",
          },
          400,
        );
      }

      const tidalApi = new TidalAPI(c.env);
      const service = new TidalService(tidalApi);
      const result = await service.getTrackPlayback(body);

      return c.json(result);
    } catch (error) {
      return c.json({ detail: error.message }, error.status || 500);
    }
  }

  /**
   * Get track preview
   */
  static async getTrackPreview(
    c: Context<{ Bindings: Env }>,
  ): Promise<Response> {
    const id = c.req.query("id");

    if (!id) {
      return c.json({ detail: "Track ID is required" }, 400);
    }

    try {
      const tidalApi = new TidalAPI(c.env);
      const service = new TidalService(tidalApi);
      const result = await service.getTrackPreview(parseInt(id));

      return c.json(result);
    } catch (error) {
      return c.json({ detail: error.message }, error.status || 500);
    }
  }
}
