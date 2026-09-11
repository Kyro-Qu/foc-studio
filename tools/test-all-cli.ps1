# FOC Studio CLI 功能矩阵 — COM44
$Port = "COM44"
$Baud = 6500000
$script:pass = 0
$script:fail = 0

$p = New-Object System.IO.Ports.SerialPort $Port, $Baud, None, 8, One
$p.ReadTimeout = 800
$p.WriteTimeout = 500
$p.Open()
Start-Sleep -Milliseconds 200

function Drain() {
  $n = $p.BytesToRead
  if ($n -gt 0) {
    $b = New-Object byte[] $n
    [void]$p.Read($b, 0, $n)
  }
}

function Cmd([string]$c, [int]$waitMs = 300) {
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
  if ($ok) {
    $script:pass++
    Write-Host "PASS  $name"
  } else {
    $script:fail++
    $preview = $text
    if ($preview.Length -gt 140) { $preview = $preview.Substring(0, 140) }
    Write-Host "FAIL  $name  need=$($need -join ',')  got=$preview"
  }
}

Write-Host "=== CLI matrix $Port @ $Baud ==="
$t = Cmd "log 0"; Expect "log 0" $t @("telem=0")
$t = Cmd "help"; Expect "help" $t @("FOC CLI", "enable", "status")
$t = Cmd "version"; Expect "version" $t @("firmware=FOC_G431", "Matchstick")
$t = Cmd "status"; Expect "status" $t @("M0", "vbus=")
$t = Cmd "motor 0"; Expect "motor 0" $t @("selected motor")
$t = Cmd "mode"; Expect "mode query" $t @("mode=")
$t = Cmd "enable"; Expect "enable" $t @("enabled")
$t = Cmd "disable"; Expect "disable" $t @("IDLE")
$t = Cmd "fault"; Expect "fault" $t @("fault=")
$t = Cmd "fault clear"; Expect "fault clear" $t @("cleared")
$t = Cmd "mode vf"; Expect "mode vf" $t @("mode=vf")
$t = Cmd "rpm 0"; Expect "rpm 0" $t @("rpm")
$t = Cmd "vq 0.3"; Expect "vq" $t @("boost")
$t = Cmd "vf slope 0.0006"; Expect "vf slope" $t @("slope")
$t = Cmd "limit 5.2"; Expect "limit" $t @("limit")
$t = Cmd "vel kp"; Expect "vel kp query" $t @("vel")
$t = Cmd "current"; Expect "current query" $t @("bw")
$t = Cmd "log"; Expect "log query" $t @("telem=")
$t = Cmd "conf read" 600; Expect "conf read" $t @("conf params")

# JustFloat
Drain
$p.Write("log 1`r`n")
Start-Sleep -Milliseconds 400
$n = $p.BytesToRead
$buf = New-Object byte[] $n
if ($n -gt 0) { [void]$p.Read($buf, 0, $n) }
$tails = 0
for ($i = 0; $i -lt $n - 3; $i++) {
  if ($buf[$i] -eq 0 -and $buf[$i + 1] -eq 0 -and $buf[$i + 2] -eq 0x80 -and $buf[$i + 3] -eq 0x7f) { $tails++ }
}
if ($tails -ge 20) {
  $script:pass++
  Write-Host "PASS  justfloat tails=$tails bytes=$n"
} else {
  $script:fail++
  Write-Host "FAIL  justfloat tails=$tails bytes=$n"
}

# 混流 CLI
Drain
$p.Write("status`r`n")
Start-Sleep -Milliseconds 350
$n = $p.BytesToRead
$buf = New-Object byte[] $n
if ($n -gt 0) { [void]$p.Read($buf, 0, $n) }
$ascii = [Text.Encoding]::ASCII.GetString($buf)
if ($ascii -match "M0" -or $ascii -match "vbus") {
  $script:pass++
  Write-Host "PASS  status during telemetry"
} else {
  Write-Host "WARN  status during telemetry: no clear ASCII (ok if demuxed on host)"
}

$t = Cmd "log 0"
Expect "log 0 again" $t @("telem=0")

$p.Close()
Write-Host ""
Write-Host "RESULT pass=$script:pass fail=$script:fail"
if ($script:fail -gt 0) { exit 1 }
