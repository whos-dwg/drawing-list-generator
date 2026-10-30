param(
  [Parameter(Mandatory=$true)][string]$Template,
  [Parameter(Mandatory=$true)][string]$Plan,
  [Parameter(Mandatory=$true)][string]$Output
)
$ErrorActionPreference='Stop'
Copy-Item -LiteralPath $Template -Destination $Output -Force
$payload=Get-Content -LiteralPath $Plan -Raw -Encoding UTF8|ConvertFrom-Json
$connection=New-Object System.Data.OleDb.OleDbConnection("Provider=Microsoft.ACE.OLEDB.12.0;Data Source=$Output;Extended Properties='Excel 8.0;HDR=No';")
$revisionMode=$false
$revisionWrites=@()
$revisionNewRows=@()
$revisionRows=@()
$revisionCategoryRows=@()
$drawingRows=@()
$revisionClearEnd=0
try {
  $connection.Open()
  $tables=$connection.GetOleDbSchemaTable([System.Data.OleDb.OleDbSchemaGuid]::Tables,$null)
  $sheetName=$null
  $requested=$payload.preset.targetWorksheet
  foreach($row in $tables.Rows){$name=[string]$row.TABLE_NAME;if($name -match "^'?(.*)\$'?$" -and $Matches[1] -eq $requested){$sheetName=$Matches[1];break}}
  if(!$sheetName){foreach($row in $tables.Rows){$name=[string]$row.TABLE_NAME;if($name -match "^'?(.*)\$'?$" -and $name -notmatch 'Print_Area|Print_Titles'){$sheetName=$Matches[1];break}}}
  if(!$sheetName){throw 'Excel template contains no writable worksheet.'}
  $fields=@($payload.preset.outputFields)
  $numberField=$fields|Where-Object {$_.name -match 'Drawing Number'}|Select-Object -First 1
  $titleField=$fields|Where-Object {$_.name -match 'Drawing Title'}|Select-Object -First 1
  $sizeField=$fields|Where-Object {$_.name -eq 'Size'}|Select-Object -First 1
  $batchField=$fields|Where-Object {$_.name -match 'Current Batch'}|Select-Object -First 1
  if($numberField.startCell -match '^([A-Z]+)([1-9][0-9]*)$'){$numberColumn=$Matches[1];$startRow=[int]$Matches[2]}
  $readCommand=$connection.CreateCommand();$readCommand.CommandText="SELECT * FROM [$sheetName`$$numberColumn$startRow`:Z2000]"
  $adapter=New-Object System.Data.OleDb.OleDbDataAdapter($readCommand);$data=New-Object System.Data.DataTable;[void]$adapter.Fill($data);$adapter.Dispose();$readCommand.Dispose()
  $existing=@{};$existingRecords=@{};$lastUsedRow=$startRow-1;$lastDrawingRow=$startRow-1;$blankRun=0
  for($i=0;$i -lt $data.Rows.Count;$i++){
    $absoluteRow=$startRow+$i;$hasValue=$false
    for($columnIndex=0;$columnIndex -lt $data.Columns.Count;$columnIndex++){if([string]$data.Rows[$i][$columnIndex] -ne ''){$hasValue=$true;break}}
    if($hasValue){$lastUsedRow=$absoluteRow}
    $hasListValue=([string]$data.Rows[$i][0] -ne '') -or ([string]$data.Rows[$i][1] -ne '') -or ([string]$data.Rows[$i][2] -ne '')
    if($hasListValue){$blankRun=0}else{$blankRun++}
    if($existing.Count -gt 0 -and $blankRun -ge 5){break}
    $number=[string]$data.Rows[$i][0]
    $trimmedNumber=$number.Trim()
    # Ignore headers such as "Dwg No.". Revision mode is enabled only when the
    # template contains values shaped like real drawing numbers.
    if($trimmedNumber -match '^(?=.*[0-9])[A-Za-z0-9.]+(?:-[A-Za-z0-9.]+)+$'){$key=$trimmedNumber.ToUpperInvariant();if(!$existing.ContainsKey($key)){$existing[$key]=$absoluteRow;$history=@{};for($h=3;$h -le 11;$h++){if([string]$data.Rows[$i][$h] -ne ''){$history[$h]=[string]$data.Rows[$i][$h]}};$existingRecords[$key]=[pscustomobject]@{number=$trimmedNumber;title=[string]$data.Rows[$i][1];size=[string]$data.Rows[$i][2];history=$history;current=$false}};if($absoluteRow -gt $lastDrawingRow){$lastDrawingRow=$absoluteRow}}
  }
  $revisionMode=$existing.Count -gt 0 -and $null -ne $batchField
  function Set-WorkbookCell([string]$address,[string]$value){
    $command=$connection.CreateCommand();$command.CommandText="UPDATE [$sheetName`$$address`:$address] SET F1 = ?"
    [void]$command.Parameters.Add('@value',[System.Data.OleDb.OleDbType]::VarWChar,4000);$command.Parameters[0].Value=$value
    [void]$command.ExecuteNonQuery();$command.Dispose()
  }
  if($revisionMode){
    $batchField.startCell -match '^([A-Z]+)[1-9][0-9]*$'|Out-Null;$batchColumn=$Matches[1]
    function Column-Number([string]$letters){$n=0;foreach($char in $letters.ToCharArray()){$n=$n*26+([int][char]$char-64)};return $n}
    function Column-Letters([int]$number){$s='';while($number -gt 0){$number--; $s=[char](65+($number%26))+$s;$number=[math]::Floor($number/26)};return $s}
    $batchNumber=Column-Number $batchColumn
    while($batchNumber -le 26){$relative=$batchNumber-(Column-Number $numberColumn);$occupied=$false;if($relative -ge 0 -and $relative -lt $data.Columns.Count){for($i=0;$i -lt $data.Rows.Count;$i++){if([string]$data.Rows[$i][$relative] -ne ''){$occupied=$true;break}}};if(!$occupied){break};$batchNumber++}
    $batchColumn=Column-Letters $batchNumber;$revisionStyleSourceRow=($existing.Values|Measure-Object -Minimum).Minimum
    $records=@{};foreach($key in $existingRecords.Keys){$records[$key]=$existingRecords[$key]}
    foreach($previewRow in $payload.preview.rows){if($previewRow.kind -ne 'drawing'){continue};$numberAddress="$numberColumn$([int]($numberField.startCell -replace '^\D+','')+$previewRow.row-1)";$number=[string]$previewRow.cells.$numberAddress;$key=$number.Trim().ToUpperInvariant();$titleField.startCell -match '^([A-Z]+)([1-9][0-9]*)$'|Out-Null;$titleAddress="$($Matches[1])$([int]$Matches[2]+$previewRow.row-1)";$sizeField.startCell -match '^([A-Z]+)([1-9][0-9]*)$'|Out-Null;$sizeAddress="$($Matches[1])$([int]$Matches[2]+$previewRow.row-1)";$history=if($records.ContainsKey($key)){$records[$key].history}else{@{}};$records[$key]=[pscustomobject]@{number=$number;title=[string]$previewRow.cells.$titleAddress;size=[string]$previewRow.cells.$sizeAddress;history=$history;current=$true;category=[string]$previewRow.category}}
    function Number-Category([string]$number){
      $found=@{};foreach($token in @($number.ToUpperInvariant() -split '[-_.\s/\\]+'|Where-Object {$_})){
        if($token -match '^P\d+[A-Z]?$' -or $token -match '^(EL|ELE|ELEV|EV)$'){$found['PLANS & ELEVATIONS']=$true}
        elseif($token -match '^(DC|DW|DF)$'){$found['DETAILS']=$true}
        elseif($token -eq 'DS'){$found['DOOR SCHEDULE']=$true}
        elseif($token -eq 'DD'){$found['DOOR DETAIL']=$true}
        elseif($token -match '^(DM|MW|JN)$'){$found['MILLWORK DETAIL']=$true}
      };if($found.Count -eq 1){return [string]@($found.Keys)[0]};return ''
    }
    function Category-Of($record){if($record.category){return $record.category};$t=$record.title.ToUpperInvariant();if($t -match 'DOOR SCHEDULE'){return 'DOOR SCHEDULE'};if($t -match 'DOOR DETAIL'){return 'DOOR DETAIL'};if($t -match 'MILLWORK|JOINERY'){return 'MILLWORK DETAIL'};if($t -match 'PLAN|ELEVATION'){return 'PLANS & ELEVATIONS'};if($t -match 'DETAIL|SECTION'){return 'DETAILS'};$numberCategory=Number-Category $record.number;if($numberCategory){return $numberCategory};return 'OTHER DRAWINGS'}
    function Natural-Key([string]$value){return [regex]::Replace($value.ToUpperInvariant(),'\d+',[System.Text.RegularExpressions.MatchEvaluator]{param($m)$m.Value.PadLeft(10,'0')})}
    function Plan-Rank($record){if($record.title -match '(?i)PLAN' -or $record.number -match '(?i)(?:^|[-_. ])P\d+(?:[-_. ]|$)'){return 0};if($record.title -match '(?i)ELEVATION' -or $record.number -match '(?i)(?:^|[-_. ])(?:EL|ELE|ELEV|EV)(?:[-_. ]|$)'){return 1};return 2}
    function Plan-Floor($record){$m=[regex]::Match($record.number.ToUpperInvariant(),'^(.*?)-(?:P\d+|EL|ELE|ELEV|EV)(?:-|$)');if($m.Success){return $m.Groups[1].Value};return ''}
    function Detail-Space($record){
      $value=$record.number.ToUpperInvariant()
      if($value -match '^(?:DC|DW|DF)-'){return ''}
      if($value -match '-(?:DC|DW|DF)-'){$space=($value -replace '-(?:DC|DW|DF)-.*$','');if($space -eq 'TPY'){return 'TYP'};return $space}
      # Other detail families (for example L1.B-DL-201) still need a stable
      # subgroup key. Remove one or more trailing numeric/supplement segments
      # so consecutive drawings remain together instead of receiving a blank
      # row after every record.
      return ($value -replace '(?:[-_. ]\d+)+$','' -replace '[-_. ]+$','')
    }
    function Detail-Rank($record){if($record.number -match '(?i)-?DC-'){return 0};if($record.number -match '(?i)-?DW-'){return 1};if($record.number -match '(?i)-?DF-'){return 2};return 3}
    function Detail-Number-Key($record){return Natural-Key ($record.number.ToUpperInvariant() -replace '^TPY-','TYP-')}
    $categoryOrder=@('PLANS & ELEVATIONS','DETAILS','DOOR SCHEDULE','DOOR DETAIL','MILLWORK DETAIL','OTHER DRAWINGS');$firstCategory=$true
    foreach($category in $categoryOrder){$items=@($records.Values|Where-Object {(Category-Of $_) -eq $category});if(!$items.Count){continue};if(!$firstCategory){$revisionRows+=[pscustomobject]@{kind='blank'}};$firstCategory=$false;$revisionRows+=[pscustomobject]@{kind='category';category=$category};$detailsSpaceFirst=$false;if($category -eq 'DETAILS'){$typeSet=@($items|ForEach-Object {Detail-Rank $_}|Where-Object {$_ -lt 3}|Sort-Object -Unique);$detailsSpaceFirst=$typeSet.Count -eq 3 -and @($items|Where-Object {(Detail-Space $_) -eq ''}).Count -eq 0};if($category -eq 'PLANS & ELEVATIONS'){$items=@($items|Sort-Object @{Expression={Plan-Rank $_}},@{Expression={Natural-Key (Plan-Floor $_)}},@{Expression={Natural-Key $_.number}})}elseif($category -eq 'DETAILS' -and $detailsSpaceFirst){$items=@($items|Sort-Object @{Expression={Natural-Key (Detail-Space $_)}},@{Expression={Detail-Rank $_}},@{Expression={Detail-Number-Key $_}})}elseif($category -eq 'DETAILS'){$items=@($items|Sort-Object @{Expression={Detail-Rank $_}},@{Expression={Natural-Key (Detail-Space $_)}},@{Expression={Detail-Number-Key $_}})}else{$items=@($items|Sort-Object @{Expression={Natural-Key $_.number}})};$previousSection=$null;foreach($item in $items){$section=if($category -eq 'PLANS & ELEVATIONS'){"$(Plan-Rank $item)|$(Plan-Floor $item)"}elseif($category -eq 'DETAILS' -and $detailsSpaceFirst){Detail-Space $item}elseif($category -eq 'DETAILS'){"$(Detail-Rank $item)|$(Detail-Space $item)"}else{$category};if($null -ne $previousSection -and $section -ne $previousSection){$revisionRows+=[pscustomobject]@{kind='blank'}};$previousSection=$section;$revisionRows+=[pscustomobject]@{kind='drawing';record=$item}}}
    $targetRow=$startRow;foreach($outputRow in $revisionRows){if($outputRow.kind -eq 'category'){$revisionCategoryRows+=$targetRow;$revisionWrites+=[pscustomobject]@{address="B$targetRow";value=$outputRow.category}}elseif($outputRow.kind -eq 'drawing'){$drawingRows+=$targetRow;$record=$outputRow.record;$revisionWrites+=[pscustomobject]@{address="A$targetRow";value=$record.number},[pscustomobject]@{address="B$targetRow";value=$record.title},[pscustomobject]@{address="C$targetRow";value=$record.size};foreach($h in $record.history.Keys){$revisionWrites+=[pscustomobject]@{address="$(Column-Letters ($h+1))$targetRow";value=[string]$record.history[$h]}};if($record.current){$revisionWrites+=[pscustomobject]@{address="$batchColumn$targetRow";value='v'}}};$targetRow++};$revisionClearEnd=[math]::Max($lastDrawingRow,$targetRow-1)
  } else {
    foreach($previewRow in $payload.preview.rows){foreach($property in $previewRow.cells.PSObject.Properties){$address=$property.Name;if($address -notmatch '^[A-Z]+[1-9][0-9]*$'){throw "Invalid Excel cell: $address"};if($previewRow.kind -eq 'drawing'){$drawingRows+=[int]([regex]::Match($address,'[1-9][0-9]*$').Value)};Set-WorkbookCell $address ([string]$property.Value)}}
  }
} finally {if($connection.State -eq 'Open'){$connection.Close()};$connection.Dispose()}

# ACE safely preserves the legacy .xls container while writing values, but it
# cannot set cell styles. Apply only the requested category-row formatting in
# Excel after all value updates are complete.
$categoryRows=@()
foreach($previewRow in $payload.preview.rows){
  if($revisionMode){break}
  if($previewRow.kind -eq 'category'){
    $addresses=@($previewRow.cells.PSObject.Properties.Name)
    if($addresses.Count -gt 0 -and $addresses[0] -match '^[A-Z]+([1-9][0-9]*)$'){$categoryRows+=[int]$Matches[1]}
  }
}
if($categoryRows.Count -gt 0 -or $revisionWrites.Count -gt 0 -or $drawingRows.Count -gt 0){
  $excel=$null;$workbook=$null;$worksheet=$null
  try {
    $excel=New-Object -ComObject Excel.Application
    $excel.Visible=$false
    $excel.DisplayAlerts=$false
    $excel.EnableEvents=$false
    $workbook=$excel.Workbooks.Open($Output,0,$false)
    try {$worksheet=$workbook.Worksheets.Item($sheetName)} catch {$worksheet=$workbook.Worksheets.Item(1)}
    function Copy-RowFormat([int]$sourceRow,[int]$targetRow,[string]$endColumn='L'){
      $source=$null;$target=$null
      try {
        $source=$worksheet.Range("A$sourceRow`:$endColumn$sourceRow")
        $target=$worksheet.Range("A$targetRow`:$endColumn$targetRow")
        # Copy directly to the destination instead of using the Windows
        # clipboard/PasteSpecial. PasteSpecial fails on some consultant
        # templates with merged cells or restricted clipboard state.
        [void]$source.Copy($target)
        $target.ClearContents()
        $target.RowHeight=$source.RowHeight
      } catch {
        # Values are written separately below. If a template refuses a row
        # format copy, keep its existing formatting instead of aborting the
        # entire Excel export.
        try {$target.ClearContents()} catch {}
      } finally {
        if($source){[void][Runtime.InteropServices.Marshal]::ReleaseComObject($source)}
        if($target){[void][Runtime.InteropServices.Marshal]::ReleaseComObject($target)}
      }
    }
    if($revisionMode){$clear=$worksheet.Range("A$startRow`:L$revisionClearEnd");$clear.ClearContents();[void][Runtime.InteropServices.Marshal]::ReleaseComObject($clear);for($formatRow=$startRow;$formatRow -le ($startRow+$revisionRows.Count-1);$formatRow++){Copy-RowFormat $revisionStyleSourceRow $formatRow 'L'}}
    foreach($newRow in $revisionNewRows){Copy-RowFormat $revisionStyleSourceRow $newRow 'Z'}
    foreach($write in $revisionWrites){try{$cell=$worksheet.Range([string]$write.address);$cell.Value2=[string]$write.value}catch{throw "Excel could not write revision cell $([string]$write.address)."}finally{if($cell){[void][Runtime.InteropServices.Marshal]::ReleaseComObject($cell);$cell=$null}}}
    foreach($rowNumber in $categoryRows){
      $cell=$worksheet.Range("A$rowNumber`:L$rowNumber")
      $cell.Interior.Color=12632256 # RGB(192,192,192)
      $cell.Font.Bold=$true
      [void][Runtime.InteropServices.Marshal]::ReleaseComObject($cell)
    }
    foreach($rowNumber in $revisionCategoryRows){$cell=$worksheet.Range("A$rowNumber`:L$rowNumber");$cell.Interior.Color=12632256;$cell.Font.Bold=$true;[void][Runtime.InteropServices.Marshal]::ReleaseComObject($cell)}
    foreach($rowNumber in @($drawingRows|Sort-Object -Unique)){$cell=$worksheet.Range("A$rowNumber`:L$rowNumber");$cell.Font.Name='Verdana';$cell.Font.Size=15;[void][Runtime.InteropServices.Marshal]::ReleaseComObject($cell)}
    $workbook.Save()
  } finally {
    if($workbook){$workbook.Close($true)}
    if($excel){$excel.Quit()}
    if($worksheet){[void][Runtime.InteropServices.Marshal]::ReleaseComObject($worksheet)}
    if($workbook){[void][Runtime.InteropServices.Marshal]::ReleaseComObject($workbook)}
    if($excel){[void][Runtime.InteropServices.Marshal]::ReleaseComObject($excel)}
    [GC]::Collect();[GC]::WaitForPendingFinalizers()
  }
}
