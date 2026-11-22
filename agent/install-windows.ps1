# Windows 10/11: agent'i C:\HomeDeckAgent altina kurar, oturum acilinca gizli baslayan bir gorev olusturur.
# Normal (yonetici olmayan) PowerShell'de calisir.
# Kullanim:
#   powershell -ExecutionPolicy Bypass -File .\install-windows.ps1 -Hub http://HUB_IP:8787 -Token TOKEN -HostId desktop -Label "Desktop"
param(
  [Parameter(Mandatory = $true)][string]$Hub,
  [Parameter(Mandatory = $true)][string]$Token,
  [string]$HostId = "desktop",
  [string]$Label = "Desktop"
)
$ErrorActionPreference = "Stop"

$node = (Get-Command node -ErrorAction SilentlyContinue)
if (-not $node) {
  Write-Host "Node bulunamadi. Once kur:  winget install OpenJS.NodeJS.LTS   (sonra yeni bir PowerShell ac)"
  exit 1
}

$dir = "C:\HomeDeckAgent"
New-Item -ItemType Directory -Force -Path $dir | Out-Null
Copy-Item "$PSScriptRoot\agent.js" "$dir\agent.js" -Force
Copy-Item "$PSScriptRoot\quota-readers.mjs" "$dir\quota-readers.mjs" -Force
Copy-Item "$PSScriptRoot\claude-usage.mjs" "$dir\claude-usage.mjs" -Force
Copy-Item "$PSScriptRoot\extra-metrics.mjs" "$dir\extra-metrics.mjs" -Force
Copy-Item "$PSScriptRoot\update-windows.ps1" "$dir\update-windows.ps1" -Force
Copy-Item "$PSScriptRoot\GUNCELLE.bat" "$dir\GUNCELLE.bat" -Force

# Eski surum gunlugu PowerShell'in "*>>" yonlendirmesiyle UTF-16 yazilmisti; agent artik kendi gunlugunu (UTF-8) tutuyor, karismasin diye eskiyi ayir.
if (Test-Path "$dir\agent.log") { Move-Item "$dir\agent.log" "$dir\agent.log.old" -Force }

# logFile: agent kendi gunlugunu bu dosyaya yazar (gizli/pencere-siz calisirken ciktiyi gormenin tek yolu).
$cfg = @{ hub = $Hub; token = $Token; host = $HostId; label = $Label; logFile = "$dir\agent.log" } | ConvertTo-Json
# BOM'SUZ UTF-8 yaz: Windows PowerShell 5.1'de "Set-Content -Encoding UTF8" dosyanin basina BOM koyar ve JSON okuyucular bozulur.
[System.IO.File]::WriteAllText("$dir\agent.config.json", $cfg, (New-Object System.Text.UTF8Encoding $false))

$taskName = "HomeDeckAgent"
$conhost = Join-Path $env:SystemRoot "System32\conhost.exe"
if (Test-Path $conhost) {
  # conhost --headless: konsol penceresi OLUSTURMADAN calistirir. Windows 11'de Windows Terminal varsayilan terminal ise
  # "-WindowStyle Hidden" yine gorunur bir pencere acar ve o pencere kapaninca agent Ctrl+C ile (0xC000013A) olur.
  $action = New-ScheduledTaskAction -Execute $conhost -Argument "--headless `"$($node.Source)`" `"$dir\agent.js`""
} else {
  $action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-WindowStyle Hidden -NoProfile -Command `"& '$($node.Source)' '$dir\agent.js'`""
}
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RestartCount 99 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero)
# Calisan eski surum varsa once durdur (yoksa dosyalar yenilense de eski surec bellekte kalir), eski gorevi kaldir, yenisini -Force ile kaydet
Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
Start-ScheduledTask -TaskName $taskName

Write-Host "Kuruldu ve basladi. Log: $dir\agent.log"
Write-Host "Kaldirmak icin: Unregister-ScheduledTask -TaskName HomeDeckAgent -Confirm:`$false; Remove-Item -Recurse $dir"
