# 設定說明

[返回 README](../README.md)

## 設定從哪裡讀取

`app/server.mjs` 從 `app/core.mjs` 匯入 `defaultPreset`，並透過 `/api/preset` 提供給頁面。`app/presets/hba-drawing-list.json` 是隨附的設定參考檔，現行服務不會自動載入它。

ADMIN SETTINGS 提供目前工作階段的工作表、起始儲存格與欄位公式編輯。分類設定區只顯示規則，沒有編輯或儲存按鈕。若要永久修改預設值，須編輯 `core.mjs` 的 `defaultPreset`，重啟服務後重新整理頁面。

預設名稱 `HBA Drawing List` 是來源設定標籤，不代表任何機構對此專案的背書。

## Excel 欄位

| 欄位 | 起點 | 公式 |
| --- | --- | --- |
| Drawing Number | A9 | `{DWG_NUMBER}` |
| Drawing Title | B9 | `{DRAWING_TITLE_1} {DRAWING_TITLE_3} {DRAWING_TITLE_2} {DRAWING_TITLE_4}` |
| Size | C9 | `{SHEET_SIZE}` |
| Current Batch | D9 | `{ISSUED_THIS_BATCH}` |

工作表預設為 `Drawing List`。儲存格格式須為英文字母欄名加上正整數列號，例如 `B9` 或 `AA12`；目前驗證未檢查是否超過 Excel 最大列／欄數。

每個輸出列依其索引加到各欄位的起始列，分類與空白列也包含在索引內。多個欄位若設定相同儲存格，可能覆蓋彼此，應自行避免。

## Token

`formula` 是字串模板，使用大括號取代資料，不是執行 Excel `=…` 公式的計算引擎。

| Token | 資料來源 |
| --- | --- |
| `{DWG_NUMBER}` | 圖框的 DWG_NUMBER 屬性 |
| `{DRAWING_TITLE_1}` … `{DRAWING_TITLE_4}` | 圖框圖名屬性 |
| `{LAYOUT_NAME}` | Layout 名稱 |
| `{FILE_NAME}` | 來源檔名 |
| `{SHEET_SIZE}` | 本次 DRAWING SIZE，預設 A1 |
| `{ISSUED_THIS_BATCH}` | 一般預覽／輸出為 v 或空字串；XLS 修訂模式另有固定標記流程 |
| `{任意屬性名稱}` | 圖框中名稱相符的屬性，名稱不分大小寫 |

找不到屬性時，Token 會變成空字串。

## 字串轉換

`transforms` 依陣列順序執行。

| type | 行為 | 額外欄位 |
| --- | --- | --- |
| `trim` | 移除前後空白 | 無 |
| `dedupeSpaces` | 多個空白字元合併為一個空格 | 無 |
| `uppercaseEnglish` | 英文字母轉大寫 | 無 |
| `prefix` | 加上前綴 | `value` |
| `suffix` | 加上後綴 | `value` |
| `replace` | 替換所有完全相符的文字片段，不使用正規表示式 | `find`、`replace` |

例如，預設圖名會先串接屬性，再移除多餘空白、轉大寫，最後把 `ELEVATIONS` 改成 `ELEVATION`。這些轉換目前須在原始碼設定，頁面沒有轉換規則編輯器。

## 分類規則

圖名依 `classificationRules` 順序尋找第一個關鍵字吻合的規則；關鍵字不分大小寫，使用文字包含比對。

圖號依 `- _ . 空白 / \` 分段，再對照 `numberClassificationRules`。`P#` 特別代表 P 加上數字及可選英文字母，例如 P1、P12A。

| 分類 | 預設圖號代碼 |
| --- | --- |
| PLANS & ELEVATIONS | P#、EL、ELE、ELEV、EV |
| DETAILS | DC、DW、DF |
| DOOR SCHEDULE | DS |
| DOOR DETAIL | DD |
| MILLWORK DETAIL | DM、MW、JN |
| OTHER DRAWINGS | 無相符證據時的預設分類 |

圖名與圖號結果一致時為 high，單一來源可判斷時為 medium；兩者衝突或無法辨識時要求確認。人工分類須位於允許的分類清單中。

`autoClassify` 控制輸出分組，`classificationOrder` 控制分類順序，`blankRowOnPrefixChange` 控制部分群組空白列。即使關閉自動分組，現行驗證仍會檢查分類確認。

`sortMethod: "layoutOrder"` 雖存在於預設值，現行核心不依此欄位切換排序策略；不要將它視為可用的排序選單。

## 圖框名稱限制

`titleBlockName` 設定值目前不會傳給 CAD 掃描器。`DrawingScanner.cs` 中的命令固定呼叫 `ScanDatabase(..., "A1_TITLE_EN")`。

若要支援另一個圖框，必須修改掃描器並為相應 AutoCAD 版本重新編譯 DLL。來源包缺少 CAD 專案檔、版本別建置設定與完整重建流程，不能只改 JSON 就宣稱已支援新圖框。

## 本機連接埠

預設為 `4310`，原始碼啟動可透過環境變數 `PORT` 調整：

~~~powershell
$env:PORT = '4311'
cd app
npm start
~~~

此時開啟 [http://127.0.0.1:4311](http://127.0.0.1:4311)。免安裝啟動器原始碼未提供，其開啟網址是否跟隨 PORT 變更尚未確認。
