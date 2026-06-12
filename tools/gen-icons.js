/* Generates public/icons/icon-180.png and icon-512.png (helm glyph, no deps). */
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
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePNG(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const C1 = [0x6d, 0x6f, 0xfb], C2 = [0x9b, 0x6d, 0xfb];

function glyphCoverage(x, y, size) {
  // Geometry in 512-space, scaled.
  const s = size / 512;
  const cx = size / 2, cy = size / 2;
  const dx = x - cx, dy = y - cy;
  const d = Math.hypot(dx, dy);
  const w = 30 * s / 2;
  if (Math.abs(d - 118 * s) <= w) return 1;            // ring
  if (d <= 40 * s) return 1;                           // hub
  for (let k = 0; k < 8; k++) {                        // spokes
    const a = (k * Math.PI) / 4;
    const px = dx * Math.cos(a) + dy * Math.sin(a);
    const py = -dx * Math.sin(a) + dy * Math.cos(a);
    const cap = Math.max(0, px < 96 * s ? 96 * s - px : px > 160 * s ? px - 160 * s : 0);
    if (Math.hypot(cap, Math.abs(py) > w ? Math.abs(py) - w : 0) === 0 && px >= 96 * s && px <= 160 * s && Math.abs(py) <= w) return 1;
  }
  return 0;
}

function roundedMask(x, y, size) {
  const r = size * 0.219; // matches rx=112/512
  const lx = Math.max(r - x, x - (size - 1 - r), 0);
  const ly = Math.max(r - y, y - (size - 1 - r), 0);
  return Math.hypot(lx, ly) <= r ? 1 : 0;
}

function makeIcon(size) {
  const buf = Buffer.alloc(size * size * 4);
  const SS = 3; // supersampling
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let mask = 0, glyph = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const fx = x + (sx + 0.5) / SS - 0.5;
          const fy = y + (sy + 0.5) / SS - 0.5;
          if (roundedMask(fx, fy, size)) {
            mask++;
            glyph += glyphCoverage(fx, fy, size);
          }
        }
      }
      const n = SS * SS;
      const a = mask / n, g = glyph / n;
      const t = (x + y) / (2 * size);
      const bg = [0, 1, 2].map((i) => C1[i] + (C2[i] - C1[i]) * t);
      const o = (y * size + x) * 4;
      buf[o] = Math.round(bg[0] * (1 - g) + 255 * g);
      buf[o + 1] = Math.round(bg[1] * (1 - g) + 255 * g);
      buf[o + 2] = Math.round(bg[2] * (1 - g) + 255 * g);
      buf[o + 3] = Math.round(a * 255);
    }
  }
  return encodePNG(size, size, buf);
}

const outDir = path.join(__dirname, '..', 'public', 'icons');
fs.mkdirSync(outDir, { recursive: true });
for (const size of [180, 512]) {
  fs.writeFileSync(path.join(outDir, `icon-${size}.png`), makeIcon(size));
  console.log(`wrote icon-${size}.png`);
}
