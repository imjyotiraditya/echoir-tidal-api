# Echoir Tidal API

> [!IMPORTANT]
> This project is for educational purposes only.

A Cloudflare Workers API for interacting with the Tidal music streaming service. This API acts as a proxy for the Tidal API, allowing you to access music data, search, and playback URLs.

> [!NOTE]
> The client IDs and secrets used in this project were collected from various public repositories on GitHub. Credit belongs to the original discoverers of these credentials.

## Features

- **Track Endpoints**: Get track info, metadata, playback URLs, and previews
- **Album Endpoints**: Get album info and tracks
- **Search Endpoints**: Search for tracks and albums
- **Status Endpoint**: Check API operational status
- **Support for High-Quality Audio**: Access FLAC, HI-RES, and Dolby Atmos streams

## Prerequisites

- [Node.js](https://nodejs.org/) (v16 or higher)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/) (Cloudflare Workers CLI)
- A Cloudflare account
- Tidal subscription (for authentication)

## Setup

1. **Clone the repository**

```bash
git clone https://github.com/imjyotiraditya/echoir-tidal-api.git
cd echoir-tidal-api
```

2. **Install dependencies**

```bash
npm install
```

3. **Configure Wrangler**

Login to your Cloudflare account:

```bash
npx wrangler login
```

4. **Create KV Namespace**

Create a KV namespace for storing authentication tokens:

```bash
npx wrangler kv namespace create "TIDAL_TOKENS"
```

Take note of the KV namespace ID in the output.

5. **Configure Wrangler**

Create a `wrangler.toml` file based on the example:

```bash
cp wrangler.toml.example wrangler.toml
```

Then edit your `wrangler.toml` and replace the placeholder KV namespace ID with your actual ID:

```toml
[[kv_namespaces]]
binding = "TIDAL_TOKENS"
id = "YOUR_KV_NAMESPACE_ID"  # Replace with your actual KV namespace ID
```

5. **Generate Tidal Tokens**

Run the token generator script:

```bash
npm run generate-tokens
```

This will start the authentication process. The script will:
- Display a URL that you need to open in your browser
- In the browser, log in to your Tidal account to authorize the app
- Once authorized, return to the terminal and press Enter to continue
- Generate the necessary tokens for API access

When the script displays the tokens and formatting information, you'll need to:
1. Go to your Cloudflare dashboard
2. Navigate to Storage & Databases → KV
3. Select your "TIDAL_TOKENS" namespace
4. Click "Add entry"
5. For each token the script generated, create an entry with:
   - Key: The key shown in the output (e.g., `tidal_tokens:TV`)
   - Value: The JSON value from the output

6. **Deploy to Cloudflare Workers**

```bash
npm run deploy
```

This will deploy your API to Cloudflare Workers. Note the URL in the output; this is your API's endpoint.

## API Endpoints

### Status

- `GET /api/status` - Check API status

### Track Endpoints

- `GET /api/track/info?id={TRACK_ID}` - Get track information
- `GET /api/track/metadata?id={TRACK_ID}` - Get track metadata
- `POST /api/track/playback` - Get track playback URLs
- `GET /api/track/preview?id={TRACK_ID}` - Get track preview

### Album Endpoints

- `GET /api/album/info?id={ALBUM_ID}` - Get album information
- `GET /api/album/tracks?id={ALBUM_ID}` - Get album tracks

### Search Endpoints

- `GET /api/search?query={QUERY}&type=tracks` - Search for tracks
- `GET /api/search?query={QUERY}&type=albums` - Search for albums

## Playback API Usage

The Track Playback API accepts the following parameters:

```json
{
  "id": 123456789,          // Track ID (required)
  "quality": "LOSSLESS",    // Quality (e.g., LOW, HIGH, LOSSLESS, HI_RES_LOSSLESS, DOLBY_ATMOS)
  "country": "US",          // Country code
  "ac4": false,             // Use AC-4 codec for Dolby Atmos (only valid with DOLBY_ATMOS)
  "immersive": true         // Use immersive audio (only valid with DOLBY_ATMOS)
}
```

Example curl request:

```bash
curl -X POST https://your-worker-url.workers.dev/api/track/playback \
  -H "Content-Type: application/json" \
  -d '{"id": 123456789, "quality": "LOSSLESS", "country": "US"}'
```

## Configuration

You can modify the `wrangler.toml` file to customize your deployment:

```toml
name = "tidal-api"                    # Worker name
compatibility_date = "2024-09-23"
main = "src/index.ts"
compatibility_flags = ["nodejs_compat"]

[vars]
APP_TITLE = "Echoir Tidal API"        # Customize app title
APP_VERSION = "v1.0"                  # Customize app version

[[kv_namespaces]]
binding = "TIDAL_TOKENS"
id = "YOUR_KV_NAMESPACE_ID"           # Replace with your KV namespace ID

[observability.logs]
enabled = true
```

## Development

To run the API locally for development:

```bash
npm run start
```

This will start a local development server using Wrangler.

## Token Refresh

Tokens are automatically refreshed when they expire. The API handles token management internally.

If you need to regenerate tokens manually (e.g., if they become invalid), run:

```bash
npm run generate-tokens
```

## Security Considerations

- Keep your KV namespace ID and tokens secure
- Avoid exposing your API publicly without authentication
- Consider implementing rate limiting for production use

## License

MIT

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
