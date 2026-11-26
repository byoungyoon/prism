# Starts the installed app twice (first run, then again): time to a visible window, what the screen
# shows, and memory / CPU of Prism and everything it starts while left alone.
param([string]$Exe, [string]$Out, [int]$IdleSeconds = 300)
. "$PSScriptRoot\lib.ps1"
$cores = [Environment]::ProcessorCount
$os = Get-CimInstance Win32_OperatingSystem
"cores=$cores ramGB=$([math]::Round($os.TotalVisibleMemorySize/1MB,1)) os=$($os.Caption) screen=$([System.Windows.Forms.SystemInformation]::VirtualScreen)"

foreach ($run in 1, 2) {
  $sw = [Diagnostics.Stopwatch]::StartNew()
  $p = Start-Process $Exe -PassThru
  $shown = $null
  while ($sw.Elapsed.TotalSeconds -lt 60) {
    $p.Refresh()
    if ($p.HasExited) { "run$run app EXITED code=$($p.ExitCode) after $($sw.Elapsed.TotalSeconds)s"; break }
    if ($p.MainWindowHandle -ne 0) { $shown = $sw.Elapsed.TotalSeconds; break }
    Start-Sleep -Milliseconds 20
  }
  "run$run process started {0:HH:mm:ss.fff} (window time: first 'Tauri Window' line in windows.tsv)" -f $p.StartTime
  # the window is plain white until the web page paints: watch one pixel of the app's background
  $pixel = New-Object System.Drawing.Bitmap 1, 1
  $g = [System.Drawing.Graphics]::FromImage($pixel)
  $inside = $false
  while ($sw.Elapsed.TotalSeconds -lt 30) {
    $g.CopyFromScreen(60, 200, 0, 0, $pixel.Size)
    $c = $pixel.GetPixel(0, 0)
    if ($c.R -eq 255 -and $c.G -eq 255 -and $c.B -eq 255) { $inside = $true }
    elseif ($inside) { "run$run first screen painted after {0:N2}s" -f ((Get-Date) - $p.StartTime).TotalSeconds; break }
    Start-Sleep -Milliseconds 50
  }
  $g.Dispose(); $pixel.Dispose()
  foreach ($at in 1, 2, 3, 5, 8, 15) {
    while ($sw.Elapsed.TotalSeconds -lt $at) { Start-Sleep -Milliseconds 50 }
    Save-Screen "$Out\run$run-t$at.png"
  }
  if ($run -eq 2) { Stop-Tree $p.Id; break }

  "sec`tprocs`tworkingSetMB`tprivateWorkingSetMB`tcpuPctOfOneCore`tcpuPctOfMachine"
  $last = @{}
  $lastAt = $sw.Elapsed.TotalSeconds
  $rows = @()
  while ($sw.Elapsed.TotalSeconds -lt $IdleSeconds + 15) {
    Start-Sleep -Seconds 10
    $tree = @(Get-Tree $p.Id)
    $private = @{}
    Get-CimInstance Win32_PerfRawData_PerfProc_Process | ForEach-Object { $private[[int]$_.IDProcess] = $_.WorkingSetPrivate }
    $now = $sw.Elapsed.TotalSeconds
    $cpu = 0.0; $ws = 0.0; $pws = 0.0; $detail = @()
    foreach ($c in $tree) {
      $g = Get-Process -Id $c.ProcessId -ErrorAction SilentlyContinue
      if (-not $g) { continue }
      $t = $g.TotalProcessorTime.TotalSeconds
      $d = 0.0
      if ($last.ContainsKey($g.Id)) { $d = $t - $last[$g.Id] } elseif ($rows.Count) { $d = $t }
      $last[$g.Id] = $t
      $cpu += $d; $ws += $g.WorkingSet64; $pws += $private[$g.Id]
      $type = if ([string]$c.CommandLine -match '--type=([\w-]+)') { $Matches[1] } else { '' }
      $detail += "    {0} {1} pid={2} ws={3:N0}MB private={4:N0}MB cpu={5:N2}s" -f $c.Name, $type, $g.Id, ($g.WorkingSet64/1MB), ($private[$g.Id]/1MB), $d
    }
    $one = 100 * $cpu / ($now - $lastAt); $lastAt = $now
    $row = [pscustomobject]@{ sec = [int]$now; procs = $tree.Count; ws = $ws/1MB; pws = $pws/1MB; one = $one }
    $rows += $row
    "{0}`t{1}`t{2:N0}`t{3:N0}`t{4:N1}`t{5:N1}" -f $row.sec, $row.procs, $row.ws, $row.pws, $row.one, ($one / $cores)
    if ($rows.Count -in 1, 6, 18 -or $sw.Elapsed.TotalSeconds -ge $IdleSeconds + 15) { $detail }
    if ($rows.Count % 6 -eq 0) { Save-Screen "$Out\idle-$([int]$now)s.png" }
  }
  # the first minute includes startup work and the update check at 20 s
  $calm = @($rows | Where-Object { $_.sec -gt 60 })
  "SUMMARY after the first minute: workingSet avg {0:N0}MB max {1:N0}MB / privateWorkingSet avg {2:N0}MB max {3:N0}MB / cpu avg {4:N1}% max {5:N1}% of one core" -f `
    ($calm.ws | Measure-Object -Average).Average, ($calm.ws | Measure-Object -Maximum).Maximum, ($calm.pws | Measure-Object -Average).Average, ($calm.pws | Measure-Object -Maximum).Maximum, `
    ($calm.one | Measure-Object -Average).Average, ($calm.one | Measure-Object -Maximum).Maximum
  Stop-Tree $p.Id
  Start-Sleep -Seconds 5
}
