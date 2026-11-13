<#
.SYNOPSIS
  Atölye'yi Windows'ta kurar, başlatır, günceller ve Windows açılışında otomatik çalıştırır.

.DESCRIPTION
  Komutlar:
    kur             (varsayılan) Kurulum: Node/Git kontrolü, indirme, paketler, masaüstü kısayolu,
                    Windows açılışında otomatik başlatma, ardından başlatıp tarayıcıyı açar.
    baslat          Arka planda başlatır (zaten çalışıyorsa sadece tarayıcıyı açar).
    durdur          Çalışan Atölye'yi durdurur.
    guncelle        Son sürümü indirir (git ile ya da paketten kurulumda zip olarak), paketleri günceller
                    ve yeniden başlatır.
    durum           Kurulum ve çalışma durumunu gösterir.
    otomatik-ac     Windows açılışında otomatik başlatmayı açar.
    otomatik-kapat  Windows açılışında otomatik başlatmayı kapatır.
    kaldir          Atölye'yi kaldırır: durdurur, kısayolları ve otomatik başlatmayı siler, paketle
                    kurulmuşsa kurulum klasörünü de siler (onay ister; -Evet ile sormaz). Git ile
                    indirilmiş klasörlere ve ~/.claude içindeki sohbet geçmişine dokunmaz.

  Yönetici izni gerekmez; kısayollar kullanıcının kendi Masaüstü ve Başlangıç klasörlerine yazılır.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\atolye.ps1
.EXAMPLE
  .\atolye.ps1 guncelle
#>
[CmdletBinding()]
param(
  [Parameter(Position = 0)]
  [ValidateSet('kur', 'baslat', 'durdur', 'guncelle', 'durum', 'otomatik-ac', 'otomatik-kapat', 'kaldir')]
  [string]$Komut = 'kur',

  # Kurulum klasörü. Script zaten bir Atölye klasörünün içindeyse o klasör kullanılır.
  [string]$Klasor,

  # Başlatırken tarayıcıyı açma (Windows açılışında kullanılır)
  [switch]$TarayiciAcma,

  # kaldir: onay sormadan kaldır
  [switch]$Evet,

  # kur: kullanım koşullarını sormadan kabul et (otomatik/toplu kurulum; ATOLYE_KABUL=1 ile aynı)
  [switch]$Kabul,

  # Bitince "kapatmak için Enter" bekle (.bat dosyalarından çift tıklanarak çalıştırıldığında)
  [switch]$Bekle
)

$ErrorActionPreference = 'Stop'
$RepoUrl = 'https://github.com/mustafaergan/atolye.git'
$AppName = 'Atölye'
$MinNode = [version]'18.18.0'

# ---------- Yardımcılar ----------
function Write-Step($text) { Write-Host "  > $text" -ForegroundColor Cyan }
function Write-Ok($text) { Write-Host "  ✓ $text" -ForegroundColor Green }
function Write-Warn($text) { Write-Host "  ! $text" -ForegroundColor Yellow }
function Stop-WithError($text) {
  Write-Host "  ✗ $text" -ForegroundColor Red
  exit 1
}

function Test-AtolyeDir($dir) {
  if (-not $dir) { return $false }
  $pkg = Join-Path $dir 'package.json'
  if (-not (Test-Path $pkg)) { return $false }
  try { return ((Get-Content $pkg -Raw -Encoding UTF8 | ConvertFrom-Json).name -eq 'atolye') } catch { return $false }
}

function Read-PaketInfo($dir) {
  $f = Join-Path $dir '.paket'
  if (-not (Test-Path $f)) { return $null }
  try { return (Get-Content $f -Raw -Encoding UTF8 | ConvertFrom-Json) } catch { return $null }
}

# Script bir dağıtım paketinin (zip) çıkarıldığı klasörden mi çalışıyor? (.paket var; git deposu
# ya da kurulmuş kopya değil — kurulum klasörüne .kurulu işareti konur)
$PaketInfo = Read-PaketInfo $PSScriptRoot
$FromPackage = ($null -ne $PaketInfo) -and -not (Test-Path (Join-Path $PSScriptRoot '.git')) -and -not (Test-Path (Join-Path $PSScriptRoot '.kurulu'))

function Resolve-InstallDir {
  if ($Klasor) { return [IO.Path]::GetFullPath($Klasor) }
  if ($FromPackage) { return (Join-Path $env:LOCALAPPDATA 'Atolye') }
  if (Test-AtolyeDir $PSScriptRoot) { return $PSScriptRoot }
  return (Join-Path $env:LOCALAPPDATA 'Atolye')
}

$InstallDir = Resolve-InstallDir
$LogFile = Join-Path $InstallDir 'atolye.log'
$ScriptPath = Join-Path $InstallDir 'atolye.ps1'
# Testlerde gerçek Masaüstü/Başlangıç klasörlerine dokunmamak için değiştirilebilir
# Windows, klasör yoksa ya da grup ilkesiyle kapatılmışsa GetFolderPath için boş yol döndürür.
# Önce oluşturmayı dener, sonra bilinen varsayılan yola düşer; o da olmazsa $null döner ve
# ilgili adım (kısayol / otomatik başlatma) uyarıyla atlanır.
function Resolve-SpecialDir($override, $folder, $fallback) {
  if ($override) { return $override }
  $p = $null
  try { $p = [Environment]::GetFolderPath($folder, [Environment+SpecialFolderOption]::Create) } catch { }
  if (-not $p -and $fallback) {
    try {
      if (-not (Test-Path $fallback)) { New-Item -ItemType Directory -Force $fallback | Out-Null }
      $p = $fallback
    } catch { $p = $null }
  }
  if ($p) { return $p }
  return $null
}
# Join-Path, erişilemeyen sürücülerde (ör. yönlendirilmiş ağ klasörü) hata verir; bu yüzden düz birleştirme
$DesktopDir = Resolve-SpecialDir $env:ATOLYE_DESKTOP_DIR 'Desktop' $(if ($HOME) { [IO.Path]::Combine($HOME, 'Desktop') })
$StartupDir = Resolve-SpecialDir $env:ATOLYE_STARTUP_DIR 'Startup' $(if ($env:APPDATA) { [IO.Path]::Combine($env:APPDATA, 'Microsoft\Windows\Start Menu\Programs\Startup') })
$DesktopLink = if ($DesktopDir) { [IO.Path]::Combine($DesktopDir, "$AppName.lnk") } else { $null }
$StartupLink = if ($StartupDir) { [IO.Path]::Combine($StartupDir, "$AppName.lnk") } else { $null }
function Test-Link($p) { try { return [bool]($p -and (Test-Path $p)) } catch { return $false } }

function Get-Port {
  $envFile = Join-Path $InstallDir '.env'
  if (Test-Path $envFile) {
    $line = Get-Content $envFile -Encoding UTF8 | Where-Object { $_ -match '^\s*ATOLYE_PORT\s*=\s*(\d+)' } | Select-Object -First 1
    if ($line -and $line -match '(\d+)\s*$') { return [int]$Matches[1] }
  }
  return 3210
}

function Get-Url { return "http://127.0.0.1:$(Get-Port)" }

# Porttaki uygulama bir Atölye mi? (süreç bilgisi okunamadığında yedek kontrol)
function Test-AtolyeHttp([int]$port) {
  try {
    $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 "http://127.0.0.1:$port/api/config"
    return ($r.Content -match '"generalDir"')
  } catch { return $false }
}

# Portu dinleyen süreç ve bu kurulumun Atölye'si olup olmadığı (yoksa $null)
function Get-PortOwner([int]$port) {
  $c = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $c) { return $null }
  $procId = [int]$c.OwningProcess
  $name = (Get-Process -Id $procId -ErrorAction SilentlyContinue).ProcessName
  $cmd = $null
  try { $cmd = (Get-CimInstance Win32_Process -Filter "ProcessId=$procId" -ErrorAction Stop).CommandLine } catch { }
  if ($cmd) {
    $cli = Join-Path $InstallDir 'src\cli.js'
    $ours = ($name -eq 'node') -and ($cmd.IndexOf($cli, [StringComparison]::OrdinalIgnoreCase) -ge 0)
  } else {
    $ours = ($name -eq 'node') -and (Test-AtolyeHttp $port)
  }
  return @{ pid = $procId; name = $name; ours = [bool]$ours }
}

# Bu kurulumun Atölye'si çalışıyor mu? (portta başka bir program varsa hayır)
function Test-Running {
  $o = Get-PortOwner (Get-Port)
  return [bool]($o -and $o.ours)
}

# Port gerçekten kullanılabilir mi? Dinleyen yoksa bile Windows (Hyper-V/WSL) bazı
# port aralıklarını ayırmış olabilir; bu yüzden kısa bir süre açmayı deneriz.
function Test-PortFree([int]$port) {
  if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) { return $false }
  $listener = New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback, $port)
  try { $listener.Start(); return $true } catch { return $false } finally { try { $listener.Stop() } catch { } }
}

function Find-FreePort([int]$start) {
  for ($p = $start; $p -lt $start + 100 -and $p -le 65535; $p++) { if (Test-PortFree $p) { return $p } }
  return $null
}

# .env içindeki bir değeri ayarlar (yorum satırı halindeyse açar, yoksa ekler)
function Set-EnvValue($key, $value) {
  $envFile = Join-Path $InstallDir '.env'
  $lines = @()
  if (Test-Path $envFile) { $lines = @(Get-Content $envFile -Encoding UTF8) }
  $done = $false
  $out = foreach ($l in $lines) {
    if (-not $done -and $l -cmatch "^\s*#?\s*$key\s*=") { $done = $true; "$key=$value" } else { $l }
  }
  if (-not $done) { $out = @($out) + "$key=$value" }
  [IO.File]::WriteAllLines($envFile, [string[]]$out, (New-Object Text.UTF8Encoding $false))
}

# Port başka bir programdaysa yeni bir port sorar (-Auto: sormadan boş portu seçer) ve .env'ye yazar
function Resolve-PortConflict([switch]$Auto) {
  $port = Get-Port
  $owner = Get-PortOwner $port
  if ($owner -and $owner.ours) { return }
  if (-not $owner -and (Test-PortFree $port)) { return }

  $who = if ($owner) { "$($owner.name) (PID $($owner.pid))" } else { 'Windows tarafından ayrılmış' }
  Write-Warn "Port $port kullanılamıyor: $who"
  $new = Find-FreePort ($port + 1)
  if (-not $new) { Stop-WithError "$port sonrasında boş port bulunamadı. .env dosyasına ATOLYE_PORT=<port> yazıp tekrar deneyin." }

  if (-not $Auto -and $env:ATOLYE_SORMA -ne '1' -and [Environment]::UserInteractive) {
    for ($i = 0; $i -lt 5; $i++) {
      $a = ''
      try { $a = Read-Host "  Atölye için kullanılacak port [$new]" } catch { break }
      $a = "$a".Trim()
      if (-not $a) { break }
      if ($a -notmatch '^\d+$' -or [int]$a -lt 1024 -or [int]$a -gt 65535) { Write-Warn '1024 ile 65535 arasında bir sayı girin.'; continue }
      if (-not (Test-PortFree ([int]$a))) { Write-Warn "Port $a da kullanılamıyor, başka bir numara deneyin."; continue }
      $new = [int]$a
      break
    }
  }
  Set-EnvValue 'ATOLYE_PORT' $new
  Write-Ok "Atölye artık $new portunu kullanacak (.env dosyasına kaydedildi): http://127.0.0.1:$new"
  Write-Host '  Not: Tarayıcı proje listesini adrese göre saklar; yeni adreste klasörleri bir kez yeniden eklemeniz gerekebilir.' -ForegroundColor Gray
}

# Tam paket kendi Node.js'ini "runtime" klasöründe getirir (Node kurulamayan bilgisayarlar için). Kurulum
# gerektirmez: node.exe olduğu yerden çalışır. Varsa her zaman o kullanılır ve npm/npx de oradan bulunur.
function Get-BundledNodeDir {
  foreach ($dir in @((Join-Path $InstallDir 'runtime'), (Join-Path $PSScriptRoot 'runtime'))) {
    if ($dir -and (Test-Path (Join-Path $dir 'node.exe'))) { return $dir }
  }
  return $null
}

function Get-NodePath {
  $bundled = Get-BundledNodeDir
  if ($bundled) {
    if (($env:PATH -split ';') -notcontains $bundled) { $env:PATH = "$bundled;$env:PATH" } # npm, npx ve oraya kurulan araçlar
    return (Join-Path $bundled 'node.exe')
  }
  $cmd = Get-Command node -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  # Node.js az önce kurulduysa bu pencerenin PATH'i henüz güncel olmayabilir: bilinen yerlere bak
  foreach ($dir in @("$env:ProgramFiles\nodejs", "${env:ProgramFiles(x86)}\nodejs", "$env:LOCALAPPDATA\Programs\nodejs")) {
    $exe = Join-Path $dir 'node.exe'
    if ($dir -and (Test-Path $exe)) {
      $env:PATH = "$dir;$env:PATH" # npm de bulunsun
      return $exe
    }
  }
  return $null
}

# Etkileşimli pencerede E/H sorusu; gizli/etkileşimsiz çalışmada varsayılanı döndürür
# (ATOLYE_SORMA=1: hiç sorma, her soruya "hayır" — otomatik/toplu kurulum için)
function Confirm-Yes($question, [bool]$default = $true) {
  if ($env:ATOLYE_SORMA -eq '1') { return $false }
  if (-not [Environment]::UserInteractive -or $TarayiciAcma) { return $default }
  $hint = if ($default) { '(E/h)' } else { '(e/H)' }
  try { $a = Read-Host "  $question $hint" } catch { return $default }
  if (-not $a) { return $default }
  return ($a.Trim() -match '^(e|evet|y|yes)$')
}

function Write-Box($color, [string[]]$lines) {
  $width = ($lines | Measure-Object -Property Length -Maximum).Maximum + 2
  Write-Host ''
  Write-Host ('  +' + ('-' * $width) + '+') -ForegroundColor $color
  foreach ($l in $lines) { Write-Host ('  | ' + $l.PadRight($width - 1) + '|') -ForegroundColor $color }
  Write-Host ('  +' + ('-' * $width) + '+') -ForegroundColor $color
  Write-Host ''
}

function Stop-NodeMissing([string]$reason) {
  $lines = @(
    $reason,
    '',
    "Atölye'nin çalışması için Node.js $MinNode veya üstü gerekli.",
    '1) https://nodejs.org adresinden "LTS" sürümünü indirip kurun',
    '   (ya da PowerShell''de: winget install OpenJS.NodeJS.LTS)',
    '2) Kurulumdan sonra bu pencereyi kapatıp Kur.bat''ı yeniden çalıştırın.'
  )
  Write-Box Red $lines
  if (Confirm-Yes 'Node.js indirme sayfası şimdi açılsın mı?') { Start-Process 'https://nodejs.org/' }
  exit 1
}

# Kullanım koşulları: Atölye yalnızca bir arayüzdür; Claude Code, GitHub Copilot ve Atlassian ürünlerinin
# lisansı kullanıcının şirketinden gelir. Kurulum, kullanıcı bunu açıkça kabul etmeden devam etmez.
function Confirm-Terms {
  # Koşullar değiştiğinde sürüm artırılır; eski sürümü kabul etmiş olanlara yeniden sorulur
  $termsVersion = '2'
  $marker = Join-Path (Join-Path $HOME '.atolye') 'kullanim-kosullari-kabul.txt'
  if ((Test-Path $marker) -and ((Get-Content $marker -Raw -Encoding UTF8) -match "Koşul sürümü: $termsVersion\b")) {
    Write-Ok "Kullanım koşulları daha önce kabul edilmiş ($((Get-Item $marker).LastWriteTime.ToString('yyyy-MM-dd')))"
    return
  }
  Write-Box Yellow @(
    'KULLANIM KOŞULLARI',
    '',
    "Atölye yalnızca bir arayüzdür; kendi başına hiçbir yapay zekâ ya da servis",
    'lisansı içermez. Kuruluma devam ederek şunları kabul etmiş olursunuz:',
    '',
    '1) Şirketiniz, bu bilgisayarda kullanacağınız ürünler için gerekli lisans ve',
    '   sözleşmelere sahiptir: Claude Code (Anthropic), GitHub Copilot ve',
    '   bağlayacaksanız Jira / Confluence / Bitbucket (Atlassian).',
    '2) Bu ürünleri, şirketinizin o sağlayıcılarla yaptığı sözleşmelere ve',
    '   şirketinizin bilgi güvenliği kurallarına uygun kullanacaksınız.',
    '3) Size verilen token ve API anahtarları kişiseldir; başkasıyla paylaşılmaz.',
    '4) Bağlantılar (Jira, Confluence, Bitbucket, Graylog, Jenkins, Fortify, SonarQube, WebLogic)',
    '   üzerinden getirilen veriler, sorduğunuz sorularla birlikte seçtiğiniz yapay',
    '   zekâ hizmetine gönderilir. Hangi verinin gönderilebileceğine şirketinizin',
    '   kuralları çerçevesinde siz karar verirsiniz.',
    '5) Atölye MIT lisansıyla, olduğu gibi ve hiçbir garanti verilmeden sunulur.',
    '   Kurulumdan ve kullanımdan doğacak tüm sorumluluk (veri paylaşımı, lisans',
    '   ve şirket kurallarına uygunluk, yapılan işlemler ve sonuçları dahil)',
    '   kurulumu yapan ve kullanan kişiye aittir; yazılımı geliştirenler sorumlu',
    '   tutulamaz.'
  )
  $accepted = ($Kabul -or $env:ATOLYE_KABUL -eq '1')
  if (-not $accepted) {
    if (-not (Test-Interactive)) { Stop-WithError "Kullanım koşulları kabul edilmeden kurulum yapılamaz. Etkileşimsiz kurulumda -Kabul parametresini (ya da ATOLYE_KABUL=1) kullanın." }
    $a = ''
    try { $a = Read-Host '  Bu koşulları kabul ediyor musunuz? Devam etmek için "evet" yazın' } catch { }
    $accepted = ($a.Trim() -match '^(evet|e|yes|y)$')
  }
  if (-not $accepted) {
    Write-Host ''
    Write-Host '  Koşullar kabul edilmedi; kurulum yapılmadı.' -ForegroundColor Red
    Write-Host ''
    exit 1
  }
  try {
    New-Item -ItemType Directory -Force -Path (Split-Path $marker) | Out-Null
    Set-Content -Path $marker -Encoding utf8 -Value "Kullanım koşulları $((Get-Date).ToString('yyyy-MM-dd HH:mm')) tarihinde $env:USERNAME tarafından kabul edildi. Koşul sürümü: $termsVersion"
  } catch { }
  Write-Ok 'Kullanım koşulları kabul edildi'
}

function Test-Requirements {
  $node = Get-NodePath
  if (-not $node) { Stop-NodeMissing 'Node.js bulunamadı.' }
  $ver = $null
  try { $ver = [version]((& $node --version).Trim().TrimStart('v')) } catch { }
  if (-not $ver) { Stop-NodeMissing "Node.js çalıştırılamadı: $node" }
  if ($ver -lt $MinNode) { Stop-NodeMissing "Node.js $ver çok eski." }
  Write-Ok "Node.js $ver$(if (Get-BundledNodeDir) { ' (paketle birlikte geldi; ayrıca kurulum gerekmez)' })"
  if ($FromPackage) { return } # paketten kurulumda Git gerekmez
  if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Stop-WithError "Git bulunamadı. https://git-scm.com adresinden kurup tekrar deneyin." }
  Write-Ok "Git $(((git --version) -replace 'git version ', ''))"
}

function New-Shortcut($path, $arguments, $description) {
  $shell = New-Object -ComObject WScript.Shell
  $lnk = $shell.CreateShortcut($path)
  $lnk.TargetPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $lnk.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$ScriptPath`" $arguments"
  $lnk.WorkingDirectory = $InstallDir
  $lnk.WindowStyle = 7 # simge durumunda
  $lnk.Description = $description
  $icon = Join-Path $InstallDir 'public\atolye.ico'
  $lnk.IconLocation = if (Test-Path $icon) { "$icon,0" } else { "$env:SystemRoot\System32\shell32.dll,13" }
  $lnk.Save()
}

# ---------- Komutlar ----------
function Install-FromPackage {
  $samePlace = [IO.Path]::GetFullPath($PSScriptRoot).TrimEnd('\') -ieq [IO.Path]::GetFullPath($InstallDir).TrimEnd('\')
  if ($samePlace) { Write-Ok "Kurulum klasörü: $InstallDir"; return }
  if (Test-Path (Join-Path $InstallDir '.git')) {
    Stop-WithError "$InstallDir git ile kurulmuş. Onu '$InstallDir\atolye.ps1 guncelle' ile güncelleyin ya da -Klasor ile başka bir yer seçin."
  }
  if ((Test-Path $InstallDir) -and -not (Test-AtolyeDir $InstallDir) -and (Get-ChildItem $InstallDir -Force | Select-Object -First 1)) {
    Stop-WithError "$InstallDir boş değil ve bir Atölye klasörü değil. -Klasor ile başka bir yer seçin."
  }
  $old = Read-PaketInfo $InstallDir
  if ($old) { Write-Step "Güncelleniyor: $($old.version) → $($PaketInfo.version)" } else { Write-Step "Kuruluyor: $($PaketInfo.version) → $InstallDir" }
  if (Test-Running) { Stop-Atolye; Start-Sleep -Seconds 1 }

  New-Item -ItemType Directory -Force $InstallDir | Out-Null
  # Eski sürümden kalan dosyalar karışmasın diye uygulama klasörlerini yenile; .env ve node_modules korunur
  foreach ($d in @('src', 'public', 'scripts')) {
    $p = Join-Path $InstallDir $d
    if (Test-Path $p) { Remove-Item $p -Recurse -Force }
  }
  $skip = @('.env')
  if (-not $PaketInfo.tam) { $skip += 'node_modules' }
  Get-ChildItem $PSScriptRoot -Force | Where-Object { $skip -notcontains $_.Name } | ForEach-Object {
    Copy-Item $_.FullName -Destination $InstallDir -Recurse -Force
  }
  Set-Content (Join-Path $InstallDir '.kurulu') (Get-Date -Format s) -Encoding ASCII
  # İnternetten indirilen zip'ten çıkan dosyalardaki "engellendi" işaretini kaldır
  Get-ChildItem $InstallDir -Recurse -File -ErrorAction SilentlyContinue | Unblock-File -ErrorAction SilentlyContinue
  Write-Ok "Dosyalar kopyalandı: $InstallDir"
}

function Install-Files {
  if ($FromPackage) { Install-FromPackage; return }
  if (Test-AtolyeDir $InstallDir) {
    Write-Ok "Kurulum klasörü: $InstallDir"
  } else {
    if ((Test-Path $InstallDir) -and (Get-ChildItem $InstallDir -Force | Select-Object -First 1)) {
      Stop-WithError "$InstallDir boş değil ve bir Atölye klasörü değil. -Klasor ile başka bir yer seçin."
    }
    Write-Step "İndiriliyor: $RepoUrl → $InstallDir"
    git clone --quiet $RepoUrl $InstallDir
    if ($LASTEXITCODE -ne 0) { Stop-WithError 'git clone başarısız oldu.' }
    Write-Ok 'İndirildi'
  }
}

function Install-Packages {
  $info = Read-PaketInfo $InstallDir
  if ($info -and $info.tam -and (Test-Path (Join-Path $InstallDir 'node_modules\@anthropic-ai\claude-agent-sdk'))) {
    Write-Ok 'Paketler pakette hazır geldi (npm erişimi gerekmedi)'
    return
  }
  Write-Step 'Paketler kuruluyor (ilk seferde birkaç dakika sürebilir)…'
  Push-Location $InstallDir
  try {
    npm install --no-audit --no-fund --loglevel=error
    if ($LASTEXITCODE -ne 0) { Stop-WithError 'npm install başarısız oldu. Şirket ağı npm erişimini engelliyor olabilir.' }
  } finally { Pop-Location }
  Write-Ok 'Paketler hazır'
}

function Install-EnvFile {
  $envFile = Join-Path $InstallDir '.env'
  if (-not (Test-Path $envFile)) {
    Copy-Item (Join-Path $InstallDir '.env.example') $envFile
    Write-Ok '.env oluşturuldu'
    return
  }
  # Eski sürümlerin örnek dosyasından kalan açık satırlar (sahte gateway adresi, boş token)
  # settings.json'daki gerçek ayarların önüne geçmesin: yorum satırına çevir
  $lines = Get-Content $envFile -Encoding UTF8
  $changed = $false
  $fixed = foreach ($l in $lines) {
    if ($l -match '^\s*ANTHROPIC_(BASE_URL|AUTH_TOKEN|API_KEY)\s*=\s*(.*)$' -and ($Matches[2].Trim() -eq '' -or $Matches[2] -match 'example\.(com|org)')) {
      $changed = $true
      "# $l"
    } else { $l }
  }
  if ($changed) {
    [IO.File]::WriteAllLines($envFile, [string[]]$fixed, (New-Object Text.UTF8Encoding $false))
    Write-Ok '.env içindeki örnek/boş bağlantı satırları devre dışı bırakıldı'
  }
}

# ---------- Claude bağlantı ayarı ----------
# Atölye'nin (ve Claude Code'un) gateway adresini ve token'ı bulduğu yerler:
# kurulum klasöründeki .env, Claude Code ayar dosyaları, kullanıcı ortam değişkenleri, claude.ai girişi.
function Read-EnvFileValues($path) {
  $vals = @{}
  if (-not (Test-Path $path)) { return $vals }
  foreach ($l in (Get-Content $path -Encoding UTF8)) {
    # -cmatch: Türkçe Windows'ta büyük/küçük harf duyarsız eşleşmede [A-Z], "I" harfini ("ı") tanımaz
    if ($l -cmatch '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$') {
      $v = $Matches[2].Trim('"', "'")
      if ($v -and $v -notmatch 'example\.(com|org)') { $vals[$Matches[1]] = $v }
    }
  }
  return $vals
}

function Get-ClaudeConnection {
  $configDirs = @()
  if ($env:CLAUDE_CONFIG_DIR) { $configDirs += $env:CLAUDE_CONFIG_DIR }
  $configDirs += (Join-Path $HOME '.claude')

  $sources = @()
  $envVals = Read-EnvFileValues (Join-Path $InstallDir '.env')
  if ($envVals.Count) { $sources += @{ name = 'Atölye .env'; env = $envVals; helper = $false } }
  foreach ($d in $configDirs) {
    foreach ($f in @('settings.local.json', 'settings.json')) {
      $p = Join-Path $d $f
      if (-not (Test-Path $p)) { continue }
      try {
        $json = Get-Content $p -Raw -Encoding UTF8 | ConvertFrom-Json
        $e = @{}
        if ($json.env) { $json.env.PSObject.Properties | ForEach-Object { if ($_.Value) { $e[$_.Name] = [string]$_.Value } } }
        $sources += @{ name = "~/.claude/$f"; env = $e; helper = [bool]$json.apiKeyHelper }
      } catch { }
    }
  }
  $procEnv = @{}
  foreach ($k in @('ANTHROPIC_BASE_URL', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_API_KEY')) {
    $v = [Environment]::GetEnvironmentVariable($k)
    if ($v) { $procEnv[$k] = $v }
  }
  if ($procEnv.Count) { $sources += @{ name = 'ortam değişkenleri'; env = $procEnv; helper = $false } }

  $result = @{ baseUrl = $null; token = $null; tokenSource = $null; baseSource = $null; login = $false }
  foreach ($s in $sources) {
    if (-not $result.baseUrl -and $s.env['ANTHROPIC_BASE_URL']) { $result.baseUrl = $s.env['ANTHROPIC_BASE_URL']; $result.baseSource = $s.name }
    if (-not $result.token) {
      if ($s.env['ANTHROPIC_AUTH_TOKEN'] -or $s.env['ANTHROPIC_API_KEY']) { $result.token = $true; $result.tokenSource = $s.name }
      elseif ($s.helper) { $result.token = $true; $result.tokenSource = "$($s.name) (apiKeyHelper)" }
    }
  }
  foreach ($d in $configDirs) { if (Test-Path (Join-Path $d '.credentials.json')) { $result.login = $true } }
  return $result
}

function Test-ClaudeConnection([switch]$Quiet) {
  $c = Get-ClaudeConnection
  $gateway = $null
  if ($c.baseUrl) { try { $gateway = ([Uri]$c.baseUrl).Host } catch { $gateway = $c.baseUrl } }

  if ($c.token) {
    if (-not $Quiet) {
      $where = if ($gateway) { "gateway: $gateway ($($c.baseSource)), " } else { '' }
      Write-Ok "Claude bağlantı ayarı bulundu ($($where)token: $($c.tokenSource))"
    }
    return $true
  }
  if ($c.login -and -not $c.baseUrl) {
    if (-not $Quiet) { Write-Ok 'Claude bağlantısı: claude.ai hesabıyla giriş yapılmış' }
    return $true
  }
  if ($Quiet) { return $false }

  $envFile = Join-Path $InstallDir '.env'
  $first = if ($c.baseUrl) { "Gateway adresi bulundu ($gateway) ama token bulunamadı." } else { 'Claude bağlantı ayarı (gateway adresi ve token) bulunamadı.' }
  Write-Box Yellow @(
    $first,
    '',
    "Atölye kurulacak ama Claude'a bağlanamayacak. Şunlardan birini yapın:",
    '- Şirketin verdiği gateway adresini ve token''ı .env dosyasına yazın',
    '  (yolu aşağıda):',
    '    ANTHROPIC_BASE_URL=https://...',
    '    ANTHROPIC_AUTH_TOKEN=...',
    '- ya da Claude Code''u (claude) bu bilgisayarda kurup ayarlayın;',
    '  ~/.claude/settings.json içindeki ayarlar otomatik kullanılır.'
  )
  Write-Host "  .env dosyası: $envFile" -ForegroundColor Yellow
  Write-Host ''
  if (Confirm-Yes '.env dosyası şimdi Not Defteri''nde açılsın mı?') {
    Start-Process notepad.exe -ArgumentList "`"$envFile`"" -Wait
    if (Test-ClaudeConnection -Quiet) { Write-Ok 'Bağlantı ayarı artık tamam' }
    else { Write-Warn "Bağlantı ayarı hâlâ eksik. Daha sonra .env dosyasını düzenleyip Atölye'yi yeniden başlatın ('atolye.ps1 durdur' ardından 'baslat')." }
  }
  return $false
}

# ---------- Claude Code ve GitHub Copilot CLI: kurulu mu, giriş yapılmış mı? ----------
# Kurulum bu kontrollerde hiçbir zaman durmaz: eksik olan anlatılır, istenirse kurulur, kurulum devam eder.
function Test-Interactive { return ([Environment]::UserInteractive -and -not $TarayiciAcma -and $env:ATOLYE_SORMA -ne '1') }

# Bir komut satırı aracını bulur. VS Code'un "copilot" yönlendiricisi (copilot-shim) gerçek CLI sayılmaz.
function Find-Cli($name) {
  $npmCmd = Join-Path $env:APPDATA "npm\$name.cmd" # az önce npm ile kurulduysa PATH henüz güncel olmayabilir
  if (Test-Path $npmCmd) { return $npmCmd }
  foreach ($c in @(Get-Command $name -All -ErrorAction SilentlyContinue)) {
    if ($c.Source -and $c.Source -notmatch 'copilot-shim') { return $c.Source }
  }
  if ($name -eq 'claude') {
    $native = Join-Path $HOME '.local\bin\claude.exe' # Claude Code'un kendi kurulum betiği buraya kurar
    if (Test-Path $native) { return $native }
  }
  return $null
}

function Get-CliVersion($exe) {
  try {
    $out = (cmd /d /c "`"$exe`" --version 2>&1") | Out-String
    if ($out -notmatch 'not found|bulunamad' -and $out -match '\d+\.\d+\.\d+') { return $Matches[0] }
  } catch { }
  return $null
}

function Install-NpmGlobal($pkg, $label) {
  Write-Step "$label kuruluyor (npm install -g $pkg)…"
  try { npm install -g $pkg --no-audit --no-fund --loglevel=error } catch { }
  if ($LASTEXITCODE -ne 0) {
    Write-Warn "$label kurulamadı. Şirket ağı npm erişimini engelliyor olabilir; daha sonra bir terminalde 'npm install -g $pkg' komutunu deneyin."
    return $false
  }
  return $true
}

function Test-ClaudeCli {
  # Atölye, Claude Code'un motorunu kendi paketiyle getirir; bu yoksa Claude oturumları açılamaz
  $arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'x64' }
  $engine = Join-Path $InstallDir "node_modules\@anthropic-ai\claude-agent-sdk-win32-$arch"
  if (Test-Path $engine) { Write-Ok 'Claude Code motoru (Atölye ile birlikte geldi)' }
  else {
    Write-Box Red @(
      'Atölye''nin Claude Code motoru eksik:',
      "  node_modules\@anthropic-ai\claude-agent-sdk-win32-$arch",
      '',
      'Paket kurulumu yarım kalmış olabilir. Kurulum klasöründe şunu çalıştırın:',
      '  npm install',
      'ya da tam paketi (node_modules dahil) indirip Kur.bat ile yeniden kurun.'
    )
  }

  $exe = Find-Cli 'claude'
  $ver = if ($exe) { Get-CliVersion $exe } else { $null }
  if ($ver) { Write-Ok "Claude Code CLI $ver"; return }
  Write-Box Yellow @(
    'Claude Code CLI (claude) bu bilgisayarda kurulu değil.',
    '',
    'Atölye kendi Claude Code motoruyla gelir; CLI olmadan da çalışır.',
    'Yine de kurmanız önerilir: bağlantı ayarlarını kontrol etme (/status),',
    'claude.ai hesabıyla giriş (/login) ve terminalden kullanım için gerekir.',
    '',
    'Kurmak için bir terminalde:',
    '  npm install -g @anthropic-ai/claude-code'
  )
  if ((Test-Interactive) -and (Confirm-Yes 'Claude Code CLI şimdi kurulsun mu?')) {
    if (Install-NpmGlobal '@anthropic-ai/claude-code' 'Claude Code CLI') {
      $exe = Find-Cli 'claude'
      $ver = if ($exe) { Get-CliVersion $exe } else { $null }
      if ($ver) { Write-Ok "Claude Code CLI $ver kuruldu" }
      else { Write-Ok 'Claude Code CLI kuruldu (yeni açılan terminallerde "claude" komutu çalışır)' }
    }
  }
}

# Copilot girişi: ortam değişkenindeki token, 'copilot login' kaydı ya da GitHub CLI (gh) girişi
function Get-CopilotLogin {
  foreach ($k in @('COPILOT_GITHUB_TOKEN', 'GH_TOKEN', 'GITHUB_TOKEN')) {
    if ([Environment]::GetEnvironmentVariable($k)) { return "ortam değişkeni $k" }
  }
  $dirs = @()
  if ($env:COPILOT_HOME) { $dirs += $env:COPILOT_HOME }
  $dirs += (Join-Path $HOME '.copilot')
  foreach ($d in $dirs) {
    $cfg = Join-Path $d 'config.json'
    if (Test-Path $cfg) {
      $raw = Get-Content $cfg -Raw -Encoding UTF8
      if ($raw -match '"(logged_in_users|loggedInUsers)"\s*:\s*\[\s*\{') {
        $user = if ($raw -match '"(?:last_logged_in_user|lastLoggedInUser)"\s*:\s*\{[^}]*"login"\s*:\s*"([^"]+)"') { " ($($Matches[1]))" } else { '' }
        return "copilot login$user"
      }
    }
  }
  if (Get-Command gh -ErrorAction SilentlyContinue) {
    cmd /d /c 'gh auth status >nul 2>&1'
    if ($LASTEXITCODE -eq 0) { return "GitHub CLI (gh) girişi; bu hesapta Copilot lisansı yoksa 'copilot login' ile lisanslı hesapla girin" }
  }
  return $null
}

function Show-CopilotLoginHelp {
  Write-Box Yellow @(
    'GitHub Copilot''a giriş yapılmamış görünüyor.',
    '',
    'Copilot motorunu kullanmak için bir kez giriş yapmanız gerekir:',
    '1) Bir terminal (PowerShell) açıp şunu yazın:  copilot login',
    '2) Ekranda 8 haneli bir kod ve https://github.com/login/device adresi çıkar.',
    '   Bu adresi tarayıcıda açın, kodu girin ve şirket GitHub hesabınızla onaylayın.',
    '3) Terminalde giriş başarılı yazınca pencereyi kapatabilirsiniz.',
    '   Giriş bilgisi Windows Kimlik Bilgisi Yöneticisi''nde saklanır; bir kez yeterli.',
    '',
    'Notlar:',
    '- Hesabınızda GitHub Copilot lisansı olmalıdır; yoksa Atölye "Copilot kullanma',
    '  yetkisi yok" der. Lisansı şirketinizin GitHub yöneticisi tanımlar.',
    '- Şirket kendi GitHub adresini (ör. ...ghe.com) kullanıyorsa, giriş adresini',
    '  BT ekibinize sorun.',
    '- Giriş yaptıktan sonra Atölye''de yeni bir Copilot oturumu açın.'
  )
}

function Test-CopilotCli {
  $exe = Find-Cli 'copilot'
  $ver = if ($exe) { Get-CliVersion $exe } else { $null }
  if (-not $ver) {
    Write-Box Yellow @(
      'GitHub Copilot CLI kurulu değil (isteğe bağlı).',
      '',
      'Atölye''de sağ üstten "GitHub Copilot" motorunu seçmek için gereklidir.',
      'Sadece Claude Code kullanacaksanız kurmanıza gerek yok.',
      '',
      'Kurmak için bir terminalde:',
      '  npm install -g @github/copilot',
      'Ardından giriş yapmak için:  copilot login'
    )
    if (-not ((Test-Interactive) -and (Confirm-Yes 'GitHub Copilot CLI şimdi kurulsun mu?' $false))) { return $false }
    if (-not (Install-NpmGlobal '@github/copilot' 'GitHub Copilot CLI')) { return $false }
    $exe = Find-Cli 'copilot'
    $ver = if ($exe) { Get-CliVersion $exe } else { $null }
    if (-not $ver) { Write-Warn 'GitHub Copilot CLI kuruldu ama bu pencerede bulunamadı; yeni bir terminalde "copilot login" çalıştırın.'; return $false }
  }
  Write-Ok "GitHub Copilot CLI $ver"

  $login = Get-CopilotLogin
  if ($login) { Write-Ok "Copilot girişi: $login"; return $true }
  Show-CopilotLoginHelp
  if ((Test-Interactive) -and (Confirm-Yes 'Copilot girişi şimdi bu pencerede yapılsın mı?')) {
    Write-Step 'copilot login başlatılıyor; ekrandaki kodu tarayıcıda girin…'
    try { cmd /d /c "`"$exe`" login" } catch { }
    if (Get-CopilotLogin) { Write-Ok 'Copilot girişi tamam'; return $true }
    Write-Warn 'Copilot girişi doğrulanamadı. Daha sonra bir terminalde "copilot login" çalıştırabilirsiniz; Claude Code oturumları bundan etkilenmez.'
  }
  return $false
}

function Start-Atolye {
  Repair-Install
  if (Test-Running) {
    Write-Ok "Zaten çalışıyor: $(Get-Url)"
  } else {
    # Port başka bir programdaysa: elle başlatmada sor, Windows açılışında (gizli) boş portu kendisi seçsin
    Resolve-PortConflict -Auto:$TarayiciAcma
    $node = Get-NodePath
    if (-not $node) { Stop-WithError 'Node.js bulunamadı.' }
    Write-Step 'Başlatılıyor…'
    # Sunucu, terminalden bağımsız gizli bir pencerede ve kullanıcının ana klasöründe çalışır
    # (terminal kapansa da sürer); çıktısı atolye.log dosyasına yazılır.
    $cli = Join-Path $InstallDir 'src\cli.js'
    $shell = New-Object -ComObject WScript.Shell
    $shell.CurrentDirectory = $HOME
    [void]$shell.Run("cmd /d /s /c `"`"$node`" `"$cli`" --no-open > `"$LogFile`" 2>&1`"", 0, $false)
    $ok = $false
    for ($i = 0; $i -lt 40; $i++) {
      Start-Sleep -Milliseconds 500
      if (Test-Running) { $ok = $true; break }
    }
    if (-not $ok) {
      Write-Warn 'Atölye başlatılamadı. Son kayıtlar:'
      if (Test-Path $LogFile) { Get-Content $LogFile -Tail 15 | ForEach-Object { Write-Host "    $_" } }
      exit 1
    }
    Write-Ok "Çalışıyor: $(Get-Url)"
  }
  if (-not $TarayiciAcma) { Start-Process (Get-Url) }
}

function Stop-Atolye {
  $port = Get-Port
  $owner = Get-PortOwner $port
  $stopped = $false
  # Sadece bu kurulumun Atölye'sini durdur; portu başka bir program (başka bir Node uygulaması
  # ya da başka bir Atölye kurulumu) kullanıyorsa dokunma
  if ($owner -and $owner.ours) {
    # /T: açık oturumların Claude Code alt süreçleriyle (claude.exe) birlikte kapat
    taskkill /PID $owner.pid /T /F 2>&1 | Out-Null
    Write-Ok "Durduruldu (süreç $($owner.pid))"
    $stopped = $true
  } elseif ($owner) {
    Write-Warn "Port $port başka bir program tarafından kullanılıyor ($($owner.name)); dokunulmadı."
  }
  # Önceki sürümlerin durdururken geride bıraktığı, bu kurulumdan çalışan süreçler
  $prefix = [IO.Path]::GetFullPath($InstallDir).TrimEnd('\') + '\'
  $orphans = Get-Process -Name claude, node -ErrorAction SilentlyContinue |
    Where-Object { $_.Path -and $_.Path.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase) }
  foreach ($p in $orphans) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue }
  if ($orphans) { Write-Ok "Arkada kalmış $(@($orphans).Count) süreç kapatıldı" }
  if (-not $stopped -and -not $orphans) { Write-Ok 'Zaten çalışmıyor' }
}

# Klasörü sil; virüs tarayıcısı gibi geçici kilitler için birkaç kez dene
function Remove-DirWithRetry($dir) {
  for ($i = 0; $i -lt 10; $i++) {
    cmd /d /c "rmdir /s /q `"$dir`"" 2>$null
    if (-not (Test-Path $dir)) { return $true }
    Start-Sleep -Seconds 1
  }
  return $false
}

function Enable-Autostart {
  if (-not $StartupLink) { Write-Warn 'Windows Başlangıç klasörü bulunamadı; otomatik başlatma atlandı (Atölye kısayoldan açılabilir).'; return }
  try {
    New-Shortcut $StartupLink '-Komut baslat -TarayiciAcma' "$AppName (Windows açılışında arka planda başlar)"
    Write-Ok 'Windows açılışında otomatik başlatma açık'
  } catch {
    Write-Warn "Otomatik başlatma ayarlanamadı: $($_.Exception.Message)"
  }
}

function Disable-Autostart {
  if (Test-Link $StartupLink) { Remove-Item $StartupLink -Force }
  Write-Ok 'Windows açılışında otomatik başlatma kapalı'
}

function Install-DesktopShortcut {
  if (-not $DesktopLink) { Write-Warn "Masaüstü klasörü bulunamadı; kısayol atlandı. Atölye'yi '$ScriptPath baslat' ile açabilirsiniz."; return $false }
  try {
    New-Shortcut $DesktopLink '-Komut baslat' "$AppName'yi aç"
    Write-Ok "Masaüstü kısayolu: $DesktopLink"
    return $true
  } catch {
    Write-Warn "Masaüstü kısayolu oluşturulamadı: $($_.Exception.Message)"
    return $false
  }
}

function Install-Atolye {
  Write-Host ''
  Write-Host "  $AppName kurulumu" -ForegroundColor White
  Write-Host ''
  Confirm-Terms
  Test-Requirements
  Install-Files
  Install-Packages
  Install-EnvFile
  Write-Host ''
  Write-Host '  Claude Code' -ForegroundColor White
  Test-ClaudeCli
  $connected = Test-ClaudeConnection
  Write-Host ''
  Write-Host '  GitHub Copilot (isteğe bağlı)' -ForegroundColor White
  $copilotReady = Test-CopilotCli
  Write-Host ''
  Resolve-PortConflict
  $hasDesktop = Install-DesktopShortcut
  Enable-Autostart
  Start-Atolye
  Write-Host ''
  if (-not $connected) {
    Write-Host "  ! Kurulum tamam ama Claude bağlantı ayarı eksik: $(Join-Path $InstallDir '.env') dosyasını doldurup Atölye'yi yeniden başlatın." -ForegroundColor Yellow
  } elseif ($hasDesktop) {
    Write-Host "  Kurulum tamam. Atölye'yi masaüstündeki '$AppName' kısayoluyla açabilirsiniz." -ForegroundColor Green
  } else {
    Write-Host "  Kurulum tamam. Atölye'yi tarayıcıda $(Get-Url) adresinden ya da '$ScriptPath baslat' ile açabilirsiniz." -ForegroundColor Green
  }
  if (-not $copilotReady) {
    Write-Host "  Copilot motoru hazır değil (isteğe bağlı): kurmak için 'npm install -g @github/copilot', giriş için 'copilot login'." -ForegroundColor Gray
  }
  if ($FromPackage) {
    Write-Host "  Güncellemek için yeni paketi indirip Kur.bat'ı çalıştırın. Bu çıkarılan klasörü artık silebilirsiniz." -ForegroundColor Gray
  } else {
    Write-Host "  Güncellemek için: $ScriptPath guncelle" -ForegroundColor Gray
  }
  Write-Host ''
}

# Paketten (zip) yapılmış kurulumu GitHub'daki son sürümle günceller: zip'i indirir, gerekiyorsa paketleri
# ayrı bir klasörde hazırlar, ancak her şey hazır olunca Atölye'yi durdurup dosyaları değiştirir. İndirme ya da
# paket kurulumu başarısız olursa çalışan kurulum olduğu gibi kalır.
#   ATOLYE_UPDATE_ZIP: farklı bir depo/ayna için zip adresi
# Klasörü hedefe aynalar: önce yeni/değişen dosyalar kopyalanır, hedefteki fazlalıklar sonra silinir.
# Kilitli dosyalarda birkaç kez yeniden dener; başarısız olursa hata fırlatır (robocopy: 8 ve üstü hata).
function Copy-Mirror($from, $to) {
  cmd /d /c "robocopy `"$from`" `"$to`" /MIR /NFL /NDL /NJH /NJS /NP /R:5 /W:1 >nul"
  if ($LASTEXITCODE -ge 8) { throw "Dosyalar kopyalanamadı: $to (robocopy kodu $LASTEXITCODE)" }
}

# Kilitli dosya/klasörlerde (az önce kapanan süreç tutamağı bırakana kadar) birkaç kez yeniden dener
function Rename-WithRetry($path, $newName) {
  for ($i = 1; ; $i++) {
    try { Rename-Item -LiteralPath $path -NewName $newName -ErrorAction Stop; return } catch { if ($i -ge 6) { throw }; Start-Sleep -Seconds 1 }
  }
}
function Move-WithRetry($from, $to) {
  for ($i = 1; ; $i++) {
    try { Move-Item -LiteralPath $from -Destination $to -ErrorAction Stop; return } catch { if ($i -ge 6) { throw }; Start-Sleep -Seconds 1 }
  }
}

# Güncelleme tam değişim anında kesildiyse (elektrik, zorla kapatma) bir klasör "<ad>.eski" olarak kalmış olabilir.
# Asıl klasör yoksa eskisi geri adlandırılır; böylece Atölye her durumda açılır.
function Repair-Install {
  foreach ($d in @('src', 'public', 'scripts', 'node_modules')) {
    $cur = Join-Path $InstallDir $d
    if (-not (Test-Path $cur) -and (Test-Path "$cur.eski")) {
      try { Rename-Item -LiteralPath "$cur.eski" -NewName $d -ErrorAction Stop; Write-Warn "Yarım kalmış bir güncelleme onarıldı: $d geri yüklendi." } catch { }
    }
  }
}

function Update-PackageInstall {
  $info = Read-PaketInfo $InstallDir
  $current = (Get-Content (Join-Path $InstallDir 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json)
  $zipUrl = if ($env:ATOLYE_UPDATE_ZIP) { $env:ATOLYE_UPDATE_ZIP } else { ($RepoUrl -replace '\.git$', '') + '/archive/refs/heads/main.zip' }
  $tmp = Join-Path $env:TEMP ('atolye-guncelle-' + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Force $tmp | Out-Null
  try {
    Write-Step 'Son sürüm indiriliyor…'
    $zip = Join-Path $tmp 'atolye.zip'
    try {
      [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
      $oldProgress = $ProgressPreference; $ProgressPreference = 'SilentlyContinue'
      Invoke-WebRequest -Uri $zipUrl -OutFile $zip -UseBasicParsing -TimeoutSec 120
      $ProgressPreference = $oldProgress
    } catch {
      Stop-WithError "Son sürüm indirilemedi ($zipUrl): $($_.Exception.Message). Ağ bu adrese izin vermiyor olabilir; yeni paketi elle indirip Kur.bat ile kurabilirsiniz."
    }
    Expand-Archive -Path $zip -DestinationPath (Join-Path $tmp 'x') -Force
    $src = Get-ChildItem (Join-Path $tmp 'x') -Directory | Select-Object -First 1
    if (-not $src -or -not (Test-AtolyeDir $src.FullName)) { Stop-WithError 'İndirilen dosya bir Atölye sürümü değil; güncelleme yapılmadı.' }
    $src = $src.FullName
    $new = (Get-Content (Join-Path $src 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json)
    if ([version]$new.version -le [version]$current.version) { Write-Ok "Zaten güncel ($($current.version))"; return }
    Write-Step "Güncelleniyor: $($current.version) → $($new.version)"

    # Kütüphaneler değiştiyse: mevcut node_modules'un kopyası üzerinde, çalışan kuruluma dokunmadan hazırla
    $depsChanged = (($new.dependencies | ConvertTo-Json -Compress) -ne ($current.dependencies | ConvertTo-Json -Compress))
    $modules = Join-Path $InstallDir 'node_modules'
    if ($depsChanged) {
      Write-Step 'Kütüphaneler güncelleniyor (birkaç dakika sürebilir)…'
      if (Test-Path $modules) { cmd /d /c "robocopy `"$modules`" `"$(Join-Path $src 'node_modules')`" /E /NFL /NDL /NJH /NJS /NP /R:1 /W:1 >nul" }
      Push-Location $src
      try {
        cmd /d /c 'npm install --omit=dev --no-audit --no-fund --loglevel=error'
        if ($LASTEXITCODE -ne 0) { Stop-WithError 'Kütüphaneler indirilemedi (şirket ağı npm erişimini engelliyor olabilir). Güncelleme yapılmadı; çalışan sürüm olduğu gibi duruyor. Tam paketi (node_modules dahil) Kur.bat ile kurabilirsiniz.' }
      } finally { Pop-Location }
    }

    # 1) Hazırlık — Atölye çalışmaya devam ederken: yeni sürüm kurulum klasöründeki ".guncelleme" altına kopyalanır.
    #    Bu adımda bir şey ters giderse çalışan sürüme hiç dokunulmamış olur.
    $stage = Join-Path $InstallDir '.guncelleme'
    $rootFiles = @('package.json', 'package-lock.json', 'atolye.ps1', 'README.md', 'LICENSE', '.env.example')
    $dirs = @(@('src', 'public', 'scripts') | Where-Object { Test-Path (Join-Path $src $_) })
    if ($depsChanged) { $dirs += 'node_modules' }
    Write-Step 'Yeni sürüm hazırlanıyor (Atölye çalışmaya devam ediyor)…'
    try {
      if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
      New-Item -ItemType Directory -Force $stage | Out-Null
      foreach ($d in $dirs) { Copy-Mirror (Join-Path $src $d) (Join-Path $stage $d) }
    } catch {
      Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue
      Stop-WithError "Yeni sürüm hazırlanamadı: $($_.Exception.Message). Çalışan sürüme dokunulmadı."
    }

    # 2) Değişim — Atölye yalnızca bu kısa adımda durur. Klasörler kopyalanmaz, yeniden adlandırılır:
    #    eskisi "<ad>.eski" olur, yenisi yerine geçer. Herhangi bir adım başarısız olursa adlar geri alınır.
    $wasRunning = Test-Running
    $swapped = @()
    $rootBackup = Join-Path $stage 'eski-dosyalar'
    try {
      if ($wasRunning) { Stop-Atolye; Start-Sleep -Seconds 1 }
      New-Item -ItemType Directory -Force $rootBackup | Out-Null
      foreach ($f in $rootFiles) {
        if (Test-Path (Join-Path $InstallDir $f)) { Copy-Item (Join-Path $InstallDir $f) -Destination $rootBackup -Force }
      }
      foreach ($d in $dirs) {
        $cur = Join-Path $InstallDir $d
        if (Test-Path "$cur.eski") { Remove-Item "$cur.eski" -Recurse -Force }
        if (Test-Path $cur) { Rename-WithRetry $cur "$d.eski" }
        $swapped += $d
        Move-WithRetry (Join-Path $stage $d) $cur
      }
      foreach ($f in $rootFiles) {
        if (Test-Path (Join-Path $src $f)) { Copy-Item (Join-Path $src $f) -Destination $InstallDir -Force }
      }
      $tam = [bool]($info -and $info.tam)
      Set-Content (Join-Path $InstallDir '.paket') (@{ version = $new.version; commit = ''; tam = $tam; tarih = (Get-Date -Format s) } | ConvertTo-Json) -Encoding UTF8
      Set-Content (Join-Path $InstallDir '.kurulu') (Get-Date -Format s) -Encoding ASCII
    } catch {
      $problem = $_.Exception.Message
      Write-Warn "Güncelleme sırasında hata oluştu: $problem"
      Write-Step 'Eski sürüm geri yükleniyor…'
      try {
        foreach ($d in $swapped) {
          $cur = Join-Path $InstallDir $d
          if (Test-Path "$cur.eski") {
            if (Test-Path $cur) { Remove-Item $cur -Recurse -Force }
            Rename-WithRetry "$cur.eski" $d
          }
        }
        foreach ($f in $rootFiles) {
          if (Test-Path (Join-Path $rootBackup $f)) { Copy-Item (Join-Path $rootBackup $f) -Destination $InstallDir -Force }
        }
        Write-Ok 'Eski sürüm geri yüklendi'
      } catch { Write-Warn "Eski sürüm geri yüklenemedi: $($_.Exception.Message). Atölye bir sonraki başlatılışta kendini onarmayı deneyecek." }
      Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue
      if ($wasRunning) { try { $script:TarayiciAcma = $true; Start-Atolye } catch { } }
      Stop-WithError "Güncelleme tamamlanamadı; önceki sürüm ($($current.version)) kullanılmaya devam ediyor. Sebep: $problem"
    }
    # 3) Temizlik: eski klasörler ancak yenisi yerine geçtikten sonra silinir (silinemezse zararsızdır)
    foreach ($d in $dirs) { Remove-Item (Join-Path $InstallDir "$d.eski") -Recurse -Force -ErrorAction SilentlyContinue }
    Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue
    Get-ChildItem $InstallDir -Recurse -File -ErrorAction SilentlyContinue | Where-Object { $_.FullName -notlike '*\node_modules\*' } | Unblock-File -ErrorAction SilentlyContinue
    Write-Ok "Güncellendi: $($current.version) → $($new.version)"
    Install-EnvFile
    if ($wasRunning) {
      $script:TarayiciAcma = $true
      Start-Atolye
      Write-Host '  Tarayıcıda sayfayı yenileyin.' -ForegroundColor Gray
    }
  } finally {
    Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
  }
}

function Update-Atolye {
  # Arayüzden başlatılan güncelleme gizli pencerede çalışır; ne olduğu sonradan görülebilsin diye kaydedilir
  if ($env:ATOLYE_GUNCELLEME_KAYDI -eq '1') {
    try { Start-Transcript -Path (Join-Path $InstallDir 'atolye-guncelle.log') -Force | Out-Null } catch { }
  }
  if (-not (Test-AtolyeDir $InstallDir)) { Stop-WithError "Kurulum bulunamadı: $InstallDir. Önce 'kur' komutunu çalıştırın." }
  Repair-Install
  if (-not (Test-Path (Join-Path $InstallDir '.git'))) {
    Update-PackageInstall
    return
  }
  # Önce yalnızca indirilir (git fetch): bu adım başarısız olursa çalışan sürüme hiç dokunulmamış olur.
  Push-Location $InstallDir
  try {
    $before = (git rev-parse HEAD)
    Write-Step 'Son sürüm indiriliyor…'
    git fetch --quiet
    if ($LASTEXITCODE -ne 0) { Stop-WithError 'Son sürüm indirilemedi (git fetch). Çalışan sürüme dokunulmadı.' }
    $target = (git rev-parse '@{u}')
    if ($LASTEXITCODE -ne 0 -or -not $target) { Stop-WithError 'Bu klasör bir uzak dalı izlemiyor; güncelleme yapılamadı.' }
    if ($before -eq $target) {
      Write-Ok "Zaten güncel ($($before.Substring(0, 7)))"
      return
    }
    # İndirilen sürüm yerine konur (yerel, hızlı bir işlem). Atölye bu sırada eski sürümle çalışmaya devam eder.
    git merge --ff-only --quiet '@{u}'
    if ($LASTEXITCODE -ne 0) { Stop-WithError 'Yeni sürüm uygulanamadı. Klasörde elle yapılmış değişiklikler olabilir (git status ile bakın). Çalışan sürüme dokunulmadı.' }
    Write-Step "Güncelleniyor: $($before.Substring(0, 7)) → $($target.Substring(0, 7))"
    # Kütüphaneler kurulamazsa dosyalar önceki sürüme geri alınır; yarım bir sürüm bırakılmaz
    cmd /d /c 'npm install --no-audit --no-fund --loglevel=error'
    if ($LASTEXITCODE -ne 0) {
      git reset --keep --quiet $before
      cmd /d /c 'npm install --no-audit --no-fund --loglevel=error >nul 2>&1'
      Stop-WithError "Kütüphaneler kurulamadı (şirket ağı npm erişimini engelliyor olabilir). Önceki sürüme ($($before.Substring(0, 7))) geri dönüldü; Atölye çalışmaya devam ediyor."
    }
  } finally { Pop-Location }
  Write-Ok "Güncellendi: $($before.Substring(0, 7)) → $($target.Substring(0, 7))"
  Install-EnvFile
  if (-not (Test-ClaudeConnection -Quiet)) { Write-Warn "Claude bağlantı ayarı bulunamadı; '$ScriptPath durum' ile kontrol edin." }
  # Atölye yalnızca en sonda, her şey hazır olduktan sonra yeniden başlatılır
  $wasRunning = Test-Running
  if ($wasRunning) {
    Stop-Atolye
    Start-Sleep -Seconds 1
    $script:TarayiciAcma = $true
    Start-Atolye
    Write-Host '  Tarayıcıda sayfayı yenileyin.' -ForegroundColor Gray
  }
}

function Show-Status {
  Write-Host ''
  $installed = Test-AtolyeDir $InstallDir
  $yes = 'evet'; $no = 'hayır'
  Write-Host "  Kurulum klasörü : $InstallDir $(if ($installed) { '' } else { '(kurulu değil)' })"
  if ($installed) {
    $info = Read-PaketInfo $InstallDir
    if (Test-Path (Join-Path $InstallDir '.git')) {
      Push-Location $InstallDir
      try { Write-Host "  Sürüm           : $(git log -1 --format='%h %cd' --date=short) (git)" } finally { Pop-Location }
    } elseif ($info) {
      Write-Host "  Sürüm           : $($info.version) $($info.commit) (paket$(if ($info.tam) { ', tam' }))"
    }
  }
  Write-Host "  Çalışıyor       : $(if (Test-Running) { "$yes ($(Get-Url))" } else { $no })"
  $owner = Get-PortOwner (Get-Port)
  if ($owner -and -not $owner.ours) {
    Write-Host "  Port            : $(Get-Port) başka bir program tarafından kullanılıyor ($($owner.name)); 'baslat' yeni port soracak" -ForegroundColor Yellow
  } else {
    Write-Host "  Port            : $(Get-Port)"
  }
  Write-Host "  Masaüstü kısayolu: $(if (Test-Link $DesktopLink) { $yes } else { $no })"
  Write-Host "  Otomatik başlatma: $(if (Test-Link $StartupLink) { $yes } else { $no })"
  $c = Get-ClaudeConnection
  $conn = if ($c.token) {
    $gw = if ($c.baseUrl) { try { ([Uri]$c.baseUrl).Host } catch { $c.baseUrl } } else { 'doğrudan Anthropic API' }
    "$yes ($gw; token: $($c.tokenSource))"
  } elseif ($c.login -and -not $c.baseUrl) { "$yes (claude.ai girişi)" } else { "$no — .env ya da ~/.claude/settings.json içinde gateway/token yok" }
  Write-Host "  Claude bağlantısı: $conn"
  $claudeExe = Find-Cli 'claude'
  $claudeVer = if ($claudeExe) { Get-CliVersion $claudeExe } else { $null }
  Write-Host "  Claude Code CLI : $(if ($claudeVer) { $claudeVer } else { "$no (isteğe bağlı: npm install -g @anthropic-ai/claude-code)" })"
  $copilotExe = Find-Cli 'copilot'
  $copilotVer = if ($copilotExe) { Get-CliVersion $copilotExe } else { $null }
  if ($copilotVer) {
    $cl = Get-CopilotLogin
    Write-Host "  Copilot CLI     : $copilotVer, giriş: $(if ($cl) { $cl } else { "$no — bir terminalde 'copilot login' çalıştırın" })"
  } else {
    Write-Host "  Copilot CLI     : $no (isteğe bağlı: npm install -g @github/copilot)"
  }
  Write-Host "  Kayıt dosyası   : $LogFile"
  Write-Host ''
}

function Uninstall-Atolye {
  Write-Host ''
  Write-Host "  $AppName kaldırma" -ForegroundColor White
  Write-Host ''
  $installed = Test-AtolyeDir $InstallDir
  $isRepo = Test-Path (Join-Path $InstallDir '.git')
  # Sadece paketle kurulmuş klasörler silinir (geliştiricinin git deposuna asla dokunulmaz)
  $markers = (Test-Path (Join-Path $InstallDir '.kurulu')) -or (Test-Path (Join-Path $InstallDir '.paket'))
  $full = [IO.Path]::GetFullPath($InstallDir).TrimEnd('\')
  $unsafe = @($HOME, $env:LOCALAPPDATA, $env:APPDATA, $env:USERPROFILE, [IO.Path]::GetPathRoot($full)) |
    Where-Object { $_ } | ForEach-Object { [IO.Path]::GetFullPath($_).TrimEnd('\') }
  $canDelete = $installed -and -not $isRepo -and $markers -and ($unsafe -notcontains $full)
  $generalDir = Join-Path $HOME '.atolye'
  $hasShortcuts = (Test-Link $DesktopLink) -or (Test-Link $StartupLink)

  if (-not $installed -and -not $hasShortcuts) {
    Write-Ok "Kaldırılacak bir Atölye kurulumu bulunamadı ($InstallDir)"
    return
  }

  Write-Host '  Yapılacaklar:'
  Write-Host '    - Çalışıyorsa Atölye durdurulacak'
  if ($hasShortcuts) { Write-Host '    - Masaüstü kısayolu ve Windows açılışında başlatma kaldırılacak' }
  if ($canDelete) { Write-Host "    - Kurulum klasörü silinecek (.env ayarları dahil): $InstallDir" }
  elseif ($isRepo) { Write-Host "    - Git ile indirilmiş klasöre dokunulmayacak: $InstallDir" -ForegroundColor Gray }
  Write-Host '    - Sohbet geçmişi (~/.claude) korunacak; Claude Code CLI ile ortaktır' -ForegroundColor Gray
  Write-Host ''
  if (-not $Evet -and -not (Confirm-Yes "$AppName kaldırılsın mı?" $false)) {
    Write-Host '  Vazgeçildi, hiçbir şey değiştirilmedi.' -ForegroundColor Gray
    return
  }

  Stop-Atolye
  if (Test-Link $DesktopLink) { Remove-Item $DesktopLink -Force; Write-Ok 'Masaüstü kısayolu kaldırıldı' }
  Disable-Autostart

  if ($canDelete) {
    Write-Step 'Kurulum klasörü siliniyor…'
    # rmdir, uzun node_modules yollarında Remove-Item'dan daha güvenilir
    if (Remove-DirWithRetry $full) { Write-Ok "Kurulum klasörü silindi: $full" }
    else { Write-Warn "Klasör tamamen silinemedi (açık bir dosya olabilir): $full — elle silebilirsiniz." }
  }

  if ((Test-Path $generalDir) -and ($Evet -or (Confirm-Yes "Klasörsüz sohbet klasörü ($generalDir) de silinsin mi?" $false))) {
    if (Remove-DirWithRetry $generalDir) { Write-Ok "Silindi: $generalDir" }
  }

  Write-Host ''
  Write-Host "  $AppName kaldırıldı." -ForegroundColor Green
  if (-not $canDelete -and $installed) { Write-Host "  Dosyalar yerinde duruyor: $InstallDir" -ForegroundColor Gray }
  Write-Host ''
}

try {
  switch ($Komut) {
    'kur' { Install-Atolye }
    'baslat' { Start-Atolye }
    'durdur' { Stop-Atolye }
    'guncelle' { Update-Atolye }
    'durum' { Show-Status }
    'otomatik-ac' { Enable-Autostart }
    'otomatik-kapat' { Disable-Autostart }
    'kaldir' { Uninstall-Atolye }
  }
} finally {
  # Kaldir.bat kendi klasörünü silebildiği için bekleme .bat'ta değil burada yapılır
  if ($Bekle -and $env:ATOLYE_SORMA -ne '1') {
    try { [void](Read-Host "  Kapatmak için Enter'a basın") } catch { }
  }
}
