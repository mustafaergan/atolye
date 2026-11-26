#!/usr/bin/env bash
# Atölye'yi macOS'ta kurar, başlatır, günceller ve Mac açılışında otomatik çalıştırır (Windows'taki atolye.ps1'in
# karşılığı; komut adları aynıdır).
#
# Kurulum (Terminal'de):
#   bash -c "$(curl -fsSL https://raw.githubusercontent.com/mustafaergan/atolye/main/atolye.sh)"
#
# Komutlar:
#   kur             (varsayılan) Node.js kontrolü, indirme, paketler, Uygulamalar klasörüne Atölye, Mac açılışında
#                   otomatik başlatma, ardından başlatıp açar.
#   baslat          Arka planda başlatır (zaten çalışıyorsa yalnızca açar).
#   durdur          Çalışan Atölye'yi durdurur.
#   guncelle        Son sürümü indirir (git ile ya da arşiv olarak), paketleri günceller ve yeniden başlatır.
#   durum           Kurulum ve çalışma durumunu gösterir.
#   otomatik-ac     Mac açılışında arka planda başlatmayı açar.      otomatik-kapat  Kapatır.
#   kisayol-ac      ~/Applications içine Atölye uygulamasını koyar.   kisayol-kapat   Kaldırır.
#   masaustu-ac     Atölye'yi Chrome ya da Edge'in uygulama penceresinde (adres çubuğu olmadan) açar.
#   masaustu-kapat  Atölye varsayılan tarayıcıda açılır.
#   kaldir          Atölye'yi kaldırır (onay ister; --evet ile sormaz). Git ile indirilmiş klasörlere ve ~/.claude
#                   içindeki sohbet geçmişine dokunmaz; ~/.atolye yalnızca --veriler ile silinir.
#
# Seçenekler: --klasor <yol>  --tarayici-acma  --evet  --veriler  --kabul
# Ortam: ATOLYE_KLASOR (kurulum klasörü), ATOLYE_SORMA=1 (hiç sorma), ATOLYE_KABUL=1 (koşulları kabul et),
#        ATOLYE_GIT=0 (git yerine arşiv indir), ATOLYE_UPDATE_CHECK=0, ATOLYE_APPS_DIR, ATOLYE_AGENTS_DIR (denemeler için)
# Yönetici izni gerekmez: her şey kullanıcının kendi klasörlerine yazılır.

set -u

REPO_URL='https://github.com/mustafaergan/atolye.git'
ARCHIVE_URL='https://github.com/mustafaergan/atolye/archive/refs/heads/main.tar.gz'
APP_NAME='Atölye'
LABEL='io.github.mustafaergan.atolye'
MIN_NODE_MAJOR=18
MIN_NODE_MINOR=18

# ---------- Parametreler ----------
KOMUT=''
KLASOR=''
TARAYICI_ACMA=0
EVET=0
VERILER=0
KABUL=0
while [ $# -gt 0 ]; do
  case "$1" in
    --klasor|-Klasor) KLASOR="${2:-}"; shift ;;
    --tarayici-acma|-TarayiciAcma) TARAYICI_ACMA=1 ;;
    --evet|-Evet) EVET=1 ;;
    --veriler|-Veriler) VERILER=1 ;;
    --kabul|-Kabul) KABUL=1 ;;
    -h|--help|yardim) KOMUT='yardim' ;;
    -*) echo "Bilinmeyen seçenek: $1" >&2; exit 2 ;;
    *) [ -z "$KOMUT" ] && KOMUT="$1" || { echo "Fazla parametre: $1" >&2; exit 2; } ;;
  esac
  shift
done
KOMUT="${KOMUT:-kur}"
case "$KOMUT" in
  kur|baslat|durdur|guncelle|durum|otomatik-ac|otomatik-kapat|kisayol-ac|kisayol-kapat|masaustu-ac|masaustu-kapat|ayarlar|kosullar|kaldir|yardim) ;;
  *) echo "Bilinmeyen komut: $KOMUT (yardım için: bash atolye.sh yardim)" >&2; exit 2 ;;
esac

# ---------- Yardımcılar ----------
if [ -t 1 ]; then C_STEP=$'\033[36m'; C_OK=$'\033[32m'; C_WARN=$'\033[33m'; C_ERR=$'\033[31m'; C_DIM=$'\033[90m'; C_END=$'\033[0m'
else C_STEP=''; C_OK=''; C_WARN=''; C_ERR=''; C_DIM=''; C_END=''; fi
step() { printf '  %s> %s%s\n' "$C_STEP" "$1" "$C_END"; }
ok() { printf '  %s✓ %s%s\n' "$C_OK" "$1" "$C_END"; }
warn() { printf '  %s! %s%s\n' "$C_WARN" "$1" "$C_END"; }
dim() { printf '  %s%s%s\n' "$C_DIM" "$1" "$C_END"; }
die() { printf '  %s✗ %s%s\n' "$C_ERR" "$1" "$C_END"; exit 1; }

is_mac() { [ "$(uname -s)" = 'Darwin' ]; }

# Soru sorulabilir mi? (Terminal'den çalışıyor, gizli başlatma değil, ATOLYE_SORMA verilmemiş)
can_ask() { [ "$TARAYICI_ACMA" = 0 ] && [ "${ATOLYE_SORMA:-}" != 1 ] && [ -r /dev/tty ] && { exec 3</dev/tty; } 2>/dev/null; }
# E/H sorusu (bash -c "$(curl …)" ile çalışırken de klavyeden okunur); sorulamıyorsa varsayılan
confirm() { # $1 soru, $2 varsayılan (1 evet / 0 hayır)
  local def="${2:-1}" a=''
  if ! can_ask; then [ "$def" = 1 ]; return; fi
  printf '  %s [%s] ' "$1" "$([ "$def" = 1 ] && echo 'E/h' || echo 'e/H')"
  read -r a <&3 || a=''
  a="$(printf '%s' "$a" | tr '[:upper:]' '[:lower:]' | tr -d ' ')"
  [ -z "$a" ] && { [ "$def" = 1 ]; return; }
  case "$a" in e|evet|y|yes) return 0 ;; *) return 1 ;; esac
}

is_atolye_dir() { [ -n "${1:-}" ] && [ -f "$1/package.json" ] && grep -q '"name": *"atolye"' "$1/package.json" 2>/dev/null; }

SCRIPT_DIR=''
if [ -n "${BASH_SOURCE[0]:-}" ] && [ -f "${BASH_SOURCE[0]}" ]; then SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; fi

resolve_install_dir() {
  if [ -n "$KLASOR" ]; then mkdir -p "$KLASOR" 2>/dev/null; (cd "$KLASOR" 2>/dev/null && pwd) || echo "$KLASOR"; return; fi
  if [ -n "${ATOLYE_KLASOR:-}" ]; then mkdir -p "$ATOLYE_KLASOR" 2>/dev/null; (cd "$ATOLYE_KLASOR" 2>/dev/null && pwd) || echo "$ATOLYE_KLASOR"; return; fi
  if is_atolye_dir "$SCRIPT_DIR"; then echo "$SCRIPT_DIR"; return; fi
  echo "$HOME/Library/Application Support/Atolye"
}
INSTALL_DIR="$(resolve_install_dir)"
LOG_FILE="$INSTALL_DIR/atolye.log"
UPDATE_LOCK="$INSTALL_DIR/.guncelleniyor"
SCRIPT_PATH="$INSTALL_DIR/atolye.sh"
ENV_FILE="$INSTALL_DIR/.env"
PATH_FILE="$INSTALL_DIR/.ortam"          # kurulumdaki PATH: Dock'tan ya da açılışta başlatıldığında node bulunsun
WINDOW_MARK="$INSTALL_DIR/.uygulama-penceresi"
APPS_DIR="${ATOLYE_APPS_DIR:-$HOME/Applications}"
APP_BUNDLE="$APPS_DIR/$APP_NAME.app"
AGENTS_DIR="${ATOLYE_AGENTS_DIR:-$HOME/Library/LaunchAgents}"
AGENT_PLIST="$AGENTS_DIR/$LABEL.plist"
DATA_DIR="$HOME/.atolye"

# Dock'tan, Spotlight'tan ya da Mac açılışında çalışınca PATH kısadır: kurulumda kaydedilen PATH eklenir
if [ -f "$PATH_FILE" ]; then
  saved="$(sed -n 's/^PATH=//p' "$PATH_FILE" | head -1)"
  [ -n "$saved" ] && export PATH="$saved:$PATH"
fi
export PATH="$PATH:/opt/homebrew/bin:/usr/local/bin"

# ---------- Node.js ----------
find_node() {
  local n
  n="$(command -v node 2>/dev/null)"
  if [ -n "$n" ]; then echo "$n"; return 0; fi
  for n in /opt/homebrew/bin/node /usr/local/bin/node "$HOME/.volta/bin/node" "$HOME"/.nvm/versions/node/*/bin/node; do
    [ -x "$n" ] && { echo "$n"; return 0; }
  done
  return 1
}
node_ok() { "$1" -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>$MIN_NODE_MAJOR||(a===$MIN_NODE_MAJOR&&b>=$MIN_NODE_MINOR)?0:1)" 2>/dev/null; }
node_missing() {
  echo ''
  warn "$1"
  echo '  Atölye için Node.js (18.18 ya da daha yeni, önerilen: LTS) gerekir. Kurmak için:'
  echo '    1) https://nodejs.org adresinden "LTS" sürümünün macOS kurulum paketini indirip kurun'
  echo '       (ya da Homebrew varsa: brew install node)'
  echo '    2) Terminal penceresini kapatıp açın ve kurulum komutunu yeniden çalıştırın.'
  echo ''
  exit 1
}
NODE=''
require_node() {
  NODE="$(find_node)" || node_missing 'Node.js bulunamadı.'
  node_ok "$NODE" || node_missing "Node.js $("$NODE" --version 2>/dev/null) çok eski."
  # npm ve npx, kullanılan node'un yanından bulunsun
  export PATH="$(dirname "$NODE"):$PATH"
}

# ---------- Port ve süreç ----------
get_port() {
  local p=''
  [ -f "$ENV_FILE" ] && p="$(sed -n 's/^[[:space:]]*ATOLYE_PORT[[:space:]]*=[[:space:]]*\([0-9][0-9]*\).*/\1/p' "$ENV_FILE" | head -1)"
  echo "${p:-3210}"
}
get_url() { echo "http://127.0.0.1:$(get_port)"; }
port_pid() { lsof -nP -iTCP:"$1" -sTCP:LISTEN -t 2>/dev/null | head -1; }
is_atolye_http() { curl -fsS -m 2 "http://127.0.0.1:$1/api/config" 2>/dev/null | grep -q '"generalDir"'; }
# Porttaki süreç bu kurulumun Atölye'si mi?
pid_is_ours() {
  local cmd
  cmd="$(ps -o command= -p "$1" 2>/dev/null)"
  case "$cmd" in *"$INSTALL_DIR/src/cli.js"*) return 0 ;; esac
  [ -z "$cmd" ] && is_atolye_http "$(get_port)"
}
is_running() { local pid; pid="$(port_pid "$(get_port)")"; [ -n "$pid" ] && pid_is_ours "$pid"; }
port_free() { [ -z "$(port_pid "$1")" ]; }
find_free_port() { local p; for ((p = $1; p < $1 + 100 && p <= 65535; p++)); do port_free "$p" && { echo "$p"; return 0; }; done; return 1; }

# .env içindeki bir değeri ayarlar (yorum satırı hâlindeyse açar, yoksa ekler)
set_env_value() {
  local key="$1" value="$2" tmp
  touch "$ENV_FILE"
  tmp="$(mktemp)"
  awk -v k="$key" -v v="$value" 'BEGIN{done=0} { if (!done && $0 ~ "^[[:space:]]*#?[[:space:]]*" k "[[:space:]]*=") { print k "=" v; done=1 } else print } END{ if (!done) print k "=" v }' "$ENV_FILE" > "$tmp" && mv "$tmp" "$ENV_FILE"
}

resolve_port_conflict() { # $1=1: sormadan boş portu seç
  local port pid who new a i
  port="$(get_port)"
  pid="$(port_pid "$port")"
  [ -z "$pid" ] && return 0
  pid_is_ours "$pid" && return 0
  who="$(ps -o comm= -p "$pid" 2>/dev/null | xargs basename 2>/dev/null) (PID $pid)"
  warn "Port $port kullanılamıyor: $who"
  new="$(find_free_port $((port + 1)))" || die "$port sonrasında boş port bulunamadı. $ENV_FILE dosyasına ATOLYE_PORT=<port> yazıp tekrar deneyin."
  if [ "${1:-0}" != 1 ] && can_ask; then
    for i in 1 2 3 4 5; do
      printf '  Atölye için kullanılacak port [%s] ' "$new"
      read -r a <&3 || a=''
      a="$(printf '%s' "$a" | tr -d ' ')"
      [ -z "$a" ] && break
      case "$a" in *[!0-9]*) warn '1024 ile 65535 arasında bir sayı girin.'; continue ;; esac
      if [ "$a" -lt 1024 ] || [ "$a" -gt 65535 ]; then warn '1024 ile 65535 arasında bir sayı girin.'; continue; fi
      port_free "$a" || { warn "Port $a da kullanılamıyor, başka bir numara deneyin."; continue; }
      new="$a"; break
    done
  fi
  set_env_value ATOLYE_PORT "$new"
  ok "Atölye artık $new portunu kullanacak (.env dosyasına kaydedildi): http://127.0.0.1:$new"
}

# ---------- Kullanım koşulları ----------
terms_lines() {
  cat <<'EOF'
KULLANIM KOŞULLARI

Atölye yalnızca bir arayüzdür; kendi başına hiçbir yapay zekâ ya da servis
lisansı içermez. Kuruluma devam ederek şunları kabul etmiş olursunuz:

1) Şirketiniz, bu bilgisayarda kullanacağınız ürünler için gerekli lisans ve
   sözleşmelere sahiptir: Claude Code (Anthropic), GitHub Copilot ve
   bağlayacaksanız Jira / Confluence / Bitbucket (Atlassian).
2) Bu ürünleri, şirketinizin o sağlayıcılarla yaptığı sözleşmelere ve
   şirketinizin bilgi güvenliği kurallarına uygun kullanacaksınız.
3) Size verilen token ve API anahtarları kişiseldir; başkasıyla paylaşılmaz.
4) Bağlantılar (Jira, Confluence, Bitbucket, Graylog test/prod, ReportPortal, Jenkins, Fortify, SonarQube, WebLogic, Oracle, PostgreSQL)
   üzerinden getirilen veriler, sorduğunuz sorularla birlikte seçtiğiniz yapay
   zekâ hizmetine gönderilir. Hangi verinin gönderilebileceğine şirketinizin
   kuralları çerçevesinde siz karar verirsiniz.
5) Atölye MIT lisansıyla, olduğu gibi ve hiçbir garanti verilmeden sunulur.
   Kurulumdan ve kullanımdan doğacak tüm sorumluluk (veri paylaşımı, lisans
   ve şirket kurallarına uygunluk, yapılan işlemler ve sonuçları dahil)
   kurulumu yapan ve kullanan kişiye aittir; yazılımı geliştirenler sorumlu
   tutulamaz.
EOF
}
confirm_terms() {
  local version=2 marker="$DATA_DIR/kullanim-kosullari-kabul.txt" a=''
  if [ -f "$marker" ] && grep -Eq "Koşul sürümü: ${version}([^0-9]|$)" "$marker" 2>/dev/null; then ok 'Kullanım koşulları daha önce kabul edilmiş'; return; fi
  echo ''
  terms_lines | sed 's/^/  /'
  echo ''
  if [ "$KABUL" != 1 ] && [ "${ATOLYE_KABUL:-}" != 1 ]; then
    can_ask || die 'Kullanım koşulları kabul edilmeden kurulum yapılamaz. Etkileşimsiz kurulumda --kabul (ya da ATOLYE_KABUL=1) kullanın.'
    printf '  Bu koşulları kabul ediyor musunuz? Devam etmek için "evet" yazın: '
    read -r a <&3 || a=''
    case "$(printf '%s' "$a" | tr '[:upper:]' '[:lower:]' | tr -d ' ')" in evet|e|yes|y) ;; *) echo ''; printf '  %sKoşullar kabul edilmedi; kurulum yapılmadı.%s\n\n' "$C_ERR" "$C_END"; exit 1 ;; esac
  fi
  mkdir -p "$DATA_DIR" && printf 'Kullanım koşulları %s tarihinde %s tarafından kabul edildi. Koşul sürümü: %s\n' "$(date '+%Y-%m-%d %H:%M')" "$(id -un)" "$version" > "$marker"
  ok 'Kullanım koşulları kabul edildi'
}

# ---------- İndirme ----------
# macOS'ta /usr/bin/git, Xcode komut satırı araçları yoksa kurulum penceresi açar: o durumda arşiv indirilir
git_usable() {
  [ "${ATOLYE_GIT:-}" = 0 ] && return 1
  command -v git >/dev/null 2>&1 || return 1
  if is_mac && [ "$(command -v git)" = /usr/bin/git ]; then xcode-select -p >/dev/null 2>&1 || return 1; fi
  return 0
}
# Depodaki son sürümü arşiv olarak $1 klasörüne açar
download_archive() {
  mkdir -p "$1" || return 1
  curl -fsSL --retry 2 "${ATOLYE_ARCHIVE_URL:-$ARCHIVE_URL}" | tar -xz --strip-components 1 -C "$1"
}

install_files() {
  if is_atolye_dir "$INSTALL_DIR"; then ok "Kurulum klasörü: $INSTALL_DIR"; return; fi
  if [ -d "$INSTALL_DIR" ] && [ -n "$(ls -A "$INSTALL_DIR" 2>/dev/null)" ]; then
    die "$INSTALL_DIR boş değil ve bir Atölye klasörü değil. --klasor ile başka bir yer seçin."
  fi
  mkdir -p "$(dirname "$INSTALL_DIR")"
  if git_usable; then
    step "İndiriliyor: $REPO_URL → $INSTALL_DIR"
    git clone --quiet "$REPO_URL" "$INSTALL_DIR" || die 'git clone başarısız oldu.'
  else
    step "İndiriliyor (arşiv): $INSTALL_DIR"
    download_archive "$INSTALL_DIR" || die 'Atölye indirilemedi. İnternet bağlantısını ya da şirket ağının GitHub erişimini kontrol edin.'
    date '+%Y-%m-%dT%H:%M:%S' > "$INSTALL_DIR/.kurulu"
  fi
  is_atolye_dir "$INSTALL_DIR" || die 'İndirilen klasörde Atölye bulunamadı.'
  ok 'İndirildi'
}

install_packages() {
  step 'Paketler kuruluyor (ilk seferde birkaç dakika sürebilir)…'
  (cd "$INSTALL_DIR" && npm install --no-audit --no-fund --loglevel=error) || die 'npm install başarısız oldu. Şirket ağı npm erişimini engelliyor olabilir.'
  ok 'Paketler hazır'
}

install_env() {
  if [ ! -f "$ENV_FILE" ] && [ -f "$INSTALL_DIR/.env.example" ]; then cp "$INSTALL_DIR/.env.example" "$ENV_FILE" && ok '.env oluşturuldu'; fi
  # Kurulumdaki PATH saklanır: Dock'tan ya da Mac açılışında başlatıldığında node, claude ve copilot bulunsun
  printf 'PATH=%s\n' "$(dirname "$NODE"):$PATH" > "$PATH_FILE"
}

# ---------- Claude bağlantısı (yalnızca bilgi) ----------
claude_connection() {
  if [ -f "$ENV_FILE" ] && grep -Eq '^[[:space:]]*ANTHROPIC_(AUTH_TOKEN|API_KEY)[[:space:]]*=[[:space:]]*[^[:space:]]' "$ENV_FILE"; then echo 'evet (.env)'; return; fi
  if [ -n "${ANTHROPIC_AUTH_TOKEN:-}${ANTHROPIC_API_KEY:-}" ]; then echo 'evet (ortam değişkeni)'; return; fi
  if [ -f "$HOME/.claude/settings.json" ] && grep -Eq '"ANTHROPIC_(AUTH_TOKEN|API_KEY)"' "$HOME/.claude/settings.json"; then echo 'evet (~/.claude/settings.json)'; return; fi
  if [ -f "$HOME/.claude.json" ] && grep -q '"oauthAccount"' "$HOME/.claude.json"; then echo 'evet (claude.ai girişi)'; return; fi
  echo ''
}
cli_version() { local exe; exe="$(command -v "$1" 2>/dev/null)" || return 1; "$exe" --version 2>/dev/null | head -1; }

# ---------- Başlatma / durdurma ----------
wait_update_lock() {
  local i
  for ((i = 0; i < 240; i++)); do
    [ -f "$UPDATE_LOCK" ] || return 0
    # 15 dakikadan eski kilit yarım kalmış bir güncellemedir
    [ -n "$(find "$UPDATE_LOCK" -mmin +15 2>/dev/null)" ] && { rm -f "$UPDATE_LOCK"; return 0; }
    [ "$i" = 0 ] && dim 'Güncelleme sürüyor, bitmesi bekleniyor…'
    sleep 0.5
  done
}

start_server() {
  local cli="$INSTALL_DIR/src/cli.js" i
  # Arka plana yalnızca node gider ve araya giren kabuk hemen çıkar: sunucu bu betiğe bağlı kalmaz
  ( cd "$HOME" || exit 1; nohup "$NODE" "$cli" --no-open < /dev/null > "$LOG_FILE" 2>&1 & )
  for ((i = 0; i < ${1:-20} * 2; i++)); do
    sleep 0.5
    is_running && return 0
  done
  return 1
}

# Uygulama penceresi için Chromium tabanlı tarayıcı (Chrome, Edge, Brave, Chromium)
app_browser() {
  local b d
  for b in 'Google Chrome' 'Microsoft Edge' 'Brave Browser' 'Chromium'; do
    for d in /Applications "$HOME/Applications"; do [ -d "$d/$b.app" ] && { echo "$b"; return 0; }; done
  done
  return 1
}

open_ui() {
  local url b
  url="$(get_url)"
  if [ -f "$WINDOW_MARK" ] && b="$(app_browser)"; then
    open -na "$b" --args --app="$url" && return
  fi
  open "$url"
}

start_atolye() {
  wait_update_lock
  if is_running; then
    ok "Zaten çalışıyor: $(get_url)"
  else
    resolve_port_conflict "$TARAYICI_ACMA"
    require_node
    step 'Başlatılıyor…'
    if ! start_server 20; then
      warn 'Atölye başlatılamadı. Son kayıtlar:'
      [ -f "$LOG_FILE" ] && tail -15 "$LOG_FILE" | sed 's/^/    /'
      exit 1
    fi
    ok "Çalışıyor: $(get_url)"
  fi
  [ "$TARAYICI_ACMA" = 1 ] || open_ui
}

# Süreci ve alt süreçlerini (açık oturumların Claude Code süreçleri) kapatır
kill_tree() {
  local child
  for child in $(pgrep -P "$1" 2>/dev/null); do kill_tree "$child"; done
  kill -TERM "$1" 2>/dev/null
}

stop_atolye() {
  local port pid stopped=0 i orphans
  port="$(get_port)"
  pid="$(port_pid "$port")"
  if [ -n "$pid" ] && pid_is_ours "$pid"; then
    kill_tree "$pid"
    for ((i = 0; i < 20; i++)); do kill -0 "$pid" 2>/dev/null || break; sleep 0.25; done
    kill -0 "$pid" 2>/dev/null && kill -KILL "$pid" 2>/dev/null
    ok "Durduruldu (süreç $pid)"
    stopped=1
  elif [ -n "$pid" ]; then
    warn "Port $port başka bir program tarafından kullanılıyor; dokunulmadı."
  fi
  # Bu kurulumdan çalışıp geride kalmış süreçler (ör. kapanmamış Claude Code süreçleri)
  orphans="$(pgrep -f "$INSTALL_DIR/node_modules/" 2>/dev/null)"
  if [ -n "$orphans" ]; then
    kill -TERM $orphans 2>/dev/null
    ok "Arkada kalmış $(echo "$orphans" | wc -l | tr -d ' ') süreç kapatıldı"
  fi
  [ "$stopped" = 0 ] && [ -z "$orphans" ] && ok 'Zaten çalışmıyor'
  return 0
}

wait_port_free() { local i; for ((i = 0; i < 40; i++)); do port_free "$(get_port)" && return 0; sleep 0.5; done; return 1; }

# ---------- Uygulama, otomatik başlatma, pencere ----------
xml_escape() { printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'; }

# ~/Applications/Atölye.app: Atölye'yi başlatan küçük bir uygulama paketi. Bu Mac'te oluşturulduğu için (internetten
# inmediği için) Gatekeeper engellemez; Launchpad ve Spotlight'ta görünür, Dock'a sürüklenebilir.
enable_shortcut() {
  local tmp="$APP_BUNDLE.yeni"
  rm -rf "$tmp"
  mkdir -p "$tmp/Contents/MacOS" "$tmp/Contents/Resources" || { warn "Uygulama oluşturulamadı: $APP_BUNDLE"; return 1; }
  cat > "$tmp/Contents/MacOS/Atolye" <<EOF
#!/bin/bash
# Atölye'yi başlatır (çalışıyorsa yalnızca açar). Kurulum: $INSTALL_DIR
exec /bin/bash "$SCRIPT_PATH" baslat >> "$INSTALL_DIR/atolye-uygulama.log" 2>&1
EOF
  chmod +x "$tmp/Contents/MacOS/Atolye"
  cat > "$tmp/Contents/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>$APP_NAME</string>
  <key>CFBundleDisplayName</key><string>$APP_NAME</string>
  <key>CFBundleIdentifier</key><string>$LABEL.app</string>
  <key>CFBundleExecutable</key><string>Atolye</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleIconFile</key><string>atolye</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>LSUIElement</key><true/>
</dict>
</plist>
EOF
  # Simge: Atölye'nin .ico dosyasından (olmazsa varsayılan simge kalır)
  if [ -f "$INSTALL_DIR/public/atolye.ico" ] && command -v sips >/dev/null 2>&1; then
    sips -s format icns "$INSTALL_DIR/public/atolye.ico" --out "$tmp/Contents/Resources/atolye.icns" >/dev/null 2>&1 \
      || { sips -s format png "$INSTALL_DIR/public/atolye.ico" --out "$tmp/Contents/Resources/atolye.png" >/dev/null 2>&1 \
        && sips -s format icns "$tmp/Contents/Resources/atolye.png" --out "$tmp/Contents/Resources/atolye.icns" >/dev/null 2>&1; rm -f "$tmp/Contents/Resources/atolye.png"; }
  fi
  rm -rf "$APP_BUNDLE" && mv "$tmp" "$APP_BUNDLE" || { warn "Uygulama yerine konamadı: $APP_BUNDLE"; return 1; }
  touch "$APP_BUNDLE"
  ok "Uygulamalar klasörüne eklendi: $APP_BUNDLE (Launchpad ve Spotlight'tan açılır, Dock'a sürüklenebilir)"
}
disable_shortcut() { if [ -d "$APP_BUNDLE" ]; then rm -rf "$APP_BUNDLE" && ok 'Uygulamalar klasöründeki Atölye kaldırıldı'; else ok 'Uygulamalar klasöründe Atölye yok'; fi; }

enable_autostart() {
  mkdir -p "$AGENTS_DIR" || { warn 'LaunchAgents klasörü oluşturulamadı; otomatik başlatma atlandı.'; return 1; }
  cat > "$AGENT_PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$(xml_escape "$SCRIPT_PATH")</string>
    <string>baslat</string>
    <string>--tarayici-acma</string>
  </array>
  <key>RunAtLoad</key><true/>
  <!-- Betik sunucuyu arka planda başlatıp çıkar; sunucu kapatılmasın -->
  <key>AbandonProcessGroup</key><true/>
  <key>StandardOutPath</key><string>$(xml_escape "$INSTALL_DIR/atolye-acilis.log")</string>
  <key>StandardErrorPath</key><string>$(xml_escape "$INSTALL_DIR/atolye-acilis.log")</string>
</dict>
</plist>
EOF
  ok 'Mac açılışında arka planda başlatma açıldı'
}
disable_autostart() {
  if [ -f "$AGENT_PLIST" ]; then
    launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || launchctl unload "$AGENT_PLIST" >/dev/null 2>&1
    rm -f "$AGENT_PLIST"
  fi
  ok 'Mac açılışında başlatma kapalı'
}

enable_window() {
  local b
  b="$(app_browser)" || { warn "Uygulama penceresi için Chrome ya da Edge gerekli; bulunamadı. Atölye varsayılan tarayıcıda açılacak."; return 1; }
  touch "$WINDOW_MARK"
  ok "Atölye, $b uygulama penceresinde açılacak (adres çubuğu olmadan; Dock'taki simgesine sağ tıklayıp \"Dock'ta Tut\" ile sabitlenebilir)"
}
disable_window() { rm -f "$WINDOW_MARK"; ok 'Atölye varsayılan tarayıcıda açılacak'; }

show_settings() {
  local avail=false
  app_browser >/dev/null && avail=true
  printf '{"platform":"mac","desktopApp":%s,"desktopAppAvailable":%s,"desktopShortcut":%s,"autostart":%s}\n' \
    "$([ -f "$WINDOW_MARK" ] && echo true || echo false)" "$avail" \
    "$([ -d "$APP_BUNDLE" ] && echo true || echo false)" "$([ -f "$AGENT_PLIST" ] && echo true || echo false)"
}

# ---------- Kurulum ----------
install_atolye() {
  echo ''
  printf '  %s kurulumu (macOS)\n\n' "$APP_NAME"
  is_mac || warn 'Bu betik macOS için yazıldı; başka sistemlerde Uygulamalar klasörü ve otomatik başlatma çalışmaz.'
  confirm_terms
  require_node
  ok "Node.js $("$NODE" --version | tr -d v)"
  install_files
  install_packages
  install_env
  local conn
  conn="$(claude_connection)"
  if [ -n "$conn" ]; then ok "Claude bağlantı ayarı bulundu: $conn"
  else
    warn 'Claude bağlantı ayarı bulunamadı. Atölye Copilot ya da yerel LLM ile yine çalışır; Claude için:'
    dim "- Şirketin verdiği gateway adresini ve token'ı Atölye'de Ayarlar > Claude Code bölümüne yazın,"
    dim '- ya da Claude Code'"'"'u (claude) kurup giriş yapın; ~/.claude/settings.json otomatik kullanılır.'
  fi
  cli_version copilot >/dev/null || dim 'GitHub Copilot CLI kurulu değil (isteğe bağlı): npm install -g @github/copilot'
  if is_mac; then
    enable_shortcut || true
    if [ -f "$AGENT_PLIST" ] || confirm 'Mac açılışında Atölye arka planda başlasın mı?' 1; then enable_autostart || true; fi
    if [ ! -f "$WINDOW_MARK" ] && app_browser >/dev/null && confirm 'Atölye, adres çubuğu olmayan kendi penceresinde (Chrome/Edge uygulama penceresi) açılsın mı?' 1; then enable_window || true; fi
  fi
  if is_running; then
    step 'Yeni sürümle yeniden başlatılıyor…'
    stop_atolye >/dev/null
    wait_port_free || true
  fi
  start_atolye
  echo ''
  printf '  %s%s hazır.%s\n' "$C_OK" "$APP_NAME" "$C_END"
  dim "Sonra açmak için: Launchpad / Spotlight'ta \"$APP_NAME\" ya da bash \"$SCRIPT_PATH\" baslat"
  echo ''
}

# ---------- Güncelleme ----------
update_atolye() {
  [ "${ATOLYE_GUNCELLEME_KAYDI:-}" = 1 ] && exec >> "$INSTALL_DIR/atolye-guncelle.log" 2>&1 && echo "--- $(date '+%Y-%m-%d %H:%M:%S')"
  is_atolye_dir "$INSTALL_DIR" || die "Kurulum bulunamadı: $INSTALL_DIR. Önce 'kur' komutunu çalıştırın."
  [ -f "$UPDATE_LOCK" ] && [ -z "$(find "$UPDATE_LOCK" -mmin +15 2>/dev/null)" ] && die 'Başka bir güncelleme şu an sürüyor; bitmesini bekleyin.'
  require_node
  local before after
  if [ -d "$INSTALL_DIR/.git" ]; then
    cd "$INSTALL_DIR" || die "Klasöre girilemedi: $INSTALL_DIR"
    before="$(git rev-parse HEAD)"
    step 'Son sürüm indiriliyor…'
    git fetch --quiet || die 'Son sürüm indirilemedi (git fetch). Çalışan sürüme dokunulmadı.'
    after="$(git rev-parse '@{u}' 2>/dev/null)" || die 'Bu klasör bir uzak dalı izlemiyor; güncelleme yapılamadı.'
    if [ "$before" = "$after" ]; then ok "Zaten güncel (${before:0:7})"; return 0; fi
    touch "$UPDATE_LOCK"
    git merge --ff-only --quiet '@{u}' || { rm -f "$UPDATE_LOCK"; die 'Yeni sürüm uygulanamadı. Klasörde elle yapılmış değişiklikler olabilir (git status). Çalışan sürüme dokunulmadı.'; }
    step "Güncelleniyor: ${before:0:7} → ${after:0:7}"
    if ! npm install --no-audit --no-fund --loglevel=error; then
      git reset --keep --quiet "$before"
      npm install --no-audit --no-fund --loglevel=error >/dev/null 2>&1
      rm -f "$UPDATE_LOCK"
      die "Kütüphaneler kurulamadı (şirket ağı npm erişimini engelliyor olabilir). Önceki sürüme (${before:0:7}) geri dönüldü."
    fi
    ok "Güncellendi: ${before:0:7} → ${after:0:7}"
  else
    update_from_archive || return 1
  fi
  rm -f "$UPDATE_LOCK"
  install_env
  [ -d "$APP_BUNDLE" ] && enable_shortcut >/dev/null
  if is_running; then
    stop_atolye >/dev/null
    wait_port_free || true
    TARAYICI_ACMA=1
    start_atolye
    dim 'Tarayıcıda sayfayı yenileyin.'
  fi
}

ver_of() { sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$1/package.json" 2>/dev/null | head -1; }

# Arşivle kurulmuşsa: son sürüm geçici klasöre indirilir; uygulama dosyaları yedeklenip yenileriyle değiştirilir,
# paketler kurulamazsa yedek geri konur. .env, node_modules ve kişisel ayar dosyaları korunur.
update_from_archive() {
  local tmp backup current latest item
  current="$(ver_of "$INSTALL_DIR")"
  tmp="$(mktemp -d)"
  step 'Son sürüm indiriliyor…'
  if ! download_archive "$tmp/yeni" || ! is_atolye_dir "$tmp/yeni"; then rm -rf "$tmp"; die 'Son sürüm indirilemedi. Çalışan sürüme dokunulmadı.'; fi
  latest="$(ver_of "$tmp/yeni")"
  if [ "$latest" = "$current" ] && [ "${ATOLYE_ZORLA:-}" != 1 ]; then rm -rf "$tmp"; ok "Zaten güncel ($current)"; return 0; fi
  touch "$UPDATE_LOCK"
  step "Güncelleniyor: $current → $latest"
  backup="$tmp/yedek"
  mkdir -p "$backup"
  for item in src public scripts chrome-eklentisi package.json package-lock.json atolye.sh atolye.ps1 README.md LICENSE .env.example; do
    [ -e "$INSTALL_DIR/$item" ] && mv "$INSTALL_DIR/$item" "$backup/"
  done
  for item in src public scripts chrome-eklentisi package.json package-lock.json atolye.sh atolye.ps1 README.md LICENSE .env.example; do
    [ -e "$tmp/yeni/$item" ] && cp -R "$tmp/yeni/$item" "$INSTALL_DIR/"
  done
  if ! (cd "$INSTALL_DIR" && npm install --no-audit --no-fund --loglevel=error); then
    for item in "$backup"/* "$backup"/.env.example; do [ -e "$item" ] || continue; rm -rf "$INSTALL_DIR/$(basename "$item")"; mv "$item" "$INSTALL_DIR/"; done
    (cd "$INSTALL_DIR" && npm install --no-audit --no-fund --loglevel=error >/dev/null 2>&1)
    rm -rf "$tmp"; rm -f "$UPDATE_LOCK"
    die "Kütüphaneler kurulamadı (şirket ağı npm erişimini engelliyor olabilir). Önceki sürüme ($current) geri dönüldü."
  fi
  rm -rf "$tmp"
  ok "Güncellendi: $current → $latest"
}

# ---------- Durum ----------
show_status() {
  local yes=evet no=hayır pid conn
  echo ''
  if is_atolye_dir "$INSTALL_DIR"; then
    echo "  Kurulum klasörü  : $INSTALL_DIR"
    if [ -d "$INSTALL_DIR/.git" ]; then echo "  Sürüm            : $(ver_of "$INSTALL_DIR") ($(cd "$INSTALL_DIR" && git log -1 --format='%h %cd' --date=short), git)"
    else echo "  Sürüm            : $(ver_of "$INSTALL_DIR") (arşiv)"; fi
  else
    echo "  Kurulum klasörü  : $INSTALL_DIR (kurulu değil)"
  fi
  if is_running; then echo "  Çalışıyor        : $yes ($(get_url))"; else echo "  Çalışıyor        : $no"; fi
  pid="$(port_pid "$(get_port)")"
  if [ -n "$pid" ] && ! pid_is_ours "$pid"; then echo "  Port             : $(get_port) başka bir program tarafından kullanılıyor; 'baslat' yeni port soracak"
  else echo "  Port             : $(get_port)"; fi
  echo "  Uygulamalar      : $([ -d "$APP_BUNDLE" ] && echo "$yes ($APP_BUNDLE)" || echo "$no")"
  echo "  Otomatik başlatma: $([ -f "$AGENT_PLIST" ] && echo "$yes" || echo "$no")"
  echo "  Uygulama penceresi: $([ -f "$WINDOW_MARK" ] && echo "$yes ($(app_browser || echo 'tarayıcı bulunamadı'))" || echo "$no (varsayılan tarayıcı)")"
  NODE="$(find_node)" && echo "  Node.js          : $("$NODE" --version)" || echo "  Node.js          : $no"
  conn="$(claude_connection)"
  echo "  Claude bağlantısı: ${conn:-$no — Ayarlar > Claude Code ya da ~/.claude/settings.json}"
  echo "  Claude Code CLI  : $(cli_version claude || echo "$no (isteğe bağlı: npm install -g @anthropic-ai/claude-code)")"
  echo "  Copilot CLI      : $(cli_version copilot || echo "$no (isteğe bağlı: npm install -g @github/copilot)")"
  echo "  Kayıt dosyası    : $LOG_FILE"
  echo ''
}

# ---------- Kaldırma ----------
uninstall_atolye() {
  local installed=0 is_repo=0 can_delete=0 full
  echo ''
  printf '  %s kaldırma\n\n' "$APP_NAME"
  is_atolye_dir "$INSTALL_DIR" && installed=1
  [ -d "$INSTALL_DIR/.git" ] && is_repo=1
  full="$(cd "$INSTALL_DIR" 2>/dev/null && pwd)"
  # Yalnızca bu betiğin arşivle kurduğu klasör silinir; git deposuna ve ana klasörlere asla dokunulmaz
  if [ "$installed" = 1 ] && [ "$is_repo" = 0 ] && [ -f "$INSTALL_DIR/.kurulu" ] && [ -n "$full" ]; then
    case "$full" in "$HOME"|"$HOME/Library"|"$HOME/Library/Application Support"|/|/Applications|/Users) ;; *) can_delete=1 ;; esac
  fi
  if [ "$installed" = 0 ] && [ ! -d "$APP_BUNDLE" ] && [ ! -f "$AGENT_PLIST" ]; then ok "Kaldırılacak bir Atölye kurulumu bulunamadı ($INSTALL_DIR)"; return 0; fi
  echo '  Yapılacaklar:'
  echo '    - Çalışıyorsa Atölye durdurulacak'
  echo '    - Uygulamalar klasöründeki Atölye ve Mac açılışında başlatma kaldırılacak'
  if [ "$can_delete" = 1 ]; then echo "    - Kurulum klasörü silinecek (.env ayarları dahil): $INSTALL_DIR"
  elif [ "$is_repo" = 1 ]; then dim "  - Git ile indirilmiş klasöre dokunulmayacak: $INSTALL_DIR"; fi
  dim '  - Sohbet geçmişi (~/.claude) korunacak; Claude Code CLI ile ortaktır'
  [ "$VERILER" = 1 ] || dim "  - Kişisel verileriniz ($DATA_DIR) korunacak"
  echo ''
  if [ "$EVET" != 1 ] && ! confirm "$APP_NAME kaldırılsın mı?" 0; then dim 'Vazgeçildi, hiçbir şey değiştirilmedi.'; return 0; fi
  stop_atolye
  disable_shortcut >/dev/null
  disable_autostart >/dev/null
  ok 'Uygulama ve otomatik başlatma kaldırıldı'
  if [ "$can_delete" = 1 ]; then
    cd "$HOME" || true
    rm -rf "$full" && ok "Kurulum klasörü silindi: $full" || warn "Klasör tamamen silinemedi: $full — elle silebilirsiniz."
  fi
  if [ -d "$DATA_DIR" ]; then
    if [ "$VERILER" = 1 ] || { [ "$EVET" != 1 ] && confirm "Kişisel verileriniz de silinsin mi? ($DATA_DIR: klasörsüz sohbet dosyaları, öğrettiğiniz komutlar, yerel model listesi, eklediğiniz dosyalar)" 0; }; then
      rm -rf "$DATA_DIR" && ok "Silindi: $DATA_DIR"
    else
      dim "Kişisel verileriniz korundu: $DATA_DIR (silmek için: kaldir --veriler)"
    fi
  fi
  echo ''
  printf '  %s%s kaldırıldı.%s\n\n' "$C_OK" "$APP_NAME" "$C_END"
}

case "$KOMUT" in
  kur) install_atolye ;;
  baslat) start_atolye ;;
  durdur) stop_atolye ;;
  guncelle) update_atolye ;;
  durum) show_status ;;
  otomatik-ac) enable_autostart ;;
  otomatik-kapat) disable_autostart ;;
  kisayol-ac) enable_shortcut ;;
  kisayol-kapat) disable_shortcut ;;
  masaustu-ac) enable_window ;;
  masaustu-kapat) disable_window ;;
  ayarlar) show_settings ;;
  kosullar) terms_lines ;;
  kaldir) uninstall_atolye ;;
  yardim) sed -n '2,27p' "${BASH_SOURCE[0]:-/dev/null}" 2>/dev/null | sed 's/^# \{0,1\}//' ;;
esac
