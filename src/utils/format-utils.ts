import * as base64 from "base64-js";
import * as xmljs from "xml-js";

/**
 * Format utilities for data manipulation and formatting
 */
export class FormatUtils {
  /**
   * Format XML string to make it pretty and readable
   * @param xmlString - Raw XML string
   * @returns Formatted XML string
   */
  static formatXml(xmlString: string): string {
    try {
      const options = {
        compact: false,
        spaces: 2,
      };
      const jsObj = xmljs.xml2js(xmlString, options);
      return xmljs.js2xml(jsObj, options);
    } catch (error) {
      throw {
        status: 500,
        message: `Error formatting XML: ${error.message}`,
      };
    }
  }

  /**
   * Decode base64 string to text
   * @param base64String - Base64 encoded string
   * @returns Decoded string
   */
  static decodeBase64ToString(base64String: string): string {
    if (!base64String) {
      throw {
        status: 404,
        message: "String is empty. Nothing to decode.",
      };
    }

    const base64Bytes = base64.toByteArray(base64String);
    const decoder = new TextDecoder();
    return decoder.decode(base64Bytes);
  }

  /**
   * Format duration in seconds to MM:SS or HH:MM:SS format
   * @param seconds - Duration in seconds
   * @returns Formatted duration string
   */
  static formatDuration(seconds: number): string {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;

    if (minutes >= 60) {
      const hours = Math.floor(minutes / 60);
      const remainingMinutes = minutes % 60;
      return `${hours}:${remainingMinutes.toString().padStart(2, "0")}:${remainingSeconds.toString().padStart(2, "0")}`;
    }

    return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
  }

  /**
   * Format boolean as "1" or "0" string
   * @param value - Boolean value
   * @returns "1" for true, "0" for false
   */
  static formatBoolean(value: boolean): string {
    return value ? "1" : "0";
  }

  /**
   * Join array values with commas
   * @param values - Array of strings
   * @returns Comma-separated string
   */
  static joinListValues(values: string[]): string {
    return values?.length ? values.join(", ") : "";
  }

  /**
   * Get cover URL from cover ID with specified size
   * @param coverId - Cover ID
   * @param size - Image size (pixels)
   * @param isTrack - Whether this is a track (vs album)
   * @returns Cover URL
   */
  static getCoverUrl(
    coverId: string | null,
    size: number = 80,
    isTrack: boolean = true,
  ): string {
    if (!coverId) {
      if (isTrack) {
        return "https://tidal.com/browse/assets/images/defaultImages/defaultTrackImage.png";
      } else {
        return "https://tidal.com/browse/assets/images/defaultImages/defaultAlbumImage.png";
      }
    }

    return `https://resources.tidal.com/images/${coverId.replace(/-/g, "/")}/${size}x${size}.jpg`;
  }

  /**
   * Format lyrics for output
   * @param lyricsModel - Lyrics data
   * @returns Formatted lyrics string or null
   */
  static formatLyrics(lyricsModel: any): string | null {
    if (!lyricsModel) {
      return null;
    }

    if (lyricsModel.subtitles) {
      // Remove extra space after timestamp
      return lyricsModel.subtitles.replace(
        /(\[\d{2}:\d{2}.\d{2,3}])(?: )/g,
        "$1",
      );
    }

    if (lyricsModel.lyrics) {
      return lyricsModel.lyrics;
    }

    return null;
  }
}
