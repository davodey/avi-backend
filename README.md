# Phoenix Backend — YouTube Transcription Service

A lightweight Go service that transcribes audio from YouTube URLs using OpenAI's Whisper API.

## Features
- POST `/api/transcribe` accepts `{ url: "https://www.youtube.com/..." }`
- Downloads the audio stream (audio-only) from the YouTube video using yt-dlp
- Converts to MP3 format
- Sends the audio to OpenAI Whisper for transcription
- Returns structured JSON with the transcript
- Cookie support for bypassing YouTube bot detection

## Requirements
- Go 1.22+ (for development)
- yt-dlp (YouTube downloader)
- An OpenAI API key

### Installing yt-dlp

**macOS:**
```bash
brew install yt-dlp
```

**Linux (Ubuntu/Debian):**
```bash
sudo apt update
sudo apt install yt-dlp
```

**Linux (other):**
```bash
pip3 install yt-dlp
```

**Windows:**
```bash
winget install yt-dlp
# or
pip3 install yt-dlp
```

## Setup

1. Clone the repository and navigate to the project directory

2. Create your `.env` file from the example:
   ```bash
   cp .env.example .env
   ```

3. Edit `.env` and set your OpenAI API key:
   ```env
   PORT=5055
   OPENAI_API_KEY=sk-proj-your-key-here
   YTDLP_COOKIES_FILE=./cookies.txt  # Optional: for bypassing bot detection
   ```

4. Install Go dependencies:
   ```bash
   go mod download
   ```

## Run (Development)

```bash
go run main.go
```

Service will start on `http://localhost:5055` by default. You can change the `PORT` in `.env`.

## Build & Run (Production)

```bash
# Build the binary
go build -o avi-backend

# Run the binary
./avi-backend
```

## Docker

Build and run with Docker:

```bash
# Build the image
docker build -t avi-backend .

# Run the container
docker run -p 5055:5055 --env-file .env avi-backend
```

## API

### Health Check
- **Endpoint:** `GET /api/health`
- **Response:**
  ```json
  {
    "ok": true,
    "service": "phoenix-backend-transcriber",
    "time": "2025-12-09T12:00:00Z"
  }
  ```

### Transcribe
- **Endpoint:** `POST /api/transcribe`
- **Body:**
  ```json
  {
    "url": "https://www.youtube.com/watch?v=VIDEO_ID"
  }
  ```
- **Response:**
  ```json
  {
    "ok": true,
    "url": "https://www.youtube.com/watch?v=VIDEO_ID",
    "transcript": {
      "text": "... full transcript ..."
    }
  }
  ```
- **Example curl:**
  ```bash
  curl -X POST http://localhost:5055/api/transcribe \
    -H 'Content-Type: application/json' \
    -d '{"url":"https://www.youtube.com/watch?v=dQw4w9WgXcQ"}'
  ```

## YouTube Bot Detection

If you encounter YouTube bot detection issues, you can provide cookies:

1. **Manual Method:**
   - Export cookies from your browser using an extension like "Get cookies.txt"
   - Save as `cookies.txt` in Netscape format

2. **Automated Method (requires Chrome/Chromium):**
   - See `scripts/get-youtube-cookies.js` for automated cookie extraction
   - Requires Node.js and Puppeteer

3. Set the path in your `.env`:
   ```env
   YTDLP_COOKIES_FILE=./cookies.txt
   ```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | `5055` | Server port |
| `OPENAI_API_KEY` | Yes | - | OpenAI API key for Whisper |
| `YTDLP_COOKIES_FILE` | No | - | Path to cookies file for YouTube authentication |

## Notes

- Temporary files are created in your OS temp directory and automatically cleaned up after each request
- The service uses OpenAI's `whisper-1` model for transcription
- CORS is enabled by default for all origins (restrict in production if needed)
- For very long videos, requests may take several minutes; consider increasing client timeouts
- The Go implementation provides better performance and lower memory usage compared to the Node.js version

## Migration from Node.js

This service has been migrated from Node.js/TypeScript to Go. The Node.js source files are still present in `src/` and `dist/` directories but are no longer used. The Go implementation in `main.go` provides the same functionality with:
- Better performance
- Lower memory footprint
- Simpler deployment (single binary)
- Faster startup time

The API endpoints and responses remain identical, ensuring backward compatibility.
