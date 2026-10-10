# Voice Navigation Proxy Server

Node.js and Express proxy server for hands-free web browsing. Keeps OpenAI and ElevenLabs API keys securely on the server, handles speech transcription, speech synthesis streaming with caching, and LLM intent resolution.

## Environment Variables (.env)

Create a `.env` file in `/server` (or copy from `.env.example`):

```bash
OPENAI_API_KEY=your_openai_api_key
ELEVEN_API_KEY=your_elevenlabs_api_key
ELEVEN_VOICE_ID=21m00Tcm4TlvDq8ikWAM
PORT=3001
```

## Running the Server

```bash
cd server
npm install
npm start
```

Or from project root:

```bash
npm run server
```

## Endpoints

- `GET /health`: Health check and configuration status.
- `POST /transcribe`: Accepts multipart audio (`audio` webm), forwards to OpenAI Whisper (`whisper-1`) with optional `language` parameter. Returns `{ text }`.
- `POST /speak`: Accepts `{ text }`, calls ElevenLabs TTS (`eleven_flash_v2_5`), streams audio/mpeg, and caches audio buffers in memory for repeated phrases.
- `POST /intent`: Accepts `{ transcript, elements }`, calls OpenAI to classify intent when built-in commands do not match. Returns `{ action: "click" | "scroll" | "navigate" | "type" | "none", target }`.
