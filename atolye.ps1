<#
.SYNOPSIS
  Atölye'yi Windows'ta kurar, başlatır, günceller ve Windows açılışında otomatik çalıştırır.

.DESCRIPTION
  Komutlar:
    kur             (varsayılan) Kurulum: Node/Git kontrolü, indirme, paketler, masaüstü kısayolu,
                    Windows açılışında otomatik başlatma, ardından başlatıp tarayıcıyı açar.
    baslat          Arka planda başlatır (zaten çalışıyorsa sadece tarayıcıyı açar).
    durdur          Çalışan Atölye'yi durdurur.
    guncelle        Son sürümü indirir, paketleri günceller ve yeniden başlatır.
    durum           Kurulum ve çalışma durumunu gösterir.
    otomatik-ac     Windows açılışında otomatik başlatmayı açar.
    otomatik-kapat  Windows açılışında otomatik başlatmayı kapatır.
    kaldir          Kısayolları ve otomatik başlatmayı kaldırır (dosyalara dokunmaz).

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
  [switch]$TarayiciAcma
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

function Test-Running {
  $client = New-Object Net.Sockets.TcpClient
  try {
    $task = $client.ConnectAsync('127.0.0.1', (Get-Port))
    return ($task.Wait(500) -and $client.Connected)
  } catch { return $false } finally { $client.Dispose() }
}

function Get-NodePath {
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

function Test-Requirements {
  $node = Get-NodePath
  if (-not $node) { Stop-NodeMissing 'Node.js bulunamadı.' }
  $ver = $null
  try { $ver = [version]((& $node --version).Trim().TrimStart('v')) } catch { }
  if (-not $ver) { Stop-NodeMissing "Node.js çalıştırılamadı: $node" }
  if ($ver -lt $MinNode) { Stop-NodeMissing "Node.js $ver çok eski." }
  Write-Ok "Node.js $ver"
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

function Start-Atolye {
  if (Test-Running) {
    Write-Ok "Zaten çalışıyor: $(Get-Url)"
  } else {
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
  $conns = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
  if (-not $conns) { Write-Ok 'Zaten çalışmıyor'; return }
  foreach ($c in $conns) {
    $proc = Get-Process -Id $c.OwningProcess -ErrorAction SilentlyContinue
    # Sadece Node süreçlerini durdur; portu başka bir program kullanıyorsa dokunma
    if ($proc -and $proc.ProcessName -eq 'node') {
      Stop-Process -Id $proc.Id -Force
      Write-Ok "Durduruldu (süreç $($proc.Id))"
    } elseif ($proc) {
      Write-Warn "Port $port başka bir program tarafından kullanılıyor ($($proc.ProcessName)); dokunulmadı."
    }
  }
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
  Test-Requirements
  Install-Files
  Install-Packages
  Install-EnvFile
  $connected = Test-ClaudeConnection
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
  if ($FromPackage) {
    Write-Host "  Güncellemek için yeni paketi indirip Kur.bat'ı çalıştırın. Bu çıkarılan klasörü artık silebilirsiniz." -ForegroundColor Gray
  } else {
    Write-Host "  Güncellemek için: $ScriptPath guncelle" -ForegroundColor Gray
  }
  Write-Host ''
}

function Update-Atolye {
  if (-not (Test-AtolyeDir $InstallDir)) { Stop-WithError "Kurulum bulunamadı: $InstallDir. Önce 'kur' komutunu çalıştırın." }
  if (-not (Test-Path (Join-Path $InstallDir '.git'))) {
    $info = Read-PaketInfo $InstallDir
    Write-Warn "Bu kurulum paketten yapıldı (sürüm $($info.version)). Güncellemek için yeni paketi indirip içindeki Kur.bat'ı çalıştırın."
    return
  }
  Push-Location $InstallDir
  try {
    $before = (git rev-parse --short HEAD)
    Write-Step 'Son sürüm indiriliyor…'
    git pull --ff-only --quiet
    if ($LASTEXITCODE -ne 0) { Stop-WithError 'git pull başarısız oldu. Klasörde elle yapılmış değişiklikler olabilir (git status ile bakın).' }
    $after = (git rev-parse --short HEAD)
  } finally { Pop-Location }
  if ($before -eq $after) {
    Write-Ok "Zaten güncel ($after)"
    return
  }
  Write-Ok "Güncellendi: $before → $after"
  Install-Packages
  Install-EnvFile
  if (-not (Test-ClaudeConnection -Quiet)) { Write-Warn "Claude bağlantı ayarı bulunamadı; '$ScriptPath durum' ile kontrol edin." }
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
  Write-Host "  Masaüstü kısayolu: $(if (Test-Link $DesktopLink) { $yes } else { $no })"
  Write-Host "  Otomatik başlatma: $(if (Test-Link $StartupLink) { $yes } else { $no })"
  $c = Get-ClaudeConnection
  $conn = if ($c.token) {
    $gw = if ($c.baseUrl) { try { ([Uri]$c.baseUrl).Host } catch { $c.baseUrl } } else { 'doğrudan Anthropic API' }
    "$yes ($gw; token: $($c.tokenSource))"
  } elseif ($c.login -and -not $c.baseUrl) { "$yes (claude.ai girişi)" } else { "$no — .env ya da ~/.claude/settings.json içinde gateway/token yok" }
  Write-Host "  Claude bağlantısı: $conn"
  Write-Host "  Kayıt dosyası   : $LogFile"
  Write-Host ''
}

function Uninstall-Atolye {
  Stop-Atolye
  if (Test-Link $DesktopLink) { Remove-Item $DesktopLink -Force }
  Disable-Autostart
  Write-Ok 'Kısayollar kaldırıldı'
  Write-Host "  Dosyalar silinmedi: $InstallDir (isterseniz klasörü elle silebilirsiniz)" -ForegroundColor Gray
}

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
