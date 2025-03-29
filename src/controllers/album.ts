import { Context } from "hono";
import { TidalAPI } from "../services/tidal-api";
import { TidalService } from "../services/tidal-service";
import { Env } from "../types";
import { DEFAULT_COUNTRY } from "../config/constants";

/**
 * Controller for album-related endpoints
 */
export class AlbumController {
  /**
   * Get album info
   */
  static async getAlbumInfo(c: Context<{ Bindings: Env }>): Promise<Response> {
    const id = c.req.query("id");
    const country = c.req.query("country") || DEFAULT_COUNTRY;

    if (!id) {
      return c.json({ detail: "Album ID is required" }, 400);
    }

    try {
      const tidalApi = new TidalAPI(c.env);
      const service = new TidalService(tidalApi);
      const result = await service.getAlbumInfo(parseInt(id), country);

      return c.json(result);
    } catch (error) {
      return c.json({ detail: error.message }, error.status || 500);
    }
  }

  /**
   * Get album tracks
   */
  static async getAlbumTracks(
    c: Context<{ Bindings: Env }>,
  ): Promise<Response> {
    const id = c.req.query("id");
    const country = c.req.query("country") || DEFAULT_COUNTRY;

    if (!id) {
      return c.json({ detail: "Album ID is required" }, 400);
    }

    try {
      const tidalApi = new TidalAPI(c.env);
      const service = new TidalService(tidalApi);
      const result = await service.getAlbumTracks(parseInt(id), country);

      return c.json(result);
    } catch (error) {
      return c.json({ detail: error.message }, error.status || 500);
    }
  }
}
