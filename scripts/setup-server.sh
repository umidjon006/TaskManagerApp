#!/usr/bin/env bash
# Contabo (Ubuntu 22.04/24.04) serverida loyiha papkasi ichidan root sifatida ishga tushiriladi:
#   bash scripts/setup-server.sh
# Qiladi: Docker o'rnatadi (yo'q bo'lsa) → .env yaratadi (yo'q bo'lsa, kalitlarni so'raydi)
#         → firewall → docker compose up → sayt javob berishini tekshiradi.
# Qayta ishga tushirish xavfsiz: mavjud .env va ma'lumotlar saqlanib qoladi.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ "$(id -u)" -ne 0 ]; then
  echo "❌ Root sifatida ishga tushiring:  sudo bash scripts/setup-server.sh"
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo ">> Docker o'rnatilmoqda (1-2 daqiqa)..."
  curl -fsSL https://get.docker.com | sh
fi

if [ ! -f .env ]; then
  echo ">> .env yaratilmoqda (parollar avtomatik, tasodifiy)..."
  TG_TOKEN=""
  AI_KEY=""
  if [ -t 0 ]; then
    echo "   Quyidagilarni hozir kiritmasangiz ham bo'ladi — keyin .env faylida to'ldirasiz."
    read -rp "   Telegram bot token (@BotFather'dan, Enter — o'tkazib yuborish): " TG_TOKEN
    read -rsp "   Anthropic API kaliti (Enter — o'tkazib yuborish): " AI_KEY
    echo
  fi
  cat > .env <<EOF
APP_PORT=8080
POSTGRES_DB=vazifalar
POSTGRES_USER=vazifalar
POSTGRES_PASSWORD=$(openssl rand -hex 16)
JWT_SECRET=$(openssl rand -hex 32)
ANTHROPIC_API_KEY=${AI_KEY}
AI_MODEL=claude-opus-5-5
TELEGRAM_BOT_TOKEN=${TG_TOKEN}
APP_TIMEZONE=Asia/Tashkent
QUIET_HOURS=23-7
DAILY_SUMMARY_HOUR=21
EOF
  chmod 600 .env
fi

# Windows'da tahrirlangan .env bo'lsa, CRLF belgilarini tozalaymiz.
sed -i 's/\r$//' .env
APP_PORT=$(grep -E '^APP_PORT=' .env | cut -d= -f2)
APP_PORT="${APP_PORT:-8080}"

if [ "${SKIP_FIREWALL:-0}" != "1" ] && command -v ufw >/dev/null 2>&1; then
  echo ">> Firewall: SSH (22) va ${APP_PORT}-port ochilmoqda..."
  ufw allow OpenSSH >/dev/null
  ufw allow "${APP_PORT}/tcp" >/dev/null
  ufw --force enable >/dev/null
fi

echo ">> Konteynerlar yig'ilmoqda va ishga tushirilmoqda (birinchi marta 2-4 daqiqa)..."
docker compose up -d --build

echo ">> Sayt tekshirilmoqda..."
for _ in $(seq 1 45); do
  if curl -fsS "http://localhost:${APP_PORT}/api/health" >/dev/null 2>&1; then
    IP=$(curl -fsS -4 --max-time 5 https://ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')
    echo ""
    echo "✅ Tayyor! Brauzerda oching:  http://${IP}:${APP_PORT}"
    echo "   Holat:  $(curl -fsS "http://localhost:${APP_PORT}/api/health")"
    echo "   Loglar: docker compose logs -f backend"
    exit 0
  fi
  sleep 2
done

echo "❌ Sayt 90 soniyada javob bermadi. Holat va loglar:"
docker compose ps
docker compose logs --tail=40
exit 1
