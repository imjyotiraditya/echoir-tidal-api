import * as xmljs from "xml-js";
import { TidalAPI } from "./tidal-api";
import {
  SessionType,
  Track,
  TrackPlaybackRequest,
  Lyrics,
  SearchItem,
} from "../types";
import { httpClient } from "../utils/http-client";
import { FormatUtils } from "../utils/format-utils";
import {
  CLIENT_IDS,
  DEFAULT_COUNTRY,
  API_URLS,
  PUBLIC_TOKENS,
} from "../config/constants";

/**
 * Service for Tidal-specific functionality
 */
export class TidalService {
  constructor(private api: TidalAPI) {}

  /**
   * Decode and validate manifest
   * @param encodedManifest - Base64 encoded manifest
   * @param manifestMimeType - Manifest MIME type
   * @returns Tuple of [formatted manifest, URLs, codec]
   */
  private decodeAndValidateManifest(
    encodedManifest: string,
    manifestMimeType: string,
  ): [string, string[], string | null] {
    if (!encodedManifest) {
      throw {
        status: 404,
        message: "Manifest is empty. No playback data available.",
      };
    }

    const decodedManifest = FormatUtils.decodeBase64ToString(encodedManifest);
    let formattedManifest = decodedManifest;
    let codec = null;

    if (manifestMimeType === "application/dash+xml") {
      formattedManifest = FormatUtils.formatXml(decodedManifest);

      // Extract codec from XML
      try {
        const xmlObj = xmljs.xml2js(decodedManifest, { compact: true });
        const representation = xmlObj.MPD.Period.AdaptationSet.Representation;

        if (
          representation &&
          representation._attributes &&
          representation._attributes.codecs
        ) {
          codec = representation._attributes.codecs;
        }
      } catch (error) {
        throw {
          status: 500,
          message: `Error parsing XML manifest: ${error.message}`,
        };
      }
    } else if (manifestMimeType === "application/vnd.tidal.bts") {
      try {
        const manifestJson = JSON.parse(decodedManifest);
        if (manifestJson.codecs) {
          codec = manifestJson.codecs;
        }
      } catch (error) {
        throw {
          status: 500,
          message: `Error parsing JSON manifest: ${error.message}`,
        };
      }
    }

    const urls = this.extractUrls(decodedManifest, manifestMimeType);
    return [formattedManifest, urls, codec];
  }

  /**
   * Extract URLs from manifest
   * @param decodedManifest - Decoded manifest string
   * @param manifestMimeType - Manifest MIME type
   * @returns Array of URLs
   */
  private extractUrls(
    decodedManifest: string,
    manifestMimeType: string,
  ): string[] {
    if (manifestMimeType === "application/vnd.tidal.bts") {
      try {
        const manifestJson = JSON.parse(decodedManifest);
        return manifestJson.urls || [];
      } catch {
        return [];
      }
    } else if (manifestMimeType === "application/dash+xml") {
      try {
        const urls: string[] = [];

        // Parse XML using xml-js
        const xmlObj = xmljs.xml2js(decodedManifest, { compact: true });

        // Find the segment template
        const segmentTemplate =
          xmlObj.MPD.Period.AdaptationSet.Representation.SegmentTemplate;

        if (segmentTemplate) {
          // Add initialization URL if it exists
          if (
            segmentTemplate._attributes &&
            segmentTemplate._attributes.initialization
          ) {
            urls.push(segmentTemplate._attributes.initialization);
          }

          // Process segment timeline if it exists
          if (
            segmentTemplate.SegmentTimeline &&
            segmentTemplate._attributes.media
          ) {
            const startNumber = parseInt(
              segmentTemplate._attributes.startNumber || "1",
            );
            const mediaTemplate = segmentTemplate._attributes.media;

            // Get all S elements from the timeline
            const timeline = segmentTemplate.SegmentTimeline;
            const sElements = Array.isArray(timeline.S)
              ? timeline.S
              : [timeline.S];

            let currentTime = 0;
            const totalSegments = [];

            // Process each S element
            for (const s of sElements) {
              // If t attribute exists, use it as the starting time
              if (s._attributes.t) {
                currentTime = parseInt(s._attributes.t);
              }

              const duration = parseInt(s._attributes.d);
              const repeat = parseInt(s._attributes.r || "0");

              // Add segments based on repeat count
              for (let j = 0; j <= repeat; j++) {
                totalSegments.push(currentTime);
                currentTime += duration;
              }
            }

            // Generate URLs for all segments
            for (let i = 0; i < totalSegments.length; i++) {
              const segmentNumber = startNumber + i;
              let url = mediaTemplate.replace(
                "$Number$",
                segmentNumber.toString(),
              );
              url = url.replace("$Time$", totalSegments[i].toString());
              urls.push(url);
            }
          }
        }

        return urls;
      } catch (error) {
        console.error("Error extracting URLs from DASH manifest:", error);
        return [];
      }
    } else {
      // For other types, just return the manifest as a URL
      return [decodedManifest];
    }
  }

  /**
   * Get formats from media metadata
   * @param mediaMetadata - Media metadata
   * @param audioQuality - Audio quality string
   * @returns Array of format strings
   */
  private getFormats(
    mediaMetadata: any,
    audioQuality: string | null = null,
  ): string[] {
    const tags = mediaMetadata && mediaMetadata.tags ? mediaMetadata.tags : [];
    return !tags.length && audioQuality ? [audioQuality] : tags;
  }

  /**
   * Get audio modes
   * @param audioModes - Audio modes array
   * @returns Audio modes array or null
   */
  private getModes(audioModes: string[] | null): string[] | null {
    return audioModes || null;
  }

  /**
   * Get track info
   * @param id - Track ID
   * @param country - Country code
   * @returns Track info
   */
  async getTrackInfo(
    id: number,
    country: string = DEFAULT_COUNTRY,
  ): Promise<any> {
    const endpoint = `tracks/${id}`;
    const params = { countryCode: country };
    return await this.api.makeRequest(endpoint, SessionType.TV, params);
  }

  /**
   * Get track playback information
   * @param request - Track playback request
   * @returns Track playback data
   */
  async getTrackPlayback(request: TrackPlaybackRequest): Promise<Track> {
    try {
      const sessionType =
        request.quality === "DOLBY_ATMOS" && request.ac4
          ? SessionType.MOBILE_ATMOS
          : request.quality === "HI_RES_LOSSLESS"
            ? SessionType.MOBILE_DEFAULT
            : SessionType.TV;

      let qualityParam = request.quality;
      if (request.quality === "DOLBY_ATMOS") {
        qualityParam = "HI_RES_LOSSLESS";
      }

      const endpoint = `tracks/${request.id}/playbackinfopostpaywall/v4`;
      const params: Record<string, string> = {
        playbackmode: "STREAM",
        assetpresentation: "FULL",
        audioquality: qualityParam,
        prefetch: "false",
        countryCode: request.country,
      };

      if (request.quality === "DOLBY_ATMOS" && !request.immersive) {
        params.immersiveaudio = "false";
      }

      const responseJson = await this.api.makeRequest(
        endpoint,
        sessionType,
        params,
      );
      const manifest = responseJson.manifest;
      const manifestMimeType = responseJson.manifestMimeType || "";

      const [formattedManifest, urls, codec] = this.decodeAndValidateManifest(
        manifest,
        manifestMimeType,
      );

      return {
        id: responseJson.trackId || request.id,
        quality: responseJson.audioQuality || request.quality,
        manifest: formattedManifest,
        bit_depth: responseJson.bitDepth || null,
        sample_rate: responseJson.sampleRate || null,
        urls: urls,
        codec: codec,
      };
    } catch (error) {
      throw error;
    }
  }

  /**
   * Get track preview
   * @param id - Track ID
   * @returns Track preview data
   */
  async getTrackPreview(id: number): Promise<Track> {
    try {
      const url = `${API_URLS.BASE}/tracks/${id}/playbackinfo`;

      const params = {
        audioquality: "LOW",
        playbackmode: "STREAM",
        assetpresentation: "FULL",
      };

      const headers = {
        "x-tidal-streamingsessionid": PUBLIC_TOKENS.STREAMING_SESSION_ID,
        "x-tidal-token": PUBLIC_TOKENS.TOKEN,
      };

      const responseJson = await httpClient.makeRequest(
        url,
        "GET",
        headers,
        params,
      );
      const manifest = responseJson.manifest;
      const manifestMimeType = responseJson.manifestMimeType || "";

      const [formattedManifest, urls, codec] = this.decodeAndValidateManifest(
        manifest,
        manifestMimeType,
      );

      return {
        id: responseJson.trackId || id,
        quality: responseJson.audioQuality || "LOW",
        manifest: formattedManifest,
        bit_depth: responseJson.bitDepth || null,
        sample_rate: responseJson.sampleRate || null,
        urls: urls,
        codec: codec,
      };
    } catch (error) {
      throw error;
    }
  }

  /**
   * Get lyrics for a track
   * @param id - Track ID
   * @param country - Country code
   * @returns Lyrics data
   */
  async getLyrics(
    id: number,
    country: string = DEFAULT_COUNTRY,
  ): Promise<Lyrics> {
    const endpoint = `tracks/${id}/lyrics`;
    const params = {
      countryCode: country,
      deviceType: "TV",
      locale: "en_US",
      limit: "9999",
    };

    try {
      const response = await this.api.makeRequest(
        endpoint,
        SessionType.TV,
        params,
      );
      return {
        lyrics: response.lyrics,
        subtitles: response.subtitles,
        trackId: response.trackId || id,
      };
    } catch (error) {
      return {
        lyrics: null,
        subtitles: null,
        trackId: id,
      };
    }
  }

  /**
   * Get album info
   * @param id - Album ID
   * @param country - Country code
   * @returns Album info
   */
  async getAlbumInfo(
    id: number,
    country: string = DEFAULT_COUNTRY,
  ): Promise<any> {
    const endpoint = `albums/${id}`;
    const params = { countryCode: country };

    try {
      const response = await this.api.makeRequest(
        endpoint,
        SessionType.TV,
        params,
      );

      try {
        const creditsEndpoint = `albums/${id}/items/credits`;
        const credits = await this.api.makeRequest(
          creditsEndpoint,
          SessionType.TV,
          params,
        );
        if (credits) {
          return { ...response, ...credits };
        }
      } catch {
        // Ignore credits error
      }

      return response;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Get album tracks
   * @param id - Album ID
   * @param country - Country code
   * @returns Array of search items
   */
  async getAlbumTracks(
    id: number,
    country: string = DEFAULT_COUNTRY,
  ): Promise<SearchItem[]> {
    const endpoint = `albums/${id}/items`;
    const params = {
      countryCode: country,
      offset: "0",
      limit: "100",
    };

    try {
      const response = await this.api.makeRequest(
        endpoint,
        SessionType.TV,
        params,
      );
      if (!response || !response.items) {
        return [];
      }

      const searchItems: SearchItem[] = [];
      const totalTracks = response.totalNumberOfItems || 0;

      // Process initial batch
      for (const item of response.items) {
        if (item.type === "track") {
          const track = item.item;
          searchItems.push({
            id: track.id,
            title: track.title,
            duration: FormatUtils.formatDuration(track.duration),
            explicit: track.explicit || false,
            cover: FormatUtils.getCoverUrl(track.album?.cover),
            artists: track.artists.map((artist: any) => artist.name),
            formats: this.getFormats(track.mediaMetadata, track.audioQuality),
            modes: this.getModes(track.audioModes),
          });
        }
      }

      // Fetch remaining pages if needed
      let offset = response.items.length;
      while (offset < totalTracks) {
        params.offset = offset.toString();
        const nextBatch = await this.api.makeRequest(
          endpoint,
          SessionType.TV,
          params,
        );

        if (!nextBatch || !nextBatch.items) {
          break;
        }

        for (const item of nextBatch.items) {
          if (item.type === "track") {
            const track = item.item;
            searchItems.push({
              id: track.id,
              title: track.title,
              duration: FormatUtils.formatDuration(track.duration),
              explicit: track.explicit || false,
              cover: FormatUtils.getCoverUrl(track.album?.cover),
              artists: track.artists.map((artist: any) => artist.name),
              formats: this.getFormats(track.mediaMetadata, track.audioQuality),
              modes: this.getModes(track.audioModes),
            });
          }
        }

        offset += nextBatch.items.length;
      }

      return searchItems;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Search for tracks
   * @param query - Search query
   * @param country - Country code
   * @returns Array of search items
   */
  async searchTracks(
    query: string,
    country: string = DEFAULT_COUNTRY,
  ): Promise<SearchItem[]> {
    try {
      const endpoint = "search/tracks";
      const params = {
        query,
        countryCode: country,
        limit: "50",
        offset: "0",
        includeContributors: "true",
      };

      const response = await this.api.makeRequest(
        endpoint,
        SessionType.TV,
        params,
      );

      return (response.items || []).map((item: any) => ({
        id: item.id,
        title: item.title,
        duration: FormatUtils.formatDuration(item.duration),
        explicit: item.explicit || false,
        cover: FormatUtils.getCoverUrl(item.album?.cover),
        artists: item.artists.map((artist: any) => artist.name),
        formats: this.getFormats(item.mediaMetadata, item.audioQuality),
        modes: this.getModes(item.audioModes),
      }));
    } catch {
      return [];
    }
  }

  /**
   * Search for albums
   * @param query - Search query
   * @param country - Country code
   * @returns Array of search items
   */
  async searchAlbums(
    query: string,
    country: string = DEFAULT_COUNTRY,
  ): Promise<SearchItem[]> {
    try {
      const endpoint = "search/albums";
      const params = {
        query,
        countryCode: country,
        limit: "50",
        offset: "0",
        includeContributors: "true",
      };

      const response = await this.api.makeRequest(
        endpoint,
        SessionType.TV,
        params,
      );

      return (response.items || []).map((item: any) => ({
        id: item.id,
        title: item.title,
        duration: FormatUtils.formatDuration(item.duration),
        explicit: item.explicit || false,
        cover: FormatUtils.getCoverUrl(item.cover, 80, false),
        artists: item.artists.map((artist: any) => artist.name),
        formats: this.getFormats(item.mediaMetadata, item.audioQuality),
        modes: this.getModes(item.audioModes),
      }));
    } catch {
      return [];
    }
  }
}
