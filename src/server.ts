import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { z } from 'zod';
// @ts-ignore - no type definitions available
import { getSubtitles } from 'youtube-captions-scraper';

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

const PORT = process.env.PORT ? Number(process.env.PORT) : 5055;

const BodySchema = z.object({
  url: z.string().url('Invalid URL').refine((u) => /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\//.test(u), {
    message: 'URL must be a YouTube link',
  }),
  lang: z.string().optional(),
});

// Healthcheck
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'phoenix-backend-transcriber', time: new Date().toISOString() });
});

app.post('/api/transcribe', async (req, res) => {
  const parse = BodySchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ error: 'Invalid request body', details: parse.error.flatten() });
  }

  const { url, lang } = parse.data;

  try {
    // Extract video ID from various YouTube URL formats
    let videoId: string | null = null;

    const patterns = [
      /(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\?\/]+)/,
      /youtube\.com\/shorts\/([^&\?\/]+)/,
      /youtube\.com\/embed\/([^&\?\/]+)/,
    ];

    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match && match[1]) {
        videoId = match[1];
        break;
      }
    }

    if (!videoId) {
      throw new Error('Could not extract video ID from URL');
    }

    console.log(`[transcript] Fetching captions for video ID: ${videoId}`);

    // Fetch captions using youtube-captions-scraper
    const captions = await getSubtitles({
      videoID: videoId,
      lang: lang || 'en',
    });

    if (!captions || captions.length === 0) {
      throw new Error('No captions found for this video');
    }

    // Combine all caption segments into full text
    const fullText = captions.map((caption: any) => caption.text).join(' ');

    // Format response
    res.json({
      ok: true,
      url,
      method: 'youtube-captions-scraper',
      transcript: {
        text: fullText,
      },
      segments: captions.map((caption: any) => ({
        text: caption.text,
        start: caption.start,
        duration: caption.dur,
      })),
    });

    console.log(`[transcript] Successfully fetched ${captions.length} caption segments`);
  } catch (err: any) {
    console.error('[transcript] error:', err?.message || err);

    let errorMessage = err?.message || 'Unknown error';
    if (errorMessage.includes('Could not find captions') || errorMessage.includes('No captions')) {
      errorMessage = 'This video does not have captions/subtitles available in the requested language.';
    }

    res.status(500).json({
      ok: false,
      error: errorMessage,
      hint: 'Try a different language or ensure the video has captions enabled.',
    });
  }
});

app.listen(PORT, () => {
  console.log(`Transcription service listening on http://localhost:${PORT}`);
  console.log(`Using youtube-captions-scraper - fetching captions directly from YouTube`);
});
