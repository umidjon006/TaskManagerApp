# ✅ Vazifalar

Vazifalar ro'yxati. Eng muhim ish doim ro'yxat tepasida turadi. AI muhimlikni baholaydi, Telegram bot esa vazifa bajarilmaguncha eslatib turadi.

- **Muhimlik 1–10 yulduz bilan belgilanadi.** 10★ — albatta bajarilishi shart bo'lgan vazifa. Ro'yxat quyidagi tartibda saralanadi: avval bajarilmaganlar, keyin yulduzi ko'plari, keyin deadline'i yaqinlari.
- **Vazifa turlari:** doimiy, kunlik, haftalik, oylik. Kunlik vazifa ertasi kuni, haftalik vazifa dushanba kuni, oylik vazifa esa oyning 1-sanasida o'zi yana "bajarilmagan" holatiga qaytadi. Davrlar `Asia/Tashkent` vaqti bo'yicha hisoblanadi.
- **Vazifaga sana va soati bilan deadline qo'yish mumkin.** Muddati o'tgan vazifa qizil bilan, 24 soatdan kam vaqt qolgani to'q sariq bilan belgilanadi.
- **AI (Claude) ikki ishni qiladi:**
  - "🤖 AI baholasin" tugmasi vazifa matniga qarab yulduzlar sonini va turini taklif qiladi.
  - "🤖 Bugun nimadan boshlay?" tugmasi qisqa kun rejasini tuzib beradi.
- **Telegram bot quyidagilarni yuboradi:**
  - har soatda bugungi holat: bajarilganlar, qolganlar va progress; hammasi tugasa bir marta tabriklab, o'sha kuni boshqa yozmaydi;
  - deadline'ga 1 soat qolganda va muddati o'tganda bir martalik ogohlantirish;
  - standart 21:00 da kun yakuni; yakshanba kuni hafta, oyning oxirgi kuni oy hisoboti ham qo'shiladi.
- **Telegram'dan turib ham ishlash mumkin.** Har eslatmada "✅ Bajarildi" tugmasi bor, vazifani saytga kirmasdan yopsa bo'ladi. Tunda (23:00–07:00) soatlik eslatmalar jim turadi.
- **Telefon va laptop uchun moslashgan.** Telefonda pastki tab-bar va sheet, laptopda chap menyu, ikki ustunli vazifalar, keng hisobotlar va markaziy dialog ishlaydi.

## Arxitektura

```
Brauzer ──► http://SERVER_IP:8080 ──► frontend (Nginx)
                                        ├── /        → HTML/CSS/JS
                                        └── /api/... → backend (Node.js + Express) ──► db (PostgreSQL 16)
                                                          ├──► api.anthropic.com  (AI)
                                                          └──► api.telegram.org   (bot, long polling)
```

- Tashqariga **faqat bitta port (8080)** ochiladi. `backend` bilan `db` faqat Docker'ning ichki tarmog'ida ishlaydi.
- Bot webhook o'rniga **long polling** ishlatadi. Shuning uchun domen ham, HTTPS ham kerak emas: server Telegram'ga o'zi murojaat qiladi.
- AI va Telegram ixtiyoriy. Kalit berilmasa, shu funksiya o'chiq turadi, sayt esa to'liq ishlayveradi.

| Papka | Ichida nima bor |
|---|---|
| `frontend/` | `public/` (index.html, style.css, app.js), `nginx.conf`, `Dockerfile` |
| `backend/src/` | `app.js` (API), `db.js` (sxema), `time.js` (davrlar va vaqt zonasi), `tasks.js`, `ai.js`, `telegram.js`, `reminders.js`, `server.js` |
| `backend/test/` | 55 ta avtomatik test |
| `scripts/` | `setup-server.sh` (serverni bir buyruqda sozlash), `smoke-test.sh` (deploy'dan keyingi tekshiruv) |

---

## 1. Kalitlarni tayyorlash (5 daqiqa)

**Telegram bot tokeni:**
1. Telegram'da [@BotFather](https://t.me/BotFather) ni oching va `/newbot` buyrug'ini yuboring.
2. Botga nom bering (masalan `Mening vazifalarim`), keyin username bering. Username `bot` bilan tugashi kerak, masalan `ravshan_vazifa_bot`.
3. BotFather bergan tokenni nusxalab oling. U `1234567890:AA...` ko'rinishida bo'ladi.

**Anthropic API kaliti (AI uchun):**
1. <https://console.anthropic.com> saytiga kiring va **API Keys → Create Key** ni bosing.
2. Kalit `sk-ant-...` bilan boshlanadi. Hisobda balans bo'lishi kerak (Billing).

## 2. GitHub orqali Contabo'ga deploy

Talablar: Ubuntu 22.04 yoki 24.04, kamida 1 GB RAM. Contabo'ning eng arzon VPS'i yetarli.

**Kompyuterda (PowerShell)** GitHub'da bo'sh `vazifalar` repository yarating, keyin:

```powershell
cd E:\vazifalar
git add .
git commit -m "Vazifalar ilovasi"
git remote add origin https://github.com/USERNAME/vazifalar.git
git push -u origin main
```

> `.env` va `node_modules` `.gitignore` ichida: maxfiy kalitlar va lokal kutubxonalar GitHub'ga yuborilmaydi.

**Contabo serverda birinchi deploy:**

```bash
ssh root@SERVER_IP
apt-get update && apt-get install -y git
git clone https://github.com/USERNAME/vazifalar.git /opt/vazifalar
cd /opt/vazifalar
bash scripts/setup-server.sh
```

Private repository ishlatilsa, serverga GitHub deploy key yoki read-only token berish kerak.

Skript quyidagilarni o'zi bajaradi:
1. Docker'ni o'rnatadi (agar o'rnatilmagan bo'lsa).
2. Telegram tokeni va Anthropic kalitini so'raydi. Enter bosib o'tkazib yuborish mumkin.
3. `.env` faylini tasodifiy parollar bilan yaratadi.
4. Firewall'da 22 va 8080 portlarini ochadi.
5. Konteynerlarni ishga tushiradi va natijani tekshiradi.

Oxirida quyidagi xabar chiqadi:

```
✅ Tayyor! Brauzerda oching:  http://SERVER_IP:8080
```

To'liq oqimni tekshirish uchun:

```bash
bash scripts/smoke-test.sh
```

## 3. Telegram'ni ulash

1. Saytga kiring va **⚙️ Sozlamalar → ✈️ Telegramni ulash** ni bosing.
2. **Telegram'da ochish** tugmasini bosing, botda **START** ni bosing.
3. Sayt ulanishni o'zi aniqlaydi va "Telegram muvaffaqiyatli ulandi 🎉" deb yozadi.
4. Soatlik xabarga qaysi muhimlikdagi vazifalar qo'shilishini shu oynada tanlaysiz: 8★ va undan yuqori, faqat 10★ va hokazo. Kunlik va deadline'i bugun bo'lgan vazifalar doim qo'shiladi.

Botdagi buyruqlar: `/vazifalar` — bajarilmaganlar, `/bugun` — bugungi holat, `/hisobot` — qisqa hisobot, `/stop` — eslatmalarni o'chirish.

## 4. Kundalik boshqaruv (serverda, `/opt/vazifalar` ichida)

| Nima qilmoqchisiz | Buyruq |
|---|---|
| Holatni ko'rish | `docker compose ps` |
| Loglarni kuzatish | `docker compose logs -f backend` |
| Kalitni o'zgartirish yoki qo'shish | `nano .env` → `docker compose up -d` |
| Kod yangilanganda | `git pull --ff-only && docker compose up -d --build` |
| To'xtatish (ma'lumot saqlanadi) | `docker compose down` |
| Bazaning zaxira nusxasi | `docker compose exec -T db pg_dump -U vazifalar vazifalar > backup-$(date +%F).sql` |
| Zaxiradan tiklash | `docker compose exec -T db psql -U vazifalar vazifalar < backup-SANA.sql` |

> ⚠️ `docker compose down -v` buyrug'ini **ishlatmang**. `-v` bayrog'i baza volume'ini, ya'ni barcha vazifalarni o'chirib yuboradi.

Asosiy `.env` sozlamalari:

| Sozlama | Standart | Vazifasi |
|---|---:|---|
| `APP_PORT` | `8080` | Sayt tashqariga ochiladigan port |
| `APP_TIMEZONE` | `Asia/Tashkent` | Vazifa davrlari va bot vaqti |
| `QUIET_HOURS` | `23-7` | Soatlik xabar yuborilmaydigan vaqt; bo'sh qiymat bilan o'chadi |
| `DAILY_SUMMARY_HOUR` | `21` | Kun yakuni yuboriladigan soat; bo'sh qiymat bilan o'chadi |
| `ANTHROPIC_API_KEY` | bo'sh | AI yordamchini yoqadi |
| `TELEGRAM_BOT_TOKEN` | bo'sh | Telegram botni yoqadi |

## 5. Kompyuterda ishga tushirish

Ma'lumotlar saqlanadigan to'liq Docker rejimi:

```bash
cp .env.example .env
# .env ichidagi POSTGRES_PASSWORD va JWT_SECRET qiymatlarini almashtiring
docker compose up -d --build
```

Sayt: <http://localhost:8080>. To'xtatish: `docker compose down` — baza saqlanib qoladi.

Docker'siz vaqtinchalik demo:

```bash
cd backend
npm install
npm test
npm run dev:memory
```

Oxirgi buyruq `http://localhost:8080` da saytni ochadi. Baza xotirada turadi, server to'xtashi bilan ma'lumot o'chadi. AI yoki botni sinash uchun `ANTHROPIC_API_KEY` va `TELEGRAM_BOT_TOKEN` o'zgaruvchilarini berish mumkin.

## 6. Muammo va yechim

| Belgi | Sabab va yechim |
|---|---|
| Brauzerda `http://IP:8080` ochilmaydi | `docker compose ps` bilan konteynerlar `Up`/`healthy` ekanini tekshiring. Keyin `ufw status` da 8080 ochiqligini ko'ring. Contabo panelida firewall yoqilgan bo'lsa, u yerda ham 8080/tcp portini oching. |
| `backend ... is unhealthy` | `docker compose logs backend` ni ko'ring. Ko'pincha sabab `.env` dagi xato bo'ladi. |
| Sozlamalarda "Telegram bot yoqilmagan" | `.env` dagi `TELEGRAM_BOT_TOKEN` bo'sh yoki noto'g'ri. Logda `TELEGRAM_BOT_TOKEN noto'g'ri` yozuvi chiqadi. Tuzatgach, `docker compose up -d` ni ishga tushiring. |
| AI "kaliti noto'g'ri" deydi | `ANTHROPIC_API_KEY` ni tekshiring. Console'da balans borligiga ham ishonch hosil qiling. |
| Serverda `\r: command not found` | Fayl Windows'da tahrirlangan (CRLF qator oxiri). Yechim: `sed -i 's/\r$//' scripts/*.sh .env` |
| Eslatmalar kelmaydi | Tekshiring: Sozlamalarda Telegram ulanganmi? Vazifa yulduzi tanlangan chegaradan yuqorimi? Hozir jim soat (23–07) emasmi? |

## Xavfsizlik

Loyihada quyidagi himoyalar bor:
- Parollar bcrypt bilan hash qilinadi.
- JWT 30 kun amal qiladi.
- Kirish va AI so'rovlari soniga cheklov (rate limit) qo'yilgan.
- SQL so'rovlarda faqat parametrlar ishlatiladi.
- Har bir so'rovda vazifa egasi tekshiriladi (IDOR himoyasi), Telegram tugmalarida ham.
- Foydalanuvchi matni `textContent` orqali chiqariladi (XSS himoyasi).
- Tashqariga bitta port ochiq, baza yopiq.

**Cheklov:** IP orqali ishlaganda HTTPS yo'q, ya'ni parol shifrlanmay uzatiladi. Shaxsiy foydalanish uchun bu maqbul. Ko'pchilik foydalanadigan bo'lsa, domen olib, Caddy yoki Certbot orqali HTTPS qo'shing.
