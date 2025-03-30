/**
 * URL Helper Utility for extracting Tidal IDs from URLs
 */
export class UrlHelper {
  /**
   * Extracts a Tidal ID from a URL if present
   * @param query - Search query which might contain a URL
   * @returns Object with id and type if found, null otherwise
   */
  static extractTidalId(
    query: string,
  ): { id: number; type: "track" | "album" } | null {
    if (!query.includes("tidal.com")) {
      return null;
    }

    try {
      const url = new URL(query);
      const pathParts = url.pathname.split("/");

      const typeIndex = pathParts.findIndex(
        (part) =>
          part === "track" ||
          part === "album" ||
          part === "tracks" ||
          part === "albums",
      );

      if (typeIndex !== -1 && typeIndex < pathParts.length - 1) {
        const type = pathParts[typeIndex].replace(/s$/, "") as
          | "track"
          | "album";
        const idCandidate = pathParts[typeIndex + 1];

        const id = parseInt(idCandidate, 10);
        if (!isNaN(id)) {
          return { id, type };
        }
      }

      return null;
    } catch (error) {
      const trackMatch = query.match(/tidal\.com\/(?:track|tracks)\/(\d+)/i);
      if (trackMatch && trackMatch[1]) {
        return { id: parseInt(trackMatch[1], 10), type: "track" };
      }

      const albumMatch = query.match(/tidal\.com\/(?:album|albums)\/(\d+)/i);
      if (albumMatch && albumMatch[1]) {
        return { id: parseInt(albumMatch[1], 10), type: "album" };
      }

      return null;
    }
  }
}
