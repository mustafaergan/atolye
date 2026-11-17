# Atölye kurulum sihirbazı: Kur.bat bunu açar. Kurulumu siyah komut penceresi yerine "İleri / İleri / Kur" adımlarıyla
# yapar; asıl işi yine atolye.ps1 yürütür (gizli çalışır, çıktısı "Ayrıntılar" kutusuna akar).
# Pencere açılamazsa (ör. Windows Forms yoksa) eski konsol kurulumuna düşer.
#   ATOLYE_SIHIRBAZ_TEST=<klasör> : deneme kipi; adımları kendi geçer, her adımın görüntüsünü klasöre kaydeder
$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$Ps1 = Join-Path $Root 'atolye.ps1'
$PsExe = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$TestDir = $env:ATOLYE_SIHIRBAZ_TEST

function Start-ConsoleInstall {
  Start-Process $PsExe -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$Ps1`" kur -Bekle"
}

try {
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing
  # Yüksek çözünürlüklü ekranlarda pencere bulanık büyütülmesin: süreç DPI'yi kendisi yönetir, pencere ölçeğe göre büyür
  try {
    Add-Type -Namespace Atolye -Name Dpi -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetProcessDPIAware();'
    [void][Atolye.Dpi]::SetProcessDPIAware()
  } catch { }
  [Windows.Forms.Application]::EnableVisualStyles()
} catch {
  Start-ConsoleInstall
  exit
}
# Alt süreçlerin (atolye.ps1) Türkçe çıktısı doğru okunsun
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch { }

# ---------- Bilgiler ----------
$version = ''
try { $version = [string](Get-Content (Join-Path $Root 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json).version } catch { }
$fromPackage = (Test-Path (Join-Path $Root '.paket')) -and -not (Test-Path (Join-Path $Root '.git')) -and -not (Test-Path (Join-Path $Root '.kurulu'))
$installDir = if ($env:ATOLYE_KLASOR) { $env:ATOLYE_KLASOR } elseif ($fromPackage) { Join-Path $env:LOCALAPPDATA 'Atolye' } else { $Root }
$oldVersion = ''
if ($fromPackage) { try { $oldVersion = [string](Get-Content (Join-Path $installDir 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json).version } catch { } }
$terms = ''
try { $terms = ((& $PsExe -NoProfile -ExecutionPolicy Bypass -File $Ps1 kosullar) -join "`r`n") } catch { }
if (-not $terms) { $terms = 'Kullanım koşulları okunamadı. Koşullar için kurulum klasöründeki README.md dosyasına bakın.' }

# ---------- Pencere ----------
$font = New-Object Drawing.Font('Segoe UI', 9)
$accent = [Drawing.Color]::FromArgb(201, 100, 66)
$form = New-Object Windows.Forms.Form
$form.Text = 'Atölye Kurulumu'
$form.AutoScaleMode = 'None' # ölçekleme en sonda elle yapılır (aşağıda)
$form.ClientSize = New-Object Drawing.Size(640, 480)
$form.FormBorderStyle = 'FixedDialog'
$form.MaximizeBox = $false
$form.StartPosition = 'CenterScreen'
$form.Font = $font
$form.BackColor = [Drawing.Color]::White
$iconPath = Join-Path $Root 'public\atolye.ico'
if (Test-Path $iconPath) { try { $form.Icon = New-Object Drawing.Icon($iconPath) } catch { } }

function New-Label($text, $x, $y, $w, $h, $parent, $size = 9, [switch]$Bold, [switch]$Gray) {
  $l = New-Object Windows.Forms.Label
  $l.Text = $text
  $l.SetBounds($x, $y, $w, $h)
  $style = if ($Bold) { [Drawing.FontStyle]::Bold } else { [Drawing.FontStyle]::Regular }
  $l.Font = New-Object Drawing.Font('Segoe UI', $size, $style)
  if ($Gray) { $l.ForeColor = [Drawing.Color]::FromArgb(105, 100, 92) }
  $parent.Controls.Add($l)
  return $l
}
function New-Check($text, $x, $y, $w, $parent, [bool]$checked = $true) {
  $c = New-Object Windows.Forms.CheckBox
  $c.Text = $text
  $c.SetBounds($x, $y, $w, 24)
  $c.Checked = $checked
  $parent.Controls.Add($c)
  return $c
}

# Başlık
$header = New-Object Windows.Forms.Panel
$header.SetBounds(0, 0, 640, 76)
$header.BackColor = [Drawing.Color]::FromArgb(250, 249, 245)
$form.Controls.Add($header)
# Logo: Atölye'nin turuncu karesi içinde "A" (simge dosyasından bağımsız çizilir, her ölçekte net)
$logo = New-Object Windows.Forms.Label
$logo.SetBounds(24, 18, 40, 40)
$logo.Text = 'A'
$logo.TextAlign = 'MiddleCenter'
$logo.Font = New-Object Drawing.Font('Segoe UI', 17, [Drawing.FontStyle]::Bold)
$logo.ForeColor = [Drawing.Color]::White
$logo.BackColor = $accent
$header.Controls.Add($logo)
$title = New-Label 'Atölye' 78 14 520 28 $header 14 -Bold
$subtitle = New-Label '' 79 44 540 20 $header 9 -Gray
$line1 = New-Object Windows.Forms.Label
$line1.SetBounds(0, 76, 640, 1); $line1.BackColor = [Drawing.Color]::FromArgb(226, 222, 212)
$form.Controls.Add($line1)

# Sayfalar
$pages = @()
function New-Page {
  $p = New-Object Windows.Forms.Panel
  $p.SetBounds(0, 77, 640, 345)
  $p.Visible = $false
  $form.Controls.Add($p)
  return $p
}

# 0: Hoş geldiniz
$p0 = New-Page; $pages += $p0
[void](New-Label "Atölye $version kurulumuna hoş geldiniz" 32 28 580 26 $p0 12 -Bold)
$welcome = "Atölye; Claude Code ve GitHub Copilot'u tarayıcıdan ya da kendi penceresinden kullanmanızı sağlayan yerel bir arayüzdür. Yalnızca bu bilgisayarda çalışır.`r`n`r`n" +
  "Bu sihirbaz Atölye'yi şu klasöre kurar:`r`n$installDir`r`n`r`n" +
  $(if ($oldVersion) { "Bu bilgisayarda Atölye $oldVersion kurulu; ayarlarınız korunarak güncellenecek.`r`n`r`n" } else { '' }) +
  "Yönetici izni gerekmez. Devam etmek için İleri'ye basın."
[void](New-Label $welcome 32 70 576 240 $p0)

# 1: Kullanım koşulları
$p1 = New-Page; $pages += $p1
$termsBox = New-Object Windows.Forms.TextBox
$termsBox.Multiline = $true; $termsBox.ReadOnly = $true; $termsBox.ScrollBars = 'Vertical'
$termsBox.SetBounds(32, 20, 576, 270)
$termsBox.BackColor = [Drawing.Color]::White
$termsBox.Text = $terms
$p1.Controls.Add($termsBox)
$chkTerms = New-Check 'Bu koşulları okudum ve kabul ediyorum' 32 300 576 $p1 $false

# 2: Seçenekler
$p2 = New-Page; $pages += $p2
$grp = New-Object Windows.Forms.GroupBox
$grp.Text = 'Atölye nasıl açılsın?'
$grp.SetBounds(32, 14, 576, 128)
$p2.Controls.Add($grp)
$rbApp = New-Object Windows.Forms.RadioButton
$rbApp.Text = 'Masaüstü uygulaması olarak (önerilir)'
$rbApp.SetBounds(16, 24, 540, 22); $rbApp.Checked = $true
$grp.Controls.Add($rbApp)
[void](New-Label 'Kendi penceresinde açılır; görev çubuğuna sabitleyebilirsiniz. Windows''un kendi bileşenini kullanır, ek yük getirmez.' 34 46 530 32 $grp 8.5 -Gray)
$rbWeb = New-Object Windows.Forms.RadioButton
$rbWeb.Text = 'Tarayıcıda'
$rbWeb.SetBounds(16, 80, 540, 22)
$grp.Controls.Add($rbWeb)
[void](New-Label 'Varsayılan tarayıcınızda bir sekme olarak açılır.' 34 102 530 18 $grp 8.5 -Gray)
$chkShortcut = New-Check 'Masaüstüne kısayol ekle' 36 156 560 $p2
$chkAuto = New-Check 'Windows açılışında arka planda başlat (Atölye hemen açılır)' 36 184 560 $p2
$chkUpdate = New-Check 'Daha yeni bir sürüm varsa kurulum sırasında güncelle' 36 212 560 $p2
$chkCopilot = New-Check 'GitHub Copilot CLI kurulu değilse kur' 36 240 560 $p2
[void](New-Label 'Bu seçenekleri sonradan Atölye içindeki Ayarlar''dan değiştirebilirsiniz.' 36 284 560 20 $p2 8.5 -Gray)

# 3: Kuruluyor
$p3 = New-Page; $pages += $p3
$status = New-Label 'Kurulum başlatılıyor…' 32 24 576 22 $p3 10 -Bold
$bar = New-Object Windows.Forms.ProgressBar
$bar.SetBounds(32, 54, 576, 16); $bar.Style = 'Marquee'; $bar.MarqueeAnimationSpeed = 30
$p3.Controls.Add($bar)
[void](New-Label 'Ayrıntılar' 32 84 200 18 $p3 8.5 -Gray)
$logBox = New-Object Windows.Forms.TextBox
$logBox.Multiline = $true; $logBox.ReadOnly = $true; $logBox.ScrollBars = 'Vertical'; $logBox.WordWrap = $false
$logBox.Font = New-Object Drawing.Font('Consolas', 8.5)
$logBox.BackColor = [Drawing.Color]::FromArgb(250, 249, 245)
$logBox.SetBounds(32, 104, 576, 226)
$p3.Controls.Add($logBox)

# 4: Bitti
$p4 = New-Page; $pages += $p4
$doneTitle = New-Label 'Kurulum tamamlandı' 32 28 576 26 $p4 12 -Bold
$doneText = New-Label '' 32 68 576 190 $p4
$chkOpen = New-Check 'Atölye''yi şimdi aç' 32 290 560 $p4

# Alt düğmeler
$line2 = New-Object Windows.Forms.Label
$line2.SetBounds(0, 422, 640, 1); $line2.BackColor = [Drawing.Color]::FromArgb(226, 222, 212)
$form.Controls.Add($line2)
function New-Button($text, $x) {
  $b = New-Object Windows.Forms.Button
  $b.Text = $text
  $b.SetBounds($x, 436, 92, 30)
  $form.Controls.Add($b)
  return $b
}
$btnBack = New-Button '< Geri' 326
$btnNext = New-Button 'İleri >' 424
$btnCancel = New-Button 'İptal' 530
$form.AcceptButton = $btnNext

$script:Page = 0
$script:Running = $false
$script:Failed = $false
$script:Proc = $null
$script:Offset = 0
$script:LogFile = Join-Path $env:TEMP "atolye-kurulum-$PID.log"
$subtitles = @('Kurulum sihirbazı', 'Kullanım koşulları', 'Kurulum seçenekleri', 'Kuruluyor', 'Bitti')

function Show-Page($i) {
  $script:Page = $i
  for ($k = 0; $k -lt $pages.Count; $k++) { $pages[$k].Visible = ($k -eq $i) }
  $subtitle.Text = $subtitles[$i]
  $btnBack.Visible = ($i -ge 1 -and $i -le 2)
  $btnNext.Visible = ($i -ne 3)
  $btnNext.Text = if ($i -eq 2) { 'Kur' } elseif ($i -eq 4) { 'Bitir' } else { 'İleri >' }
  $btnNext.Enabled = ($i -ne 1 -or $chkTerms.Checked)
  $btnCancel.Visible = ($i -ne 4)
  # Son sayfada tek düğme kalır: sağ kenara alınır
  if ($null -eq $script:NextLeft) { $script:NextLeft = $btnNext.Left }
  $btnNext.Left = if ($i -eq 4) { $btnCancel.Left } else { $script:NextLeft }
  $btnCancel.Enabled = ($i -ne 3)
  $btnCancel.Text = 'İptal'
}

function Read-NewLog {
  if (-not (Test-Path $script:LogFile)) { return }
  try {
    $fs = New-Object IO.FileStream($script:LogFile, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)
    try {
      if ($fs.Length -le $script:Offset) { return }
      [void]$fs.Seek($script:Offset, [IO.SeekOrigin]::Begin)
      $buf = New-Object byte[] ($fs.Length - $script:Offset)
      $n = $fs.Read($buf, 0, $buf.Length)
      $script:Offset += $n
    } finally { $fs.Close() }
    $text = [Text.Encoding]::UTF8.GetString($buf, 0, $n).TrimStart([char]0xFEFF)
    $logBox.AppendText(($text -replace "`r?`n", "`r`n"))
    $steps = @($text -split "`r?`n" | Where-Object { $_ -match '^\s*(>|✓)\s+\S' })
    if ($steps.Count) { $status.Text = ($steps[-1] -replace '^\s*(>|✓)\s+', '') }
  } catch { }
}

function Start-Install {
  Show-Page 3
  $script:Running = $true
  $env:ATOLYE_SORMA = '1'
  $env:ATOLYE_KABUL = '1'
  $env:ATOLYE_MASAUSTU = if ($rbApp.Checked) { '1' } else { '0' }
  $env:ATOLYE_KISAYOL = if ($chkShortcut.Checked) { '1' } else { '0' }
  $env:ATOLYE_OTOMATIK = if ($chkAuto.Checked) { '1' } else { '0' }
  $env:ATOLYE_KURULUMDA_GUNCELLE = if ($chkUpdate.Checked) { '1' } else { '0' }
  $env:ATOLYE_COPILOT_KUR = if ($chkCopilot.Checked) { '1' } else { '0' }
  try {
    $script:Proc = Start-Process $PsExe -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$Ps1`" kur -Kabul -TarayiciAcma" `
      -NoNewWindow -PassThru -RedirectStandardOutput $script:LogFile -RedirectStandardError "$($script:LogFile).hata"
    $null = $script:Proc.Handle # çıkış kodu sonradan okunabilsin
    $timer.Start()
  } catch {
    Complete-Install 1 "Kurulum başlatılamadı: $($_.Exception.Message)"
  }
}

function Complete-Install($code, $problem) {
  $script:Running = $false
  $bar.Visible = $false
  if ($code -ne 0) {
    $script:Failed = $true
    $status.Text = 'Kurulum tamamlanamadı. Sebep aşağıdaki ayrıntılarda yazıyor.'
    $status.ForeColor = [Drawing.Color]::FromArgb(176, 48, 48)
    if ($problem) { $logBox.AppendText("`r`n$problem`r`n") }
    $btnCancel.Enabled = $true
    $btnCancel.Text = 'Kapat'
    return
  }
  $all = $logBox.Text
  $note = "Atölye kuruldu ve arka planda çalışıyor.`r`n`r`n"
  if ($rbApp.Checked -and $all -match 'Masaüstü uygulaması hazır') {
    $note += "Görev çubuğuna sabitlemek için: Atölye penceresi açıkken görev çubuğundaki simgesine sağ tıklayıp `"Görev çubuğuna sabitle`"yi seçin.`r`n`r`n"
  } elseif ($rbApp.Checked) {
    $note += "Masaüstü uygulaması bu bilgisayarda hazırlanamadı; Atölye tarayıcıda açılacak. Sonradan Atölye içindeki Ayarlar'dan yeniden deneyebilirsiniz.`r`n`r`n"
  }
  if ($all -match 'Güncelleme (yapılamadı|denetlenemedi)') { $note += "Güncelleme yapılamadı; paketteki sürüm kuruldu.`r`n`r`n" }
  if ($all -match 'bağlantı ayarı eksik') { $note += "Claude bağlantı ayarı eksik görünüyor; Atölye içindeki Ayarlar'dan girebilirsiniz.`r`n`r`n" }
  $note += "Bağlantıları, Claude ve Copilot ayarlarını Atölye içindeki Ayarlar'dan yönetebilirsiniz.$(if ($fromPackage) { ' Zip''ten çıkardığınız klasörü artık silebilirsiniz.' })"
  $doneText.Text = $note
  Show-Page 4
}

$timer = New-Object Windows.Forms.Timer
$timer.Interval = 300
$timer.Add_Tick({
  Read-NewLog
  if ($script:Proc -and $script:Proc.HasExited) {
    $timer.Stop()
    Start-Sleep -Milliseconds 200
    Read-NewLog
    $err = ''
    try { $err = (Get-Content "$($script:LogFile).hata" -Raw -Encoding UTF8) } catch { }
    Complete-Install $script:Proc.ExitCode $err
  }
})

$chkTerms.Add_CheckedChanged({ if ($script:Page -eq 1) { $btnNext.Enabled = $chkTerms.Checked } })
$btnBack.Add_Click({ if ($script:Page -gt 0) { Show-Page ($script:Page - 1) } })
$btnCancel.Add_Click({ $form.Close() })
$btnNext.Add_Click({
  if ($script:Page -lt 2) { Show-Page ($script:Page + 1) }
  elseif ($script:Page -eq 2) { Start-Install }
  elseif ($script:Page -eq 4) {
    if ($chkOpen.Checked -and -not $TestDir) {
      Start-Process $PsExe -WindowStyle Hidden -ArgumentList "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$(Join-Path $installDir 'atolye.ps1')`" baslat"
    }
    $form.Close()
  }
})
$form.Add_FormClosing({
  param($s, $e)
  if ($script:Running) {
    $e.Cancel = $true
    [void][Windows.Forms.MessageBox]::Show($form, 'Kurulum sürüyor; bitmesini bekleyin.', 'Atölye Kurulumu')
  }
})

# Deneme kipi: adımlar kendiliğinden geçilir ve her birinin görüntüsü kaydedilir
if ($TestDir) {
  New-Item -ItemType Directory -Force $TestDir | Out-Null
  function Save-Shot($name) {
    $bmp = New-Object Drawing.Bitmap($form.Width, $form.Height)
    $form.DrawToBitmap($bmp, (New-Object Drawing.Rectangle(0, 0, $form.Width, $form.Height)))
    $bmp.Save((Join-Path $TestDir "$name.png")); $bmp.Dispose()
  }
  $script:TestStep = 0
  $auto = New-Object Windows.Forms.Timer
  $auto.Interval = 700
  $auto.Add_Tick({
    if ($script:Running) { if ($script:TestStep -eq 3) { Save-Shot '3-kuruluyor'; $script:TestStep = 4 }; return }
    switch ($script:TestStep) {
      0 { Save-Shot '0-hosgeldiniz'; $btnNext.PerformClick() }
      1 { $chkTerms.Checked = $true; Save-Shot '1-kosullar'; $btnNext.PerformClick() }
      2 { if ($env:ATOLYE_SIHIRBAZ_TARAYICI -eq '1') { $rbWeb.Checked = $true }; Save-Shot '2-secenekler'; $btnNext.PerformClick() }
      default { Save-Shot "5-son-$(if ($script:Failed) { 'hata' } else { 'tamam' })"; $auto.Stop(); if ($script:Failed) { $form.Close() } else { $btnNext.PerformClick() } }
    }
    if ($script:TestStep -lt 3) { $script:TestStep++ }
  })
  $form.Add_Shown({ $auto.Start() })
}

# Pencere 96 DPI'ye göre çizildi; ekran ölçeği daha büyükse (ör. %150, %200) bütün ölçüler ona göre büyütülür.
# Yazılar punto cinsinden olduğu için kendiliğinden büyür.
try {
  $g = [Drawing.Graphics]::FromHwnd([IntPtr]::Zero)
  $scale = $g.DpiX / 96
  $g.Dispose()
  if ($scale -gt 1.01) { $form.Scale((New-Object Drawing.SizeF($scale, $scale))) }
} catch { }
try {
  Show-Page 0
  [void]$form.ShowDialog()
} catch {
  # Sihirbazda beklenmeyen bir hata olursa (ve kurulum sürmüyorsa) komut penceresinden kurulum açılır
  if (-not $script:Running -and $script:Page -lt 3) { Start-ConsoleInstall }
}
try { Remove-Item $script:LogFile, "$($script:LogFile).hata" -Force -ErrorAction SilentlyContinue } catch { }
