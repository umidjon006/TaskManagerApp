# TaskManagerApp

Bitta foydalanuvchi uchun lokal vazifa menejeri. Kunlik/haftalik/oylik
vazifalar, deadline, hisobotlar. Server YO'Q — hamma narsa qurilma ichida.

## Qattiq cheklovlar

- Hech qanday backend, API server yoki bulut. Internet faqat Telegram uchun.
- Ma'lumot faqat qurilma xotirasidagi SQLite faylida.
- Ilova internetsiz to'liq ishlashi shart (Telegramdan tashqari).
- Auth yo'q: parol, JWT, bcrypt, foydalanuvchilar jadvali kerak emas.
- AI yo'q: Anthropic SDK va /api/ai/\* olib tashlandi.

## Platformalar

Android (asosiy) · iOS · Windows/Linux desktop
Capacitor 8 + Vite. iOS build faqat MacBook'da.

## Tuzilma va import qoidasi

    ui/ → features/ → data/ → platform/
           ↘        ↙
             core/

- `src/core/` — sof JS. Hech narsani import qilmaydi (faqat o'zaro).
  DOM, SQLite, Capacitor, fetch — bulardan hech biri bu yerda bo'lmaydi.
- `src/data/` — SQLite sxemasi va so'rovlari.
- `src/platform/` — platforma farqlari SHU YERDA qamaladi.
  capacitor.js | electron.js | web.js — bir xil interfeys.
- `src/features/` — notifications, telegram, backup.
- `src/ui/` — mavjud interfeys. Dizaynga TEGILMAYDI (pastga qarang).

Platforma API'sini (Capacitor plugin, better-sqlite3, localStorage)
`platform/` dan tashqarida to'g'ridan-to'g'ri chaqirish taqiqlanadi.

## UI — tegilmaydi

`src/ui/style.css` Apple HIG bo'yicha qilingan: semantik ranglar,
hisoblangan spring egri chiziqlari (`linear()`), iOS sheet easing,
segmented control, safe-area, dark mode. Bu ataylab shunday.
Ranglarni, animatsiya vaqtlarini yoki easing qiymatlarini
"yaxshilash" uchun o'zgartirmang. Tailwind yoki boshqa CSS
framework qo'shilmaydi.

## Eslatmalar — arxitektura

Server versiyasida har daqiqada "hozir kimga nima kerak" deb hisoblanardi.
Telefonda bu ishlamaydi, chunki ilova yopiq bo'lsa kod ishlamaydi.

Shuning uchun eslatma OLDINDAN jadvallanadi (`LocalNotifications.schedule`).
Vazifa qo'shilganda/o'zgarganda kelajakdagi eslatmalar qayta hisoblanadi.
iOS bir vaqtda 64 ta kutayotgan eslatmani saqlaydi — limitni hisobga oling.

## Telegram

Internetsiz yuborib bo'lmaydi. Xabar `outbox` jadvaliga yoziladi,
internet paydo bo'lganda yuboriladi (Network plugin + background runner).
Bot tokeni qurilmada Preferences'da saqlanadi, repo'ga tushmaydi.

## Til

UI matnlari va kod izohlari — o'zbekcha. Texnik atamalar inglizcha.

## Testlar

`node --test`. `core/` uchun test yozish majburiy.
Eski kod: `git show server-version:backend/src/<fayl>`
