# Full motor suite v3 COM44 — calib first, conservative gains
$Port = "COM44"
$Baud = 6500000
$script:pass = 0
$script:fail = 0

$p = New-Object System.IO.Ports.SerialPort $Port, $Baud, None, 8, One
$p.ReadTimeout = 5000
$p.WriteTimeout = 800
try { $p.Open() } catch { Write-Host "SKIP port busy"; exit 2 }

function Cmd([string]$c, [int]$w = 300) {
  $n = $p.BytesToRead
  if ($n -gt 0) {
    $b = New-Object byte[] $n
    [void]$p.Read($b, 0, $n)
  }
  $p.Write($c + "`r`n")
  Start-Sleep -Milliseconds $w
  $n = $p.BytesToRead
  if ($n -le 0) { return "" }
  $b = New-Object byte[] $n
  [void]$p.Read($b, 0, $n)
  return [Text.Encoding]::ASCII.GetString($b) -replace "[^\x20-\x7E\r\n]", ""
}

function Snap {
  $t = Cmd "status" 450
  $vel = $null
  $iq = $null
  $state = ""
  $fault = ""
  if ($t -match "vel=(-?[0-9]+[.]?[0-9]*)rpm") { $vel = [double]$Matches[1] }
  if ($t -match "iq=(-?[0-9]+[.]?[0-9]*)A") { $iq = [double]$Matches[1] }
  if ($t -match "M0 ([A-Z]+)") { $state = $Matches[1] }
  if ($t -match "fault=([0-9]+)") { $fault = $Matches[1] }
  return @{ vel = $vel; iq = $iq; state = $state; fault = $fault }
}

function SafeOff {
  Cmd "target 0" 150 | Out-Null
  Cmd "rpm 0" 150 | Out-Null
  Cmd "disable" 350 | Out-Null
  Cmd "fault clear" 250 | Out-Null
}

function Ok([string]$n, [bool]$c, [string]$info) {
  if ($c) {
    $script:pass++
    Write-Host "PASS  $n  $info"
  } else {
    $script:fail++
    Write-Host "FAIL  $n  $info"
  }
}

Write-Host "=== FULL MOTOR SUITE v3 ==="
Cmd "log 0" | Out-Null
SafeOff

# 0) Full calib first (fault=6 NOT_CALIBRATED blocked closed-loop)
Write-Host "-- calib full --"
Cmd "calib full" 250 | Out-Null
$final = $null
for ($i = 0; $i -lt 60; $i++) {
  Start-Sleep -Milliseconds 400
  $s = Snap
  $final = $s
  if ($s.state -eq "IDLE" -and $i -ge 8) { break }
  if ($s.state -eq "FAULT") { break }
}
Ok "CALIB" ($final.state -eq "IDLE" -and $final.fault -eq 0) "st=$($final.state) f=$($final.fault)"
$st = Cmd "status" 400
Ok "calib=1" ($st -match "calib=1") ""
SafeOff

# 1) VF
Write-Host "-- vf --"
Cmd "mode vf" | Out-Null
Cmd "vf slope 0.0008" | Out-Null
Cmd "vq 0.65" | Out-Null
Cmd "rpm 0" | Out-Null
Cmd "enable" | Out-Null
Cmd "rpm 180" | Out-Null
Start-Sleep -Milliseconds 1600
$s = Snap
Ok "VF 180rpm" ($s.vel -ne $null -and [Math]::Abs($s.vel - 180) -lt 50) "vel=$($s.vel) f=$($s.fault)"
SafeOff

# 2) Velocity — gentle gains
Write-Host "-- vel --"
Cmd "mode vel" | Out-Null
Cmd "vel kp 0.02" | Out-Null
Cmd "vel ki 0.02" | Out-Null
Cmd "target 0" | Out-Null
Cmd "enable" | Out-Null
Cmd "target 150" | Out-Null
Start-Sleep -Milliseconds 2500
$s = Snap
Ok "VEL 150rpm" ($s.vel -ne $null -and $s.vel -gt 50 -and $s.vel -lt 350 -and $s.fault -eq "0") "vel=$($s.vel) f=$($s.fault) st=$($s.state)"
SafeOff

# 3) IQ small
Write-Host "-- iq --"
Cmd "mode iq" | Out-Null
Cmd "target 0" | Out-Null
Cmd "enable" | Out-Null
Cmd "target 0.2" | Out-Null
Start-Sleep -Milliseconds 1000
$s = Snap
Ok "IQ" ($s.fault -eq "0" -and $s.iq -ne $null -and [Math]::Abs($s.iq) -lt 1.0 -and [Math]::Abs($s.iq) -gt 0.05) "iq=$($s.iq) f=$($s.fault)"
SafeOff

# 4) Position
Write-Host "-- pos --"
Cmd "mode pos" | Out-Null
Cmd "target 0" | Out-Null
Cmd "enable" | Out-Null
Cmd "target 0.5" | Out-Null
Start-Sleep -Milliseconds 1000
$s = Snap
Ok "POS" ($s.fault -eq "0" -and $s.state -ne "FAULT") "st=$($s.state) f=$($s.fault)"
SafeOff

$p.Close()
Write-Host ""
Write-Host "RESULT pass=$script:pass fail=$script:fail"
if ($script:fail -gt 0) { exit 1 }
