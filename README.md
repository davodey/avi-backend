# Phoenix Backend — YouTube Transcription Service

A small Node/Express service you can run from the `backend` folder to transcribe audio from a YouTube URL using OpenAI's transcription models.

## Features
- POST `/api/transcribe` accepts `{ url: "https://www.youtube.com/..." }`
- Downloads the audio stream (audio-only) from the YouTube video
- Transcodes to MP3 via ffmpeg (bundled via `ffmpeg-static`)
- Sends the audio to OpenAI for transcription (default model: `gpt-4o-mini-transcribe`, fallback compatible with `whisper-1`)
- Returns structured JSON with the transcript

## Requirements
- Node.js v18.17+ (recommended LTS)
- An OpenAI API key

No system `ffmpeg` installation is required; the service uses `ffmpeg-static`.

## Setup
1. Open a terminal at the project root, then go to the backend folder:
   ```bash
   cd backend
   ```
2. Create your `.env` from the example and add your OpenAI key:
   ```bash
   cp .env.example .env
   # then edit .env and set OPENAI_API_KEY
   ```
3. Install dependencies (from the project root or here in `backend` if desired):
   ```bash
   npm install
   ```
   If you prefer separate install in backend only:
   ```bash
   cd backend && npm install
   ```

## Run (dev)
```bash
npm run dev
```
Service will start on `http://localhost:5055` by default. You can change `PORT` in `.env`.

## Build & Start (prod-like)
```bash
npm run build
npm start
```

## API
- Health check
  - `GET /api/health`
  - Response:
    ```json
    { "ok": true, "service": "phoenix-backend-transcriber", "time": "..." }
    ```

- Transcribe
  - `POST /api/transcribe`
  - Body:
    ```json
    { "url": "https://www.youtube.com/watch?v=VIDEO_ID" }
    ```
  - Response (shape):
    ```json
    {
      "ok": true,
      "model": "gpt-4o-mini-transcribe",
      "url": "https://...",
      "transcript": { "text": "... full transcript ..." }
    }
    ```
  - Example curl:
    ```bash
    curl -X POST http://localhost:5055/api/transcribe \
      -H 'Content-Type: application/json' \
      -d '{"url":"https://www.youtube.com/watch?v=dQw4w9WgXcQ"}'
    ```

## Notes
- Change model via `.env` using `OPENAI_TRANSCRIBE_MODEL` if you want to force `whisper-1`:
  ```env
  OPENAI_TRANSCRIBE_MODEL=whisper-1
  ```
- Temporary files are created in your OS temp directory and cleaned up after each request.
- If YouTube throttles requests, the code sets a user-agent header. For very long videos your request may take several minutes; consider increasing any client timeouts.
- If you plan to call this service from the frontend app, CORS is enabled by default. For production, you may wish to restrict allowed origins.
