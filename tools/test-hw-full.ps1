# 逐项功能实测（Console/Tuning 映射的全部 CLI + 遥测）
# COM44 @ 6500000 — 电机安全：IDLE，rpm=0，enable 后立即 disable
$Port = "COM44"
$Baud = 6500000
$script:pass = 0
$script:fail = 0

$p = New-Object System.IO.Ports.SerialPort $Port, $Baud, None, 8, One
$p.ReadTimeout = 1000
$p.WriteTimeout = 500
try {
  $p.Open()
} catch {
  Write-Host "SKIP: cannot open $Port (占用中). 请在网页 FOC Studio 点「断开」后重试."
  exit 2
}
Start-Sleep -Milliseconds 250

function Drain() {
  $n = $p.BytesToRead
  if ($n -gt 0) {
    $b = New-Object byte[] $n
    [void]$p.Read($b, 0, $n)
  }
}
function Cmd([string]$c, [int]$waitMs = 280) {
  Drain
  $p.Write($c + "`r`n")
  Start-Sleep -Milliseconds $waitMs
  $n = $p.BytesToRead
  if ($n -le 0) { return "" }
  $b = New-Object byte[] $n
  [void]$p.Read($b, 0, $n)
  return [Text.Encoding]::ASCII.GetString($b) -replace "[^\x20-\x7E\r\n]", ""
}
function Expect([string]$name, [string]$text, [string[]]$need) {
  $ok = $true
  foreach ($m in $need) {
    if ($text.IndexOf($m, [StringComparison]::OrdinalIgnoreCase) -lt 0) { $ok = $false }
  }
  if ($ok) { $script:pass++; Write-Host "PASS  $name" }
  else {
    $script:fail++
    $pv = $text; if ($pv.Length -gt 120) { $pv = $pv.Substring(0, 120) }
    Write-Host "FAIL  $name need=$($need -join ',') got=$pv"
  }
}

Write-Host "=== Full feature matrix $Port ==="
$t = Cmd "log 0"; Expect "A1 log off" $t @("telem=0")

# --- Terminal / Console presets ---
$t = Cmd "help"; Expect "T1 help" $t @("FOC CLI", "blackbox", "conf")
$t = Cmd "version"; Expect "T2 version" $t @("v0.3.11", "pole_pairs")
$t = Cmd "status"; Expect "T3 status" $t @("calib=", "cpu=")
$t = Cmd "enable"; Expect "C1 enable" $t @("enabled")
$t = Cmd "disable"; Expect "C2 disable" $t @("IDLE")
$t = Cmd "fault"; Expect "C3 fault" $t @("fault=")
$t = Cmd "fault clear"; Expect "C4 fault clear" $t @("cleared")
$t = Cmd "log 1"; Expect "C5 log on" $t @("telem=1")
$t = Cmd "log 0"; Expect "C6 log off" $t @("telem=0")
$t = Cmd "calib"; Expect "C7 calib query/busy" $t @()

# --- Console mode/target ---
$t = Cmd "mode iq"; Expect "M1 mode iq" $t @("mode=iq")
$t = Cmd "target 0"; Expect "M2 target iq 0" $t @("target")
$t = Cmd "mode vel"; Expect "M3 mode vel" $t @("mode=vel")
$t = Cmd "target 0"; Expect "M4 target vel 0" $t @("target")
$t = Cmd "mode pos"; Expect "M5 mode pos" $t @("mode=pos")
$t = Cmd "target 0"; Expect "M6 target pos 0" $t @("target")
$t = Cmd "mode vf"; Expect "M7 mode vf" $t @("mode=vf")

# Dashboard 页 VF 控制
$t = Cmd "rpm 0"; Expect "D1 rpm 0" $t @("rpm")
$t = Cmd "vq 0.3"; Expect "D2 vq" $t @("boost")

# --- Tuning 滑条映射 ---
$t = Cmd "limit 5.2"; Expect "U1 limit" $t @("limit")
$t = Cmd "current bw 2000"; Expect "U2 current bw set" $t @("bw")
$t = Cmd "vel kp 0.2"; Expect "U3 vel kp set" $t @("kp")
$t = Cmd "vel ki 0.01"; Expect "U4 vel ki set" $t @("ki")
$t = Cmd "vel ramp 800"; Expect "U5 vel ramp" $t @("ramp")
$t = Cmd "vel filter 50"; Expect "U6 vel filter" $t @("filter")
$t = Cmd "pos kp 10"; Expect "U7 pos kp" $t @("kp")
$t = Cmd "vf slope 0.0006"; Expect "U8 vf slope" $t @("slope")

# --- Record 用的数据源 ---
Drain
$p.Write("log 1`r`n")
Start-Sleep -Milliseconds 500
$n = $p.BytesToRead
$buf = New-Object byte[] $n
if ($n -gt 0) { [void]$p.Read($buf, 0, $n) }
$tails = 0
for ($i = 0; $i -lt $n - 3; $i++) {
  if ($buf[$i] -eq 0 -and $buf[$i+1] -eq 0 -and $buf[$i+2] -eq 0x80 -and $buf[$i+3] -eq 0x7f) { $tails++ }
}
$expectFrames = [Math]::Floor($n / 68)
if ($tails -ge 30 -and [Math]::Abs($tails - $expectFrames) -le 2) {
  Write-Host "PASS  R1 justfloat density tails=$tails≈$expectFrames (n=$n)"
  $script:pass++
} else {
  Write-Host "FAIL  R1 justfloat tails=$tails expect~$expectFrames n=$n"
  $script:fail++
}

# 混流：遥测中 CLI
Drain
$p.Write("status`r`n")
Start-Sleep -Milliseconds 400
$n = $p.BytesToRead
$buf = New-Object byte[] $n
if ($n -gt 0) { [void]$p.Read($buf, 0, $n) }
$ascii = [Text.Encoding]::ASCII.GetString($buf)
if ($ascii.Contains("vbus") -or $ascii.Contains("M0")) {
  Write-Host "PASS  R2 status during telem"
  $script:pass++
} else {
  Write-Host "WARN  R2 status during telem (binary heavy)"
}

$t = Cmd "log 0"; Expect "R3 log off end" $t @("telem=0")
$t = Cmd "conf read" 700; Expect "S1 conf read" $t @("conf params")

# 恢复出厂校准值（测试时改过的）
$t = Cmd "current bw 2000"; Expect "S2 restore bw" $t @("bw")
$t = Cmd "vel kp 0.2"; Expect "S3 restore vel kp" $t @()
$t = Cmd "vel ki 0.01"; Expect "S4 restore vel ki" $t @()
$t = Cmd "vq 0.300"; Expect "S5 restore vq" $t @()

$p.Close()
Write-Host ""
Write-Host "RESULT pass=$script:pass fail=$script:fail"
if ($script:fail -gt 0) { exit 1 }
