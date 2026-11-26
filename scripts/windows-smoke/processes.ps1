# Logs every process that starts, with its parent and command line (sign-in codes cut off).
param([string]$Out)
$seen = @{}
$first = $true
while ($true) {
  foreach ($p in Get-CimInstance Win32_Process) {
    $key = "$($p.ProcessId)/$($p.CreationDate)"
    if ($seen.ContainsKey($key)) { continue }
    $seen[$key] = $true
    if ($first) { continue }
    $cmd = [string]$p.CommandLine -replace '(https?://[^\s"?#]+)[?#][^\s"]*', '$1?…'
    if ($cmd.Length -gt 400) { $cmd = $cmd.Substring(0, 400) }
    "{0:HH:mm:ss.fff}`t{1}`t{2}`tparent={3}`t{4}" -f (Get-Date), $p.Name, $p.ProcessId, $p.ParentProcessId, $cmd | Add-Content -Path $Out -Encoding utf8
  }
  $first = $false
  Start-Sleep -Milliseconds 400
}
