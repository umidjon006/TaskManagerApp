// Ilova ikonkalarini (PNG) hech qanday kutubxonasiz yaratadi: gradient fon + progress halqa + belgi.
//   node scripts/make-icons.js   →   frontend/public/icons/icon-{180,192,512}.png
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
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
function png(size, pixel) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x += 1) {
      const [r, g, b, a] = pixel(x, y);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const TOP = hex('#34c759');
const BOTTOM = hex('#0a84ff');

function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax; const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

// Birlik kvadratdagi (0..1) nuqta oq belgiga tegishlimi.
function isWhite(u, v) {
  const r = Math.hypot(u - 0.5, v - 0.5);
  const ringR = 0.3; const ringW = 0.07;
  if (Math.abs(r - ringR) < ringW / 2) {
    let ang = Math.atan2(v - 0.5, u - 0.5) + Math.PI / 2; // tepadan boshlab
    if (ang < 0) ang += Math.PI * 2;
    if (ang <= Math.PI * 2 * 0.78) return true; // 78% to'lgan halqa
  }
  const w = 0.065;
  return distToSegment(u, v, 0.385, 0.51, 0.465, 0.59) < w / 2 || distToSegment(u, v, 0.465, 0.59, 0.625, 0.425) < w / 2;
}

function render(size) {
  const SS = 4; // supersampling — silliq qirralar
  return png(size, (x, y) => {
    let white = 0;
    for (let i = 0; i < SS; i += 1) {
      for (let j = 0; j < SS; j += 1) {
        if (isWhite((x + (i + 0.5) / SS) / size, (y + (j + 0.5) / SS) / size)) white += 1;
      }
    }
    const t = (x + y) / (2 * size);
    const bg = TOP.map((c, k) => Math.round(c + (BOTTOM[k] - c) * t));
    const a = white / (SS * SS);
    return [...bg.map((c) => Math.round(c + (255 - c) * a)), 255];
  });
}

const outDir = path.join(__dirname, '..', 'frontend', 'public', 'icons');
fs.mkdirSync(outDir, { recursive: true });
for (const size of [180, 192, 512]) {
  fs.writeFileSync(path.join(outDir, `icon-${size}.png`), render(size));
  console.log(`icon-${size}.png`);
}
