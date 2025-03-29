import { TidalAPI } from "./tidal-api";
import { TidalService } from "./tidal-service";
import { SessionType } from "../types";
import { DEFAULT_COUNTRY } from "../config/constants";
import { FormatUtils } from "../utils/format-utils";

/**
 * Service for managing track metadata
 */
export class TrackMetadataService {
  private tidalService: TidalService;

  constructor(private tidalApi: TidalAPI) {
    this.tidalService = new TidalService(tidalApi);
  }

  /**
   * Get unique contributors by role
   * @param contributors - List of contributors
   * @returns Map of roles to contributor names
   */
  private getUniqueContributorsByRole(
    contributors: any[],
  ): Record<string, string[]> {
    const roleMap: Record<string, Set<string>> = {};

    for (const contributor of contributors) {
      if (!roleMap[contributor.role]) {
        roleMap[contributor.role] = new Set();
      }
      roleMap[contributor.role].add(contributor.name);
    }

    const result: Record<string, string[]> = {};
    for (const [role, names] of Object.entries(roleMap)) {
      result[role] = Array.from(names).sort();
    }

    return result;
  }

  /**
   * Get track metadata
   * @param trackId - Track ID
   * @param country - Country code
   * @returns Metadata as key-value pairs
   */
  async getTrackMetadata(
    trackId: number,
    country: string = DEFAULT_COUNTRY,
  ): Promise<Record<string, string>> {
    try {
      // Fetch all required data
      const trackInfo = await this.tidalService.getTrackInfo(trackId, country);
      const albumInfo = await this.tidalService.getAlbumInfo(
        trackInfo.album.id,
        country,
      );

      // Get lyrics
      const lyricsModel = await this.tidalService.getLyrics(trackId, country);

      // Get contributors
      const contributorsEndpoint = `tracks/${trackId}/contributors`;
      const contributorsParams = {
        countryCode: country,
        limit: "9999",
        includeContributors: "true",
      };

      const contributorsData = await this.tidalApi.makeRequest(
        contributorsEndpoint,
        SessionType.TV,
        contributorsParams,
      );

      const contributors = contributorsData.items || [];

      // Group contributors by role
      const contributorsByRole = this.getUniqueContributorsByRole(contributors);

      // Build Vorbis comments
      const comments: Record<string, string> = {
        // Basic track information
        TITLE: trackInfo.title,
        TRACKNUMBER: trackInfo.trackNumber.toString().padStart(2, "0"),
        TRACKTOTAL: albumInfo.numberOfTracks.toString().padStart(2, "0"),
        DISCNUMBER: trackInfo.volumeNumber.toString().padStart(2, "0"),
        DISCTOTAL: albumInfo.numberOfVolumes.toString().padStart(2, "0"),
        // Album information
        ALBUM: albumInfo.title,
        DATE: albumInfo.releaseDate,
        YEAR: albumInfo.releaseDate.substring(0, 4),
        COPYRIGHT: trackInfo.copyright,
        LABEL: albumInfo.label || "",
        UPC: albumInfo.upc || "",
        // Track identifiers
        ISRC: trackInfo.isrc || "",
        BARCODE: albumInfo.upc || "",
        // Artist information
        ARTIST: FormatUtils.joinListValues(
          trackInfo.artists.map((artist: any) => artist.name),
        ),
        ALBUMARTIST: albumInfo.artist?.name || "",
        // Technical information
        EXPLICIT: FormatUtils.formatBoolean(trackInfo.explicit || false),
      };

      // Add cover art
      const coverUrl = FormatUtils.getCoverUrl(albumInfo.cover, 1280);
      if (coverUrl) {
        comments["COVER"] = coverUrl;
      }

      // Add lyrics if available
      const formattedLyrics = FormatUtils.formatLyrics(lyricsModel);
      if (formattedLyrics) {
        comments["LYRICS"] = formattedLyrics;
      }

      // Map contributor roles to Vorbis comments
      const roleMapping: Record<string, string> = {
        Composer: "COMPOSER",
        Lyricist: "LYRICIST",
        Producer: "PRODUCER",
        Mixer: "MIXER",
        Engineer: "ENGINEER",
        "Mastering Engineer": "ENCODED_BY",
        "Associated Performer": "PERFORMER",
        "Additional Producer": "ARRANGER",
      };

      for (const [role, vorbisTag] of Object.entries(roleMapping)) {
        if (contributorsByRole[role]) {
          comments[vorbisTag] = FormatUtils.joinListValues(
            contributorsByRole[role],
          );
        }
      }

      // Add URLs
      if (trackInfo.url) {
        comments["DESCRIPTION"] = trackInfo.url;
      }

      // Clean up comments by removing empty values
      return Object.fromEntries(
        Object.entries(comments).filter(([_, value]) => value !== ""),
      );
    } catch (error) {
      throw error;
    }
  }
}
