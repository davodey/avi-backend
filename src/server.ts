import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { z } from 'zod';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { promisify } from 'node:util';
import { pipeline as _pipeline } from 'node:stream';
import ytdl from 'ytdl-core';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';
import { OpenAI } from 'openai';
import { fileFromPath } from 'openai/uploads';
import youtubedl from 'youtube-dl-exec';

const pipeline = promisify(_pipeline);

// Configure ffmpeg binary for fluent-ffmpeg
if (ffmpegStatic) {
  ffmpeg.setFfmpegPath(ffmpegStatic as unknown as string);
}

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

const PORT = process.env.PORT ? Number(process.env.PORT) : 5055;

const BodySchema = z.object({
  url: z.string().url('Invalid URL').refine((u) => /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\//.test(u), {
    message: 'URL must be a YouTube link',
  }),
  // optional: choose language or prompt etc. in future
});

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

if (!process.env.OPENAI_API_KEY) {
  // Log a warning but don't crash so the server can still start and show a helpful error upon use.
  console.warn('[WARN] OPENAI_API_KEY is not set. /api/transcribe requests will fail until it is provided.');
}

// Healthcheck
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'phoenix-backend-transcriber', time: new Date().toISOString() });
});

app.post('/api/transcribe', async (req, res) => {
  const parse = BodySchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ error: 'Invalid request body', details: parse.error.flatten() });
  }

  const { url } = parse.data;

  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({ error: 'Server misconfiguration: OPENAI_API_KEY missing' });
  }

  let tempDir: string | null = null;
  let audioFilePath: string | null = null;

  try {
    // Create a temporary working directory
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yt-audio-'));
    audioFilePath = path.join(tempDir, 'audio.mp3');

    // Attempt 1: ytdl-core stream -> ffmpeg mp3
    let finalFilePath: string | null = null;
    let finalMime: string = 'audio/mpeg';
    let usedFallback = false;

    try {
      const audioStream = ytdl(url, {
        filter: 'audioonly',
        quality: 'highestaudio',
        dlChunkSize: 0, // disable chunking to reduce throttling edge cases
        requestOptions: {
          headers: {
            // Updated user-agent to latest Chrome version to bypass bot detection
            'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            'accept-language': 'en-US,en;q=0.9',
            'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'accept-encoding': 'gzip, deflate, br',
            'sec-fetch-dest': 'document',
            'sec-fetch-mode': 'navigate',
            'sec-fetch-site': 'none',
          },
        },
      });

      audioStream.on('error', (e) => {
        console.error('[ytdl] error:', (e as any)?.message || e);
      });

      // Transcode to mp3 with normalized settings using ffmpeg
      await new Promise<void>((resolve, reject) => {
        ffmpeg(audioStream)
          .audioCodec('libmp3lame')
          .audioBitrate('192k')
          .format('mp3')
          .on('start', (cmd) => console.log('[ffmpeg] start', cmd))
          .on('stderr', (line) => console.log('[ffmpeg]', line))
          .on('error', (err) => reject(new Error('FFmpeg error: ' + err.message)))
          .on('end', () => resolve())
          .save(audioFilePath!);
      });

      // Ensure output file exists and is not empty/suspiciously small
      const stats = fs.statSync(audioFilePath!);
      if (!stats.size || stats.size < 16000) {
        throw new Error('Audio extraction failed: produced file is empty or too small');
      }
      finalFilePath = audioFilePath!; // mp3 path
      finalMime = 'audio/mpeg';
    } catch (primaryErr: any) {
      // Fallback: use yt-dlp via youtube-dl-exec to fetch bestaudio container (webm/m4a/opus)
      usedFallback = true;
      console.warn('[fallback] ytdl-core/ffmpeg path failed:', primaryErr?.message || primaryErr);
      const outTemplate = path.join(tempDir!, 'audio.%(ext)s');
      try {
        const ytdlpOptions: any = {
          output: outTemplate,
          format: 'ba/bestaudio',
          noPlaylist: true,
          noWarnings: true,
          preferFreeFormats: true,
          // retries for robustness
          retries: 3,
          // limit filenames
          restrictFilenames: true,
          // reduce console noise from yt-dlp itself; we log stderr if it fails
          quiet: true,
          // Use Android/iOS mobile clients which are less restricted
          extractorArgs: 'youtube:player_client=android,ios,mweb',
          userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        };

        // Cookie support (optional, for when bot detection is strict)
        // Option 1: Use browser cookies (only works if Chrome is installed with logged-in profile)
        if (process.env.YTDLP_USE_BROWSER_COOKIES === 'true') {
          ytdlpOptions.cookiesFromBrowser = process.env.YTDLP_BROWSER || 'chrome';
        }
        // Option 2: Use exported cookies file (recommended for servers)
        // Export cookies from YouTube using browser extension, then upload to server
        else if (process.env.YTDLP_COOKIES_FILE) {
          ytdlpOptions.cookies = process.env.YTDLP_COOKIES_FILE;
        }

        const result = await youtubedl(url, ytdlpOptions);
        console.log('[ytdlp] done');
      } catch (e: any) {
        console.error('[ytdlp] error:', e?.stderr || e?.stdout || e?.message || e);
        throw new Error('Audio download failed via yt-dlp');
      }

      // Find the produced file (audio.webm/m4a/opus/mp3)
      const files = fs.readdirSync(tempDir!);
      const candidate = files.find((f) => /^audio\.(webm|m4a|opus|mp3)$/i.test(f));
      if (!candidate) {
        throw new Error('yt-dlp did not produce an audio file');
      }
      finalFilePath = path.join(tempDir!, candidate);

      // Determine MIME type based on extension
      const ext = path.extname(finalFilePath).toLowerCase();
      finalMime = ext === '.webm' ? 'audio/webm'
        : ext === '.m4a' ? 'audio/mp4'
        : ext === '.opus' ? 'audio/ogg'
        : 'audio/mpeg';

      const stats = fs.statSync(finalFilePath);
      if (!stats.size || stats.size < 16000) {
        throw new Error('Audio extraction failed (fallback): produced file is empty or too small');
      }
    }

    // Ensure final asset is MP3 for maximum compatibility; transcode if needed
    const extFinal = path.extname(finalFilePath!).toLowerCase();
    if (extFinal !== '.mp3') {
      const mp3Out = path.join(tempDir!, 'final.mp3');
      await new Promise<void>((resolve, reject) => {
        ffmpeg(finalFilePath!)
          .audioCodec('libmp3lame')
          .audioBitrate('192k')
          .format('mp3')
          .on('start', (cmd) => console.log('[ffmpeg transcode->mp3] start', cmd))
          .on('stderr', (line) => console.log('[ffmpeg transcode->mp3]', line))
          .on('error', (err) => reject(new Error('FFmpeg transcode-to-mp3 error: ' + err.message)))
          .on('end', () => resolve())
          .save(mp3Out);
      });
      const s2 = fs.statSync(mp3Out);
      if (!s2.size || s2.size < 16000) {
        throw new Error('Final MP3 is empty or too small after transcode');
      }
      finalFilePath = mp3Out;
      finalMime = 'audio/mpeg';
    }

    // Send to OpenAI for transcription
    const model = process.env.OPENAI_TRANSCRIBE_MODEL || 'whisper-1';

    let response;
    try {
      const readStream = fs.createReadStream(finalFilePath!);
      response = await openai.audio.transcriptions.create({
        file: readStream as any,
        model,
      });
    } catch (e: any) {
      if (e?.status) console.error('OpenAI status:', e.status);
      if (e?.response?.data) console.error('OpenAI error body:', e.response.data);
      throw e;
    }

    // Normalize response
    const result = typeof (response as any).text === 'string' ? { text: (response as any).text } : response;

    res.json({
      ok: true,
      model,
      url,
      transcript: result,
    });
  } catch (err: any) {
    console.error('Transcription error:', err?.message || err);
    res.status(500).json({ ok: false, error: err?.message || 'Unknown error' });
  } finally {
    // Cleanup temp files
    if (audioFilePath && fs.existsSync(audioFilePath)) {
      try { fs.unlinkSync(audioFilePath); } catch {}
    }
    if (tempDir && fs.existsSync(tempDir)) {
      try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
    }
  }
});

app.listen(PORT, () => {
  console.log(`Transcription service listening on http://localhost:${PORT}`);
});
