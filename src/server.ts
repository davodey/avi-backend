import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { z } from 'zod';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import ytdl from '@distube/ytdl-core';
import { OpenAI } from 'openai';

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

const PORT = process.env.PORT ? Number(process.env.PORT) : 5055;

const BodySchema = z.object({
  url: z.string().url('Invalid URL').refine((u) => /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\//.test(u), {
    message: 'URL must be a YouTube link',
  }),
});

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

if (!process.env.OPENAI_API_KEY) {
  console.warn('[WARN] OPENAI_API_KEY is not set.');
}

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

  try {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yt-audio-'));
    const audioPath = path.join(tempDir, 'audio.mp3');

    console.log(`[download] Downloading audio from: ${url}`);

    // Download audio directly as readable stream
    const audioStream = ytdl(url, {
      filter: 'audioonly',
      quality: 'lowestaudio', // Faster download, good enough for transcription
    });

    // Save to file
    await new Promise<void>((resolve, reject) => {
      const writeStream = fs.createWriteStream(audioPath);
      audioStream.pipe(writeStream);
      audioStream.on('error', reject);
      writeStream.on('error', reject);
      writeStream.on('finish', resolve);
    });

    console.log(`[download] Audio downloaded to ${audioPath}`);

    // Transcribe with OpenAI Whisper
    console.log(`[transcribe] Sending to OpenAI Whisper...`);
    const readStream = fs.createReadStream(audioPath);
    const response = await openai.audio.transcriptions.create({
      file: readStream as any,
      model: 'whisper-1',
    });

    console.log(`[transcribe] Success!`);

    res.json({
      ok: true,
      url,
      transcript: {
        text: response.text,
      },
    });
  } catch (err: any) {
    console.error('[error]:', err?.message || err);
    res.status(500).json({ ok: false, error: err?.message || 'Unknown error' });
  } finally {
    if (tempDir && fs.existsSync(tempDir)) {
      try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
    }
  }
});

app.listen(PORT, () => {
  console.log(`Transcription service listening on http://localhost:${PORT}`);
  console.log(`Using ytdl + OpenAI Whisper - WORKING solution`);
});
