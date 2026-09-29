#!/usr/bin/env bash
# Deploy'dan keyin to'liq oqimni tekshiradi (Nginx → Backend → PostgreSQL):
#   bash scripts/smoke-test.sh                 # http://localhost:8080
#   bash scripts/smoke-test.sh http://IP:8080  # boshqa manzil
# Sinov foydalanuvchisi yaratadi va oxirida uning vazifalarini o'chiradi.
set -euo pipefail

BASE="${1:-http://localhost:$(grep -E '^APP_PORT=' "$(dirname "$0")/../.env" 2>/dev/null | cut -d= -f2 || echo 8080)}"
BASE="${BASE%/}"
EMAIL="smoke-$(date +%s)-$RANDOM@test.local"
PASS=0
FAIL=0

ok()   { echo "  ✅ $1"; PASS=$((PASS + 1)); }
bad()  { echo "  ❌ $1"; FAIL=$((FAIL + 1)); }
check() { if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 (kutilgan: $3, keldi: $2)"; fi; }

# req METHOD PATH [BODY] [TOKEN] → "HTTP_KODI<TAB>JAVOB"
req() {
  local args=(-s -o /tmp/smoke_body -w '%{http_code}' -X "$1" "$BASE$2" -H 'Content-Type: application/json')
  [ -n "${3:-}" ] && args+=(--data "$3")
  [ -n "${4:-}" ] && args+=(-H "Authorization: Bearer $4")
  local code
  : > /tmp/smoke_body
  code=$(curl "${args[@]}" || true)
  printf '%s\t%s' "$code" "$(cat /tmp/smoke_body)"
}
code() { printf '%s' "${1%%$'\t'*}"; }
body() { printf '%s' "${1#*$'\t'}"; }
json() { body "$1" | grep -o "\"$2\":[^,}]*" | head -1 | cut -d: -f2- | tr -d '"'; }

echo "Tekshirilmoqda: $BASE"

# `docker compose up -d` konteynerni ishga tushirishi bilan port bir necha soniya
# davomida ulanmasligi mumkin. Contabo'dagi yangi deployda yolg'on xato bermaslik
# uchun avval Nginx → backend → baza zanjiri tayyor bo'lishini kutamiz.
READY=0
for _ in $(seq 1 60); do
  if curl -fsS "$BASE/api/health" >/dev/null 2>&1; then
    READY=1
    break
  fi
  sleep 1
done
if [ "$READY" -ne 1 ]; then
  echo "❌ Sayt 60 soniyada tayyor bo'lmadi: $BASE"
  exit 1
fi

r=$(req GET /api/health);                      check "health" "$(code "$r")" 200
r=$(req GET /);                                 check "frontend (index.html)" "$(code "$r")" 200
body "$r" | grep -q 'Vazifalar' && ok "sahifa sarlavhasi" || bad "sahifa sarlavhasi"

r=$(req POST /api/auth/register "{\"full_name\":\"Smoke Test\",\"email\":\"$EMAIL\",\"password\":\"parol123\"}")
check "ro'yxatdan o'tish" "$(code "$r")" 201
r=$(req POST /api/auth/login "{\"email\":\"$EMAIL\",\"password\":\"xato\"}")
check "xato parol rad etiladi" "$(code "$r")" 401
r=$(req POST /api/auth/login "{\"email\":\"$EMAIL\",\"password\":\"parol123\"}")
check "kirish" "$(code "$r")" 200
TOKEN=$(json "$r" token)

r=$(req GET /api/tasks "" "");                  check "tokensiz kirish taqiqlangan" "$(code "$r")" 401

r=$(req POST /api/tasks '{"title":"Past muhim","type":"doimiy","importance":3}' "$TOKEN")
check "vazifa qo'shish (3★)" "$(code "$r")" 201
LOW_ID=$(json "$r" id)
r=$(req POST /api/tasks '{"title":"Eng muhim","type":"kunlik","importance":10}' "$TOKEN")
check "vazifa qo'shish (10★, kunlik)" "$(code "$r")" 201
TOP_ID=$(json "$r" id)
r=$(req POST /api/tasks '{"title":"X","type":"yillik","importance":5}' "$TOKEN")
check "noto'g'ri tur rad etiladi" "$(code "$r")" 400

r=$(req GET /api/tasks "" "$TOKEN")
FIRST=$(body "$r" | grep -o '"title":"[^"]*"' | head -1 | cut -d'"' -f4)
check "10★ vazifa eng tepada" "$FIRST" "Eng muhim"

r=$(req POST "/api/tasks/$TOP_ID/toggle" "" "$TOKEN")
check "bajarildi deb belgilash" "$(json "$r" done)" "true"
r=$(req GET /api/tasks "" "$TOKEN")
FIRST=$(body "$r" | grep -o '"title":"[^"]*"' | head -1 | cut -d'"' -f4)
check "bajarilgan pastga tushdi" "$FIRST" "Past muhim"

for id in "$LOW_ID" "$TOP_ID"; do req DELETE "/api/tasks/$id" "" "$TOKEN" >/dev/null; done
r=$(req GET /api/tasks "" "$TOKEN")
check "tozalash (vazifalar o'chirildi)" "$(json "$r" total)" "0"

echo ""
echo "Natija: $PASS ta o'tdi, $FAIL ta xato"
[ "$FAIL" -eq 0 ]
