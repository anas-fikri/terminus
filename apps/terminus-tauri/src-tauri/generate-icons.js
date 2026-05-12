#!/usr/bin/env node
/**
 * Generate Terminus app icons using pure Node.js (no external deps).
 * Creates a clean terminal-themed icon: dark rounded square + > prompt symbol.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ICONS_DIR = path.join(__dirname, 'icons');

// ─── Minimal PNG encoder (no deps) ────────────────────────────────────────────
const zlib = require('zlib');

function u32be(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n, 0);
  return b;
}

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc & 1) ? (0xEDB88320 ^ (crc >>> 1)) : (crc >>> 1);
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const len = u32be(data.length);
  const crcData = Buffer.concat([typeBytes, data]);
  const crcVal = u32be(crc32(crcData));
  return Buffer.concat([len, typeBytes, data, crcVal]);
}

function encodePng(width, height, pixels) {
  // pixels: Uint8Array of width*height*4 (RGBA)
  const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: RGB (we'll strip alpha in filter but encode RGBA)
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  // Raw pixel data with filter bytes
  const rowBytes = width * 4;
  const raw = Buffer.alloc((rowBytes + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (rowBytes + 1)] = 0; // filter type: None
    for (let x = 0; x < width; x++) {
      const srcIdx = (y * width + x) * 4;
      const dstIdx = y * (rowBytes + 1) + 1 + x * 4;
      raw[dstIdx] = pixels[srcIdx];
      raw[dstIdx + 1] = pixels[srcIdx + 1];
      raw[dstIdx + 2] = pixels[srcIdx + 2];
      raw[dstIdx + 3] = pixels[srcIdx + 3];
    }
  }

  const compressed = zlib.deflateSync(raw, { level: 9 });
  const idat = pngChunk('IDAT', compressed);
  const iend = pngChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([SIGNATURE, pngChunk('IHDR', ihdr), idat, iend]);
}

// ─── Draw icon ────────────────────────────────────────────────────────────────
function drawIcon(size) {
  const pixels = new Uint8Array(size * size * 4);

  function setPixel(x, y, r, g, b, a = 255) {
    if (x < 0 || x >= size || y < 0 || y >= size) return;
    const i = (y * size + x) * 4;
    // Simple alpha blend over existing
    const srcA = a / 255;
    pixels[i]     = Math.round(pixels[i]     * (1 - srcA) + r * srcA);
    pixels[i + 1] = Math.round(pixels[i + 1] * (1 - srcA) + g * srcA);
    pixels[i + 2] = Math.round(pixels[i + 2] * (1 - srcA) + b * srcA);
    pixels[i + 3] = Math.min(255, pixels[i + 3] + a);
  }

  // Anti-aliased circle helper
  function fillRoundedRect(x0, y0, x1, y1, r, R, G, B, A = 255) {
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        // distance from nearest corner
        const cx = x < x0 + r ? x0 + r : x > x1 - r ? x1 - r : x;
        const cy = y < y0 + r ? y0 + r : y > y1 - r ? y1 - r : y;
        const dx = x - cx, dy = y - cy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist <= r) {
          const aa = Math.max(0, Math.min(1, r - dist + 0.5));
          setPixel(x, y, R, G, B, Math.round(A * aa));
        }
      }
    }
  }

  // Draw a filled circle
  function fillCircle(cx, cy, r, R, G, B, A = 255) {
    for (let y = cy - r - 1; y <= cy + r + 1; y++) {
      for (let x = cx - r - 1; x <= cx + r + 1; x++) {
        const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
        const aa = Math.max(0, Math.min(1, r - dist + 0.5));
        if (aa > 0) setPixel(x, y, R, G, B, Math.round(A * aa));
      }
    }
  }

  // Draw a horizontal line (thick)
  function hline(x0, x1, y, thick, R, G, B, A = 255) {
    for (let x = x0; x <= x1; x++) {
      for (let dy = -thick / 2; dy <= thick / 2; dy++) {
        const aa = Math.max(0, 1 - Math.abs(dy) / (thick / 2 + 0.5));
        setPixel(x, Math.round(y + dy), R, G, B, Math.round(A * aa));
      }
    }
  }

  // Draw ">" chevron text prompt symbol
  function drawChevron(cx, cy, sz, R, G, B, A = 255) {
    const half = sz / 2;
    const thick = Math.max(2, sz * 0.15);
    // Two angled lines making >
    for (let i = 0; i <= sz; i++) {
      const t = i / sz; // 0..1
      // Upper arm: from left-mid to right-top
      const x1 = Math.round(cx - half + i * 0.6);
      const y1 = Math.round(cy - t * half);
      // Lower arm: from right-top back to left-mid (mirror)
      const y2 = Math.round(cy + t * half);
      for (let d = -thick / 2; d <= thick / 2; d++) {
        const aa = Math.max(0, 1 - Math.abs(d) / (thick / 2 + 0.5));
        setPixel(x1 + Math.round(d * 0.7), y1 + Math.round(d * 0.7), R, G, B, Math.round(A * aa));
        setPixel(x1 + Math.round(d * 0.7), y2 + Math.round(d * 0.7), R, G, B, Math.round(A * aa));
      }
    }
  }

  const s = size;
  const pad = Math.round(s * 0.08);
  const radius = Math.round(s * 0.22);

  // Minimal dark tile base
  fillRoundedRect(pad, pad, s - pad - 1, s - pad - 1, radius, 0x0F, 0x17, 0x2A);

  // Very subtle top highlight for depth
  const glowH = Math.max(2, Math.round(s * 0.16));
  fillRoundedRect(pad, pad, s - pad - 1, pad + glowH, radius, 0x1E, 0x29, 0x42, 170);

  // Clean prompt mark: >_
  const markY = Math.round(s * 0.53);
  const markX = Math.round(s * 0.30);
  const chevSz = Math.round(s * 0.24);
  drawChevron(markX, markY, chevSz, 0xF8, 0xFA, 0xFC);

  const lineStart = markX + Math.round(s * 0.12);
  const lineEnd = lineStart + Math.round(s * 0.18);
  hline(lineStart, lineEnd, markY + Math.round(s * 0.01), Math.max(2, Math.round(s * 0.07)), 0x7D, 0xF9, 0xFF);

  return pixels;
}

// ─── Generate all sizes ───────────────────────────────────────────────────────
const sizes = [
  { size: 32,  file: '32x32.png' },
  { size: 64,  file: '32x32@2x.png' },
  { size: 128, file: '128x128.png' },
  { size: 256, file: '128x128@2x.png' },
];

for (const { size, file } of sizes) {
  const pixels = drawIcon(size);
  const png = encodePng(size, size, pixels);
  const outPath = path.join(ICONS_DIR, file);
  fs.writeFileSync(outPath, png);
  console.log(`✓ Generated ${file} (${size}x${size})`);
}

// Also generate ICO (simple wrapper for 32x32)
function generateIco(pngBuffer) {
  // ICO header
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: ICO
  header.writeUInt16LE(1, 4); // count: 1

  // Directory entry
  const entry = Buffer.alloc(16);
  entry[0] = 32; // width
  entry[1] = 32; // height
  entry[2] = 0;  // color count (0 = > 256)
  entry[3] = 0;  // reserved
  entry.writeUInt16LE(1, 4);  // color planes
  entry.writeUInt16LE(32, 6); // bits per pixel
  entry.writeUInt32LE(pngBuffer.length, 8);
  entry.writeUInt32LE(22, 12); // offset = header(6) + entry(16)

  return Buffer.concat([header, entry, pngBuffer]);
}

const png32 = fs.readFileSync(path.join(ICONS_DIR, '32x32.png'));
fs.writeFileSync(path.join(ICONS_DIR, 'icon.ico'), generateIco(png32));
console.log('✓ Generated icon.ico');

// For ICNS on macOS, try sips + iconutil if available
try {
  const iconsetDir = path.join(ICONS_DIR, 'AppIcon.iconset');
  if (!fs.existsSync(iconsetDir)) fs.mkdirSync(iconsetDir);
  
  const icnsSizes = [
    { src: '32x32.png',    dst: 'icon_16x16@2x.png' },
    { src: '32x32.png',    dst: 'icon_32x32.png' },
    { src: '32x32@2x.png', dst: 'icon_32x32@2x.png' },
    { src: '128x128.png',  dst: 'icon_128x128.png' },
    { src: '128x128@2x.png', dst: 'icon_128x128@2x.png' },
  ];
  for (const { src, dst } of icnsSizes) {
    fs.copyFileSync(path.join(ICONS_DIR, src), path.join(iconsetDir, dst));
  }
  execSync(`iconutil -c icns "${iconsetDir}" -o "${path.join(ICONS_DIR, 'icon.icns')}"`, { stdio: 'pipe' });
  fs.rmSync(iconsetDir, { recursive: true });
  console.log('✓ Generated icon.icns');
} catch (e) {
  console.log(`⚠ ICNS generation skipped (${e.message})`);
}

console.log('\nDone! Icons updated in src-tauri/icons/');
