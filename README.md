<div align="center">

![Drawing List Generator：從圖紙到可交付清單](docs/assets/cover.png)

# Drawing List Generator

**批次讀取 AutoCAD 圖框，檢查圖紙分類，產生沿用既有 Excel 範本的圖紙清單。**

![Version v8.13](https://img.shields.io/badge/version-v8.13-1845B9)
![Platform Windows](https://img.shields.io/badge/platform-Windows-555555)
![AutoCAD 2021 validated](https://img.shields.io/badge/AutoCAD-2021%20validated-237A57)
[![License MIT](https://img.shields.io/badge/license-MIT-1845B9)](LICENSE)

[下載 v8.13](https://github.com/whos-dwg/drawing-list-generator/releases/tag/v8.13) · [快速開始](#快速開始) · [操作指南](docs/USAGE.zh-TW.md) · [設定說明](docs/CONFIGURATION.zh-TW.md) · [v8.13 發布說明](docs/releases/v8.13.zh-TW.md) · [English](README.en.md)

</div>

Drawing List Generator 是給建築、室內設計與製圖團隊使用的 Windows 本機工具。選取一個或多個 DWG 與 Excel 範本後，程式會讀取各個紙空間 Layout 的圖框屬性，依圖名與圖號分類，讓你先處理重複圖號、缺漏資料與待確認分類，再下載圖紙清單。

DWG 與 Excel 的處理在本機執行；介面透過 `127.0.0.1:4310` 連接本機服務。程式提供掃描快取，重複掃描相同 DWG 內容時可以重用既有結果。

> **相容性：** 原始 v8.13 發行文件列 AutoCAD 2021 為已驗證目標。2018／2026 的掃描 DLL 已隨附，仍待裝置測試；本次文件整理僅重跑核心邏輯測試，未重新驗證 AutoCAD 或 Excel 的完整流程。

## 下載 v8.13

| 內容 | 連結 |
| --- | --- |
| Windows 免安裝版（約 36.7 MB） | [下載 DrawingList-Generator-v8.13-Windows-Portable.zip](https://github.com/whos-dwg/drawing-list-generator/releases/download/v8.13/DrawingList-Generator-v8.13-Windows-Portable.zip) |
| 檔案完整性 | [SHA256SUMS.txt](https://github.com/whos-dwg/drawing-list-generator/releases/download/v8.13/SHA256SUMS.txt) |
| 本版更新、環境需求與英文說明 | [v8.13 Release](https://github.com/whos-dwg/drawing-list-generator/releases/tag/v8.13) |

下載後完整解壓縮，雙擊 `DrawingList.exe`。Node.js 已隨附；AutoCAD、桌面版 Excel 及 XLS 所需的 ACE Provider 仍須安裝。GitHub 自動產生的 Source code ZIP 供開發使用，沒有免安裝啟動器與執行環境。

本版免安裝 ZIP 的 SHA-256：

~~~text
5d18c4bb99842919e3c4a385efcf87eb6dceb8bf5fa09de20c0f7e6eddbef2d9
~~~

可在 PowerShell 執行 `Get-FileHash -Algorithm SHA256 '.\DrawingList-Generator-v8.13-Windows-Portable.zip'`，比對下載檔案的雜湊。核心邏輯可查看 [GitHub Actions 測試](https://github.com/whos-dwg/drawing-list-generator/actions/workflows/core-tests.yml)結果；AutoCAD／Excel 實機驗證範圍見下方系統需求。

## 目錄

- [下載 v8.13](#下載-v813)
- [功能](#功能)
- [v8.13 更新](#v813-更新)
- [系統需求](#系統需求)
- [快速開始](#快速開始)
- [輸出範例](#輸出範例)
- [圖框與欄位](#圖框與欄位)
- [使用限制](#使用限制)
- [本機資料與診斷](#本機資料與診斷)
- [開發與測試](#開發與測試)
- [文件與協作](#文件與協作)
- [授權與致謝](#授權與致謝)

## 功能

| 功能 | 實際行為 |
| --- | --- |
| 多 DWG 輸入 | 一次選取多個檔案，也可透過 ADD DWG 加入其他資料夾的圖紙；依序掃描 |
| Layout 圖框讀取 | 依 Tab Order 讀取紙空間中符合所選完整名稱的圖框，支援多個候選名稱 |
| 圖紙分類 | 比對圖名關鍵字與圖號中段代碼；有衝突或無法判斷時要求確認 |
| 可設定 CAD 輸入 | 自訂圖框名稱、圖號／圖名標籤，保存設定並查看 DISCOVERED BLOCKS |
| 人工調整 | 可改選分類、確認 OTHER DRAWINGS，或取消某個 Layout 的輸出 |
| 發布前檢查 | 重複圖號、缺少必要圖號與未確認分類會阻擋產生 |
| 排序與分組 | 依分類與圖號分組，處理補充圖號及群組間空白列 |
| Excel 輸出 | 接受 `.xls`／`.xlsx` 範本，下載對應格式的 `Drawing List` 檔案 |
| 本機診斷 | 掃描失敗提供 Diagnostic ID 與本機紀錄，成功掃描紀錄自動清理 |

預設分類包括 PLANS & ELEVATIONS、DETAILS、DOOR SCHEDULE、DOOR DETAIL、MILLWORK DETAIL 與 OTHER DRAWINGS。

~~~mermaid
flowchart LR
  A["選擇 DWG 與 Excel 範本"] --> B["讀取 Layout 圖框"]
  B --> C["分類與資料檢查"]
  C --> D["確認分類／排除圖紙"]
  D --> E["預覽 Excel 寫入位置"]
  E --> F["下載圖紙清單"]
~~~

## v8.13 更新

在 **ADMIN SETTINGS → CAD INPUT / 圖框與屬性** 可輸入圖塊全名，並把來源屬性映射到圖號與四個圖名欄位。多個名稱可用逗號分隔，完整名稱比對不分大小寫。

例如使用 `CONSULTANT_FRAME`：圖號選 `SHEET_ID`、Title 1 選 `PROJECT`、Title 3 選 `TITLE_EN`、Title 4 選 `TITLE_CN`，Title 2 可留空。

按 **SAVE INPUT SETTINGS** 後，CAD 輸入設定會寫入本機檔案，下次啟動可還原。只改屬性標籤可直接更新既有預覽；改圖塊名稱須重新掃描，程式會阻擋舊掃描資料的匯出。掃描後的 **DISCOVERED BLOCKS** 會列出紙空間圖塊名稱與屬性標籤，點選名稱可帶入設定。

本版也讀取常數屬性，保留 v8.12 的靜默 Layout 圖號修正。自訂圖框與圖號標籤的掃描以 AutoCAD 2021 為目標。詳見[本版發布說明](docs/releases/v8.13.zh-TW.md)與[設定指南](docs/CONFIGURATION.zh-TW.md)。

## 系統需求

| 項目 | 需求與驗證狀態 |
| --- | --- |
| 作業系統 | Windows；目前程式含 Windows PowerShell、AutoCAD 與 Excel 相依流程 |
| AutoCAD | 本機須有對應版本的 `accoreconsole.exe` 與掃描 DLL；2021 為原文件已驗證目標 |
| AutoCAD 2018／2026 | 隨附版本專用 DLL，互動提示與完整流程仍待驗證 |
| `.xlsx` 匯出 | 桌面版 Microsoft Excel；目前寫入腳本固定尋找 `C:\Program Files\Microsoft Office\Root\Office16\EXCEL.EXE` |
| `.xls` 匯出 | Microsoft ACE OLEDB 12.0 Provider，加上桌面版 Excel COM；Provider 位元架構須與執行的 PowerShell 相容 |
| Node.js | 免安裝版自帶執行環境；原始碼啟動可用 Node.js 24，本次測試使用 v24.22.1 |
| 瀏覽器 | 可存取本機服務的桌面瀏覽器；程式未提供瀏覽器版本相容性矩陣 |
| 輸入資料 | 含紙空間圖框的 DWG 與自行提供的 Excel 範本；圖框預設為 `A1_TITLE_EN`，可由 CAD INPUT 更改 |

AutoCAD、Excel 與 ACE Provider 不包含在下載包內。此版本未附可直接操作的範例 DWG 或 Excel 範本。

## 快速開始

### 使用 Windows 免安裝版

1. 到本儲存庫的 **Releases** 下載 `DrawingList-Generator-v8.13-Windows-Portable.zip`。GitHub 自動產生的 Source code ZIP 是開發用原始碼封存，不含免安裝版執行環境。
2. 完整解壓縮至可寫入的資料夾，保留 `DrawingList.exe`、`app` 與 `runtime` 的相對位置。
3. 雙擊 `DrawingList.exe` 開啟介面。
4. 選取 DWG 與 Excel 範本，設定 DRAWING SIZE 與 CURRENT BATCH。
5. 若圖框不同，先在 ADMIN SETTINGS 的 CAD INPUT 設定名稱與標籤並儲存；按 **SCAN DRAWINGS** 後檢查圖號、分類與警告。
6. 處理所有阻擋項目後，按 **GENERATE DRAWING LIST** 下載成果。

分類顏色：綠色表示自動分類，藍色表示人工指定，琥珀色表示需要確認。當圖紙確實屬於 OTHER DRAWINGS，按 **CONFIRM OTHER** 即可明確確認。

### 從原始碼啟動

在儲存庫根目錄執行：

~~~powershell
cd app
npm start
~~~

開啟 [http://127.0.0.1:4310](http://127.0.0.1:4310)。目前 `package.json` 未宣告第三方 npm 套件，因此啟動前不需要 `npm install`。實際掃描與匯出仍需要上表列出的 Windows 桌面元件。

## 輸出範例

下表使用隨附的[合成示例](examples/sample-scan.json)，展示預設輸出位置。這是依核心程式產生的資料範例，並非實際 DWG 掃描或 Excel 成品截圖。

| Excel 列 | A：Drawing Number | B：Drawing Title | C：Size | D：Current Batch |
| --- | --- | --- | --- | --- |
| 9 |  | PLANS & ELEVATIONS |  |  |
| 10 | L2-A-P1-001 | GENERAL ARRANGEMENT PLAN | A1 | v |
| 11 |  |  |  |  |
| 12 |  | DETAILS |  |  |
| 13 | L2-A-DW-003 | WALL FINISH DETAIL | A1 | v |

分類標題列與群組空白列也會占用 Excel 列數，因此 `A9` 是整段輸出的起點，第一筆圖紙可能從 `A10` 開始。

## 圖框與欄位

預設圖框為 `A1_TITLE_EN`，預設圖號標籤為 `DWG_NUMBER`，圖名為 `DRAWING_TITLE_1` 至 `DRAWING_TITLE_4`。v8.13 可在 CAD INPUT 調整來源圖塊及標籤；映射後的標準 Token 與 Excel 欄位仍可沿用。

| 輸出欄位 | 預設起點 | 預設內容 |
| --- | --- | --- |
| Drawing Number | `A9` | `{DWG_NUMBER}` |
| Drawing Title | `B9` | `{DRAWING_TITLE_1} {DRAWING_TITLE_3} {DRAWING_TITLE_2} {DRAWING_TITLE_4}` |
| Size | `C9` | `{SHEET_SIZE}`，預設 A1 |
| Current Batch | `D9` | `{ISSUED_THIS_BATCH}`，勾選時為 v |

預設工作表為 `Drawing List`。**ADMIN SETTINGS** 可調整工作表、起始儲存格與欄位公式；Excel 輸出設定只適用目前頁面工作階段；CAD INPUT 的圖框與屬性映射可以儲存到本機。詳細方式見[設定說明](docs/CONFIGURATION.zh-TW.md)。

## 使用限制

- 掃描目標為紙空間 Layout 中直接放置的所選圖框；不遞迴讀取巢狀圖塊，也不展開外部參考圖框。
- AutoCAD 2021 使用側載資料庫讀取，目的是避免缺字型與未解析外部參考提示干擾正常掃描；2018／2026 走不同啟動路徑。
- Layout 圖號修正針對特定 CTAB 快取結果與命名規則，並非通用 AutoCAD Field 計算引擎。
- Excel 寫入會沿用範本結構，但圖紙列字型會設為 **Verdana 15pt**；`.xls` 分類列會套用 A:L 灰底粗體。
- `.xls` 修訂模式會合併既有圖紙與此次輸入，保留部分歷史批次標記；含固定 A:L 欄位及列數假設，不能視為任意範本的通用合併工具。此模式的最終內容會多於網頁中只列本次輸入的預覽。
- 同時安裝多個 AutoCAD 版本時，程式會優先嘗試較新版本；介面目前沒有指定 2021 的選項。

首次使用新範本時，請先用副本檢查工作表、字型、合併儲存格與列印範圍。更多情況見[疑難排解](docs/TROUBLESHOOTING.zh-TW.md)。

## 本機資料與診斷

- `app/local-settings.json`：保存 CAD 輸入的圖塊名稱與屬性映射。
- `app/scan-cache/`：儲存圖框屬性等掃描結果。快取檔名雖然經過雜湊，內容仍可能含專案資料。
- `logs/cad-diagnostics/`：失敗掃描的 Diagnostic ID、程式路徑及處理階段；成功掃描紀錄會自動刪除。
- `logs/DrawingList.log`：原始發行文件列出的啟動器紀錄位置。

ADMIN SETTINGS 內的 **OPEN DIAGNOSTIC FOLDER** 可開啟診斷資料夾。回報問題時先移除客戶名稱、圖紙內容與個人路徑，詳細方式見 [SECURITY.md](SECURITY.md)。

## 開發與測試

~~~powershell
cd app
npm test
~~~

本次文件整理於 2026-11-02 使用 Node.js v24.22.1 執行既有測試：**15 項通過，0 項失敗**。涵蓋圖框設定正規化、屬性映射、變更圖框後的匯出阻擋，以及原有分類、分組與 Layout 圖號正規化。此結果不代表 AutoCAD DLL、啟動器或 Excel 匯出已完成整合測試。

專案使用 Node.js HTTP 服務、原生 HTML/CSS/JavaScript、PowerShell 工作程序與 AutoCAD .NET 掃描器。儲存庫隨附原始包的掃描 DLL；原始 ZIP 未提供啟動器原始碼或 CAD `.csproj`，目前無法僅靠此儲存庫重建全部二進位檔。詳見[架構與開發](docs/ARCHITECTURE.md)。

## 文件與協作

| 文件 | 用途 |
| --- | --- |
| [操作指南](docs/USAGE.zh-TW.md) | 選檔、掃描、確認分類、產生與修訂模式 |
| [設定說明](docs/CONFIGURATION.zh-TW.md) | Token、轉換規則、分類及設定保存方式 |
| [疑難排解](docs/TROUBLESHOOTING.zh-TW.md) | AutoCAD、Excel、圖框及診斷問題 |
| [架構與開發](docs/ARCHITECTURE.md) | 程式地圖、資料流程與測試範圍 |
| [版本紀錄](CHANGELOG.md) | 原文件可確認的 v8.10–v8.13 變更 |
| [貢獻指南](CONTRIBUTING.md) | 問題回報、修改與驗證證據 |
| [安全回報](SECURITY.md) | 本機資料、紀錄與非公開回報方式 |

維護者：[whos-dwg](https://github.com/whos-dwg)。一般問題請使用本儲存庫的 Issues，提交修改請附操作重現步驟與測試結果。

## 授權與致謝

本專案採用 [MIT License](LICENSE)。Node.js 等第三方元件保留各自授權，詳見 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。AutoCAD 與 Microsoft Excel 為各自權利人的產品。

README 編排參考 [matiassingers/awesome-readme](https://github.com/matiassingers/awesome-readme) 收錄的清楚介紹、視覺展示、快速開始、實例與文件導覽做法。
