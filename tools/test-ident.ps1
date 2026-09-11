# ident show + ident rs (static Rs/Ls) on COM44
$Port = "COM44"
$p = New-Object System.IO.Ports.SerialPort $Port, 6500000, None, 8, One
$p.ReadTimeout = 8000
$p.WriteTimeout = 800
try { $p.Open() } catch { Write-Host SKIP; exit 2 }

function Cmd([string]$c, [int]$w = 400) {
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

function SnapState {
  $t = Cmd "status" 350
  if ($t -match "M0 ([A-Z]+)") { return $Matches[1] }
  return ""
}

Write-Host "=== ident ==="
Cmd "log 0" | Out-Null
Cmd "disable" | Out-Null
Cmd "fault clear" | Out-Null

$t = Cmd "ident show" 500
Write-Host "--- ident show ---"
Write-Host $t

Write-Host "--- ident rs (static) ---"
$t = Cmd "ident rs" 400
Write-Host $t
for ($i = 0; $i -lt 40; $i++) {
  Start-Sleep -Milliseconds 400
  $st = SnapState
  Write-Host "  poll $i state=$st"
  if ($st -eq "IDLE" -and $i -gt 3) { break }
  if ($st -eq "FAULT") { break }
}

$t = Cmd "ident show" 500
Write-Host "--- after ident ---"
Write-Host $t

$ok = $t -match "ident result" -and $t -match "valid="
Cmd "disable" | Out-Null
$p.Close()

if ($ok) { Write-Host "RESULT: PASS"; exit 0 }
Write-Host "RESULT: FAIL"
exit 1
