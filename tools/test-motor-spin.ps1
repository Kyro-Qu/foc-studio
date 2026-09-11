# Motor VF spin test COM44
$Port = "COM44"
$Baud = 6500000

$p = New-Object System.IO.Ports.SerialPort $Port, $Baud, None, 8, One
$p.ReadTimeout = 1500
$p.WriteTimeout = 500
try {
  $p.Open()
} catch {
  Write-Host "SKIP: port busy, disconnect web UI first"
  exit 2
}

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

function Get-Vel {
  $t = Cmd "status" 400
  $m = [regex]::Match($t, "vel=(-?[0-9]+[.]?[0-9]*)rpm")
  if ($m.Success) { return [double]$m.Groups[1].Value }
  return $null
}

Write-Host "=== VF open-loop spin ==="
Write-Host (Cmd "log 0")
Write-Host (Cmd "disable")
Write-Host (Cmd "mode vf")
Write-Host (Cmd "vq 0.50")
Write-Host (Cmd "rpm 0")
Write-Host (Cmd "enable")

$last = $null
foreach ($rpm in @(100, 200, 300, 400)) {
  Write-Host (Cmd "rpm $rpm")
  Start-Sleep -Milliseconds 900
  $last = Get-Vel
  Write-Host "cmd=$rpm meas=$last"
}

Write-Host (Cmd "disable")
Write-Host (Cmd "rpm 0")
$p.Close()

if ($last -ne $null -and [Math]::Abs($last) -ge 40) {
  Write-Host "RESULT: PASS vel=$last"
  exit 0
} else {
  Write-Host "RESULT: FAIL vel=$last"
  exit 1
}
