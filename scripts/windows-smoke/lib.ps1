Add-Type -AssemblyName System.Windows.Forms, System.Drawing

function Save-Screen([string]$path) {
  try {
    $b = [System.Windows.Forms.SystemInformation]::VirtualScreen
    $bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size)
    $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose(); $bmp.Dispose()
  } catch { Write-Host "screen capture failed: $_" }
}

# a process and everything it started
function Get-Tree([int]$root) {
  $all = Get-CimInstance Win32_Process
  $ids = @($root)
  do {
    $more = @($all | Where-Object { $ids -contains $_.ParentProcessId -and $ids -notcontains $_.ProcessId } | ForEach-Object { $_.ProcessId })
    $ids += $more
  } while ($more.Count)
  $all | Where-Object { $ids -contains $_.ProcessId }
}

function Stop-Tree([int]$root) { Get-Tree $root | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue } }
