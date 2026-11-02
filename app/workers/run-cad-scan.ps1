param(
  [string]$Dwg,
  [string]$Output,
  [string]$DiagnosticLog,
  [string]$ScanId,
  [string]$ApplicationVersion,
  [string]$ScanConfig,
  [switch]$DetectOnly
)
$ErrorActionPreference = 'Stop'

function Get-AutoCadInstallations {
  $roots = @('C:\Program Files\Autodesk','C:\Program Files\Autodesk\AutoCAD 2026','C:\Program Files\Autodesk\AutoCAD 2021','C:\Program Files\Autodesk\AutoCAD 2018')
  $found = @(foreach ($base in $roots) {
    if (Test-Path -LiteralPath $base) {
      Get-ChildItem -LiteralPath $base -Directory -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -match '^AutoCAD\s+(2018|2021|2026)' } |
        ForEach-Object {
          $console = Join-Path $_.FullName 'accoreconsole.exe'
          if (Test-Path -LiteralPath $console) {
            [pscustomobject]@{ version=[int]$Matches[1]; path=$console }
          }
      }
    }
  })
  # Some deployments use a localized/product-specific install folder. Consult
  # Autodesk uninstall keys and locate accoreconsole.exe from InstallLocation.
  $uninstallRoots = @('HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*','HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*')
  foreach ($keyRoot in $uninstallRoots) {
    $found += @(Get-ItemProperty -Path $keyRoot -ErrorAction SilentlyContinue |
      Where-Object { $_.DisplayName -match 'AutoCAD' -and $_.DisplayName -match '(2018|2021|2026)' -and $_.InstallLocation } |
      ForEach-Object {
        $m = [regex]::Match($_.DisplayName, '(2018|2021|2026)')
        $console = Join-Path $_.InstallLocation 'accoreconsole.exe'
        if ($m.Success -and (Test-Path -LiteralPath $console)) {
          [pscustomobject]@{ version=[int]$m.Groups[1].Value; path=$console }
        }
      })
  }
  # Last-resort fallback for unusual/custom Autodesk paths. Limit the search
  # to Autodesk program folders and derive the supported year from the path.
  foreach ($searchRoot in @('C:\Program Files\Autodesk','C:\Program Files (x86)\Autodesk')) {
    if (Test-Path -LiteralPath $searchRoot) {
      $found += @(Get-ChildItem -LiteralPath $searchRoot -Filter 'accoreconsole.exe' -File -Recurse -ErrorAction SilentlyContinue |
        ForEach-Object {
          $m = [regex]::Match($_.FullName, '(?<!\d)(2018|2021|2026)(?!\d)')
          if ($m.Success) { [pscustomobject]@{ version=[int]$m.Groups[1].Value; path=$_.FullName } }
        })
    }
  }
  @($found | Sort-Object version,path -Descending -Unique)
}

$app = Split-Path -Parent $PSScriptRoot
$installations = @(Get-AutoCadInstallations | ForEach-Object {
  $scanner = Join-Path $app ("cad\" + $_.version + "\DrawingList.CadPlugin.dll")
  [pscustomobject]@{ version=$_.version; path=$_.path; scannerAvailable=(Test-Path -LiteralPath $scanner) }
})
$usableInstallations = @($installations | Where-Object scannerAvailable)
if ($DetectOnly) {
  [pscustomobject]@{
    available = $usableInstallations.Count -gt 0
    selectedVersion = if ($usableInstallations.Count) { $usableInstallations[0].version } else { $null }
    installations = $installations
    compatibilityNote = 'Supported targets are AutoCAD 2018, 2021, and 2026. A version-specific scanner must be packaged for the installed version.'
  } | ConvertTo-Json -Depth 4 -Compress
  exit 0
}
if (!$Dwg -or !$Output) { throw 'Dwg and Output are required.' }
$blockNames=@('A1_TITLE_EN');$numberTag='DWG_NUMBER'
if($ScanConfig){
  $config=Get-Content -LiteralPath $ScanConfig -Raw -Encoding UTF8|ConvertFrom-Json
  $blockNames=@($config.blockNames)
  $numberTag=[string]$config.attributeMap.DWG_NUMBER
  if(!$blockNames.Count -or [string]::IsNullOrWhiteSpace($numberTag)){throw 'Block names and a drawing-number attribute are required.'}
}
if ([string]::IsNullOrWhiteSpace($ScanId)) { $ScanId=(Get-Date -Format 'yyyyMMdd-HHmmss')+'-'+[guid]::NewGuid().ToString('N').Substring(0,4).ToUpperInvariant() }
if ([string]::IsNullOrWhiteSpace($DiagnosticLog)) {
  $diagnosticRoot=Join-Path (Split-Path -Parent $app) 'logs\cad-diagnostics';New-Item -ItemType Directory -Force -Path $diagnosticRoot|Out-Null
  $DiagnosticLog=Join-Path $diagnosticRoot ("scan_{0}_{1}.log" -f $ScanId,([IO.Path]::GetFileNameWithoutExtension($Dwg)-replace '[^A-Za-z0-9._-]','-'))
}
function Write-Diagnostic([string]$area,[string]$stage,[string]$detail=''){$line=(Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ')+" [$ScanId] [$area] $stage"+$(if($detail){" | $detail"});Add-Content -LiteralPath $DiagnosticLog -Value $line -Encoding UTF8}
$detected=($installations|ForEach-Object {$_.version}) -join ','
Write-Diagnostic 'SCAN' 'START' ("applicationVersion={0} windows={1} inputFile={2} inputFullPath={3} fileSize={4} detectedAutoCADVersions={5}" -f $ApplicationVersion,[Environment]::OSVersion.VersionString,[IO.Path]::GetFileName($Dwg),[IO.Path]::GetFullPath($Dwg),(Get-Item -LiteralPath $Dwg).Length,$detected)
if (!$usableInstallations.Count) { Write-Diagnostic 'SCAN RESULT' 'FAILED' 'stage=AUTOCAD_DETECTION selectedAutoCAD=none';throw 'No usable AutoCAD 2018, 2021, or 2026 scanner was found. Ask an administrator to install the matching scanner package.' }

$failures = @()
foreach ($installation in $usableInstallations) {
  if($installation.version -ne 2021 -and (($blockNames -join ',') -ne 'A1_TITLE_EN' -or $numberTag -ne 'DWG_NUMBER')){
    $failures += "AutoCAD $($installation.version): configurable blocks require the validated AutoCAD 2021 scanner"
    continue
  }
  $plugin = Join-Path $app ("cad\" + $installation.version + "\DrawingList.CadPlugin.dll")
  if (!(Test-Path -LiteralPath $plugin)) {
    $failures += "AutoCAD $($installation.version): version-specific scanner is not installed"
    continue
  }
  $tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("drawing-list-cad-" + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $tempRoot | Out-Null
  Write-Diagnostic 'SCAN' 'AUTOCAD_START_BEGIN' ("selectedVersion={0} executable={1} temporaryWorkingPath={2}" -f $installation.version,$installation.path,$tempRoot)
  try {
    $loadPlugin = Join-Path $tempRoot 'DrawingList.CadPlugin.dll'
    Copy-Item -LiteralPath $plugin -Destination $loadPlugin
    $script = Join-Path $tempRoot 'scan.scr'
    $stdoutFile = Join-Path $tempRoot 'accoreconsole.stdout.log'
    $stderrFile = Join-Path $tempRoot 'accoreconsole.stderr.log'
    # AutoCAD used to receive the user's DWG through /i, which meant missing
    # fonts and unresolved xrefs could interrupt startup before our scanner had
    # a chance to run. The 2021 scanner now starts in a neutral session and
    # opens the DWG as a side database, so it never activates layouts or xrefs.
    $sideDatabaseScan = $installation.version -eq 2021
    $quietCommands = @(
      '_.FILEDIA','0',
      '_.CMDDIA','0',
      '_.ATTDIA','0',
      '_.ATTREQ','0',
      '_.PROXYNOTICE','0',
      '_.XREFNOTIFY','0',
      '_.EXPERT','5',
      '_.FONTALT','simplex.shx'
    )
    $scanCommand = if($sideDatabaseScan){'DLSCANFILE'}else{'DLSCAN'}
    $commands = @($quietCommands + @('_.NETLOAD',('"' + $loadPlugin.Replace('\','/') + '"'),$scanCommand,'_.QUIT','Y')) -join "`n"
    [System.IO.File]::WriteAllText($script, $commands + "`n", [System.Text.Encoding]::ASCII)
    $env:DRAWING_LIST_OUTPUT = $Output
    $env:DRAWING_LIST_DWG = $Dwg
    $env:DRAWING_LIST_BLOCK_NAMES = $blockNames -join "`n"
    $env:DRAWING_LIST_NUMBER_TAG = $numberTag
    $env:DRAWING_LIST_DIAGNOSTIC_LOG = $DiagnosticLog
    $env:DRAWING_LIST_SCAN_ID = $ScanId
    $processArguments = if($sideDatabaseScan){('/s "{0}" /l en-US' -f $script.Replace('"','\"'))}else{('/i "{0}" /s "{1}" /l en-US' -f $Dwg.Replace('"','\"'), $script.Replace('"','\"'))}
    $displayInvocation = ('"{0}" {1}' -f $installation.path, $processArguments)
    $workingDirectory=Split-Path -Parent $installation.path
    Write-Diagnostic 'AUTOCAD PROCESS' 'INVOCATION' ("executable={0} invocation={1} serializedArguments={2} workingDirectory={3}" -f $installation.path,$displayInvocation,$processArguments,$workingDirectory)
    Write-Diagnostic 'SCAN' 'DWG_OPEN_BEGIN' $Dwg
    $startedAt=Get-Date
    $process = Start-Process -FilePath $installation.path -ArgumentList $processArguments -WorkingDirectory $workingDirectory -WindowStyle Hidden -PassThru -RedirectStandardOutput $stdoutFile -RedirectStandardError $stderrFile
    Write-Diagnostic 'SCAN' 'AUTOCAD_STARTED' ("pid={0} started={1:o}" -f $process.Id,$startedAt)
    $completed=$process.WaitForExit(600000)
    if(!$completed){
      Write-Diagnostic 'AUTOCAD PROCESS' 'TIMEOUT' ("pid={0} timeoutSec=600" -f $process.Id)
      & taskkill.exe /PID $process.Id /T /F 2>$null | Out-Null
      throw 'AutoCAD scanner exceeded the 10-minute safety timeout.'
    }
    $process.Refresh();$endedAt=Get-Date;$duration=[math]::Round(($endedAt-$startedAt).TotalSeconds,3)
    $rawExitCode=$process.ExitCode
    [string]$stdoutText = if (Test-Path -LiteralPath $stdoutFile) { Get-Content -LiteralPath $stdoutFile -Raw -Encoding Unicode -ErrorAction SilentlyContinue | Out-String } else { '' }
    [string]$stderrText = if (Test-Path -LiteralPath $stderrFile) { Get-Content -LiteralPath $stderrFile -Raw -Encoding Unicode -ErrorAction SilentlyContinue | Out-String } else { '' }
    [string]$nativeOutput = $stdoutText + $stderrText
    $exitCodeSource='process';$exitCode=$rawExitCode
    if($null -eq $exitCode -or [string]::IsNullOrWhiteSpace([string]$exitCode)){
      $exitCodeSource='stdout-fallback'
      if($nativeOutput -match 'ErrorStatus\s*=\s*(\d+)'){$exitCode=[int]$Matches[1]}elseif($nativeOutput -match 'DLSCAN_(?:OK|ERROR)'){$exitCode=0}else{$exitCode=-1}
    }
    Write-Diagnostic 'AUTOCAD PROCESS' 'PROCESS_RESULT' ("pid={0} started={1:o} ended={2:o} durationSec={3} exitCode={4} exitCodeSource={5}" -f $process.Id,$startedAt,$endedAt,$duration,$exitCode,$exitCodeSource)
    Add-Content -LiteralPath $DiagnosticLog -Value "--- AUTOCAD STDOUT ---`r`n$stdoutText`r`n--- AUTOCAD STDERR ---`r`n$stderrText`r`n--- PROCESS RESULT ---`r`nExitCode: $exitCode`r`nExitCodeSource: $exitCodeSource`r`nDuration: $duration sec" -Encoding UTF8
    $outputExists=Test-Path -LiteralPath $Output;$outputSize=if($outputExists){(Get-Item -LiteralPath $Output).Length}else{0}
    Write-Diagnostic 'OUTPUT' 'CHECK' ("path={0} exists={1} size={2}" -f $Output,$outputExists,$outputSize)
    if ($exitCode -eq 0 -and $outputExists -and $outputSize -gt 0) {
      Write-Diagnostic 'SCAN' 'OUTPUT_WRITTEN' ("path={0} size={1}" -f $Output,$outputSize)
      exit 0
    }
    $detail = ($nativeOutput -replace '\s+', ' ').Trim()
    if ($detail.Length -gt 500) { $detail = $detail.Substring(0,500) }
    Write-Diagnostic 'SCAN RESULT' 'FAILED' ("stage=AUTOCAD_PROCESS exitCode={0} outputExists={1}" -f $exitCode,$outputExists)
    $failures += "AutoCAD $($installation.version): exit $exitCode, no scanner output$(if($detail){": $detail"})"
  } catch {
    Write-Diagnostic 'SCAN RESULT' 'FAILED' ("stage=AUTOCAD_PROCESS exceptionType={0} message={1}" -f $_.Exception.GetType().FullName,($_.Exception.Message-replace '\s+',' '))
    $failures += "AutoCAD $($installation.version): $($_.Exception.Message)"
  } finally {
    Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
  }
}
throw ('Unable to read the DWG with the installed AutoCAD versions. ' + ($failures -join '; '))
