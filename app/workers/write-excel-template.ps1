param(
  [Parameter(Mandatory=$true)][string]$Template,
  [Parameter(Mandatory=$true)][string]$Plan,
  [Parameter(Mandatory=$true)][string]$Output
)
$ErrorActionPreference = 'Stop'
$excel = $null
$book = $null
$excelProcess = $null
try {
  $payload = Get-Content -LiteralPath $Plan -Raw -Encoding UTF8 | ConvertFrom-Json
  $officeCache = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'Microsoft\Windows\INetCache\Content.MSO'
  [void][IO.Directory]::CreateDirectory($officeCache)
  $excelPath = 'C:\Program Files\Microsoft Office\Root\Office16\EXCEL.EXE'
  if (!(Test-Path -LiteralPath $excelPath)) { throw 'Microsoft Excel desktop app was not found.' }
  $excelProcess = Start-Process -FilePath $excelPath -ArgumentList '/automation','/safe' -WindowStyle Hidden -PassThru
  Start-Sleep -Seconds 3
  $excel = [Runtime.InteropServices.Marshal]::GetActiveObject('Excel.Application')
  $excel.Visible = $false
  $excel.DisplayAlerts = $false
  $book = $excel.Workbooks.Open($Template, 0, $false)
  $sheet = $null
  foreach ($candidate in $book.Worksheets) { if ($candidate.Name -eq $payload.preset.targetWorksheet) { $sheet = $candidate; break } }
  if ($null -eq $sheet) { throw "Target worksheet does not exist: $($payload.preset.targetWorksheet)" }
  $fields = @($payload.preset.outputFields)
  if ($fields.Count -eq 0) { throw 'No output fields configured.' }
  $starts = foreach ($field in $fields) { if ($field.startCell -match '^([A-Za-z]+)([1-9][0-9]*)$') { [int]$Matches[2] } else { throw "Invalid Excel start cell: $($field.startCell)" } }
  $templateRow = ($starts | Measure-Object -Minimum).Minimum
  for ($i = 0; $i -lt $payload.preview.rows.Count; $i++) {
    if ($i -gt 0) {
      $sourceRow = $sheet.Rows.Item($templateRow)
      $targetRow = $sheet.Rows.Item($templateRow + $i)
      $sourceRow.Copy($targetRow)
      $targetRow.RowHeight = $sourceRow.RowHeight
    }
    foreach ($field in $fields) {
      $field.startCell -match '^([A-Za-z]+)([1-9][0-9]*)$' | Out-Null
      $column = $Matches[1].ToUpperInvariant()
      $sourceRowNumber = [int]$Matches[2]
      $targetAddress = "$column$($sourceRowNumber + $i)"
      $value = $payload.preview.rows[$i].cells.$targetAddress
      if ($i -gt 0 -and $sourceRowNumber -ne $templateRow) {
        $sheet.Range("$column$sourceRowNumber").Copy($sheet.Range($targetAddress))
      }
      $targetCell = $sheet.Range($targetAddress)
      $targetCell.Value2 = [string]$value
      if ([string]$payload.preview.rows[$i].kind -eq 'drawing') {
        $targetCell.Font.Name = 'Verdana'
        $targetCell.Font.Size = 15
      }
      [void][Runtime.InteropServices.Marshal]::ReleaseComObject($targetCell)
    }
  }
  $xlsxFormat = 51
  $book.SaveAs($Output, $xlsxFormat)
  $book.Close($false)
  $book = $null
} finally {
  if ($null -ne $book) { $book.Close($false) }
  if ($null -ne $excel) { $excel.Quit() }
  if ($null -ne $excelProcess -and !$excelProcess.HasExited) { Stop-Process -Id $excelProcess.Id -Force -ErrorAction SilentlyContinue }
  if ($null -ne $sheet) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($sheet) }
  if ($null -ne $book) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($book) }
  if ($null -ne $excel) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($excel) }
  [GC]::Collect(); [GC]::WaitForPendingFinalizers()
}
