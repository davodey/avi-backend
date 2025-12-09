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

## Digital Ocean Deployment

There are three ways to deploy this Go backend to Digital Ocean:

### Option 1: App Platform with Dockerfile (Recommended)

This uses the included Dockerfile for a containerized deployment.

1. **Push your code to GitHub** (already done if using the claude branch)

2. **Create a new App in Digital Ocean**:
   - Go to [Digital Ocean App Platform](https://cloud.digitalocean.com/apps)
   - Click "Create App"
   - Select your GitHub repository: `davodey/avi-backend`
   - Select branch: `main` (or your deployment branch)

3. **Configure the App**:
   - **Build Method**: Select "Dockerfile"
   - **Dockerfile Path**: `Dockerfile`
   - **HTTP Port**: `5055`
   - **Health Check Path**: `/api/health`

4. **Set Environment Variables**:
   - `PORT` = `5055`
   - `OPENAI_API_KEY` = `your-openai-api-key` (mark as secret)
   - `YTDLP_COOKIES_FILE` = `./cookies.txt` (optional)

5. **Instance Size**:
   - Basic (1 GB RAM, 1 vCPU) or higher depending on load

6. **Deploy**: Click "Create Resources" and wait for deployment

### Option 2: App Platform with Native Go Build

This uses Digital Ocean's Go buildpack for faster builds.

1. **Use the App Spec file**:
   ```bash
   doctl apps create --spec .do/app-native.yaml
   ```

   Or manually configure:
   - **Build Command**:
     ```bash
     pip3 install --user yt-dlp && go build -o avi-backend main.go
     ```
   - **Run Command**: `./avi-backend`

2. **Set Environment Variables** (same as Option 1)

3. **Deploy**

### Option 3: Update Existing App

If you already have an app deployed with `npm run dev`:

1. **Go to your App in Digital Ocean Dashboard**

2. **Update Settings → Components → Edit Component**:
   - **Build Command**: `pip3 install --user yt-dlp && go build -o avi-backend main.go`
   - **Run Command**: `./avi-backend`
   - **HTTP Port**: `5055`

   Or switch to Dockerfile:
   - **Build Method**: Dockerfile
   - **Dockerfile Path**: `Dockerfile`

3. **Update Environment Variables**:
   - Remove Node.js specific variables
   - Add Go variables (see Option 1)

4. **Save and Deploy**

### Using App Spec File

You can also deploy using the included App Spec files:

```bash
# For Dockerfile-based deployment
doctl apps create --spec .do/app.yaml

# For native Go build
doctl apps create --spec .do/app-native.yaml

# Or update existing app
doctl apps update YOUR_APP_ID --spec .do/app.yaml
```

### Important Notes for Digital Ocean:

- **yt-dlp dependency**: Both deployment methods include yt-dlp installation
- **Go version**: Digital Ocean uses Go 1.21+ by default
- **Build time**: Dockerfile builds take ~3-5 minutes, native builds ~1-2 minutes
- **Health checks**: The `/api/health` endpoint is configured for monitoring
- **Secrets**: Always mark `OPENAI_API_KEY` as a secret in the environment variables
- **Scaling**: For high traffic, increase instance size or enable autoscaling

### Troubleshooting Digital Ocean Deployment:

**Build fails with "go: command not found"**:
- Ensure you're using Dockerfile or the native Go buildpack is detected
- Check that `go.mod` is in the repository root

**yt-dlp not found**:
- Verify the build command includes `pip3 install --user yt-dlp`
- For Dockerfile, it's already included in the image

**Health check failing**:
- Ensure `PORT` environment variable is set to `5055`
- Check that the app is listening on `0.0.0.0:5055` not `localhost:5055`

**App crashes on startup**:
- Check logs: `doctl apps logs YOUR_APP_ID`
- Verify `OPENAI_API_KEY` is set correctly
- Ensure the binary has execute permissions (handled automatically)



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
    "video": {
      "title": "Video Title",
      "description": "Video description...",
      "channel": "Channel Name",
      "channel_url": "https://www.youtube.com/@channel",
      "duration": 300,
      "upload_date": "20231215",
      "view_count": 123456,
      "thumbnail": "https://i.ytimg.com/vi/VIDEO_ID/maxresdefault.jpg"
    },
    "transcript": {
      "text": "Full transcript text...",
      "language": "en",
      "duration": 298.5,
      "segments": [
        {
          "id": 0,
          "start": 0.0,
          "end": 5.5,
          "text": "First segment of the transcript."
        },
        {
          "id": 1,
          "start": 5.5,
          "end": 12.0,
          "text": "Second segment continues here."
        }
      ]
    }
  }
  ```

  **Response Fields:**
  - `video.title` - Title of the YouTube video
  - `video.description` - Full description of the video
  - `video.channel` - Channel/uploader name
  - `video.channel_url` - URL to the channel
  - `video.duration` - Duration in seconds
  - `video.upload_date` - Upload date in YYYYMMDD format
  - `video.view_count` - Number of views
  - `video.thumbnail` - URL to video thumbnail
  - `transcript.text` - Full transcript as plain text
  - `transcript.language` - Detected language code (e.g., "en")
  - `transcript.duration` - Audio duration in seconds
  - `transcript.segments` - Array of timestamped segments
  - `segment.start` - Start time in seconds
  - `segment.end` - End time in seconds
  - `segment.text` - Text for this time segment

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

- **Article Writing Friendly**: The service returns formatted transcripts with timestamps, making it easy to reference specific sections when writing articles
- **Rich Metadata**: Video information (title, description, channel, views, etc.) is included to provide context for article creation
- **Timestamped Segments**: Each transcript segment includes start/end times, allowing you to jump to specific parts of the video
- Temporary files are created in your OS temp directory and automatically cleaned up after each request
- The service uses OpenAI's `whisper-1` model for transcription with verbose JSON output
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
