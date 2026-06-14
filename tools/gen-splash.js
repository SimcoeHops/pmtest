/* Generates an iPhone splash screen PNG (1179x2556 — fits iPhone 14 Pro/15).
   Solid dark background with the Helm mark centred — replaces the white flash
   on launch when added to Home Screen.
   Run:  node tools/gen-splash.js
*/
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function crc32(buf) {
  let c, table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function encodePNG(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Gradient hex colours
const BG = [0x0d, 0x10, 0x17]; // --bg dark
const AC1 = [0x6d, 0x6f, 0xfb]; // --accent
const AC2 = [0x9b, 0x6d, 0xfb]; // --accent-2

function makeSplash(W, H) {
  const buf = Buffer.alloc(W * H * 4);
  // Icon size relative to screen
  const IS = Math.round(Math.min(W, H) * 0.20);
  const CX = W / 2, CY = H / 2 - IS * 0.1; // very slightly above true center
  const SS = 2;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let icon = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const fx = x + (sx + 0.5) / SS - 0.5 - CX;
          const fy = y + (sy + 0.5) / SS - 0.5 - CY;
          const d = Math.hypot(fx, fy);
          const w = IS * 0.059;
          // ring
          if (Math.abs(d - IS * 0.46) <= w) { icon++; continue; }
          // hub
          if (d <= IS * 0.156) { icon++; continue; }
          // spokes (8)
          for (let k = 0; k < 8; k++) {
            const a = (k * Math.PI) / 4;
            const px = fx * Math.cos(a) + fy * Math.sin(a);
            const py = -fx * Math.sin(a) + fy * Math.cos(a);
            if (px >= IS * 0.187 && px <= IS * 0.313 && Math.abs(py) <= w) { icon++; break; }
          }
        }
      }
      const o = (y * W + x) * 4;
      const g = icon / (SS * SS);
      buf[o]   = Math.round(BG[0] * (1 - g) + (AC1[0] + (AC2[0] - AC1[0]) * (x / W)) * g);
      buf[o+1] = Math.round(BG[1] * (1 - g) + (AC1[1] + (AC2[1] - AC1[1]) * (x / W)) * g);
      buf[o+2] = Math.round(BG[2] * (1 - g) + (AC1[2] + (AC2[2] - AC1[2]) * (x / W)) * g);
      buf[o+3] = 255;
    }
  }
  return encodePNG(W, H, buf);
}

const out = path.join(__dirname, '..', 'public', 'icons');
fs.mkdirSync(out, { recursive: true });

// Common iPhone sizes (portrait @3x scale)
const sizes = [
  ['splash-1179x2556.png', 1179, 2556],  // iPhone 14 Pro / 15 / 15 Pro
  ['splash-1290x2796.png', 1290, 2796],  // iPhone 14 Pro Max / 15 Pro Max
  ['splash-1170x2532.png', 1170, 2532],  // iPhone 13 / 14
  ['splash-750x1334.png',   750, 1334],  // iPhone SE 3rd gen
];

for (const [name, w, h] of sizes) {
  process.stdout.write(`generating ${name}…`);
  fs.writeFileSync(path.join(out, name), makeSplash(w, h));
  console.log(' done');
}
