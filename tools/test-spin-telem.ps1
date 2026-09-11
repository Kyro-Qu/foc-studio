# While spinning: JustFloat stream + CLI mix
$Port = "COM44"
$p = New-Object System.IO.Ports.SerialPort $Port, 6500000, None, 8, One
$p.ReadTimeout = 3000
$p.WriteTimeout = 500
try { $p.Open() } catch { Write-Host SKIP; exit 2 }

function Cmd([string]$c, [int]$w = 300) {
  $n = $p.BytesToRead
  if ($n -gt 0) { $b = New-Object byte[] $n; [void]$p.Read($b, 0, $n) }
  $p.Write($c + "`r`n")
  Start-Sleep -Milliseconds $w
  $n = $p.BytesToRead
  if ($n -le 0) { return "" }
  $b = New-Object byte[] $n
  [void]$p.Read($b, 0, $n)
  return [Text.Encoding]::ASCII.GetString($b) -replace "[^\x20-\x7E\r\n]", ""
}

Write-Host "=== spin + JustFloat ==="
Cmd "log 0" | Out-Null
Cmd "disable" | Out-Null
Cmd "fault clear" | Out-Null
Cmd "mode vf" | Out-Null
Cmd "vq 0.65" | Out-Null
Cmd "rpm 0" | Out-Null
Cmd "enable" | Out-Null
Cmd "rpm 200" | Out-Null
Start-Sleep -Milliseconds 800

# enable telem while spinning
Cmd "log 1" 100 | Out-Null
Start-Sleep -Milliseconds 400
$n = $p.BytesToRead
$buf = New-Object byte[] $n
if ($n -gt 0) { [void]$p.Read($buf, 0, $n) }
$tails = 0
for ($i = 0; $i -lt $n - 3; $i++) {
  if ($buf[$i] -eq 0 -and $buf[$i+1] -eq 0 -and $buf[$i+2] -eq 0x80 -and $buf[$i+3] -eq 0x7f) { $tails++ }
}
Write-Host "JustFloat while spinning: bytes=$n tails=$tails"
$telemOk = $tails -ge 20

# CLI during telem
$p.DiscardInBuffer()
$p.Write("status`r`n")
Start-Sleep -Milliseconds 350
$n = $p.BytesToRead
$buf = New-Object byte[] $n
if ($n -gt 0) { [void]$p.Read($buf, 0, $n) }
$ascii = [Text.Encoding]::ASCII.GetString($buf)
$cliOk = $ascii.Contains("M0") -or $ascii.Contains("vbus") -or $ascii.Contains("vel=")
Write-Host "CLI during telem: $cliOk"

Cmd "log 0" | Out-Null
Cmd "rpm 0" | Out-Null
Cmd "disable" | Out-Null
$p.Close()

if ($telemOk -and $cliOk) { Write-Host "RESULT: PASS"; exit 0 }
else { Write-Host "RESULT: FAIL telem=$telemOk cli=$cliOk"; exit 1 }
