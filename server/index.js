import express from 'express';
import cors from 'cors';
import multer from 'multer';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '.env') });
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const app = express();
const port = process.env.PORT || 3001;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

const ttsCache = new Map();
const rateLimitMap = new Map();

function rateLimiter(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  const now = Date.now();
  const windowMs = 60 * 1000;
  const maxRequests = 100;

  const record = rateLimitMap.get(ip) || [];
  const recent = record.filter((timestamp) => now - timestamp < windowMs);

  if (recent.length >= maxRequests) {
    return res.status(429).json({ error: 'Too many requests. Please try again later.' });
  }

  recent.push(now);
  rateLimitMap.set(ip, recent);
  next();
}

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(rateLimiter);

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    openaiConfigured: Boolean(process.env.OPENAI_API_KEY),
    elevenlabsConfigured: Boolean(process.env.ELEVEN_API_KEY),
    elevenVoiceId: process.env.ELEVEN_VOICE_ID || '21m00Tcm4TlvDq8ikWAM'
  });
});

app.post('/transcribe', upload.single('audio'), async (req, res) => {
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ error: 'Audio file is required.' });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'OPENAI_API_KEY is not configured on the server.' });
    }

    const audioBlob = new Blob([req.file.buffer], { type: req.file.mimetype || 'audio/webm' });
    const formData = new FormData();
    formData.append('file', audioBlob, 'audio.webm');
    formData.append('model', 'whisper-1');

    const language = req.body.language || req.query.language;
    if (language && typeof language === 'string' && language.trim() !== '' && language !== 'auto') {
      formData.append('language', language.trim());
    }

    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`
      },
      body: formData
    });

    if (!response.ok) {
      const errorText = await response.text();
      return res.status(response.status).json({
        error: 'OpenAI Whisper API error',
        details: errorText
      });
    }

    const data = await response.json();
    return res.json({ text: (data.text || '').trim() });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Internal server error during transcription.' });
  }
});

app.post('/speak', async (req, res) => {
  try {
    const text = req.body.text;
    if (!text || typeof text !== 'string' || text.trim() === '') {
      return res.status(400).json({ error: 'Text parameter is required.' });
    }

    const apiKey = process.env.ELEVEN_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'ELEVEN_API_KEY is not configured on the server.' });
    }

    const voiceId = req.body.voiceId || process.env.ELEVEN_VOICE_ID || '21m00Tcm4TlvDq8ikWAM';
    const cacheKey = `${voiceId}:${text.trim().toLowerCase()}`;

    if (ttsCache.has(cacheKey)) {
      const cachedBuffer = ttsCache.get(cacheKey);
      res.setHeader('Content-Type', 'audio/mpeg');
      res.setHeader('X-Cache', 'HIT');
      return res.send(cachedBuffer);
    }

    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream`, {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg'
      },
      body: JSON.stringify({
        text: text.trim(),
        model_id: 'eleven_flash_v2_5'
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      return res.status(response.status).json({
        error: 'ElevenLabs API error',
        details: errorText
      });
    }

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('X-Cache', 'MISS');

    const chunks = [];
    for await (const chunk of response.body) {
      res.write(chunk);
      chunks.push(Buffer.from(chunk));
    }
    res.end();

    if (chunks.length > 0) {
      const fullBuffer = Buffer.concat(chunks);
      if (ttsCache.size > 500) {
        const firstKey = ttsCache.keys().next().value;
        ttsCache.delete(firstKey);
      }
      ttsCache.set(cacheKey, fullBuffer);
    }
  } catch (error) {
    if (!res.headersSent) {
      return res.status(500).json({ error: error.message || 'Internal server error during speech synthesis.' });
    }
    res.end();
  }
});

app.post('/intent', async (req, res) => {
  try {
    const { transcript, elements } = req.body;
    if (!transcript || typeof transcript !== 'string') {
      return res.status(400).json({ error: 'Transcript parameter is required.' });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'OPENAI_API_KEY is not configured on the server.' });
    }

    const systemPrompt = `You are a web voice navigation intent resolver.
Determine user intent from the transcript given the list of interactive elements.
Available actions:
- "click": click an interactive element. target MUST be the integer index of the chosen element.
- "scroll": scroll the page. target MUST be "up", "down", "top", or "bottom".
- "navigate": navigate history or page. target MUST be "back", "forward", or "refresh".
- "type": enter text. target MUST be the text string to type.
- "none": no applicable action found. target MUST be null.

Respond ONLY with valid JSON in this exact structure:
{"action": "click" | "scroll" | "navigate" | "type" | "none", "target": <number | string | null>}`;

    const userPrompt = JSON.stringify({
      transcript: transcript.trim(),
      elements: Array.isArray(elements) ? elements.slice(0, 50) : []
    });

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.1
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      return res.status(response.status).json({
        error: 'OpenAI Intent API error',
        details: errorText
      });
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    const parsed = JSON.parse(content || '{"action":"none","target":null}');
    return res.json(parsed);
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Internal server error resolving intent.' });
  }
});

app.listen(port, () => {
  console.log(`Voice navigation proxy server listening on port ${port}`);
});
