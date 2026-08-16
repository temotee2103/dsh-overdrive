#Requires -Version 5.1
# ============================================================
#  dsh-overdrive - guided installer (Windows)
#  the OpenClaw of DeepSeek Harness - 引导式一键安装
#  Requirements: Docker Desktop + Git (auto-checked)
# ============================================================
$ErrorActionPreference = 'Stop'

function Say($msg) { Write-Host $msg -ForegroundColor Cyan }
function Ask($msg) { Write-Host $msg -NoNewline; return Read-Host }

Say "=================================================="
Say "  dsh-overdrive - the OpenClaw of DeepSeek Harness"
Say "  Guided installer (English) / 引导式安装"
Say "=================================================="
Write-Host ""

# 0. prerequisites
foreach ($cmd in @('docker', 'git')) {
  if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
    Write-Host "[x] '$cmd' is required but not found." -ForegroundColor Red
    if ($cmd -eq 'docker') { Write-Host '    Install Docker Desktop: https://www.docker.com/products/docker-desktop/' }
    if ($cmd -eq 'git')    { Write-Host '    Install Git: https://git-scm.com/downloads' }
    Write-Host "    Re-run this installer after installing."
    exit 1
  }
}
Write-Host "[ok] docker + git found"

# 1. install folder
$dir = Ask "[1/4] Install folder [default: $HOME\dsh-overdrive]: "
if (-not $dir) { $dir = Join-Path $HOME 'dsh-overdrive' }
$dir = $dir.Trim('"').Trim("'")

# 2. DeepSeek API key
Write-Host ""
Write-Host "  Get a key (2 min): https://platform.deepseek.com/api_keys"
$key = Ask "[2/4] Paste your DeepSeek API key (sk-...): "
if ($key -notmatch '^sk-') { Write-Host "[x] That does not look like a DeepSeek key (should start with sk-)." -ForegroundColor Red; exit 1 }

# 3. platforms
Write-Host ""
Say "  Platforms: telegram, whatsapp, discord, slack, feishu, dingtalk, wecom"
$plats = Ask "[3/4] Which platforms? (comma separated, default: telegram): "
if (-not $plats) { $plats = 'telegram' }
$plats = (($plats -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ }) -join ',')

$tgToken = ''
if ($plats -match 'telegram') {
  Write-Host ""
  Write-Host "  Create a bot (2 min): open https://t.me/BotFather -> /newbot -> copy the token"
  $tgToken = Ask "[3b] Paste your Telegram bot token (123456789:AA...): "
  if ($tgToken -notmatch '^\d+:[A-Za-z0-9_-]{20,}$') { Write-Host "[x] That does not look like a Telegram bot token." -ForegroundColor Red; exit 1 }
}

# 4. clone
Write-Host ""
Say "  Installing to : $dir"
Say "  API key       : $($key.Substring(0, [Math]::Min(8, $key.Length)))..."
Say "  Platforms     : $plats"
Write-Host ""

if (Test-Path $dir) { Write-Host "[x] '$dir' already exists. Remove it or pick another folder." -ForegroundColor Red; exit 1 }
Write-Host "[..] cloning..."
git clone --depth 1 https://github.com/temotee2103/dsh-overdrive.git $dir 2>&1 | Out-Host
if (-not (Test-Path (Join-Path $dir 'deploy\docker-compose.yml'))) { Write-Host "[x] Clone failed." -ForegroundColor Red; exit 1 }
Write-Host "[ok] cloned"

# 5. write .env
$envLines = @(
  "DEEPSEEK_API_KEY=$key",
  "DSH_OVERDRIVE_TOKEN=dsh-overdrive-token",
  "GATEWAY_ADAPTERS=$plats",
  "TELEGRAM_BOT_TOKEN=$tgToken"
)
Set-Content -Path (Join-Path $dir '.env') -Value $envLines -Encoding UTF8
Write-Host "[ok] .env written (keep it private)"

# 6. start
Write-Host ""
Say "  Starting... the first build takes a few minutes."
Push-Location $dir
try {
  docker compose -f deploy/docker-compose.yml up -d --build
} finally {
  Pop-Location
}

Write-Host ""
Say "=================================================="
Say "  Done! / 安装完成"
Say "  Console / 控制台 : http://localhost:3190/"
Say "  DSH Web UI       : http://localhost:3080/"
Say "  In your chat app : send /help"
if ($plats -match 'whatsapp') { Say "  WhatsApp: a QR code appears in the gateway logs on first start - scan it" }
Say "=================================================="
