param([string]$Port = "COM44")

function Test-Baud {
  param([int]$Baud, [string]$Cmd, [int]$WaitMs = 400)
  $p = $null
  try {
    $p = New-Object System.IO.Ports.SerialPort $Port, $Baud, None, 8, One
    $p.ReadTimeout = 500
    $p.WriteTimeout = 300
    $p.Open()
    Start-Sleep -Milliseconds 50
    $p.DiscardInBuffer()
    $p.Write($Cmd)
    Start-Sleep -Milliseconds $WaitMs
    $n = $p.BytesToRead
    $buf = @()
    if ($n -gt 0) {
      $buf = New-Object byte[] $n
      [void]$p.Read($buf, 0, $n)
    }
    return @{ ok = $true; n = $n; bytes = $buf }
  } catch {
    return @{ ok = $false; err = $_.Exception.Message }
  } finally {
    if ($p -and $p.IsOpen) { $p.Close() }
  }
}

Write-Host "=== Port $Port ==="
foreach ($baud in @(6500000, 2000000, 921600, 115200)) {
  $r = Test-Baud -Baud $baud -Cmd "version`r`n" -WaitMs 400
  if (-not $r.ok) { Write-Host "OPEN FAIL ${baud}: $($r.err)"; continue }
  $txt = ""
  if ($r.n -gt 0) {
    $txt = [Text.Encoding]::ASCII.GetString($r.bytes) -replace '[^\x20-\x7E\r\n]', '.'
  }
  Write-Host ("{0,-10} version bytes={1} {2}" -f $baud, $r.n, $txt)
}

# help at 6.5M
$r = Test-Baud -Baud 6500000 -Cmd "help`r`n" -WaitMs 500
Write-Host "help@6.5M n=$($r.n)"
if ($r.n -gt 0) {
  Write-Host ([Text.Encoding]::ASCII.GetString($r.bytes) -replace '[^\x20-\x7E\r\n]', '.')
}

# enable telemetry then sample
$p = $null
try {
  $p = New-Object System.IO.Ports.SerialPort $Port, 6500000, None, 8, One
  $p.ReadTimeout = 800
  $p.Open()
  $p.DiscardInBuffer()
  $p.Write("log 1`r`n")
  Start-Sleep -Milliseconds 200
  $p.Write("log`r`n")
  Start-Sleep -Milliseconds 400
  $n = $p.BytesToRead
  $buf = New-Object byte[] ([Math]::Min($n, 2000))
  if ($n -gt 0) { [void]$p.Read($buf, 0, $buf.Length) }
  $tailCount = 0
  for ($i = 0; $i -lt $buf.Length - 3; $i++) {
    if ($buf[$i] -eq 0 -and $buf[$i+1] -eq 0 -and $buf[$i+2] -eq 0x80 -and $buf[$i+3] -eq 0x7f) {
      $tailCount++
    }
  }
  Write-Host "log1 sample n=$n justfloat-tails≈$tailCount (expect n/68)"
  $p.Write("log 0`r`n")
  Start-Sleep -Milliseconds 100
} catch {
  Write-Host "log test fail: $($_.Exception.Message)"
} finally {
  if ($p -and $p.IsOpen) { $p.Close() }
}
