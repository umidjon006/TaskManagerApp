const Anthropic = require('@anthropic-ai/sdk');
const { TASK_TYPES, formatLocal } = require('./time');

const SUGGEST_SYSTEM = `Siz shaxsiy vazifalarni baholovchi yordamchisiz. Foydalanuvchi vazifa nomi va izohini beradi.
Sizning ishingiz: vazifaning muhimligini 1 dan 10 gacha yulduz bilan baholash va turini tanlash.

Muhimlik shkalasi:
- 10: albatta bajarilishi shart; bajarilmasa jiddiy oqibat (sog'liq, qonun, katta pul, bugungi qat'iy muddat, boshqa odamlar shunga bog'liq).
- 8-9: juda muhim; bir-ikki kun ichida bajarilmasa sezilarli zarar yoki yo'qotilgan imkoniyat.
- 5-7: muhim, lekin biroz kechiksa ham bo'ladi; odatiy ish va o'qish vazifalari.
- 3-4: foydali, ammo shoshilinch emas.
- 1-2: xohishga ko'ra; qilinmasa ham hech narsa bo'lmaydi.

Turlar:
- doimiy: bir marta bajariladi yoki muddatsiz, bajarilguncha ro'yxatda turadi.
- kunlik: har kuni takrorlanadi (odat, kundalik ish).
- haftalik: haftada bir marta.
- oylik: oyda bir marta (to'lovlar, hisobotlar).

"reason" maydonida o'zbek tilida bitta qisqa gap bilan nega shunday baholaganingizni tushuntiring.`;

const PLAN_SYSTEM = `Siz shaxsiy samaradorlik bo'yicha yordamchisiz. Foydalanuvchining bajarilmagan vazifalari ro'yxati beriladi.
Muhimlik (yulduzlar), deadline yaqinligi va vazifa turini hisobga olib, BUGUN nimadan boshlash kerakligini ayting.

Javob talablari:
- O'zbek tilida, sodda va do'stona.
- Eng ko'pi bilan 3 ta vazifani tartib bilan tanlang: "1) ... — sababi".
- Muddati o'tgan yoki bugun tugaydigan vazifa bo'lsa, buni alohida ogohlantiring.
- Oxirida bitta qisqa motivatsion gap.
- Jami 8 qatordan oshmasin. Markdown sarlavhalar va jadval ishlatmang.`;

const SUGGEST_SCHEMA = {
  type: 'object',
  properties: {
    importance: { type: 'integer', description: 'Muhimlik, 1 dan 10 gacha' },
    type: { type: 'string', enum: TASK_TYPES },
    reason: { type: 'string', description: "O'zbek tilida bitta qisqa gap" },
  },
  required: ['importance', 'type', 'reason'],
  additionalProperties: false,
};

class AiError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.status = status;
  }
}

function textOf(response) {
  return response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('')
    .trim();
}

function ensureUsable(response) {
  if (response.stop_reason === 'refusal') {
    throw new AiError("AI bu so'rovga javob bermadi. Vazifa matnini boshqacha yozib ko'ring.");
  }
}

// Anthropic xatolarini foydalanuvchiga tushunarli xabarga aylantiradi.
function translateError(err) {
  if (err instanceof AiError) return err;
  if (err instanceof Anthropic.AuthenticationError) return new AiError("AI kaliti noto'g'ri (ANTHROPIC_API_KEY)", 503);
  if (err instanceof Anthropic.RateLimitError) return new AiError("AI hozir band. Bir daqiqadan keyin qayta urinib ko'ring.", 503);
  if (err instanceof Anthropic.APIConnectionError) return new AiError('AI serveriga ulanib bo\'lmadi. Internetni tekshiring.', 503);
  if (err instanceof Anthropic.APIError) return new AiError(`AI xatosi (${err.status})`, 502);
  return new AiError('AI javobini qayta ishlashda xato');
}

function createAi({ apiKey, model = 'claude-opus-5-5', baseURL } = {}) {
  if (!apiKey) {
    return { enabled: false };
  }

  const client = new Anthropic({ apiKey, baseURL, timeout: 60_000, maxRetries: 1 });

  async function suggest({ title, description = '' }) {
    try {
      const response = await client.messages.create({
        model,
        max_tokens: 4000,
        system: SUGGEST_SYSTEM,
        output_config: {
          effort: 'low',
          format: { type: 'json_schema', schema: SUGGEST_SCHEMA },
        },
        messages: [{ role: 'user', content: `Vazifa: ${title}\nIzoh: ${description || "(yo'q)"}` }],
      });
      ensureUsable(response);

      const data = JSON.parse(textOf(response));
      const importance = Math.min(10, Math.max(1, Math.round(Number(data.importance))));
      if (!Number.isFinite(importance) || !TASK_TYPES.includes(data.type)) {
        throw new AiError("AI javobi kutilgan formatda emas");
      }
      return { importance, type: data.type, reason: String(data.reason || '').slice(0, 300) };
    } catch (err) {
      throw translateError(err);
    }
  }

  async function plan({ tasks, now, tz }) {
    if (tasks.length === 0) {
      return { text: "Bajarilmagan vazifa yo'q — ajoyib! Yangi maqsad qo'shishingiz mumkin." };
    }
    const lines = tasks.slice(0, 30).map((t, i) => {
      const parts = [`${i + 1}. ${t.title}`, `${t.importance}/10 yulduz`, t.type];
      if (t.deadline) parts.push(`deadline: ${formatLocal(new Date(t.deadline), tz)}${t.overdue ? ' (MUDDATI O\'TGAN)' : ''}`);
      return parts.join(' | ');
    });

    try {
      const response = await client.messages.create({
        model,
        max_tokens: 6000,
        system: PLAN_SYSTEM,
        output_config: { effort: 'low' },
        messages: [{
          role: 'user',
          content: `Hozirgi vaqt: ${formatLocal(now, tz)}\n\nBajarilmagan vazifalarim:\n${lines.join('\n')}`,
        }],
      });
      ensureUsable(response);
      const text = textOf(response);
      if (!text) throw new AiError("AI bo'sh javob qaytardi");
      return { text };
    } catch (err) {
      throw translateError(err);
    }
  }

  return { enabled: true, suggest, plan };
}

module.exports = { createAi, AiError, SUGGEST_SCHEMA };
