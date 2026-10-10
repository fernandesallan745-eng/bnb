import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const extensionDir = path.resolve(rootDir, 'extension');
const profileDir = path.resolve(rootDir, '.chrome-handsfree-profile');

const chromeCandidates = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
];

const chromePath = chromeCandidates.find((candidate) => existsSync(candidate));

if (!chromePath) {
  console.error('❌ Chromium browser executable not found in /Applications.');
  console.log('👉 To run manually:');
  console.log('1. Open your browser to chrome://extensions');
  console.log('2. Toggle "Developer mode" ON in the top right.');
  console.log(`3. Click "Load unpacked" and select: ${extensionDir}`);
  process.exit(1);
}

const args = [
  `--user-data-dir=${profileDir}`,
  `--load-extension=${extensionDir}`,
  '--no-first-run',
  '--no-default-browser-check',
  'http://localhost:8080/demo.html',
  'https://www.google.com',
];

console.log('🚀 Starting Voice Navigation & Eye Tracking Extension in Chromium...');
console.log(`📁 Extension Path: ${extensionDir}`);
console.log(`🌐 Browser: ${chromePath}`);
console.log('✨ Opened tabs: Demo Page (http://localhost:8080/demo.html) & Google Search');

const child = spawn(chromePath, args, {
  detached: true,
  stdio: 'ignore',
});

child.unref();
console.log('✅ Chrome launched successfully with Handsfree extension installed!');
