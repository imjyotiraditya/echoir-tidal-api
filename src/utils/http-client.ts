/**
 * HttpClient - Utility for making HTTP requests
 */
class HttpClient {
  /**
   * Makes an HTTP request and returns the JSON response
   * @param url - The URL to request
   * @param method - HTTP method (GET, POST, etc.)
   * @param headers - HTTP headers
   * @param params - URL query parameters
   * @param body - Request body
   * @returns Promise resolving to the JSON response
   */
  async makeRequest(
    url: string,
    method: string = "GET",
    headers: HeadersInit = {},
    params?: Record<string, string>,
    body?: BodyInit,
  ): Promise<any> {
    let fullUrl = url;

    // Add query parameters to the URL if provided
    if (params) {
      const urlObj = new URL(url);
      Object.entries(params).forEach(([key, value]) => {
        urlObj.searchParams.append(key, value);
      });
      fullUrl = urlObj.toString();
    }

    try {
      const response = await fetch(fullUrl, {
        method,
        headers,
        body,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw {
          status: response.status,
          message: `HTTP error ${response.status}: ${errorText}`,
        };
      }

      return await response.json();
    } catch (error) {
      // If we already have a status, just throw the error
      if (error.status) {
        throw error;
      }
      // Otherwise, wrap it in a standard format
      throw {
        status: 503,
        message: `Request failed: ${error.message}`,
      };
    }
  }
}

// Export a singleton instance
export const httpClient = new HttpClient();
