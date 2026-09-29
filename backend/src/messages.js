// Telegram xabarlari matnlari (HTML parse_mode). Foydalanuvchi matni doim escapeHtml'dan o'tadi.
const T = require('./time');

const TYPE_LABELS = { doimiy: 'doimiy', kunlik: 'kunlik', haftalik: 'haftalik', oylik: 'oylik' };

function escapeHtml(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function shorten(text, max) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function progressBar(done, total, cells = 10) {
  const filled = total ? Math.round((done / total) * cells) : 0;
  return '🟩'.repeat(filled) + '⬜'.repeat(cells - filled);
}

function deadlineNote(task, now, tz) {
  if (!task.deadline) return '';
  const deadline = new Date(task.deadline);
  if (task.overdue) return ` · ⚠️ <b>muddati o'tgan</b> (${T.formatLocal(deadline, tz)})`;
  const sameDay = T.localDate(deadline, tz) === T.localDate(now, tz);
  return sameDay
    ? ` · ⏳ ${T.localParts(deadline, tz).time} gacha`
    : ` · 📅 ${T.formatLocal(deadline, tz)}`;
}

function doneButtons(tasks, limit = 8) {
  return tasks.slice(0, limit).map((t, i) => [{ text: `✅ ${i + 1}. ${shorten(t.title, 28)}`, callback_data: `done:${t.id}` }]);
}

// /vazifalar — bajarilmagan vazifalar ro'yxati.
function formatTaskList(tasks, tz, header, { now = new Date(), limit = 8 } = {}) {
  const shown = tasks.slice(0, limit);
  const lines = shown.map((t, i) => `${i + 1}. <b>${escapeHtml(t.title)}</b> — ★${t.importance} · ${TYPE_LABELS[t.type]}${deadlineNote(t, now, tz)}`);
  if (tasks.length > limit) lines.push(`… yana ${tasks.length - limit} ta`);
  return { text: `${header}\n\n${lines.join('\n')}`, buttons: doneButtons(shown, limit) };
}

// Bugungi e'tibor ro'yxati: nima bajarildi, nima qoldi.
//   Qolganlar = kunlik vazifalar + deadline'i bugun/o'tgan + muhimligi chegaradan yuqori
//               + yakshanba kuni haftaliklar + oy oxirida oyliklar.
function dayFocus(tasks, now, tz, minImportance) {
  const today = T.localDate(now, tz);
  const isSunday = T.weekdayOf(today) === 6;
  const isMonthEnd = T.monthEnd(today) === today;
  const doneToday = tasks.filter((t) => t.done && t.completed_at && T.localDate(t.completed_at, tz) === today);
  const pending = tasks.filter((t) => !t.done && (
    t.type === 'kunlik'
    || (t.deadline && T.localDate(t.deadline, tz) <= today)
    || t.importance >= minImportance
    || (t.type === 'haftalik' && isSunday)
    || (t.type === 'oylik' && isMonthEnd)
  ));
  return { today, doneToday, pending };
}

function dayStatusMessage({ doneToday, pending, today }, now, tz) {
  const total = doneToday.length + pending.length;
  const pct = total ? Math.round((doneToday.length / total) * 100) : 0;
  const lines = [
    `📋 <b>Bugun, ${T.dayLabel(today)}</b> · ${T.localParts(now, tz).time}`,
    `Bajarildi: <b>${doneToday.length} / ${total}</b> (${pct}%)`,
    progressBar(doneToday.length, total),
  ];
  if (doneToday.length) {
    lines.push('', '✅ <b>Bajarilganlar</b>');
    doneToday.slice(0, 10).forEach((t) => lines.push(`• <s>${escapeHtml(t.title)}</s> ★${t.importance}`));
    if (doneToday.length > 10) lines.push(`… yana ${doneToday.length - 10} ta`);
  }
  lines.push('', '⬜ <b>Qolganlar</b>');
  pending.slice(0, 10).forEach((t, i) => lines.push(`${i + 1}. <b>${escapeHtml(t.title)}</b> ★${t.importance}${deadlineNote(t, now, tz)}`));
  if (pending.length > 10) lines.push(`… yana ${pending.length - 10} ta`);
  lines.push('', '<i>Bajarganingizni pastdagi tugma bilan belgilang — keyingi soatda yangilangan holatni yuboraman.</i>');
  return { text: lines.join('\n'), buttons: doneButtons(pending) };
}

function allDoneMessage(doneCount, today) {
  return `🎉 <b>Barakalla!</b> ${T.dayLabel(today)} uchun barcha vazifalar bajarildi (${doneCount} ta).\nBugun boshqa eslatma yubormayman.`;
}

function deltaText(delta, unit) {
  if (delta === null || delta === undefined) return '';
  if (delta === 0) return ` · o'tgan ${unit}dagidek`;
  return ` · o'tgan ${unit}ga nisbatan ${delta > 0 ? '📈 +' : '📉 '}${delta}%`;
}

function reportBlock(report, title, unit) {
  const s = report.summary;
  const lines = [`<b>${title}</b> — ${report.range.sublabel}`];
  if (s.expected === 0) {
    lines.push("Bu davrda rejalashtirilgan vazifa yo'q.");
    return lines;
  }
  lines.push(`${progressBar(s.done, s.expected)} <b>${s.rate}%</b>`);
  lines.push(`Bajarildi ${s.done} / ${s.expected}${deltaText(s.delta, unit)}`);
  const left = [...report.missed, ...report.pending];
  if (left.length) {
    lines.push(`❌ Qolib ketgan: ${left.length} ta`);
    left.slice(0, 6).forEach((o) => lines.push(`  • ${escapeHtml(o.title)} ★${o.importance}${unit === 'kun' ? '' : ` (${o.due_label})`}`));
    if (left.length > 6) lines.push(`  … yana ${left.length - 6} ta`);
  }
  return lines;
}

// Kun yakuni (yakshanba — hafta, oy oxiri — oy hisoboti ham qo'shiladi).
function summaryMessage({ day, week, month }) {
  const lines = ['🌙 <b>Kun yakuni</b>', ''];
  lines.push(...reportBlock(day, 'Bugun', 'kun'));
  if (day.streak) lines.push(`🔥 Ketma-ket ${day.streak} kun hammasi bajarildi`);
  if (week) lines.push('', ...reportBlock(week, '📅 Hafta hisoboti', 'hafta'));
  if (month) lines.push('', ...reportBlock(month, '🗓 Oy hisoboti', 'oy'));
  lines.push('', "Batafsil diagrammalar — saytdagi «Hisobot» bo'limida.");
  return lines.join('\n');
}

module.exports = {
  escapeHtml,
  formatTaskList,
  dayFocus,
  dayStatusMessage,
  allDoneMessage,
  summaryMessage,
  reportBlock,
  progressBar,
};
