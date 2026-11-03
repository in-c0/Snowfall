<#
  Snowfall job runner. Start once (double-click RUN_SNOWFALL_RUNNER.bat); it then polls Saved\Verify\queue for job files
  written by the build agent and runs Tools\verify.ps1 for each. Only verify.ps1 is ever executed.
  Job file (JSON): { "tag": "r1", "stages": "build,content,shots", "levels": "L_Park", "contentStages": "materials,import,levels", "shotDelay": 6, "noScript": true }
  Close the window to stop.
#>
$Root = Split-Path -Parent $PSScriptRoot
$Q = Join-Path $Root "Saved\Verify\queue"
$Done = Join-Path $Root "Saved\Verify\done"
New-Item -ItemType Directory -Force -Path $Q, $Done | Out-Null
$Host.UI.RawUI.WindowTitle = "Snowfall runner"
Write-Host "Snowfall runner watching $Q  (close this window to stop)"
while ($true) {
  (Get-Date).ToString("s") | Set-Content (Join-Path $Root "Saved\Verify\runner_alive.txt")
  $jobs = Get-ChildItem $Q -Filter *.json -ErrorAction SilentlyContinue | Sort-Object Name
  foreach ($j in $jobs) {
    try { $job = Get-Content $j.FullName -Raw | ConvertFrom-Json } catch { Move-Item $j.FullName (Join-Path $Done ($j.Name + ".bad")) -Force; continue }
    $running = Join-Path $Root "Saved\Verify\running.json"
    Move-Item $j.FullName $running -Force
    $tag = if ($job.tag) { $job.tag } else { (Get-Date -Format "yyyyMMdd-HHmmss") }
    $a = @("-ExecutionPolicy", "Bypass", "-File", (Join-Path $PSScriptRoot "verify.ps1"), "-Tag", $tag)
    if ($job.stages) { $a += @("-Stages", $job.stages) }
    if ($job.levels) { $a += @("-Levels", $job.levels) }
    if ($job.contentStages) { $a += @("-ContentStages", $job.contentStages) }
    if ($job.shotDelay) { $a += @("-ShotDelay", [string]$job.shotDelay) }
    if ($job.noScript) { $a += "-NoScript" }
    if ($job.walk) { $a += @("-Walk", $job.walk) }
    if ($job.playSpeed) { $a += @("-PlaySpeed", [string]$job.playSpeed) }
    if ($job.playChoice -ne $null) { $a += @("-PlayChoice", [string]$job.playChoice) }
    Write-Host ((Get-Date).ToString("T") + "  job $tag : " + ($a -join " "))
    & powershell.exe @a *>&1 | Tee-Object -FilePath (Join-Path $Root "Saved\Verify\runner_$tag.log")
    Move-Item $running (Join-Path $Done "$tag.json") -Force
    Write-Host ((Get-Date).ToString("T") + "  job $tag finished")
  }
  Start-Sleep -Seconds 5
}
