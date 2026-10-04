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
$DesktopDir = if ($env:ATOLYE_DESKTOP_DIR) { $env:ATOLYE_DESKTOP_DIR } else { [Environment]::GetFolderPath('Desktop') }
$StartupDir = if ($env:ATOLYE_STARTUP_DIR) { $env:ATOLYE_STARTUP_DIR } else { [Environment]::GetFolderPath('Startup') }
$DesktopLink = Join-Path $DesktopDir "$AppName.lnk"
$StartupLink = Join-Path $StartupDir "$AppName.lnk"

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
  return $null
}

function Test-Requirements {
  $node = Get-NodePath
  if (-not $node) { Stop-WithError "Node.js bulunamadı. https://nodejs.org adresinden LTS sürümünü kurup tekrar deneyin." }
  $ver = [version]((& $node --version).TrimStart('v'))
  if ($ver -lt $MinNode) { Stop-WithError "Node.js $ver çok eski; en az $MinNode gerekli." }
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
  if (Test-Path $envFile) { return }
  Copy-Item (Join-Path $InstallDir '.env.example') $envFile
  Write-Ok '.env oluşturuldu (gateway ayarları ~/.claude/settings.json içindeyse dokunmanıza gerek yok)'
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
  New-Shortcut $StartupLink '-Komut baslat -TarayiciAcma' "$AppName (Windows açılışında arka planda başlar)"
  Write-Ok 'Windows açılışında otomatik başlatma açık'
}

function Disable-Autostart {
  if (Test-Path $StartupLink) { Remove-Item $StartupLink -Force }
  Write-Ok 'Windows açılışında otomatik başlatma kapalı'
}

function Install-Atolye {
  Write-Host ''
  Write-Host "  $AppName kurulumu" -ForegroundColor White
  Write-Host ''
  Test-Requirements
  Install-Files
  Install-Packages
  Install-EnvFile
  New-Shortcut $DesktopLink '-Komut baslat' "$AppName'yi aç"
  Write-Ok "Masaüstü kısayolu: $DesktopLink"
  Enable-Autostart
  Start-Atolye
  Write-Host ''
  Write-Host "  Kurulum tamam. Atölye'yi masaüstündeki '$AppName' kısayoluyla açabilirsiniz." -ForegroundColor Green
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
  Write-Host "  Masaüstü kısayolu: $(if (Test-Path $DesktopLink) { $yes } else { $no })"
  Write-Host "  Otomatik başlatma: $(if (Test-Path $StartupLink) { $yes } else { $no })"
  Write-Host "  Kayıt dosyası   : $LogFile"
  Write-Host ''
}

function Uninstall-Atolye {
  Stop-Atolye
  if (Test-Path $DesktopLink) { Remove-Item $DesktopLink -Force }
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
