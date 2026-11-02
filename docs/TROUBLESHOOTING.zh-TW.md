# 疑難排解

[返回 README](../README.md)

## 啟動後沒有介面

確認已完整解壓縮，且 `DrawingList.exe`、`runtime/node.exe`、`app/server.mjs` 與 `app/public` 位於原來的相對位置。資料夾須允許目前使用者寫入快取與 logs。

原始發行文件指出啟動器紀錄位於 `logs/DrawingList.log`。若本機服務已啟動，可嘗試在瀏覽器開啟 [http://127.0.0.1:4310](http://127.0.0.1:4310)。若連接埠被占用，開發者可按[設定文件](CONFIGURATION.zh-TW.md)調整 PORT；啟動器是否支援此變更仍待確認。

長時間關閉頁面後，本機服務可能因沒有心跳而結束，需重新啟動。

## NO SUPPORTED AUTOCAD FOUND

目前只偵測 2018、2021 與 2026，且必須同時找到 `accoreconsole.exe` 與 `app/cad/<年份>/DrawingList.CadPlugin.dll`。其他年份即使已安裝，也不在現行偵測範圍。

確認 AutoCAD 安裝可正常啟動並完成其授權要求。自訂安裝目錄可能需要檢查登錄安裝資訊與實際路徑。

`Diagnose-AutoCAD.cmd` 可產生 `autocad-diagnostic.txt`，內容包含安裝路徑與 Autodesk 解除安裝項目。診斷腳本會搜尋多個磁碟位置，可能花費時間；這份檔案回報前也須檢查個人資訊。

## 安裝多個 AutoCAD 版本時結果不同

工作程序依年份由新到舊嘗試可用安裝，並非固定選擇 2021。頁面顯示的 READY 年份是偵測結果，不能當作所有掃描都成功使用該版本的證據。

失敗紀錄中的 selectedVersion 與程序呼叫資訊可確認實際嘗試的版本。2018／2026 沒有原文件中 2021 側載資料庫路徑的完整驗證紀錄。

## Unable to analyze this DWG

記下畫面上的 Diagnostic ID，在 ADMIN SETTINGS 按 **OPEN DIAGNOSTIC FOLDER**，尋找相同 ID 的失敗紀錄。

| 失敗階段 | 檢查方向 |
| --- | --- |
| AUTOCAD_DETECTION | Core Console 與對應 DLL 是否存在 |
| AUTOCAD_START_BEGIN／AUTOCAD_STARTED | AutoCAD 啟動、DLL 載入與安裝環境 |
| AUTOCAD_PROCESS／TIMEOUT | Core Console 輸出、互動提示或超過 10 分鐘逾時 |
| OUTPUT／RESULT_PARSE_BEGIN | 是否產生有效 scan.json，掃描器是否回報錯誤 |
| BACKEND_PARSE | 本機服務是否能解析掃描結果 |

成功掃描的逐檔紀錄會自動刪除，啟動服務時也會清理殘留的成功紀錄；成功後找不到對應 log 是現行設計。

## 找不到圖框或只讀到一個圖框

掃描器只處理紙空間 Layout 的直接圖塊參考，依 CAD INPUT 的完整名稱清單比對，預設為 `A1_TITLE_EN`。Model 空間、巢狀圖塊與外部參考中的圖框不會被遞迴讀取。

沒有符合圖框時，Layout 預設不納入。多個符合圖框時會警告 `MULTIPLE_TITLE_BLOCKS`，但目前只讀取第一個；請在 DWG 中整理圖框，再重新掃描。

## Generate 按鈕無法使用

檢查可操作警告清單中的 error。常見原因是重複圖號、缺少圖號或待確認分類。圖名缺漏通常是 warning，但其他 `MISSING_` 類型的來源警告在 Layout 被納入時可能成為 error。

如果確定圖紙應留在 OTHER DRAWINGS，按 **CONFIRM OTHER**。若屬於另一類，直接改選分類。圖紙不應輸出時可取消 IN。

## 圖號仍含 Model 或 Layout 值不正確

自動修正使用特定 Layout 命名與字尾比對規則，並不計算所有種類的 AutoCAD Field。v8.12 隱藏的是這種自動修正提示，並不保證任意圖號都會修正。

在 DWG 中檢查 `DWG_NUMBER`、Layout 名稱與欄位設定。以最小化、去識別的範例回報原值、預期值與實際值。

## XLSX 無法匯出

目前腳本固定尋找 `C:\Program Files\Microsoft Office\Root\Office16\EXCEL.EXE`，再以 Excel COM 寫入。Microsoft 365 網頁版或只有 LibreOffice 的環境不符合此流程。

確認工作表名稱存在、工作表可寫入、目標列可以複製。此路徑工作表名稱不存在時會直接報錯。

腳本使用 `GetActiveObject('Excel.Application')` 取得 Excel COM，結束時會呼叫 Quit。測試前請儲存並關閉其他 Excel 工作，避免與既有 Excel 執行個體互相影響。

## XLS 顯示 Provider 未註冊

`Microsoft.ACE.OLEDB.12.0` 必須可由目前執行的 Windows PowerShell 載入。常見問題包括缺少 Provider，或 32／64 位元組合不相容。

XLS 流程也會使用 Excel COM 套用格式，只有 ACE 而沒有桌面版 Excel 仍不足以完成一般輸出。

## 工作表、歷史批次或版面不如預期

XLS 路徑找不到指定工作表時會退回第一個可用工作表；XLSX 路徑則會報錯。產生前應核對工作表名稱，完成後確認檔案。

XLS 修訂模式包含固定 A:L 清理範圍、A/B/C 資料欄與歷史批次讀取假設。若範本有特殊欄位、合併儲存格、保護設定或長清單，應使用副本檢查。[操作指南](USAGE.zh-TW.md)列出目前修訂模式的邊界。

兩條 Excel 路徑都會更改部分字型或樣式，不能保證所有範本排版完全不變。

## SCAN_BLOCK_CONFIG_CHANGED 或 NO_SELECTED_DRAWINGS

更換圖框名稱後，按 SCAN DRAWINGS 重新掃描。只改來源屬性標籤可保存後重建預覽。若沒有納入的圖紙，先查看 DISCOVERED BLOCKS 的實際名稱與屬性，再檢查 IN 欄位。

若來源圖框在外部參考或巢狀圖塊中，目前不會遞迴讀取。多個所選圖框同時存在時仍只讀第一個，請檢查 MULTIPLE_TITLE_BLOCKS。

## 設定不見了或修改 JSON 沒有效果

CAD INPUT 可保存至 `app/local-settings.json`；請確認已按 SAVE INPUT SETTINGS，且 app 資料夾可寫入。Excel 輸出設定只保留於目前工作階段。`app/presets/hba-drawing-list.json` 不會自動載入；永久預設值來自 `app/core.mjs`。圖框名稱與屬性映射請從 CAD INPUT 設定；修改圖框名稱後須重新掃描。自訂圖框或圖號標籤需要 2021 掃描器。詳見[設定說明](CONFIGURATION.zh-TW.md)。

## 回報時提供什麼

請提供程式版本、Windows 版本、AutoCAD 年份、Excel 版本及位元架構、檔案格式、重現步驟、預期與實際結果。掃描失敗請附 Diagnostic ID 和已去識別的相關紀錄。

不要公開真實客戶 DWG、完整圖框屬性快取、含機密內容的範本或未清理的個人路徑。
