import fs from "fs";
import path from "path";
import zlib from "zlib";

// Simple PNG generator or SVG data URI for icons
// We will create extension/icons directory and write icons
const iconsDir = path.resolve(process.cwd(), "extension", "icons");
if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir, { recursive: true });
}

// Generate an SVG icon representing Handsfree (Webcam + Voice waves + Cursor)
const svgIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#0f172a" />
      <stop offset="100%" stop-color="#1e293b" />
    </linearGradient>
    <linearGradient id="brand" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#7bd3c2" />
      <stop offset="100%" stop-color="#38bdf8" />
    </linearGradient>
    <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="3" result="blur" />
      <feComposite in="SourceGraphic" in2="blur" operator="over" />
    </filter>
  </defs>
  <!-- Background Rounded Rect -->
  <rect width="128" height="128" rx="28" fill="url(#bg)" />
  <rect x="2" y="2" width="124" height="124" rx="26" fill="none" stroke="#7bd3c2" stroke-width="2" stroke-opacity="0.3" />
  
  <!-- Outer Focus Ring -->
  <circle cx="64" cy="64" r="44" fill="none" stroke="url(#brand)" stroke-width="3" stroke-dasharray="6 4" stroke-opacity="0.6" />
  
  <!-- Webcam / Eye Aperture Center -->
  <circle cx="64" cy="64" r="28" fill="#1e293b" stroke="url(#brand)" stroke-width="3" filter="url(#glow)" />
  <circle cx="64" cy="64" r="16" fill="url(#brand)" />
  <circle cx="68" cy="60" r="5" fill="#ffffff" opacity="0.9" />

  <!-- Voice Soundwaves Left & Right -->
  <path d="M 22 52 Q 18 64 22 76" fill="none" stroke="#7bd3c2" stroke-width="3" stroke-linecap="round" />
  <path d="M 14 44 Q 8 64 14 84" fill="none" stroke="#38bdf8" stroke-width="2.5" stroke-linecap="round" opacity="0.7" />

  <path d="M 106 52 Q 110 64 106 76" fill="none" stroke="#7bd3c2" stroke-width="3" stroke-linecap="round" />
  <path d="M 114 44 Q 120 64 114 84" fill="none" stroke="#38bdf8" stroke-width="2.5" stroke-linecap="round" opacity="0.7" />

  <!-- Handsfree Target Crosshairs -->
  <line x1="64" y1="12" x2="64" y2="28" stroke="#7bd3c2" stroke-width="3" stroke-linecap="round" />
  <line x1="64" y1="100" x2="64" y2="116" stroke="#7bd3c2" stroke-width="3" stroke-linecap="round" />
  <line x1="12" y1="64" x2="28" y2="64" stroke="#7bd3c2" stroke-width="3" stroke-linecap="round" />
  <line x1="100" y1="64" x2="116" y2="64" stroke="#7bd3c2" stroke-width="3" stroke-linecap="round" />
</svg>`;

fs.writeFileSync(path.join(iconsDir, "icon.svg"), svgIcon, "utf8");

// Generate minimal valid PNG binary icons for 16, 48, 128
// We can use a Node script with a tiny pure-JS PNG encoder (or uncompressed PNG chunks)
function createMinimalPng(size) {
  // Simple uncompressed valid RGBA PNG
  // PNG signature: 89 50 4E 47 0D 0A 1A 0A
  const width = size;
  const height = size;
  
  // We'll write an SVG file and copy it or create a valid RGBA PNG
  // For standard Chrome extension loading, Chrome supports PNG. Let's make an exact RGBA raw buffer & compress with zlib.
  
  const rawData = Buffer.alloc(height * (1 + width * 4));
  let offset = 0;
  
  const cx = width / 2;
  const cy = width / 2;
  const r = width * 0.45;
  
  for (let y = 0; y < height; y++) {
    rawData[offset++] = 0; // Filter type 0 (None)
    for (let x = 0; x < width; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      
      if (dist <= r) {
        // Brand Teal #7BD3C2 -> R:123, G:211, B:194
        if (dist <= r * 0.35) {
          // Center core
          rawData[offset++] = 255;
          rawData[offset++] = 255;
          rawData[offset++] = 255;
          rawData[offset++] = 255;
        } else if (dist <= r * 0.7) {
          rawData[offset++] = 123;
          rawData[offset++] = 211;
          rawData[offset++] = 194;
          rawData[offset++] = 255;
        } else {
          rawData[offset++] = 20;
          rawData[offset++] = 25;
          rawData[offset++] = 35;
          rawData[offset++] = 240;
        }
      } else {
        rawData[offset++] = 0;
        rawData[offset++] = 0;
        rawData[offset++] = 0;
        rawData[offset++] = 0;
      }
    }
  }
  
  const compressed = zlib.deflateSync(rawData);
  
  // CRC32 helper
  function crc32(buf) {
    let crc = 0 ^ -1;
    for (let i = 0; i < buf.length; i++) {
      crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
    }
    return (crc ^ -1) >>> 0;
  }
  
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c;
  }
  
  function makeChunk(type, data) {
    const len = data.length;
    const buf = Buffer.alloc(12 + len);
    buf.writeUInt32BE(len, 0);
    buf.write(type, 4, 4, "ascii");
    data.copy(buf, 8);
    const typeAndData = buf.subarray(4, 8 + len);
    buf.writeUInt32BE(crc32(typeAndData), 8 + len);
    return buf;
  }
  
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace
  
  const ihdrChunk = makeChunk("IHDR", ihdr);
  const idatChunk = makeChunk("IDAT", compressed);
  const iendChunk = makeChunk("IEND", Buffer.alloc(0));
  
  return Buffer.concat([sig, ihdrChunk, idatChunk, iendChunk]);
}

async function run() {
  for (const size of [16, 48, 128]) {
    const png = await createMinimalPng(size);
    fs.writeFileSync(path.join(iconsDir, `icon-${size}.png`), png);
    console.log(`Generated icon-${size}.png (${png.length} bytes)`);
  }
}

run().catch(console.error);
