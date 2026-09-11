$Port = "COM44"
$p = New-Object System.IO.Ports.SerialPort $Port, 6500000, None, 8, One
$p.ReadTimeout = 1000
$p.WriteTimeout = 500
$p.Open()
Start-Sleep -Milliseconds 100
$p.DiscardInBuffer()

function Send-Cmd($cmd) {
  $p.Write($cmd + "`r`n")
  Start-Sleep -Milliseconds 250
  $n = $p.BytesToRead
  if ($n -le 0) { return "" }
  $buf = New-Object byte[] $n
  [void]$p.Read($buf, 0, $n)
  return [Text.Encoding]::ASCII.GetString($buf) -replace '[^\x20-\x7E\r\n]', ''
}

# 先关遥测再问 CLI
Write-Host "--- log 0 ---"
Write-Host (Send-Cmd "log 0")
Write-Host "--- version ---"
Write-Host (Send-Cmd "version")
Write-Host "--- status ---"
Write-Host (Send-Cmd "status")

# 开遥测采 300ms
Write-Host "--- log 1 sample ---"
$p.DiscardInBuffer()
$p.Write("log 1`r`n")
Start-Sleep -Milliseconds 350
$n = $p.BytesToRead
$buf = New-Object byte[] $n
if ($n -gt 0) { [void]$p.Read($buf, 0, $n) }
$tails = 0
for ($i = 0; $i -lt $n - 3; $i++) {
  if ($buf[$i] -eq 0x00 -and $buf[$i+1] -eq 0x00 -and $buf[$i+2] -eq 0x80 -and $buf[$i+3] -eq 0x7f) { $tails++ }
}
Write-Host "bytes=$n tails=$tails frames≈$([math]::Round($n/68,1))"
$p.Write("log 0`r`n")
Start-Sleep -Milliseconds 50
$p.Close()
Write-Host "done"
