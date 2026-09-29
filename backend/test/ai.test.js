const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { createAi, AiError } = require('../src/ai');

// Soxta Anthropic API serveri: SDK haqiqiy HTTP so'rov yuboradi, biz javobni boshqaramiz.
let server;
let baseURL;
const requests = [];
let nextResponse;

before(async () => {
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      requests.push({ url: req.url, headers: req.headers, body: JSON.parse(body) });
      const { status, json } = nextResponse;
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(json));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseURL = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((resolve) => server.close(resolve)));

const message = (text, stopReason = 'end_turn') => ({
  status: 200,
  json: {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: 'claude-opus-5-5',
    content: [{ type: 'text', text }],
    stop_reason: stopReason,
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 10 },
  },
});

test("kalit bo'lmasa AI o'chiq", () => {
  assert.equal(createAi({ apiKey: '' }).enabled, false);
});

test('suggest: structured output so\'raladi, javob tekshiriladi va chegaralanadi', async () => {
  const ai = createAi({ apiKey: 'sk-test', baseURL });
  nextResponse = message(JSON.stringify({ importance: 14, type: 'oylik', reason: "Oylik to'lov" }));

  const result = await ai.suggest({ title: "Kommunal to'lov", description: '' });
  assert.deepEqual(result, { importance: 10, type: 'oylik', reason: "Oylik to'lov" });

  const req = requests.at(-1);
  assert.equal(req.url, '/v1/messages');
  assert.equal(req.headers['x-api-key'], 'sk-test');
  assert.equal(req.body.model, 'claude-opus-5-5');
  assert.equal(req.body.output_config.effort, 'low');
  assert.equal(req.body.output_config.format.type, 'json_schema');
  assert.deepEqual(req.body.output_config.format.schema.properties.type.enum, ['doimiy', 'kunlik', 'haftalik', 'oylik']);
  assert.equal(req.body.thinking, undefined, "Opus 5.5 da thinking'ni o'chirib bo'lmaydi — parametr yuborilmaydi");
  assert.match(req.body.messages[0].content, /Kommunal to'lov/);
});

test("suggest: noto'g'ri tur yoki buzuq JSON — tushunarli xato", async () => {
  const ai = createAi({ apiKey: 'sk-test', baseURL });
  nextResponse = message(JSON.stringify({ importance: 5, type: 'yillik', reason: 'x' }));
  await assert.rejects(ai.suggest({ title: 'x' }), (err) => err instanceof AiError && /formatda emas/.test(err.message));
  nextResponse = message('bu json emas');
  await assert.rejects(ai.suggest({ title: 'x' }), AiError);
});

test('refusal va 401 xatolari foydalanuvchi tilida', async () => {
  const ai = createAi({ apiKey: 'sk-test', baseURL });
  nextResponse = message('', 'refusal');
  await assert.rejects(ai.suggest({ title: 'x' }), /javob bermadi/);

  nextResponse = { status: 401, json: { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } } };
  await assert.rejects(ai.suggest({ title: 'x' }), (err) => err instanceof AiError && err.status === 503 && /kaliti/.test(err.message));
});

test("plan: vazifalar mahalliy vaqt bilan yuboriladi, matn qaytadi; bo'sh ro'yxatda API chaqirilmaydi", async () => {
  const ai = createAi({ apiKey: 'sk-test', baseURL });
  nextResponse = message("1) Hisobot — bugun tugaydi.\nOmad!");
  const count = requests.length;

  const empty = await ai.plan({ tasks: [], now: new Date(), tz: 'Asia/Tashkent' });
  assert.match(empty.text, /Bajarilmagan vazifa yo'q/);
  assert.equal(requests.length, count);

  const result = await ai.plan({
    tasks: [{ title: 'Hisobot', importance: 9, type: 'doimiy', deadline: '2026-09-29T13:00:00.000Z', overdue: false }],
    now: new Date('2026-09-29T05:00:00Z'),
    tz: 'Asia/Tashkent',
  });
  assert.equal(result.text, "1) Hisobot — bugun tugaydi.\nOmad!");
  const content = requests.at(-1).body.messages[0].content;
  assert.match(content, /Hozirgi vaqt: 29\.09\.2026 10:00/);
  assert.match(content, /Hisobot \| 9\/10 yulduz \| doimiy \| deadline: 29\.09\.2026 18:00/);
});
