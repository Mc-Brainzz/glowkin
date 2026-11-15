// Draws the app icon source (a plain glowing glowkin) as a PNG, with no dependencies.
// Usage: node scripts/make-icon.mjs && npx tauri icon src-tauri/app-icon.png
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const S = 1024;
const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src-tauri/app-icon.png');
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const INK = [9, 11, 32];

function pixel(dx, dy) {
  const d = Math.hypot(dx, dy);
  // Soft aura.
  let rgb = [60, 255, 170];
  let alpha = clamp01(1 - d / 0.98) ** 2 * 0.55;
  // Body.
  const bd = Math.hypot(dx / 0.62, (dy - 0.02) / 0.66);
  const cover = clamp01((1 - bd) / 0.012);
  if (cover > 0) {
    const t = clamp01(Math.hypot(dx + 0.2, dy + 0.28) / 0.95) ** 0.8;
    let body = mix([228, 255, 242], [40, 215, 140], t);
    body = mix(body, [18, 150, 112], bd ** 4 * 0.5);
    for (const side of [-1, 1]) {
      const ex = side * 0.22, ey = -0.06;
      if (Math.hypot((dx - ex) / 0.085, (dy - ey) / 0.1) < 1) {
        body = Math.hypot(dx - ex + 0.028, dy - ey + 0.036) < 0.032 ? [255, 255, 255] : INK;
      }
      if (Math.hypot(dx - side * 0.37, dy - 0.11) < 0.07) body = mix(body, [255, 120, 190], 0.35);
    }
    if (Math.abs(Math.hypot(dx, dy - 0.1) - 0.09) < 0.016 && dy > 0.135) body = INK;
    rgb = mix(rgb, body, cover);
    alpha = alpha + (1 - alpha) * cover;
  }
  return [...rgb, alpha * 255];
}

const raw = Buffer.alloc(S * (S * 4 + 1));
for (let y = 0; y < S; y++) {
  const row = y * (S * 4 + 1);
  for (let x = 0; x < S; x++) {
    const p = pixel((x + 0.5 - S / 2) / (S / 2), (y + 0.5 - S / 2) / (S / 2));
    for (let c = 0; c < 4; c++) raw[row + 1 + x * 4 + c] = Math.round(p[c]);
  }
}

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(body) >>> 0);
  return Buffer.concat([len, body, crc]);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(S, 0); ihdr.writeUInt32BE(S, 4);
ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA

fs.writeFileSync(out, Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
]));
console.log('Wrote', out);
