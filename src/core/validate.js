import { TASK_TYPES } from './time.js';

function toIso(value) {
  if (!value) return null;
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

// Foydalanuvchidan kelgan vazifa ma'lumotini tekshiradi. Xato bo'lsa { error }, aks holda { value }.
function validateTaskInput(body) {
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const description = typeof body.description === 'string' ? body.description.trim() : '';
  const type = body.type;
  const importance = Number(body.importance);
  const deadlineRaw = body.deadline ? String(body.deadline).trim() : null;

  if (!title) return { error: 'Vazifa nomini kiriting' };
  if (title.length > 200) return { error: 'Vazifa nomi 200 belgidan oshmasin' };
  if (description.length > 2000) return { error: 'Izoh 2000 belgidan oshmasin' };
  if (!TASK_TYPES.includes(type)) return { error: "Turi: doimiy, kunlik, haftalik yoki oylik bo'lsin" };
  if (!Number.isInteger(importance) || importance < 1 || importance > 10) {
    return { error: "Muhimlik 1 dan 10 gacha yulduz bo'lsin" };
  }

  let deadline = null;
  if (deadlineRaw) {
    const parsed = new Date(deadlineRaw);
    if (Number.isNaN(parsed.getTime())) return { error: "Deadline sanasi noto'g'ri" };
    deadline = parsed.toISOString();
  }

  return { value: { title, description, type, importance, deadline } };
}

// completion — shu vazifaning JORIY davrdagi bajarilish yozuvi (yo'q bo'lsa — bajarilmagan).
function publicTask(row, completion, now) {
  const done = Boolean(completion);
  const deadline = toIso(row.deadline);
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    type: row.type,
    importance: row.importance,
    deadline,
    completed_at: done ? toIso(completion.completed_at) : null,
    created_at: toIso(row.created_at),
    done,
    overdue: Boolean(deadline && !done && Date.parse(deadline) < now.getTime()),
  };
}

// Saralash: bajarilmaganlar tepada → muhimlik (10★ birinchi) → yaqin deadline → eski vazifa.
function compareTasks(a, b) {
  if (a.done !== b.done) return a.done ? 1 : -1;
  if (a.importance !== b.importance) return b.importance - a.importance;
  const da = a.deadline ? Date.parse(a.deadline) : Infinity;
  const db = b.deadline ? Date.parse(b.deadline) : Infinity;
  if (da !== db) return da - db;
  return a.id - b.id;
}

export { validateTaskInput, publicTask, compareTasks, toIso };
