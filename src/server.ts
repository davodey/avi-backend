import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { z } from 'zod';
import { YoutubeTranscript } from 'youtube-transcript';

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

const PORT = process.env.PORT ? Number(process.env.PORT) : 5055;

const BodySchema = z.object({
  url: z.string().url('Invalid URL').refine((u) => /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\//.test(u), {
    message: 'URL must be a YouTube link',
  }),
  // Optional: specify language preference
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
    console.log(`[transcript] Fetching transcript for: ${url}`);

    // Fetch transcript from YouTube captions
    const transcriptData = await YoutubeTranscript.fetchTranscript(url, {
      lang: lang || 'en',
    });

    // Combine all transcript segments into full text
    const fullText = transcriptData.map(segment => segment.text).join(' ');

    // Format response to match OpenAI Whisper format for compatibility
    res.json({
      ok: true,
      url,
      method: 'youtube-captions',
      transcript: {
        text: fullText,
      },
      // Include detailed segments if needed
      segments: transcriptData.map(segment => ({
        text: segment.text,
        start: segment.offset / 1000, // Convert ms to seconds
        duration: segment.duration / 1000, // Convert ms to seconds
      })),
    });

    console.log(`[transcript] Successfully fetched transcript (${transcriptData.length} segments)`);
  } catch (err: any) {
    console.error('[transcript] error:', err?.message || err);

    // Provide helpful error messages
    let errorMessage = err?.message || 'Unknown error';
    if (errorMessage.includes('Could not find captions') || errorMessage.includes('Transcript is disabled')) {
      errorMessage = 'This video does not have captions/subtitles available. Enable captions on YouTube or try a different video.';
    }

    res.status(500).json({
      ok: false,
      error: errorMessage,
      hint: 'This service requires videos to have captions enabled. Most videos have auto-generated captions.',
    });
  }
});

app.listen(PORT, () => {
  console.log(`Transcription service listening on http://localhost:${PORT}`);
  console.log(`Using youtube-transcript (caption fetching) - no downloads required`);
});
