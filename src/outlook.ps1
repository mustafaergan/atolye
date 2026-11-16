# Atölye: bilgisayardaki klasik Outlook'tan YALNIZCA OKUMA. outlook.js tarafından -EncodedCommand ile çalıştırılır.
# İşlem ATOLYE_OL_OP, parametreler ATOLYE_OL_ARGS (JSON) ortam değişkeninden gelir; sonuç JSON olarak yazılır.
# Hiçbir e-postayı göndermez, taşımaz, silmez ve "okundu" işaretini değiştirmez.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue' # ilerleme bildirimleri hata çıktısına karışmasın
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false

function Emit($o) { [Console]::Out.Write(($o | ConvertTo-Json -Depth 6 -Compress)); exit 0 }
function Fail($code, $text) { [Console]::Error.Write("$code`: $text"); exit 3 }
function Fmt($d) { try { if ($d -and $d.Year -gt 1900 -and $d.Year -lt 4000) { return $d.ToString('yyyy-MM-dd HH:mm') } } catch { } return '' }
function Cut($s, $n) { $t = [string]$s; if ($t.Length -gt $n) { return $t.Substring(0, $n) } return $t }
function Num($v, $def, $max) { $x = 0; if ([int]::TryParse([string]$v, [ref]$x) -and $x -gt 0) { return [Math]::Min($x, $max) } return $def }
function Q($s) { return ([string]$s).Replace("'", "''") }

$op = $env:ATOLYE_OL_OP
$a = if ($env:ATOLYE_OL_ARGS) { $env:ATOLYE_OL_ARGS | ConvertFrom-Json } else { New-Object psobject }

try { $ol = New-Object -ComObject Outlook.Application } catch { Fail 'NO_OUTLOOK' $_.Exception.Message }
try { $ns = $ol.GetNamespace('MAPI') } catch { Fail 'NO_MAPI' $_.Exception.Message }

$inbox = $ns.GetDefaultFolder(6)
$root = $inbox.Parent

# Klasör: boşsa Gelen Kutusu; "gönderilmiş/sent" Gönderilmiş Öğeler; değilse ada ya da yola (Gelen Kutusu/jira) göre aranır
function Find-Folder($name) {
  $n = ([string]$name).Trim()
  if (-not $n) { return $inbox }
  if ($n -match '^(g[öo]nderil|sent)') { return $ns.GetDefaultFolder(5) }
  if ($n -match '^(gelen|inbox)$') { return $inbox }
  $parts = $n -split '[\\/]' | Where-Object { $_ }
  if ($parts.Count -gt 1) {
    $f = $root
    foreach ($p in $parts) {
      $next = $null
      foreach ($c in $f.Folders) { if ($c.Name -ieq $p) { $next = $c; break } }
      if (-not $next) { $f = $null; break }
      $f = $next
    }
    if ($f) { return $f }
  }
  $queue = New-Object System.Collections.Queue
  $queue.Enqueue(@($root, 0))
  $seen = 0
  while ($queue.Count -gt 0 -and $seen -lt 2000) {
    $pair = $queue.Dequeue(); $f = $pair[0]; $depth = $pair[1]
    foreach ($c in $f.Folders) {
      $seen++
      if ($c.Name -ieq $parts[-1]) { return $c }
      if ($depth -lt 4) { $queue.Enqueue(@($c, ($depth + 1))) }
    }
  }
  Fail 'NO_FOLDER' $n
}

function Folder-Path($f) {
  $names = @()
  $cur = $f
  while ($cur -and $cur.EntryID -ne $root.EntryID) { $names = ,$cur.Name + $names; try { $cur = $cur.Parent } catch { break } }
  return ($names -join '/')
}

switch ($op) {
  'whoami' {
    Emit @{ user = [string]$ns.CurrentUser.Name; mailbox = [string]$root.Name; inbox = $inbox.Items.Count; unread = $inbox.UnReadItemCount }
  }
  'folders' {
    $out = New-Object System.Collections.ArrayList
    $queue = New-Object System.Collections.Queue
    $queue.Enqueue(@($root, 0))
    while ($queue.Count -gt 0 -and $out.Count -lt 300) {
      $pair = $queue.Dequeue(); $f = $pair[0]; $depth = $pair[1]
      foreach ($c in $f.Folders) {
        if ($c.DefaultItemType -ne 0) { continue } # yalnızca e-posta klasörleri
        [void]$out.Add(@{ path = (Folder-Path $c); count = $c.Items.Count; unread = $c.UnReadItemCount })
        if ($depth -lt 3) { $queue.Enqueue(@($c, ($depth + 1))) }
      }
    }
    Emit @{ folders = $out }
  }
  'search' {
    $folder = Find-Folder $a.folder
    $days = Num $a.days 7 365
    $limit = Num $a.limit 20 100
    $since = (Get-Date).AddDays(-$days).ToUniversalTime().ToString('yyyy-MM-dd HH:mm')
    $parts = @("`"urn:schemas:httpmail:datereceived`" >= '$since'")
    $text = ([string]$a.query).Trim()
    if ($text) {
      $t = Q $text
      $parts += "(`"urn:schemas:httpmail:subject`" LIKE '%$t%' OR `"urn:schemas:httpmail:fromname`" LIKE '%$t%' OR `"urn:schemas:httpmail:textdescription`" LIKE '%$t%')"
    }
    $from = ([string]$a.from).Trim()
    if ($from) { $parts += "`"urn:schemas:httpmail:fromname`" LIKE '%$(Q $from)%'" }
    if ([string]$a.unread -match '^(true|1|evet)$') { $parts += "`"urn:schemas:httpmail:read`" = 0" }
    $items = $folder.Items
    $items.Sort('[ReceivedTime]', $true)
    $found = $items.Restrict('@SQL=' + ($parts -join ' AND '))
    $out = New-Object System.Collections.ArrayList
    $it = $found.GetFirst()
    while ($it -and $out.Count -lt $limit) {
      $received = $null; try { $received = $it.ReceivedTime } catch { }
      $preview = ''; try { $preview = (Cut $it.Body 300) -replace '\s+', ' ' } catch { }
      $sender = ''; try { $sender = [string]$it.SenderName } catch { }
      $att = 0; try { $att = $it.Attachments.Count } catch { }
      [void]$out.Add(@{ id = $it.EntryID; received = (Fmt $received); from = $sender; subject = [string]$it.Subject; unread = [bool]$it.UnRead; attachments = $att; preview = $preview })
      $it = $found.GetNext()
    }
    Emit @{ folder = (Folder-Path $folder); days = $days; total = $found.Count; items = $out }
  }
  'get' {
    $id = ([string]$a.id).Trim()
    if (-not $id) { Fail 'NO_ID' 'id' }
    try { $m = $ns.GetItemFromID($id) } catch { Fail 'NOT_FOUND' $id }
    $atts = @()
    try { foreach ($x in $m.Attachments) { $atts += @{ name = [string]$x.FileName; size = $x.Size } } } catch { }
    $body = ''; try { $body = [string]$m.Body } catch { }
    $received = $null; try { $received = $m.ReceivedTime } catch { }
    $to = ''; $cc = ''; $sender = ''
    try { $to = [string]$m.To } catch { }
    try { $cc = [string]$m.CC } catch { }
    try { $sender = [string]$m.SenderName } catch { }
    Emit @{ subject = [string]$m.Subject; from = $sender; to = $to; cc = $cc; received = (Fmt $received); body = (Cut $body 30000); bodyLength = $body.Length; attachments = $atts }
  }
  'events' {
    $days = Num $a.days 1 60
    $start = (Get-Date).Date
    $fromDate = ([string]$a.start).Trim()
    if ($fromDate) { try { $start = [datetime]::ParseExact($fromDate, 'yyyy-MM-dd', $null) } catch { Fail 'BAD_DATE' $fromDate } }
    $end = $start.AddDays($days)
    $items = $ns.GetDefaultFolder(9).Items
    $items.Sort('[Start]')
    $items.IncludeRecurrences = $true
    # Takvim süzgeci yerel tarih biçimini bekler (Outlook ile aynı bölge ayarı)
    $found = $items.Restrict("[Start] < '" + $end.ToString('g') + "' AND [End] > '" + $start.ToString('g') + "'")
    $out = New-Object System.Collections.ArrayList
    $it = $found.GetFirst()
    while ($it -and $out.Count -lt 100) {
      $org = ''; try { $org = [string]$it.Organizer } catch { }
      [void]$out.Add(@{ start = (Fmt $it.Start); end = (Fmt $it.End); subject = [string]$it.Subject; location = [string]$it.Location; organizer = $org; allDay = [bool]$it.AllDayEvent; status = $it.ResponseStatus })
      $it = $found.GetNext()
    }
    Emit @{ start = $start.ToString('yyyy-MM-dd'); days = $days; items = $out }
  }
  default { Fail 'BAD_OP' $op }
}
