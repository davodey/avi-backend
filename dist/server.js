import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { z } from 'zod';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import YTDlpWrap from 'yt-dlp-wrap';
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
    let tempDir = null;
    try {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yt-audio-'));
        const audioPath = path.join(tempDir, 'audio.mp3');
        console.log(`[download] Downloading audio from: ${url}`);
        // Initialize yt-dlp
        const ytDlpWrap = new YTDlpWrap();
        // Build yt-dlp arguments
        const args = [
            '--extract-audio',
            '--audio-format', 'mp3',
            '--audio-quality', '0', // Best quality
            '--output', audioPath,
            '--no-playlist',
            '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        ];
        // Add cookies file if available
        const cookiesFile = process.env.YTDLP_COOKIES_FILE;
        if (cookiesFile && fs.existsSync(cookiesFile)) {
            args.push('--cookies', cookiesFile);
            console.log(`[download] Using cookies from ${cookiesFile}`);
        }
        // Add the URL as the last argument
        args.push(url);
        // Download using yt-dlp
        await ytDlpWrap.execPromise(args);
        console.log(`[download] Audio downloaded to ${audioPath}`);
        // Transcribe with OpenAI Whisper
        console.log(`[transcribe] Sending to OpenAI Whisper...`);
        const readStream = fs.createReadStream(audioPath);
        const response = await openai.audio.transcriptions.create({
            file: readStream,
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
    }
    catch (err) {
        console.error('[error]:', err?.message || err);
        res.status(500).json({ ok: false, error: err?.message || 'Unknown error' });
    }
    finally {
        if (tempDir && fs.existsSync(tempDir)) {
            try {
                fs.rmSync(tempDir, { recursive: true, force: true });
            }
            catch { }
        }
    }
});
app.listen(PORT, () => {
    console.log(`Transcription service listening on http://localhost:${PORT}`);
    console.log(`Using yt-dlp + OpenAI Whisper - Enhanced bot detection evasion`);
});
//# sourceMappingURL=server.js.map