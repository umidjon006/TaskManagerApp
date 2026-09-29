const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');
const html = read('frontend', 'public', 'index.html');
const css = read('frontend', 'public', 'style.css');
const app = read('frontend', 'public', 'app.js');

test('desktop qobiq: chap menyu va ikki ustunli bugun sahifasi bor', () => {
  assert.match(html, /class="desktop-brand"/);
  assert.match(html, /class="today-grid"/);
  assert.match(css, /@media \(min-width: 900px\)/);
  assert.match(css, /--sidebar-w: 244px/);
  assert.match(css, /\.today-grid \{ display: grid; grid-template-columns:/);
});

test('desktop hisobot ikki ustunli, asosiy natija to\'liq kenglikda', () => {
  assert.match(css, /\.report-body \{ display: grid; grid-template-columns: repeat\(2,/);
  assert.match(css, /\.report-hero \{ grid-column: 1 \/ -1;/);
});

test('vazifa oynasi desktopda dialog, mobilda pastki sheet bo\'lib qoladi', () => {
  assert.match(css, /left: calc\(var\(--sidebar-w\)/);
  assert.match(css, /\.sheet\.open \{ transform: translate\(-50%, -50%\) scale\(1\)/);
  assert.match(app, /matchMedia\('\(min-width: 900px\)'\)\.matches/);
  assert.match(css, /bottom: 0; margin: 0 auto; width: 100%; max-width: 680px/);
});

test('mobil elementlar va cache-busting versiyasi saqlangan', () => {
  assert.match(html, /class="hint-mobile"/);
  assert.match(css, /\.fab span \{ display: none; \}/);
  assert.match(html, /style\.css\?v=4/);
  assert.match(html, /app\.js\?v=4/);
});

test('kun yakuni sozlamasi deployning barcha qatlamlariga ulangan', () => {
  assert.match(read('docker-compose.yml'), /DAILY_SUMMARY_HOUR: \$\{DAILY_SUMMARY_HOUR-21\}/);
  assert.match(read('.env.example'), /DAILY_SUMMARY_HOUR=21/);
  assert.match(read('scripts', 'setup-server.sh'), /DAILY_SUMMARY_HOUR=21/);
  assert.match(read('scripts', 'smoke-test.sh'), /READY=0/);
  assert.match(read('backend', '.dockerignore'), /^node_modules$/m);
});
