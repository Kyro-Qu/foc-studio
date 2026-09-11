$ports = [System.IO.Ports.SerialPort]::GetPortNames()
Write-Host "PORTS: $($ports -join ', ')"
foreach ($baud in @(6500000, 2000000, 921600, 115200)) {
  foreach ($name in $ports) {
    $p = $null
    try {
      $p = New-Object System.IO.Ports.SerialPort $name, $baud, None, 8, One
      $p.ReadTimeout = 400
      $p.WriteTimeout = 300
      $p.Open()
      $p.DiscardInBuffer()
      $p.Write("version`r`n")
      Start-Sleep -Milliseconds 350
      $n = $p.BytesToRead
      if ($n -gt 0) {
        $buf = New-Object byte[] ([Math]::Min($n, 400))
        [void]$p.Read($buf, 0, $buf.Length)
        $txt = [Text.Encoding]::ASCII.GetString($buf) -replace '[^\x20-\x7E\r\n]', '.'
        Write-Host "HIT $name @${baud} n=$n"
        Write-Host $txt
      }
    } catch {
      # ignore
    } finally {
      if ($p -and $p.IsOpen) { $p.Close() }
    }
  }
}
Write-Host "probe-done"
