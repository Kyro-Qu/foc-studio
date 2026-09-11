# VEL loop only — with ramp, low target
$Port = "COM44"
$p = New-Object System.IO.Ports.SerialPort $Port, 6500000, None, 8, One
$p.ReadTimeout = 4000
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

Cmd "log 0" | Out-Null
Cmd "disable" 300 | Out-Null
Cmd "fault clear" 200 | Out-Null
Cmd "mode vel" | Out-Null
Cmd "vel ramp 400" | Out-Null
Cmd "vel kp 0.01" | Out-Null
Cmd "vel ki 0.05" | Out-Null
Cmd "target 0" | Out-Null
Cmd "enable" | Out-Null
Cmd "target 100" | Out-Null
foreach ($i in 1..8) {
  Start-Sleep -Milliseconds 400
  $t = Cmd "status" 350
  $m = [regex]::Match($t, "vel=(-?[0-9]+[.]?[0-9]*)rpm")
  $v = if ($m.Success) { $m.Groups[1].Value } else { "?" }
  Write-Host "t=$i vel=$v"
}
Cmd "target 0" | Out-Null
Start-Sleep -Milliseconds 400
Cmd "disable" | Out-Null
$p.Close()
