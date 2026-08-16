#!/usr/bin/env bash
# ============================================================
#  dsh-overdrive - guided installer (macOS / Linux)
#  the OpenClaw of DeepSeek Harness - 引导式一键安装
#  Usage: curl -fsSL https://raw.githubusercontent.com/temotee2103/dsh-overdrive/main/install.sh | bash
#  Requirements: Docker + git (auto-checked)
# ============================================================
set -e

echo "=================================================="
echo "  dsh-overdrive - the OpenClaw of DeepSeek Harness"
echo "  Guided installer (English) / 引导式安装"
echo "=================================================="
echo ""

# 0. prerequisites
command -v docker >/dev/null 2>&1 || { echo "[x] docker is required. https://www.docker.com/get-started"; exit 1; }
command -v git >/dev/null 2>&1 || { echo "[x] git is required. https://git-scm.com"; exit 1; }
echo "[ok] docker + git found"

# 1. install folder
read -r -p "[1/4] Install folder [default: ~/dsh-overdrive]: " dir
dir="${dir:-$HOME/dsh-overdrive}"
dir="${dir%/}"

# 2. DeepSeek API key
echo "  Get a key (2 min): https://platform.deepseek.com/api_keys"
read -r -p "[2/4] Paste your DeepSeek API key (sk-...): " key
case "$key" in
  sk-*) ;;
  *) echo "[x] That does not look like a DeepSeek key (should start with sk-)."; exit 1 ;;
esac

# 3. platforms
echo "  Platforms: telegram, whatsapp, discord, slack, feishu, dingtalk, wecom"
read -r -p "[3/4] Which platforms? (comma separated, default: telegram): " plats
plats="${plats:-telegram}"
plats="$(echo "$plats" | tr -d ' ' | sed 's/,,*/,/g; s/^,//; s/,$//')"

tg_token=""
if echo "$plats" | grep -q telegram; then
  echo "  Create a bot (2 min): open https://t.me/BotFather -> /newbot -> copy the token"
  read -r -p "[3b] Paste your Telegram bot token (123456789:AA...): " tg_token
  case "$tg_token" in
    [0-9]*:[A-Za-z0-9_-]*) ;;
    *) echo "[x] That does not look like a Telegram bot token."; exit 1 ;;
  esac
fi

# 4. clone
echo ""
echo "  Installing to : $dir"
echo "  API key       : ${key:0:8}..."
echo "  Platforms     : $plats"
echo ""
[ -e "$dir" ] && { echo "[x] '$dir' already exists. Remove it or pick another folder."; exit 1; }
echo "[..] cloning..."
git clone --depth 1 https://github.com/temotee2103/dsh-overdrive.git "$dir"
[ -f "$dir/deploy/docker-compose.yml" ] || { echo "[x] Clone failed."; exit 1; }
echo "[ok] cloned"

# 5. write .env
cat > "$dir/.env" <<EOF
DEEPSEEK_API_KEY=$key
DSH_OVERDRIVE_TOKEN=dsh-overdrive-token
GATEWAY_ADAPTERS=$plats
TELEGRAM_BOT_TOKEN=$tg_token
EOF
echo "[ok] .env written (keep it private)"

# 6. start
echo ""
echo "  Starting... the first build takes a few minutes."
cd "$dir"
docker compose -f deploy/docker-compose.yml up -d --build

echo ""
echo "=================================================="
echo "  Done! / 安装完成"
echo "  Console / 控制台 : http://localhost:3190/"
echo "  DSH Web UI       : http://localhost:3080/"
echo "  In your chat app : send /help"
echo "$plats" | grep -q whatsapp && echo "  WhatsApp: a QR code appears in the gateway logs on first start - scan it"
echo "=================================================="
