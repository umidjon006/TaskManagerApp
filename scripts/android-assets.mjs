// Android ikonka va splash resurslarini yaratadi — hech qanday kutubxonasiz (zlib + PNG yozuvchi).
// Geometriya server-version:scripts/make-icons.js dan (src/ui/public/icons/ dagi web ikonkalar
// aynan shu chizmadan): diagonal gradient #34c759 → #0a84ff, 78% to'lgan halqa, belgi.
//
//   node scripts/android-assets.mjs           → android/app/src/main/res/ ga yozadi
//   node scripts/android-assets.mjs --check   → web icon-512.png bilan piksel solishtirish
//
// Adaptive ikonka: 108dp kanvas, ko'rinadigan qismi markazdagi 72dp. Asl ikonka (birlik kvadrat)
// shu 72dp ga joylanadi → halqa diametri 48dp, xavfsiz zona (66dp doira) ichida.
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RES = join(ROOT, 'android/app/src/main/res');

// ---------- PNG yozish ----------

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
      const o = y * (size * 4 + 1) + 1 + x * 4;
      const [r, g, b, a] = pixel(x, y);
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------- Chizma (make-icons.js bilan bir xil) ----------

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const TOP = hex('#34c759'); // --green
const BOTTOM = hex('#0a84ff'); // --tint (dark)

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
    let ang = Math.atan2(v - 0.5, u - 0.5) + Math.PI / 2;
    if (ang < 0) ang += Math.PI * 2;
    if (ang <= Math.PI * 2 * 0.78) return true;
  }
  const w = 0.065;
  return distToSegment(u, v, 0.385, 0.51, 0.465, 0.59) < w / 2 || distToSegment(u, v, 0.465, 0.59, 0.625, 0.425) < w / 2;
}

const SS = 4; // supersampling
// map(x, y) → birlik kvadratdagi nuqta yoki null (chizmadan tashqari). Natija — oq qoplama ulushi.
function coverage(x, y, size, map, test) {
  let hit = 0;
  for (let i = 0; i < SS; i += 1) {
    for (let j = 0; j < SS; j += 1) {
      const p = map((x + (i + 0.5) / SS) / size, (y + (j + 0.5) / SS) / size);
      if (p && test(p[0], p[1])) hit += 1;
    }
  }
  return hit / (SS * SS);
}
const gradient = (u, v) => {
  const t = Math.min(1, Math.max(0, (u + v) / 2));
  return TOP.map((c, k) => Math.round(c + (BOTTOM[k] - c) * t));
};
const identity = (u, v) => [u, v];
// 108dp kanvas → markazdagi 72dp (asl ikonka)
const adaptive = (s, t) => [(s * 108 - 18) / 72, (t * 108 - 18) / 72];

// Asl web ikonka (tekshiruv uchun): gradient + oq chizma, to'liq kvadrat.
function renderWebIcon(size) {
  return png(size, (x, y) => {
    const a = coverage(x, y, size, identity, isWhite);
    return [...gradient(x / size, y / size).map((c) => Math.round(c + (255 - c) * a)), 255];
  });
}

// Adaptive foreground: shaffof fon, oq chizma. Android 13 "themed icon" (monochrome) ham shu.
function renderForeground(size) {
  return png(size, (x, y) => [255, 255, 255, Math.round(255 * coverage(x, y, size, adaptive, isWhite))]);
}

// Eski uslubdagi (adaptive'siz) ikonka: ko'rinadigan 72dp qism, shakl bilan kesilgan.
//   shape(u, v) — birlik kvadratda nuqta shakl ichidami.
const roundedSquare = (u, v) => {
  const r = 0.18; // ~13dp/72dp
  const dx = Math.max(r - u, 0, u - (1 - r));
  const dy = Math.max(r - v, 0, v - (1 - r));
  return dx * dx + dy * dy <= r * r;
};
const circle = (u, v) => Math.hypot(u - 0.5, v - 0.5) <= 0.5;
function renderLegacy(size, shape) {
  return png(size, (x, y) => {
    const inside = coverage(x, y, size, identity, shape);
    if (!inside) return [0, 0, 0, 0];
    const a = coverage(x, y, size, identity, isWhite);
    return [...gradient(x / size, y / size).map((c) => Math.round(c + (255 - c) * a)), Math.round(255 * inside)];
  });
}

// ---------- Tekshiruv ----------

function decodePng(buf) {
  // Faqat o'zimiz yozgan va 8-bit RGBA, filtr 0 bo'lmagan PNG'lar uchun ham ishlaydigan oddiy dekoder.
  let off = 8; const idat = []; let w = 0; let h = 0;
  while (off < buf.length) {
    const len = buf.readUInt32BE(off); const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); }
    if (type === 'IDAT') idat.push(data);
    off += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * 4; const out = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    const f = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x += 1) {
      const cur = raw[y * (stride + 1) + 1 + x];
      const a = x >= 4 ? out[y * stride + x - 4] : 0;
      const b = y > 0 ? out[(y - 1) * stride + x] : 0;
      const c = x >= 4 && y > 0 ? out[(y - 1) * stride + x - 4] : 0;
      const pa = Math.abs(b - c); const pb = Math.abs(a - c); const pc = Math.abs(a + b - 2 * c);
      const pred = [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][f];
      out[y * stride + x] = (cur + pred) & 0xff;
    }
  }
  return { w, h, data: out };
}

if (process.argv.includes('--check')) {
  const web = decodePng(readFileSync(join(ROOT, 'src/ui/public/icons/icon-512.png')));
  const mine = decodePng(renderWebIcon(512));
  let maxDiff = 0;
  for (let i = 0; i < web.data.length; i += 1) maxDiff = Math.max(maxDiff, Math.abs(web.data[i] - mine.data[i]));
  console.log(`icon-512.png bilan eng katta farq: ${maxDiff} (0 — aynan bir xil)`);
  process.exit(maxDiff <= 1 ? 0 : 1);
}

// ---------- Yozish ----------

function write(rel, content) {
  const file = join(RES, rel);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
  console.log(rel);
}

const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
for (const [name, k] of Object.entries(DENSITIES)) {
  write(`mipmap-${name}/ic_launcher_foreground.png`, renderForeground(Math.round(108 * k)));
  write(`mipmap-${name}/ic_launcher.png`, renderLegacy(Math.round(48 * k), roundedSquare));
  write(`mipmap-${name}/ic_launcher_round.png`, renderLegacy(Math.round(48 * k), circle));
}
