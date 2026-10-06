// Vazifalar — iOS uslubidagi mijoz qismi (framework'siz).
// Ma'lumotlar features/store.js orqali — qurilma ichidagi SQLite, server yo'q.
import * as Charts from './charts.js';
import { openDatabase, getNotifier, onAppResume } from '../platform/index.js';
import { createStore } from '../features/store.js';
import { syncNotifications } from '../features/notifications.js';
import schemaSql from '../data/schema.sql?raw';

const DONE_COLLAPSED_KEY = 'vazifalar_done_collapsed';
// Bildirishnoma ruxsati bir marta so'raldi — rad etilsa har ochilishda qayta so'ramaymiz.
// Yo'qolsa, eng ko'pi bilan yana bir marta so'raladi (Android o'zi ham ikkinchi raddan keyin so'ramaydi).
const NOTIF_ASKED_KEY = 'vazifalar_notif_asked';

const TYPE_LABELS = { doimiy: 'Doimiy', kunlik: 'Kunlik', haftalik: 'Haftalik', oylik: 'Oylik' };
const TYPE_HINTS = {
  doimiy: "Bir marta bajariladi — bajarilguncha ro'yxatda turadi.",
  kunlik: "Har kuni yangidan ochiladi — kundalik odatlar uchun.",
  haftalik: 'Har dushanba yangidan ochiladi.',
  oylik: "Har oyning 1-sanasida yangidan ochiladi.",
};
const MONTHS = ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr'];
const MONTHS_SHORT = ['yan', 'fev', 'mar', 'apr', 'may', 'iyn', 'iyl', 'avg', 'sen', 'okt', 'noy', 'dek'];
const WEEKDAYS = ['Yakshanba', 'Dushanba', 'Seshanba', 'Chorshanba', 'Payshanba', 'Juma', 'Shanba'];
const WD_SHORT = ['Ya', 'Du', 'Se', 'Ch', 'Pa', 'Ju', 'Sh'];
const STAR_PATH = 'M12 2.6l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.4l-5.8 3.1 1.1-6.5L2.6 9.4l6.5-.9z';

const state = {
  me: null,
  tasks: [],
  filter: 'all',
  tab: 'today',
  doneCollapsed: readStore(DONE_COLLAPSED_KEY) === '1',
  editing: null,
  importance: 5,
  type: 'doimiy',
  streak: 0,
  report: { period: 'day', offset: 0, data: null },
  scroll: {},
  notifications: null, // oxirgi syncNotifications natijasi: { scheduled, exactAlarm } yoki { skipped, permission? }
  notifySupported: false, // tabiiy ilova — eslatma qatorlari ko'rinadi
};

const $ = (id) => document.getElementById(id);

// ---------- Umumiy yordamchilar ----------

function readStore(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function writeStore(key, value) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch { /* xususiy rejim — e'tiborsiz */ }
}

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value; // textContent — XSS'dan himoya
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of [].concat(children)) if (child !== null && child !== undefined && child !== false) node.append(child);
  return node;
}

function icon(name, cls = 'ic') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', cls);
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#${name}`);
  svg.append(use);
  return svg;
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
function haptic(ms = 8) {
  if (navigator.vibrate && !reduceMotion()) navigator.vibrate(ms);
}
function springEasing() {
  const v = getComputedStyle(document.documentElement).getPropertyValue('--spring').trim();
  return v || 'cubic-bezier(0.32, 0.72, 0, 1)';
}

function levelClass(n) {
  if (n >= 10) return 'lvl-top';
  if (n >= 8) return 'lvl-high';
  if (n >= 5) return 'lvl-mid';
  return 'lvl-low';
}
function importanceLabel(n) {
  if (n >= 10) return 'Majburiy';
  if (n >= 8) return 'Juda muhim';
  if (n >= 5) return 'Muhim';
  if (n >= 3) return "O'rtacha";
  return 'Past';
}

// ---------- Ma'lumot ----------

// boot() da db ochilib, store.init() tugagandan keyin o'rnatiladi.
let store = null;
let notifier = null;

// ---------- Eslatmalar ----------

// Jadvalni o'zgartira oladigan store amallari: muvaffaqiyatli tugagach eslatmalar qayta jadvallanadi.
// Har bir chaqiruv joyiga alohida yozish o'rniga shu yerda — yangi joy qo'shilsa ham unutilmaydi.
const SCHEDULE_MUTATIONS = ['createTask', 'updateTask', 'deleteTask', 'restoreTask', 'toggleTask', 'updateSettings'];

function withNotificationSync(s) {
  for (const name of SCHEDULE_MUTATIONS) {
    const original = s[name].bind(s);
    s[name] = async (...args) => {
      const result = await original(...args);
      resyncNotifications();
      return result;
    };
  }
  return s;
}

// Debounce features/notifications.js da: ketma-ket chaqiruvlar bitta ishga birlashadi.
function resyncNotifications() {
  if (!store || !notifier) return;
  syncNotifications(store, notifier)
    .then((result) => {
      state.notifications = result;
      renderPermissionWarnings();
    })
    .catch((err) => console.warn('Eslatmalarni jadvallab bo\'lmadi:', err));
}

// Birinchi ishga tushishda — bir marta. Rad etilsa — boshqa so'ralmaydi (sozlamalardan yoqiladi, 5c).
async function askNotificationPermissionOnce() {
  if (!(await notifier.isSupported())) return;
  const { notifications } = await notifier.checkPermissions();
  if (notifications !== 'prompt' || readStore(NOTIF_ASKED_KEY)) return;
  writeStore(NOTIF_ASKED_KEY, '1');
  await notifier.requestPermissions();
}

async function withLoading(button, fn) {
  button.classList.add('loading');
  button.disabled = true;
  try {
    return await fn();
  } finally {
    button.classList.remove('loading');
    button.disabled = false;
  }
}

// ---------- Toast (pastdagi xabar, "Qaytarish" bilan) ----------

let toastTimer = null;
function toast(text, actionLabel, action) {
  const box = $('toast');
  $('toastText').textContent = text;
  const btn = $('toastAction');
  btn.classList.toggle('hidden', !actionLabel);
  btn.textContent = actionLabel || '';
  // Amal faqat bir marta: ikkinchi bosish (yoki yopilish animatsiyasi paytidagi bosish) e'tiborsiz.
  let used = false;
  btn.onclick = actionLabel ? async () => {
    if (used) return;
    used = true;
    hideToast();
    await action();
  } : null;
  box.hidden = false;
  requestAnimationFrame(() => box.classList.add('show'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, actionLabel ? 5000 : 2600);
}
function hideToast() {
  const box = $('toast');
  const btn = $('toastAction');
  // Yopilgan toast'ning amali endi ishlamaydi. Tugma animatsiya tugaguncha ko'rinib turadi.
  btn.onclick = null;
  box.classList.remove('show');
  setTimeout(() => {
    if (box.classList.contains('show')) return;
    box.hidden = true;
    btn.classList.add('hidden');
  }, 400);
}

// ---------- Sana ----------

const pad = (n) => String(n).padStart(2, '0');
const hhmm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const dayStart = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

function relativeDeadline(iso) {
  const d = new Date(iso);
  const diffDays = Math.round((dayStart(d) - dayStart(new Date())) / 86400000);
  if (diffDays === 0) return `Bugun ${hhmm(d)}`;
  if (diffDays === 1) return `Ertaga ${hhmm(d)}`;
  if (diffDays === -1) return `Kecha ${hhmm(d)}`;
  const base = `${WD_SHORT[d.getDay()]}, ${d.getDate()}-${MONTHS_SHORT[d.getMonth()]}`;
  return `${base}${d.getFullYear() !== new Date().getFullYear() ? ` ${d.getFullYear()}` : ''} ${hhmm(d)}`;
}

function toLocalInput(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${hhmm(date)}`;
}

// ---------- Segmented control ----------

function layoutSegmented(root) {
  const active = root.querySelector('.seg.active');
  const thumb = root.querySelector('.seg-thumb');
  if (!active || !thumb || !active.offsetWidth) return;
  thumb.style.width = `${active.offsetWidth}px`;
  thumb.style.transform = `translateX(${active.offsetLeft}px)`;
}
function setSegmented(root, value) {
  root.querySelectorAll('.seg').forEach((b) => {
    const on = b.dataset.value === value;
    b.classList.toggle('active', on);
    b.setAttribute(b.getAttribute('role') === 'radio' ? 'aria-checked' : 'aria-selected', String(on));
  });
  layoutSegmented(root);
}
function initSegmented(root, onChange) {
  root.addEventListener('click', (e) => {
    const btn = e.target.closest('.seg');
    if (!btn || btn.classList.contains('active')) return;
    haptic(5);
    setSegmented(root, btn.dataset.value);
    onChange(btn.dataset.value);
  });
  requestAnimationFrame(() => layoutSegmented(root));
}
const layoutAllSegmented = () => document.querySelectorAll('[data-segmented]').forEach(layoutSegmented);

// ---------- Ishga tushish ----------

async function showApp() {
  $('app').classList.remove('hidden');
  await refreshMe();
  const tab = { '#hisobot': 'report', '#sozlamalar': 'settings' }[location.hash] || 'today';
  switchTab(tab, { initial: true });
  await loadTasks();
  loadStreak();
}

// ---------- Tablar va navigatsiya ----------

function switchTab(tab, { initial = false } = {}) {
  if (!initial && tab === state.tab) {
    window.scrollTo({ top: 0, behavior: reduceMotion() ? 'auto' : 'smooth' });
    return;
  }
  state.scroll[state.tab] = window.scrollY;
  state.tab = tab;
  document.querySelectorAll('.tab').forEach((b) => {
    const on = b.dataset.tab === tab;
    b.classList.toggle('active', on);
    if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  document.querySelectorAll('.screen').forEach((s) => {
    const on = s.dataset.screen === tab;
    s.classList.toggle('hidden', !on);
    if (on && !initial) {
      s.classList.remove('entering');
      void s.offsetWidth;
      s.classList.add('entering');
    }
  });
  $('fab').classList.toggle('away', tab !== 'today');
  history.replaceState(null, '', { today: '#bugun', report: '#hisobot', settings: '#sozlamalar' }[tab]);
  window.scrollTo(0, state.scroll[tab] || 0);
  requestAnimationFrame(() => { layoutAllSegmented(); updateNavBars(); });
  if (tab === 'report') loadReport();
  if (tab === 'settings') renderSettings();
  if (tab === 'today' && !initial) loadTasks().catch(() => {});
}

function updateNavBars() {
  const scrolled = window.scrollY > 36;
  document.querySelectorAll('.screen:not(.hidden) .nav-bar').forEach((n) => n.classList.toggle('scrolled', scrolled));
}

// ---------- Profil ----------

async function refreshMe() {
  state.me = await store.getMe();
}

async function loadStreak() {
  try {
    const report = await store.getReport('day', 0);
    state.streak = report.streak || 0;
    renderHero();
  } catch { /* streak — qo'shimcha ma'lumot, xato bo'lsa ko'rsatmaymiz */ }
}

// ---------- Bugun: vazifalar ro'yxati ----------

function compareTasks(a, b) {
  if (a.done !== b.done) return a.done ? 1 : -1;
  if (a.importance !== b.importance) return b.importance - a.importance;
  const da = a.deadline ? Date.parse(a.deadline) : Infinity;
  const db = b.deadline ? Date.parse(b.deadline) : Infinity;
  if (da !== db) return da - db;
  return a.id - b.id;
}

async function loadTasks() {
  const data = await store.listTasks();
  state.tasks = data.tasks;
  renderTasks();
}

function renderHero() {
  const total = state.tasks.length;
  const done = state.tasks.filter((t) => t.done).length;
  const pct = total ? Math.round((done / total) * 100) : 0;
  const now = new Date();
  $('todayDate').textContent = `${WEEKDAYS[now.getDay()]}, ${now.getDate()}-${MONTHS[now.getMonth()]}`;
  $('heroDone').textContent = done;
  $('heroTotal').textContent = total;
  $('heroSub').textContent = total === 0
    ? "Birinchi vazifani qo'shing"
    : done === total ? 'Hammasi bajarildi — zo\'r!' : `${total - done} ta vazifa qoldi`;

  const ringBox = $('todayRing');
  const prev = ringBox.dataset.pct;
  if (prev !== String(pct)) {
    ringBox.replaceChildren(Charts.ring({ size: 92, stroke: 11, value: pct, label: `${pct}%` }));
    ringBox.dataset.pct = String(pct);
  }
  const streakChip = $('streakChip');
  streakChip.classList.toggle('hidden', !state.streak);
  streakChip.querySelector('span').textContent = `${state.streak} kun ketma-ket`;
  const overdue = state.tasks.filter((t) => t.overdue).length;
  const overdueChip = $('overdueChip');
  overdueChip.classList.toggle('hidden', !overdue);
  overdueChip.querySelector('span').textContent = `${overdue} ta muddati o'tgan`;
}

function taskMeta(task) {
  const items = [el('span', { class: 'meta-stars', 'aria-label': `Muhimlik ${task.importance} dan 10` }, [el('span', { class: 'star', text: '★' }), String(task.importance)])];
  items.push(el('span', { class: 'meta-item', text: TYPE_LABELS[task.type] }));
  if (task.deadline) {
    const left = Date.parse(task.deadline) - Date.now();
    const cls = task.overdue ? 'meta-item overdue' : (!task.done && left < 24 * 3600 * 1000 ? 'meta-item soon' : 'meta-item');
    items.push(el('span', { class: cls }, [icon(task.overdue ? 'i-alert' : 'i-clock'), relativeDeadline(task.deadline)]));
  }
  return el('div', { class: 'meta' }, items);
}

function taskItem(task) {
  const li = el('li', { class: `task ${levelClass(task.importance)}${task.done ? ' done' : ''}`, 'data-id': String(task.id) });
  const actions = el('div', { class: 'task-actions', 'aria-hidden': 'true' }, [
    el('div', { class: 'swipe-action swipe-done' }, [icon('i-check'), task.done ? 'Qaytarish' : 'Bajarildi']),
    el('div', { class: 'swipe-action swipe-delete' }, ["O'chirish", icon('i-trash')]),
  ]);
  const check = el('button', {
    class: 'check',
    type: 'button',
    'aria-label': task.done ? `"${task.title}" — bajarilmagan deb belgilash` : `"${task.title}" — bajarildi deb belgilash`,
    onclick: (e) => { e.stopPropagation(); toggleTask(task, li); },
  }, [icon('i-check')]);
  const row = el('div', {
    class: 'task-row',
    role: 'button',
    tabindex: '0',
    'aria-label': `${task.title}, ${task.importance} yulduz, ${TYPE_LABELS[task.type]}. Tahrirlash`,
    onclick: () => openSheet(task),
    onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openSheet(task); } },
  }, [
    check,
    el('div', { class: 'task-main' }, [
      el('div', { class: 'task-title', text: task.title }),
      task.description ? el('div', { class: 'task-desc', text: task.description }) : null,
      taskMeta(task),
    ]),
  ]);
  li.append(actions, row);
  attachSwipe(li, row, task);
  return li;
}

// FLIP: qayta chizishdan oldin/keyin joylashuvni o'lchab, qatorlarni yangi joyiga silliq suramiz.
function withFlip(render) {
  const before = new Map();
  document.querySelectorAll('#screen-today .task[data-id]').forEach((n) => before.set(n.dataset.id, n.getBoundingClientRect().top));
  render();
  if (reduceMotion()) return;
  const easing = springEasing();
  document.querySelectorAll('#screen-today .task[data-id]').forEach((n) => {
    const prev = before.get(n.dataset.id);
    if (prev === undefined) {
      if (before.size) {
        n.classList.add('entering');
        n.addEventListener('animationend', () => n.classList.remove('entering'), { once: true });
      }
      return;
    }
    const dy = prev - n.getBoundingClientRect().top;
    if (Math.abs(dy) < 1) return;
    try {
      n.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 520, easing });
    } catch {
      n.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 480, easing: 'cubic-bezier(0.32, 0.72, 0, 1)' });
    }
  });
}

function renderTasks() {
  state.tasks.sort(compareTasks);
  renderHero();
  const visible = state.tasks.filter((t) => state.filter === 'all' || t.type === state.filter);
  const pending = visible.filter((t) => !t.done);
  const done = visible.filter((t) => t.done);

  withFlip(() => {
    $('pendingList').replaceChildren(...pending.map(taskItem));
    $('doneList').replaceChildren(...(state.doneCollapsed ? [] : done.map(taskItem)));
  });

  $('pendingTitle').replaceChildren('Bajarilmagan ', el('span', { class: 'count', text: String(pending.length) }));
  $('pendingTitle').classList.toggle('hidden', pending.length === 0);
  $('doneTitle').replaceChildren('Bajarilgan ', el('span', { class: 'count', text: String(done.length) }));
  $('doneToggle').classList.toggle('hidden', done.length === 0);
  $('doneToggle').setAttribute('aria-expanded', String(!state.doneCollapsed));

  const empty = visible.length === 0;
  $('emptyState').classList.toggle('hidden', !empty);
  if (empty) {
    const none = state.tasks.length === 0;
    $('emptyTitle').textContent = none ? "Hali vazifa yo'q" : `${TYPE_LABELS[state.filter]} vazifa yo'q`;
    $('emptySub').replaceChildren(...(none ? [el('b', { text: 'Yangi vazifa' }), " tugmasi bilan birinchisini qo'shing."] : ["Boshqa turni tanlang yoki yangisini qo'shing."]));
  }
  document.querySelector('#screen-today .hint').classList.toggle('hidden', visible.length === 0);
}

async function toggleTask(task, li) {
  haptic(12);
  const wasDone = task.done;
  const request = store.toggleTask(task.id);
  task.done = !wasDone;
  if (li) {
    li.classList.toggle('done', task.done);
    if (task.done) li.classList.add('popping');
  }
  await wait(task.done && !reduceMotion() ? 460 : 60);
  renderTasks();
  try {
    const { task: updated } = await request;
    Object.assign(task, updated);
    renderTasks();
    loadStreak();
  } catch (err) {
    task.done = wasDone;
    renderTasks();
    toast(err.message);
  }
}

async function deleteTask(task) {
  haptic(15);
  state.tasks = state.tasks.filter((t) => t.id !== task.id);
  renderTasks();
  try {
    await store.deleteTask(task.id);
    toast('Vazifa o\'chirildi', 'Qaytarish', async () => {
      try {
        const { task: restored } = await store.restoreTask(task.id);
        // Takroriy chaqiruv dublikat yaratmasin: id bor bo'lsa — almashtiramiz.
        const i = state.tasks.findIndex((t) => t.id === restored.id);
        if (i === -1) state.tasks.push(restored);
        else state.tasks[i] = restored;
        renderTasks();
      } catch (err) {
        toast(err.message);
      }
    });
  } catch (err) {
    state.tasks.push(task);
    renderTasks();
    toast(err.message);
  }
}

// Swipe: o'ngga — bajarildi, chapga — o'chirish (iOS Mail'dagi kabi to'liq surish).
function attachSwipe(li, row, task) {
  let startX = 0; let startY = 0; let dx = 0; let pid = null; let dragging = false; let moved = false; let armed = null;
  row.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('.check')) return;
    startX = e.clientX; startY = e.clientY; dx = 0; pid = e.pointerId; dragging = false; armed = null;
    row.classList.remove('settle');
  });
  row.addEventListener('pointermove', (e) => {
    if (pid !== e.pointerId) return;
    const mx = e.clientX - startX; const my = e.clientY - startY;
    if (!dragging) {
      if (Math.abs(mx) > 10 && Math.abs(mx) > Math.abs(my) * 1.3) {
        dragging = true;
        li.classList.add('swiping');
        row.setPointerCapture(pid);
      } else if (Math.abs(my) > 10) {
        pid = null; // vertikal scroll — swipe emas
        return;
      } else return;
    }
    const w = row.offsetWidth;
    dx = Math.max(-w, Math.min(w, mx));
    row.style.transform = `translateX(${dx}px)`;
    const threshold = Math.min(130, w * 0.32);
    const nowArmed = dx > threshold ? 'done' : dx < -threshold ? 'delete' : null;
    if (nowArmed !== armed) { armed = nowArmed; if (armed) haptic(6); }
  });
  const end = (e) => {
    if (pid !== e.pointerId) return;
    pid = null;
    if (!dragging) return;
    moved = true;
    row.classList.add('settle');
    if (armed === 'delete') {
      row.style.transform = `translateX(${-row.offsetWidth}px)`;
      setTimeout(() => deleteTask(task), 200);
    } else {
      row.style.transform = 'translateX(0)';
      row.addEventListener('transitionend', () => li.classList.remove('swiping'), { once: true });
      if (armed === 'done') setTimeout(() => toggleTask(task, li), 120);
    }
  };
  row.addEventListener('pointerup', end);
  row.addEventListener('pointercancel', end);
  // Surishdan keyingi "click" tahrirlash oynasini ochmasin.
  row.addEventListener('click', (e) => {
    if (moved) { e.stopImmediatePropagation(); e.preventDefault(); moved = false; }
  }, true);
}

// ---------- Sheet: vazifa qo'shish / tahrirlash ----------

function buildStars() {
  const box = $('stars');
  box.replaceChildren();
  for (let i = 1; i <= 10; i += 1) {
    const cell = el('span', { class: 'star-cell', 'data-v': String(i) });
    cell.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${STAR_PATH}"/></svg>`;
    box.append(cell);
  }
}

function setImportance(n, { animate = false } = {}) {
  n = Math.max(1, Math.min(10, n));
  const changed = n !== state.importance;
  state.importance = n;
  document.querySelectorAll('#stars .star-cell').forEach((c) => {
    const v = Number(c.dataset.v);
    c.classList.toggle('on', v <= n);
    c.classList.toggle('tip', v === n && animate);
  });
  const num = $('impNum');
  num.textContent = n;
  num.className = `importance-num ${levelClass(n)}`;
  num.style.setProperty('--c', `var(--${n >= 10 ? 'red' : n >= 8 ? 'orange' : n >= 5 ? 'tint' : 'gray'})`);
  if (changed && animate) {
    num.classList.remove('bump'); void num.offsetWidth; num.classList.add('bump');
    haptic(4);
  }
  $('impLabel').textContent = importanceLabel(n);
  $('stars').setAttribute('aria-valuenow', String(n));
  $('stars').setAttribute('aria-valuetext', `${n} yulduz — ${importanceLabel(n)}`);
}

function initStars() {
  const box = $('stars');
  const pick = (e) => {
    const rect = box.getBoundingClientRect();
    setImportance(Math.ceil(((e.clientX - rect.left) / rect.width) * 10), { animate: true });
  };
  box.addEventListener('pointerdown', (e) => { box.setPointerCapture(e.pointerId); pick(e); });
  box.addEventListener('pointermove', (e) => { if (box.hasPointerCapture(e.pointerId)) pick(e); });
  box.addEventListener('pointerup', () => document.querySelectorAll('#stars .tip').forEach((c) => c.classList.remove('tip')));
  box.addEventListener('keydown', (e) => {
    const map = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 };
    if (e.key in map) { e.preventDefault(); setImportance(state.importance + map[e.key], { animate: true }); }
    if (e.key === 'Home') { e.preventDefault(); setImportance(1, { animate: true }); }
    if (e.key === 'End') { e.preventDefault(); setImportance(10, { animate: true }); }
  });
}

function setType(type) {
  state.type = type;
  setSegmented($('typeTabs'), type);
  $('typeHint').textContent = TYPE_HINTS[type];
}

function quickDeadlines() {
  const now = new Date();
  const at = (daysAhead, h, m = 0) => { const d = dayStart(now); d.setDate(d.getDate() + daysAhead); d.setHours(h, m, 0, 0); return d; };
  const options = [];
  if (now.getHours() < 18) options.push(['Bugun 18:00', at(0, 18)]);
  options.push(['Bugun 23:00', at(0, 23)]);
  options.push(['Ertaga 09:00', at(1, 9)]);
  const toFriday = (5 - now.getDay() + 7) % 7 || 7;
  options.push([`Juma 18:00`, at(toFriday, 18)]);
  options.push(['1 haftadan keyin', at(7, 18)]);
  return options;
}

function renderQuickChips() {
  const input = $('taskForm').deadline;
  $('quickChips').replaceChildren(...quickDeadlines().map(([label, date]) => el('button', {
    class: `chip-btn${input.value === toLocalInput(date) ? ' active' : ''}`,
    type: 'button',
    text: label,
    onclick: () => { input.value = toLocalInput(date); haptic(5); updateDeadlinePreview(); renderQuickChips(); },
  })));
}

function updateDeadlinePreview() {
  const on = $('deadlineSwitch').checked;
  const value = $('taskForm').deadline.value;
  $('deadlinePreview').textContent = on && value ? relativeDeadline(new Date(value).toISOString()) : "Muddati yo'q";
}

function setDeadline(iso) {
  const on = Boolean(iso);
  $('deadlineSwitch').checked = on;
  $('deadlinePanel').hidden = !on;
  $('taskForm').deadline.value = iso ? toLocalInput(new Date(iso)) : '';
  renderQuickChips();
  updateDeadlinePreview();
}

function autoGrow(textarea) {
  textarea.style.height = 'auto';
  textarea.style.height = `${Math.min(textarea.scrollHeight, 180)}px`;
}

function openSheet(task = null) {
  state.editing = task;
  const form = $('taskForm');
  form.title.value = task ? task.title : '';
  form.description.value = task ? task.description : '';
  setType(task ? task.type : (state.filter !== 'all' ? state.filter : 'doimiy'));
  setImportance(task ? task.importance : 5);
  setDeadline(task ? task.deadline : null);
  $('sheetTitle').textContent = task ? 'Tahrirlash' : 'Yangi vazifa';
  $('sheetSave').textContent = task ? 'Saqlash' : "Qo'shish";
  $('sheetDelete').classList.toggle('hidden', !task);
  $('formMessage').textContent = '';
  updateSaveState();

  const sheet = $('sheet'); const backdrop = $('sheetBackdrop');
  sheet.hidden = false; backdrop.hidden = false;
  sheet.style.transform = '';
  document.body.style.overflow = 'hidden';
  $('fab').classList.add('away');
  requestAnimationFrame(() => {
    autoGrow(form.description);
    layoutSegmented($('typeTabs'));
    sheet.classList.add('open'); backdrop.classList.add('open');
  });
  if (!task) setTimeout(() => form.title.focus({ preventScroll: true }), 380);
}

function closeSheet(immediate = false) {
  const sheet = $('sheet'); const backdrop = $('sheetBackdrop');
  if (sheet.hidden) return;
  sheet.classList.remove('open', 'dragging'); backdrop.classList.remove('open');
  sheet.style.transform = '';
  document.body.style.overflow = '';
  $('fab').classList.toggle('away', state.tab !== 'today');
  document.activeElement && document.activeElement.blur && document.activeElement.blur();
  const hide = () => { if (!sheet.classList.contains('open')) { sheet.hidden = true; backdrop.hidden = true; } };
  if (immediate || reduceMotion()) hide(); else setTimeout(hide, 460);
}

// Sheet'ni barmoq bilan pastga tortib yopish.
function initSheetDrag() {
  const sheet = $('sheet');
  let startY = 0; let dy = 0; let pid = null; let t0 = 0;
  const handles = [$('sheetGrab'), document.querySelector('.sheet-head')];
  handles.forEach((h) => {
    h.addEventListener('pointerdown', (e) => {
      if (matchMedia('(min-width: 900px)').matches) return;
      if (e.target.closest('button')) return;
      pid = e.pointerId; startY = e.clientY; dy = 0; t0 = performance.now();
      h.setPointerCapture(pid);
      sheet.classList.add('dragging');
    });
    h.addEventListener('pointermove', (e) => {
      if (pid !== e.pointerId) return;
      const raw = e.clientY - startY;
      dy = raw > 0 ? raw : raw / 6; // yuqoriga — "rezina" qarshilik
      sheet.style.transform = `translateY(${dy}px)`;
    });
    const end = (e) => {
      if (pid !== e.pointerId) return;
      pid = null;
      sheet.classList.remove('dragging');
      const velocity = dy / Math.max(1, performance.now() - t0);
      if (dy > 140 || velocity > 0.7) closeSheet();
      else sheet.style.transform = '';
    };
    h.addEventListener('pointerup', end);
    h.addEventListener('pointercancel', end);
  });
}

function updateSaveState() {
  $('sheetSave').disabled = !$('taskForm').title.value.trim();
}

function formPayload() {
  const form = $('taskForm');
  const on = $('deadlineSwitch').checked && form.deadline.value;
  return {
    title: form.title.value,
    description: form.description.value,
    type: state.type,
    importance: state.importance,
    deadline: on ? new Date(form.deadline.value).toISOString() : null,
  };
}

async function saveTask() {
  const payload = formPayload();
  if (!payload.title.trim()) return;
  const btn = $('sheetSave');
  await withLoading(btn, async () => {
    try {
      if (state.editing) {
        const { task } = await store.updateTask(state.editing.id, payload);
        Object.assign(state.editing, task);
        toast('Saqlandi');
      } else {
        const { task } = await store.createTask(payload);
        state.tasks.push(task);
        toast("Vazifa qo'shildi");
      }
      haptic(10);
      closeSheet();
      setTimeout(renderTasks, reduceMotion() ? 0 : 180);
    } catch (err) {
      $('formMessage').textContent = err.message;
    }
  });
  updateSaveState();
}

// ---------- Hisobot ----------

const PERIOD_UNIT = { day: 'kun', week: 'hafta', month: 'oy' };

async function loadReport() {
  const body = $('reportBody');
  const { period, offset } = state.report;
  $('nextPeriod').disabled = offset >= 0;
  body.classList.add('refreshing');
  try {
    const data = await store.getReport(period, offset);
    if (data.period !== state.report.period || data.offset !== state.report.offset) return; // eskirgan javob
    state.report.data = data;
    renderReport(data);
  } catch (err) {
    body.replaceChildren(el('div', { class: 'card', text: `⚠️ ${err.message}` }));
  } finally {
    body.classList.remove('refreshing');
  }
}

function occList(items, { valueOf, limit = 5 }) {
  const group = el('ul', { class: 'group list occ-list' });
  const renderRows = (all) => {
    const shown = all ? items : items.slice(0, limit);
    group.replaceChildren(...shown.map((o) => el('li', { class: `row ${levelClass(o.importance)}` }, [
      el('span', { class: 'occ-dot', 'aria-hidden': 'true' }),
      el('span', { class: 'row-text' }, [
        el('span', { text: o.title }),
        el('small', { text: `★${o.importance} · ${TYPE_LABELS[o.type]}${o.deleted ? " · o'chirilgan" : ''}` }),
      ]),
      el('span', { class: 'row-value', text: valueOf(o) }),
    ])));
    if (!all && items.length > limit) {
      group.append(el('li', {}, [el('button', { class: 'more-btn', type: 'button', text: `Yana ${items.length - limit} ta`, onclick: () => renderRows(true) })]));
    }
  };
  renderRows(false);
  return group;
}

function deltaChip(delta, period) {
  if (delta === null || delta === undefined) return null;
  const cls = delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat';
  const text = delta === 0 ? `O'tgan ${PERIOD_UNIT[period]}dagidek` : `${delta > 0 ? '+' : ''}${delta}% o'tgan ${PERIOD_UNIT[period]}ga nisbatan`;
  return el('span', { class: `delta ${cls}` }, [delta !== 0 ? icon(delta > 0 ? 'i-arrow-up' : 'i-arrow-down') : null, text]);
}

function renderReport(r) {
  $('periodLabel').textContent = r.range.label;
  $('periodSub').textContent = r.range.sublabel;
  const s = r.summary;
  const body = $('reportBody');
  const cards = [];

  // 1) Asosiy natija
  const hero = el('div', { class: 'card report-hero' });
  hero.append(Charts.ring({ size: 148, stroke: 16, value: s.rate || 0, label: s.rate === null ? '—' : `${s.rate}%`, sublabel: 'bajarildi' }));
  hero.append(el('p', { class: 'hero-main', text: s.expected ? `${s.done} / ${s.expected} bajarildi` : "Bu davrda reja yo'q" }));
  const chips = el('div', { class: 'hero-chips' }, [deltaChip(s.delta, r.period)]);
  if (r.streak) chips.append(el('span', { class: 'chip chip-flame' }, [icon('i-flame'), `${r.streak} kun ketma-ket`]));
  hero.append(chips);
  hero.append(el('div', { class: 'stat-row' }, [
    el('div', { class: 'stat stat-good' }, [el('div', { class: 'stat-top' }, [icon('i-check'), String(s.done)]), el('span', { class: 'stat-label', text: 'Bajarildi' })]),
    el('div', { class: 'stat stat-bad' }, [el('div', { class: 'stat-top' }, [icon('i-alert'), String(s.missed)]), el('span', { class: 'stat-label', text: 'Qolib ketdi' })]),
    el('div', { class: 'stat stat-wait' }, [el('div', { class: 'stat-top' }, [icon('i-hourglass'), String(s.pending)]), el('span', { class: 'stat-label', text: 'Kutilmoqda' })]),
  ]));
  cards.push(hero);

  // 2) Faollik (qachon bajarilgan)
  const activityBox = el('div', { class: 'chart' });
  const activityCard = el('div', { class: 'card chart-card' }, [
    el('h3', { text: 'Qachon bajardingiz' }),
    el('p', { class: 'chart-sub', text: r.period === 'day' ? "Soatlar bo'yicha bajarilgan vazifalar soni" : "Kunlar bo'yicha bajarilgan vazifalar soni" }),
    activityBox,
    Charts.tableView([r.period === 'day' ? 'Soat' : 'Kun', 'Bajarildi'], r.activity.filter((a) => !a.future).map((a) => [a.full_label || `${a.label}:00`, a.value])),
  ]);
  cards.push(activityCard);

  // 3) O'sish dinamikasi
  const trendBox = el('div', { class: 'chart' });
  const trendSub = { day: "So'nggi 14 kun", week: "So'nggi 8 hafta", month: "So'nggi 6 oy" }[r.period];
  cards.push(el('div', { class: 'card chart-card' }, [
    el('h3', { text: "O'sish dinamikasi" }),
    el('p', { class: 'chart-sub', text: `${trendSub} — bajarilish foizi` }),
    trendBox,
    Charts.tableView(['Davr', 'Bajarildi', 'Foiz'], r.trend.map((p) => [p.full_label, `${p.done}/${p.expected}`, p.rate === null ? '—' : `${p.rate}%`])),
  ]));

  // 4) Turlar va muhimlik bo'yicha
  const typeRows = ['kunlik', 'haftalik', 'oylik', 'doimiy'].map((t) => ({ label: TYPE_LABELS[t], ...r.by_type[t] })).filter((x) => x.expected > 0);
  if (typeRows.length) cards.push(el('div', { class: 'card chart-card' }, [el('h3', { text: "Turlar bo'yicha" }), Charts.meterList(typeRows)]));
  const impRows = r.by_importance.filter((x) => x.expected > 0);
  if (impRows.length) cards.push(el('div', { class: 'card chart-card' }, [el('h3', { text: "Muhimlik bo'yicha" }), Charts.meterList(impRows)]));

  // 5) Ro'yxatlar
  const section = (title, count) => el('h2', { class: 'section-title' }, [title, ' ', el('span', { class: 'count', text: String(count) })]);
  if (r.missed.length) cards.push(el('div', {}, [section('Qolib ketganlar', r.missed.length), occList(r.missed, { valueOf: (o) => (r.period === 'day' ? '' : o.due_label) })]));
  if (r.pending.length) cards.push(el('div', {}, [section('Kutilmoqda', r.pending.length), occList(r.pending, { valueOf: (o) => (r.period === 'day' ? '' : o.due_label) })]));
  if (r.upcoming.length) {
    cards.push(el('div', {}, [
      section('Shu hafta / oy davomida', r.upcoming.length),
      occList(r.upcoming, { valueOf: () => '' }),
    ]));
  }
  if (r.done.length) cards.push(el('div', {}, [section('Bajarilganlar', r.done.length), occList(r.done, { valueOf: (o) => (r.period === 'day' ? (o.completed_label || '').slice(-5) : o.due_label) })]));

  body.replaceChildren(...cards);
  const labelEvery = r.period === 'day' ? 6 : r.period === 'month' ? 5 : 1;
  Charts.barChart(activityBox, r.activity, { labelEvery, caption: (d) => (r.period === 'day' ? `${d.label}:00–${d.label}:59` : d.full_label) });
  Charts.lineChart(trendBox, r.trend);
}

// ---------- Sozlamalar ----------

function settingsRow({ iconName, tint, text, sub, value, onclick, cls = '' }) {
  const tag = onclick ? 'button' : 'div';
  return el(tag, { class: `row ${cls}`, type: onclick ? 'button' : undefined, onclick }, [
    el('span', { class: `row-icon ${tint}` }, [icon(iconName)]),
    el('span', { class: 'row-text' }, [el('span', { text }), sub ? el('small', { text: sub }) : null]),
    value !== undefined ? (value instanceof Node ? value : el('span', { class: 'row-value', text: value })) : null,
  ]);
}

const LEAD_OPTIONS = [[1440, '1 kun'], [180, '3 soat'], [60, '1 soat'], [30, '30 daq'], [10, '10 daq'], [0, 'Vaqtida']];

function hourSelect(label, current, onChange) {
  const select = el('select', { 'aria-label': label });
  select.append(el('option', { value: '', text: "O'chiq" }));
  for (let h = 0; h < 24; h += 1) select.append(el('option', { value: String(h), text: `${pad(h)}:00` }));
  // getMe: '09:00' yoki null (o'chiq).
  select.value = current ? String(Number(current.slice(0, 2))) : '';
  select.addEventListener('change', () => onChange(select.value));
  return select;
}

// Ruxsat ogohlantirishlari — eslatmalar guruhining tepasida. Brauzerda (isSupported=false) hech qachon yo'q.
// state.notifications — oxirgi syncNotifications natijasi; u kelganda shu funksiya qayta chaqiriladi.
function permissionWarnings() {
  const n = state.notifications;
  if (!state.notifySupported || !n) return [];
  if (n.permission && n.permission !== 'granted') {
    // 'prompt' — Android hali dialog ko'rsata oladi; 'denied' — faqat ilova sozlamalaridan.
    const canAsk = n.permission === 'prompt';
    return [settingsRow({
      iconName: 'i-alert', tint: 'tint-red', cls: 'warn-row',
      text: 'Eslatmalar kelmaydi',
      sub: canAsk ? 'Bildirishnomaga ruxsat berilmagan' : "Telefon sozlamalari → Ilovalar → Vazifalar → Bildirishnomalar",
      value: el('span', { class: 'row-value', text: canAsk ? 'Ruxsat berish' : 'Ochish' }),
      onclick: canAsk ? requestNotificationPermission : () => openSystemSettings(() => notifier.openNotificationSettings()),
    })];
  }
  if (n.exactAlarm === 'denied') {
    return [settingsRow({
      iconName: 'i-hourglass', tint: 'tint-orange', cls: 'warn-row',
      text: 'Eslatmalar kechikishi mumkin',
      sub: "Bir necha daqiqaga. «Signal va eslatmalar» ruxsatini yoqing",
      value: el('span', { class: 'row-value', text: 'Ochish' }),
      onclick: () => openSystemSettings(() => notifier.openExactAlarmSettings()),
    })];
  }
  return [];
}

function renderPermissionWarnings() {
  const group = $('remindGroup');
  if (!group) return;
  group.querySelectorAll('.warn-row').forEach((r) => r.remove());
  group.prepend(...permissionWarnings());
}

async function requestNotificationPermission() {
  try {
    await notifier.requestPermissions();
  } catch (err) {
    console.warn(err);
  }
  resyncNotifications(); // natija kelgach ogohlantirish yangilanadi
}

// Tizim oynasidan qaytilganda appStateChange → qayta jadvallash → ogohlantirishlar yangilanadi.
async function openSystemSettings(open) {
  haptic(5);
  try {
    if (!(await open())) toast("Bu qurilmada sozlamalarni ochib bo'lmaydi");
  } catch (err) {
    console.warn(err);
    toast("Sozlamalarni ochib bo'lmadi");
  }
}

// Sozlamalar ketma-ket saqlanadi: store.updateSettings tranzaksiya ochadi, ikkitasi ustma-ust tushmasin.
let settingsQueue = Promise.resolve();
function saveSetting(patch, { quiet = false } = {}) {
  const job = settingsQueue.then(() => store.updateSettings(patch));
  settingsQueue = job.catch(() => {});
  return job.then((me) => {
    state.me = me;
    if (!quiet) toast('Saqlandi');
    return me;
  }, (err) => {
    toast(err.message);
    renderSettings(); // ekranni saqlangan holatga qaytaramiz
    throw err;
  });
}

function leadChips(selected) {
  const hint = el('p', { class: 'group-foot', text: "Deadline eslatmalari o'chiq — hech biri tanlanmagan." });
  const chips = LEAD_OPTIONS.map(([minutes, label]) => el('button', {
    class: `chip-btn${selected.includes(minutes) ? ' active' : ''}`,
    type: 'button',
    text: label,
    'aria-pressed': String(selected.includes(minutes)),
    'data-minutes': String(minutes),
  }));
  const sync = () => { hint.hidden = chips.some((c) => c.classList.contains('active')); };
  for (const chip of chips) {
    chip.addEventListener('click', () => {
      haptic(5);
      const on = !chip.classList.contains('active');
      chip.classList.toggle('active', on);
      chip.setAttribute('aria-pressed', String(on));
      sync();
      const value = chips.filter((c) => c.classList.contains('active')).map((c) => c.dataset.minutes).join(',');
      saveSetting({ lead_minutes: value }, { quiet: true }).catch(() => {});
    });
  }
  sync();
  return { panel: el('div', { class: 'chips-panel' }, [el('div', { class: 'chip-wrap', role: 'group', 'aria-label': "Deadline'dan qancha oldin eslatilsin" }, chips)]), hint };
}

function renderSettings() {
  if (!state.me) return;
  const { settings, quiet_hours: quiet, summary_hour: summaryHour, morning_hour: morningHour, timezone } = state.me;
  const body = $('settingsBody');

  const select = el('select', { 'aria-label': 'Qaysi vazifalar eslatilsin' });
  for (let i = 10; i >= 1; i -= 1) select.append(el('option', { value: String(i), text: i === 10 ? '★10' : `★${i}+` }));
  select.value = String(settings.reminder_min_importance);
  select.addEventListener('change', saveMinImportance);

  const remindGroup = el('div', { class: 'group', id: 'remindGroup' }, [
    settingsRow({ iconName: 'i-bell', tint: 'tint-red', text: 'Eslatiladi', sub: 'shu muhimlikdan boshlab', value: select }),
    settingsRow({ iconName: 'i-calendar', tint: 'tint-blue', text: 'Ertalabki reja', value: hourSelect('Ertalabki reja soati', morningHour, (v) => saveSetting({ morning_hour: v }).catch(() => {})) }),
    settingsRow({ iconName: 'i-clock', tint: 'tint-orange', text: 'Kun yakuni', value: hourSelect('Kun yakuni soati', summaryHour, (v) => saveSetting({ summary_hour: v }).catch(() => {})) }),
    settingsRow({ iconName: 'i-moon', tint: 'tint-purple', text: 'Jim soatlar', value: quiet || "Yo'q" }),
  ]);

  const lead = leadChips(settings.lead_minutes);
  const leadGroup = el('div', { class: 'group' }, [
    settingsRow({ iconName: 'i-hourglass', tint: 'tint-red', text: "Deadline'dan oldin" }),
    lead.panel,
  ]);

  // Ovoz — faqat tabiiy ilovada: Android 8+ da ovoz kanal xossasi, uni tizim sozlamalarida tanlanadi.
  const soundParts = state.notifySupported ? [
    el('div', { class: 'group' }, [
      settingsRow({
        iconName: 'i-ring', tint: 'tint-green', text: 'Eslatma ovozi',
        value: el('span', { class: 'row-value', text: 'Tanlash' }),
        onclick: () => openSystemSettings(() => notifier.openChannelSettings()),
      }),
    ]),
    el('p', { class: 'group-foot', text: 'Ovoz telefonning o\'z sozlamalarida tanlanadi.' }),
  ] : [];

  body.replaceChildren(
    el('p', { class: 'group-label', text: 'Eslatmalar' }), remindGroup,
    el('p', { class: 'group-foot', text: `Ertalab — bugungi va muddati o'tgan vazifalar, kechqurun — bajarilmay qolganlari. Jim soatlarda eslatma kelmaydi. Vaqt zonasi: ${timezone}.` }),
    el('p', { class: 'group-label', text: 'Deadline' }), leadGroup, lead.hint,
    ...soundParts,
    el('p', { class: 'footer-note', text: "Vazifalar · Ma'lumotlar faqat shu qurilmada saqlanadi" }),
  );
  renderPermissionWarnings();
}

async function saveMinImportance(e) {
  await saveSetting({ reminder_min_importance: Number(e.target.value) }).catch(() => {});
}

// ---------- Hodisalar ----------

function bind() {
  document.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => { haptic(5); switchTab(b.dataset.tab); }));
  window.addEventListener('scroll', updateNavBars, { passive: true });
  let resizeTimer = null;
  window.addEventListener('resize', () => {
    layoutAllSegmented();
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (state.tab === 'report' && state.report.data) renderReport(state.report.data); }, 200);
  });

  initSegmented($('filterTabs'), (v) => { state.filter = v; renderTasks(); });
  $('doneToggle').addEventListener('click', () => {
    state.doneCollapsed = !state.doneCollapsed;
    writeStore(DONE_COLLAPSED_KEY, state.doneCollapsed ? '1' : null);
    renderTasks();
  });
  $('fab').addEventListener('click', () => { haptic(8); openSheet(); });

  // Sheet
  buildStars();
  initStars();
  initSegmented($('typeTabs'), (v) => setType(v));
  initSheetDrag();
  $('sheetCancel').addEventListener('click', () => closeSheet());
  $('sheetBackdrop').addEventListener('click', () => closeSheet());
  $('sheetSave').addEventListener('click', saveTask);
  $('taskForm').addEventListener('submit', (e) => { e.preventDefault(); saveTask(); });
  $('taskForm').title.addEventListener('input', updateSaveState);
  $('taskForm').title.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); saveTask(); } });
  $('taskForm').description.addEventListener('input', (e) => autoGrow(e.target));
  $('deadlineSwitch').addEventListener('change', (e) => {
    haptic(6);
    const input = $('taskForm').deadline;
    if (e.target.checked && !input.value) input.value = toLocalInput(quickDeadlines()[0][1]);
    $('deadlinePanel').hidden = !e.target.checked;
    renderQuickChips();
    updateDeadlinePreview();
  });
  $('taskForm').deadline.addEventListener('input', () => { renderQuickChips(); updateDeadlinePreview(); });
  $('sheetDelete').addEventListener('click', () => {
    const task = state.editing;
    closeSheet();
    if (task) setTimeout(() => deleteTask(task), 250);
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('sheet').hidden) closeSheet(); });

  // Hisobot
  initSegmented($('periodTabs'), (v) => { state.report.period = v; state.report.offset = 0; loadReport(); });
  $('prevPeriod').addEventListener('click', () => { haptic(4); state.report.offset -= 1; loadReport(); });
  $('nextPeriod').addEventListener('click', () => { if (state.report.offset < 0) { haptic(4); state.report.offset += 1; loadReport(); } });

  // Kun almashsa kunlik vazifalar yana "bajarilmagan"ga qaytadi — daqiqada bir marta jimgina yangilaymiz.
  setInterval(() => {
    if (state.me && !document.hidden && $('sheet').hidden && state.tab === 'today') loadTasks().catch(() => {});
  }, 60 * 1000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && state.me && state.tab === 'today') loadTasks().catch(() => {});
  });
}

bind();
// wasm yuklanguncha #app yashirin turadi (index.html dagi boshlang'ich holat).
(async function boot() {
  try {
    const db = await openDatabase();
    store = withNotificationSync(createStore(db, { migrations: [schemaSql] }));
    await store.init();
  } catch (err) {
    console.error(err);
    toast("Ma'lumotlar bazasini ochib bo'lmadi. Sahifani yangilab ko'ring.");
    return;
  }
  // Eslatmalar ilovani to'smaydi: xato bo'lsa ham ro'yxat ishlayveradi.
  // showApp'dan oldin: sozlamalar ekrani ochilganda qaysi qatorlar ko'rinishi ma'lum bo'lsin.
  try {
    notifier = await getNotifier();
    state.notifySupported = await notifier.isSupported();
  } catch (err) {
    console.warn('Eslatmalar moduli yuklanmadi:', err);
  }
  try {
    await showApp();
  } catch (err) {
    toast(err.message);
  }
  try {
    if (notifier) await askNotificationPermissionOnce();
  } catch (err) {
    console.warn('Bildirishnoma ruxsatini tekshirib bo\'lmadi:', err);
  }
  resyncNotifications();
  // Oldingi planga qaytganda: kun almashgan, ruxsat o'zgargan yoki Android aniq budilnik
  // ruxsati olib qo'yilganda o'chirib yuborgan eslatmalar qayta qo'yiladi.
  onAppResume(resyncNotifications).catch((err) => console.warn(err));
}());
