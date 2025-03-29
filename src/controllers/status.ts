import { Context } from "hono";
import { TidalAPI } from "../services/tidal-api";
import { TidalService } from "../services/tidal-service";
import { Env } from "../types";
import { SAMPLE_TRACK_ID } from "../config/constants";

/**
 * Controller for API status endpoint
 */
export class StatusController {
  /**
   * Get API status
   */
  static async getStatus(c: Context<{ Bindings: Env }>): Promise<Response> {
    const status = {
      status: "operational",
      timestamp: new Date().toISOString(),
      services: {
        api: { status: "operational", latency_ms: 0 },
      },
    };

    try {
      const tidalApi = new TidalAPI(c.env);
      const service = new TidalService(tidalApi);

      const startTime = Date.now();
      await service.getLyrics(SAMPLE_TRACK_ID);
      const endTime = Date.now();

      status.services.api.latency_ms = Math.round(endTime - startTime);
    } catch (error) {
      status.services.api = {
        status: "error",
        error: error.message,
        latency_ms: null,
      };
      status.status = "degraded";
    }

    return c.json(status);
  }
}
