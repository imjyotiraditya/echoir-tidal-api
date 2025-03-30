import { Context } from "hono";
import { TidalAPI } from "../services/tidal-api";
import { TidalService } from "../services/tidal-service";
import { Env } from "../types";
import { DEFAULT_COUNTRY } from "../config/constants";
import { UrlHelper } from "../utils/url-helper";

/**
 * Controller for search-related endpoints
 */
export class SearchController {
  /**
   * Search Tidal
   */
  static async search(c: Context<{ Bindings: Env }>): Promise<Response> {
    const query = c.req.query("query");
    const type = c.req.query("type");
    const country = c.req.query("country") || DEFAULT_COUNTRY;

    if (!query) {
      return c.json({ detail: "Query parameter is required" }, 400);
    }

    if (!type || (type !== "tracks" && type !== "albums")) {
      return c.json(
        { detail: 'Type must be either "tracks" or "albums"' },
        400,
      );
    }

    try {
      const tidalApi = new TidalAPI(c.env);
      const service = new TidalService(tidalApi);

      // Check if query contains a Tidal URL
      const urlData = UrlHelper.extractTidalId(query);
      let result = [];

      if (urlData) {
        // Try URL-based search first
        result = await service.handleUrlSearch(urlData, type, country);
      }

      // If no URL was detected or URL search returned no results, use regular search
      if (result.length === 0) {
        if (type === "tracks") {
          result = await service.searchTracks(query, country);
        } else {
          result = await service.searchAlbums(query, country);
        }
      }

      return c.json(result);
    } catch (error) {
      return c.json({ detail: error.message }, error.status || 500);
    }
  }
}
