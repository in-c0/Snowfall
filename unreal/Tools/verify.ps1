<#
  Snowfall — automated build verification.
  Usage (PowerShell, from anywhere):
    powershell -ExecutionPolicy Bypass -File <project>\Tools\verify.ps1 [-Stages build,content,shots] [-Levels L_Park,L_Field] [-Tag run1] [-Engine "E:\Epic Games\UE_5.8"]
  Writes everything to <project>\Saved\Verify\<tag>\ : build.log, content.log, shots.log, summary.json, and screenshots under Saved\AutoShots\<tag>\.
  Finishes by writing VERIFY_DONE.txt so a watcher can tell it has ended.
#>
param(
  [string]$Engine = "E:\Epic Games\UE_5.8",
  [string]$Stages = "build,content,shots",
  [string]$Levels = "",
  [string]$Tag = (Get-Date -Format "yyyyMMdd-HHmm"),
  [int]$ShotDelay = 6,
  [int]$ContentTimeoutMin = 240,
  [int]$ShotTimeoutMin = 40,
  [switch]$NoScript,
  [string]$ContentStages = "fetch,materials,import,levels",
  [double]$PlaySpeed = 2.0,
  [int]$PlayChoice = 0
)
$ErrorActionPreference = "Continue"
$Root = Split-Path -Parent $PSScriptRoot
$Proj = Join-Path $Root "Snowfall.uproject"
$Out = Join-Path $Root "Saved\Verify\$Tag"
New-Item -ItemType Directory -Force -Path $Out | Out-Null
Remove-Item (Join-Path $Out "VERIFY_DONE.txt") -ErrorAction SilentlyContinue
$Editor = Join-Path $Engine "Engine\Binaries\Win64\UnrealEditor.exe"
$EditorCmd = Join-Path $Engine "Engine\Binaries\Win64\UnrealEditor-Cmd.exe"
$BuildBat = Join-Path $Engine "Engine\Build\BatchFiles\Build.bat"
$summary = [ordered]@{ tag = $Tag; started = (Get-Date).ToString("s"); engine = $Engine; stages = @{} }

function Save-Summary { $summary.updated = (Get-Date).ToString("s"); $summary | ConvertTo-Json -Depth 6 | Set-Content -Encoding UTF8 (Join-Path $Out "summary.json") }
function Log-Errors($file, $max = 60) {
  if (-not (Test-Path $file)) { return @() }
  return @(Select-String -Path $file -Pattern "error C\d+|error LNK|: error|Error:|Fatal error|Assertion failed|Unhandled Exception|\[SF\].*(failed|missing|crashed)" -CaseSensitive:$false |
    Where-Object { $_.Line -notmatch "UnifiedErrorTest|FError that has been|== fetch done|aqProf|Vtune|WinPix" } |
    Select-Object -First $max | ForEach-Object { $_.Line.Trim() })
}
function Run-Proc($exe, $argList, $log, $timeoutMin) {
  $p = Start-Process -FilePath $exe -ArgumentList $argList -PassThru -WindowStyle Hidden -RedirectStandardOutput $log -RedirectStandardError "$log.err"
  # stay out of the way of whoever is using the PC
  $null = $p.Handle   # makes ExitCode available after WaitForExit
  try { $p.PriorityClass = [System.Diagnostics.ProcessPriorityClass]::BelowNormal } catch {}
  if (-not $p.WaitForExit($timeoutMin * 60 * 1000)) { try { $p.Kill() } catch {}; return @{ code = -999; timeout = $true } }
  return @{ code = $p.ExitCode; timeout = $false }
}

if (-not (Test-Path $Editor)) { $summary.fatal = "UnrealEditor.exe not found at $Editor"; Save-Summary; "done" | Set-Content (Join-Path $Out "VERIFY_DONE.txt"); exit 1 }
$st = $Stages.Split(",") | ForEach-Object { $_.Trim() }

# ---------------------------------------------------------------- 1. C++ build
if ($st -contains "build") {
  $t = Get-Date
  $log = Join-Path $Out "build.log"
  $r = Run-Proc $BuildBat @("SnowfallEditor", "Win64", "Development", "-Project=`"$Proj`"", "-WaitMutex", "-FromMsBuild", "-NoUBA", "-NoXGE", "-Log=`"$Out\ubt.log`"") $log 60
  $summary.stages.build = @{ exit = $r.code; timeout = $r.timeout; seconds = [int]((Get-Date) - $t).TotalSeconds; errors = (Log-Errors $log) }
  Save-Summary
  if ($r.code -ne 0) { "done" | Set-Content (Join-Path $Out "VERIFY_DONE.txt"); exit 2 }
}

# ---------------------------------------------------------------- 2. content build (editor Python)
if ($st -contains "content") {
  $t = Get-Date
  $log = Join-Path $Out "content.log"
  $py = Join-Path $Root "Content\Python\sf_build_all.py"
  if ($Levels) { $env:SF_LEVELS = $Levels } else { Remove-Item Env:SF_LEVELS -ErrorAction SilentlyContinue }
  $env:SF_STAGES = $ContentStages
  $r = Run-Proc $Editor @("`"$Proj`"", "-ExecutePythonScript=`"$py`"", "-unattended", "-nosplash", "-nopause", "-RenderOffscreen", "-stdout", "-FullStdOutLogOutput", "-log=SFContent.log") $log $ContentTimeoutMin
  $report = Join-Path $Root "Saved\ContentBuild\report.json"
  $rep = $null; if (Test-Path $report) { $rep = Get-Content $report -Raw | ConvertFrom-Json }
  $summary.stages.content = @{ exit = $r.code; timeout = $r.timeout; seconds = [int]((Get-Date) - $t).TotalSeconds;
    done = [bool](Select-String -Path $log -Pattern "SF_BUILD_DONE" -Quiet);
    report_errors = if ($rep) { @($rep.errors | Select-Object -First 40) } else { @("no report.json") };
    report_warnings = if ($rep) { @($rep.warnings).Count } else { 0 };
    log_errors = (Log-Errors $log 80) }
  $maps = @(Get-ChildItem (Join-Path $Root "Content\Maps") -Filter "L_*.umap" -ErrorAction SilentlyContinue | ForEach-Object { $_.BaseName })
  $summary.stages.content.maps = $maps
  Save-Summary
}

# ---------------------------------------------------------------- 3. autoshots (packaged-like -game run per level set)
if ($st -contains "shots") {
  $t = Get-Date
  $log = Join-Path $Out "shots.log"
  $lv = if ($Levels) { $Levels.Replace(",", "+") } else { (@(Get-ChildItem (Join-Path $Root "Content\Maps") -Filter "L_*.umap" | ForEach-Object { $_.BaseName }) -join "+") }
  $first = $lv.Split("+")[0]
  $shotArgs = @("`"$Proj`"", "/Game/Maps/$first", "-game", "-RenderOffscreen", "-ResX=1920", "-ResY=1080", "-autoshot", "-shotlevels=$lv", "-shotdelay=$ShotDelay", "-shottag=$Tag",
            "-nosplash", "-unattended", "-stdout", "-FullStdOutLogOutput", "-log=SFShots.log", "-NoSound")
  if ($NoScript) { $shotArgs += "-noscript" }
  $r = Run-Proc $Editor $shotArgs $log $ShotTimeoutMin
  $shotDir = Join-Path $Root "Saved\AutoShots\$Tag"
  $pngs = @(Get-ChildItem $shotDir -Filter *.png -ErrorAction SilentlyContinue | ForEach-Object { $_.Name })
  $perf = @(Select-String -Path $log -Pattern "AUTOSHOT shot=.*avg=([0-9.]+)ms" -ErrorAction SilentlyContinue | ForEach-Object { $_.Line.Trim() })
  $summary.stages.shots = @{ exit = $r.code; timeout = $r.timeout; seconds = [int]((Get-Date) - $t).TotalSeconds; levels = $lv; shots = $pngs; perf = $perf;
    done = [bool](Select-String -Path $log -Pattern "AUTOSHOT done" -Quiet); log_errors = (Log-Errors $log 60) }
  Save-Summary
}
# ---------------------------------------------------------------- 4. autoplay: the whole story, hands-free
if ($st -contains "play") {
  $t = Get-Date
  $log = Join-Path $Out "play.log"
  $start = if ($Levels) { $Levels.Split(",")[0] } else { "L_Blizzard" }
  $playArgs = @("`"$Proj`"", "/Game/Maps/$start", "-game", "-RenderOffscreen", "-ResX=1280", "-ResY=720", "-autoplay", "-autoplayspeed=$PlaySpeed", "-autochoice=$PlayChoice",
                "-shottag=$Tag", "-nosplash", "-unattended", "-stdout", "-FullStdOutLogOutput", "-log=SFPlay.log", "-NoSound")
  $r = Run-Proc $Editor $playArgs $log 75
  $alog = Join-Path $Root "Saved\AutoShots\$Tag\autoplay.log"
  $summary.stages.play = @{ exit = $r.code; timeout = $r.timeout; seconds = [int]((Get-Date) - $t).TotalSeconds;
    result = @(Select-String -Path $log -Pattern "AUTOPLAY (END|STUCK|TIMEOUT)" -ErrorAction SilentlyContinue | ForEach-Object { $_.Line.Trim() });
    tail = if (Test-Path $alog) { @(Get-Content $alog -Tail 25) } else { @() };
    log_errors = (Log-Errors $log 40) }
  Save-Summary
}
# ---------------------------------------------------------------- 5. package a shipping build
if ($st -contains "package") {
  $t = Get-Date
  $log = Join-Path $Out "package.log"
  $uat = Join-Path $Engine "Engine\Build\BatchFiles\RunUAT.bat"
  $arch = Join-Path $Root "Build"
  $r = Run-Proc $uat @("BuildCookRun", "-project=`"$Proj`"", "-noP4", "-platform=Win64", "-clientconfig=Shipping", "-build", "-cook", "-stage", "-pak", "-iostore",
                       "-archive", "-archivedirectory=`"$arch`"", "-utf8output", "-NoUBA", "-unattended") $log 180
  $exe = @(Get-ChildItem $arch -Recurse -Filter "Snowfall*.exe" -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName })
  $size = if (Test-Path $arch) { [math]::Round(((Get-ChildItem $arch -Recurse | Measure-Object -Property Length -Sum).Sum / 1GB), 2) } else { 0 }
  $summary.stages.package = @{ exit = $r.code; timeout = $r.timeout; seconds = [int]((Get-Date) - $t).TotalSeconds; exe = $exe; size_gb = $size; log_errors = (Log-Errors $log 40) }
  Save-Summary
}
$summary.finished = (Get-Date).ToString("s")
Save-Summary
"done" | Set-Content (Join-Path $Out "VERIFY_DONE.txt")
