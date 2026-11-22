# HomeDeck agent guncelleyici (Windows). Hub'dan agent dosyalarinin son halini ceker, degisenleri yerine koyar, agent'i yeniden baslatir.
# GUNCELLE.bat ile cift tiklanarak calistirilir. Hub adresi ve token C:\HomeDeckAgent\agent.config.json'dan okunur (yeniden girmen gerekmez).
# Yeni surum acilmazsa (log'da "hub baglantisi tamam" gorunmezse) eski dosyalar otomatik geri yuklenir.
$ErrorActionPreference = "Stop"
$dir = "C:\HomeDeckAgent"
$task = "HomeDeckAgent"
$cfg = Get-Content "$dir\agent.config.json" -Raw | ConvertFrom-Json
$hub = $cfg.hub.TrimEnd('/')
$hdr = @{ Authorization = "Bearer $($cfg.token)" }

Write-Host "Hub'a soruluyor: $hub"
$m = Invoke-RestMethod -Uri "$hub/api/agent/manifest" -Headers $hdr -TimeoutSec 15
$order = @("agent.js", "quota-readers.mjs", "claude-usage.mjs", "extra-metrics.mjs", "update-windows.ps1", "GUNCELLE.bat")
$changed = @()
foreach ($n in $order) {
  $want = $m.files.$n
  if (-not $want) { continue }
  $path = Join-Path $dir $n
  $have = ""
  if (Test-Path $path) { $have = (Get-FileHash $path -Algorithm SHA256).Hash.ToLower() }
  if ($have -eq $want.sha256) { continue }
  Write-Host "  indiriliyor: $n"
  Invoke-WebRequest -Uri "$hub/api/agent/file/$n" -Headers $hdr -OutFile "$path.new" -UseBasicParsing -TimeoutSec 60
  $got = (Get-FileHash "$path.new" -Algorithm SHA256).Hash.ToLower()
  if ($got -ne $want.sha256) { Remove-Item "$path.new" -Force; throw "Dogrulama basarisiz: $n (indirilen dosya bozuk)" }
  $changed += $n
}
if ($changed.Count -eq 0) { Write-Host "Zaten guncel."; exit 0 }

Write-Host "Agent durduruluyor..."
Stop-ScheduledTask -TaskName $task -ErrorAction SilentlyContinue
Start-Sleep -Seconds 3
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like "*HomeDeckAgent*agent.js*" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

foreach ($n in $changed) {
  $path = Join-Path $dir $n
  if (Test-Path $path) { Copy-Item $path "$path.prev" -Force }
  Move-Item "$path.new" $path -Force
}
Write-Host ("Guncellendi: " + ($changed -join ", "))

$log = "$dir\agent.log"
$mark = 0
if (Test-Path $log) { $mark = (Get-Item $log).Length }
Start-ScheduledTask -TaskName $task
Write-Host "Agent baslatiliyor, kontrol ediliyor (25 sn)..."
$ok = $false
for ($i = 0; $i -lt 12; $i++) {
  Start-Sleep -Seconds 2
  if (Test-Path $log) {
    $fs = [System.IO.File]::Open($log, 'Open', 'Read', 'ReadWrite')
    try { $null = $fs.Seek($mark, 'Begin'); $txt = (New-Object System.IO.StreamReader($fs)).ReadToEnd() } finally { $fs.Close() }
    if ($txt -match "hub baglantisi tamam") { $ok = $true; break }
  }
}
if ($ok) { Write-Host "TAMAM: agent yeni surumle calisiyor ve hub'a baglandi."; exit 0 }

Write-Host "UYARI: yeni surum hub'a baglanamadi, ESKI dosyalar geri yukleniyor..."
Stop-ScheduledTask -TaskName $task -ErrorAction SilentlyContinue
Start-Sleep -Seconds 3
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like "*HomeDeckAgent*agent.js*" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
foreach ($n in $changed) {
  $path = Join-Path $dir $n
  if (Test-Path "$path.prev") { Copy-Item "$path.prev" $path -Force }
}
Start-ScheduledTask -TaskName $task
Write-Host "Eski surum geri yuklendi. Log: $log"
exit 1
