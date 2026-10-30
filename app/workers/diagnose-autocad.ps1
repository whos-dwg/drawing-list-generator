$ErrorActionPreference = 'SilentlyContinue'
$out = Join-Path (Get-Location) 'autocad-diagnostic.txt'
$lines = @('Drawing List AutoCAD diagnostic', ('Time: ' + (Get-Date)), '')
$lines += 'Core Console files found:'
foreach ($root in @('C:\Program Files','C:\Program Files (x86)','D:\')) {
  if (Test-Path -LiteralPath $root) {
    Get-ChildItem -LiteralPath $root -Filter 'accoreconsole.exe' -File -Recurse -ErrorAction SilentlyContinue |
      ForEach-Object { $lines += $_.FullName }
  }
}
$lines += ''; $lines += 'Autodesk uninstall entries:'
foreach ($keyRoot in @('HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*','HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*')) {
  Get-ItemProperty -Path $keyRoot -ErrorAction SilentlyContinue |
    Where-Object { $_.DisplayName -match 'AutoCAD' } |
    ForEach-Object { $lines += ("{0} | {1}" -f $_.DisplayName, $_.InstallLocation) }
}
$lines += ''; $lines += 'Result: send this file to the administrator.'
[System.IO.File]::WriteAllLines($out, $lines, [System.Text.Encoding]::UTF8)
Start-Process notepad.exe -ArgumentList @($out)
