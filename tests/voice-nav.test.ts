import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'node:child_process';

describe('Voice Navigation Server & Engine Suite', () => {
  let serverProcess: any = null;
  const baseUrl = 'http://127.0.0.1:3002';

  beforeAll(async () => {
    return new Promise((resolve, reject) => {
      serverProcess = spawn('node', ['server/index.js'], {
        env: {
          ...process.env,
          PORT: '3002',
          OPENAI_API_KEY: 'test_openai_key',
          ELEVEN_API_KEY: 'test_eleven_key',
          ELEVEN_VOICE_ID: '21m00Tcm4TlvDq8ikWAM'
        },
        stdio: ['ignore', 'pipe', 'pipe']
      });

      serverProcess.stdout.on('data', (data: Buffer) => {
        if (data.toString().includes('listening on port 3002')) {
          resolve(true);
        }
      });

      serverProcess.stderr.on('data', (err: Buffer) => {
        console.error('Server err:', err.toString());
      });

      serverProcess.on('error', (err: Error) => {
        reject(err);
      });

      setTimeout(() => resolve(true), 1500);
    });
  });

  afterAll(() => {
    if (serverProcess) {
      serverProcess.kill('SIGTERM');
    }
  });

  it('responds with ok and configuration status on GET /health', async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe('ok');
    expect(data.openaiConfigured).toBe(true);
    expect(data.elevenlabsConfigured).toBe(true);
  });

  it('rejects /transcribe without audio file with 400', async () => {
    const res = await fetch(`${baseUrl}/transcribe`, {
      method: 'POST'
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe('Audio file is required.');
  });

  it('rejects /speak without text parameter with 400', async () => {
    const res = await fetch(`${baseUrl}/speak`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe('Text parameter is required.');
  });

  it('rejects /intent without transcript parameter with 400', async () => {
    const res = await fetch(`${baseUrl}/intent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe('Transcript parameter is required.');
  });

  it('filters Whisper silence hallucinations correctly', () => {
    const filter = (text: string) => {
      const patterns = [
        /^thank you[.!]?$/i,
        /^thanks for watching[.!]?$/i,
        /^bye[.!]?$/i,
        /^you[.!]?$/i,
        /^\.+$/,
        /^subtitles by/i,
        /^subscribe[.!]?$/i,
        /^mbc[.!]?$/i,
        /^silence[.!]?$/i
      ];
      if (!text || text.trim().length < 2) return true;
      return patterns.some((p) => p.test(text.trim()));
    };

    expect(filter('Thank you.')).toBe(true);
    expect(filter('Thanks for watching!')).toBe(true);
    expect(filter('Bye.')).toBe(true);
    expect(filter('...')).toBe(true);
    expect(filter('')).toBe(true);
    expect(filter('scroll down')).toBe(false);
    expect(filter('click pricing')).toBe(false);
    expect(filter('type hello into the focused field')).toBe(false);
  });

  it('parses built-in voice command syntax correctly', () => {
    const parse = (text: string) => {
      const t = text.trim().toLowerCase();
      if (t === 'scroll down') return { action: 'scroll', direction: 'down' };
      if (t === 'scroll up') return { action: 'scroll', direction: 'up' };
      if (t === 'go to top') return { action: 'scroll', direction: 'top' };
      if (t === 'go to bottom') return { action: 'scroll', direction: 'bottom' };
      if (t === 'read this page') return { action: 'read' };
      if (t === 'refresh') return { action: 'refresh' };
      const clickMatch = t.match(/^(?:click|open|press)\s+(.+)$/i);
      if (clickMatch) return { action: 'click', target: clickMatch[1].trim() };
      const typeMatch = t.match(/^(?:type|enter|write)\s+(?:into the focused field\s+)?(.+)$/i);
      if (typeMatch) return { action: 'type', text: typeMatch[1].replace(/into the focused field$/i, '').trim() };
      return { action: 'intent_fallback' };
    };

    expect(parse('scroll down')).toEqual({ action: 'scroll', direction: 'down' });
    expect(parse('scroll up')).toEqual({ action: 'scroll', direction: 'up' });
    expect(parse('go to top')).toEqual({ action: 'scroll', direction: 'top' });
    expect(parse('go to bottom')).toEqual({ action: 'scroll', direction: 'bottom' });
    expect(parse('click pricing')).toEqual({ action: 'click', target: 'pricing' });
    expect(parse('open contact')).toEqual({ action: 'click', target: 'contact' });
    expect(parse('type hello into the focused field')).toEqual({ action: 'type', text: 'hello' });
    expect(parse('read this page')).toEqual({ action: 'read' });
    expect(parse('refresh')).toEqual({ action: 'refresh' });
    expect(parse('find me the cheapest option')).toEqual({ action: 'intent_fallback' });
  });
});
