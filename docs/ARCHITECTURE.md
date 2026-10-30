# 架構與開發

[繁體中文 README](../README.md) · [English README](../README.en.md)

## 程式地圖

~~~text
app/
├── package.json
├── server.mjs                  HTTP API、快取、暫存檔、診斷與工作程序
├── core.mjs                    分類、Token、分組、排序、驗證及預覽
├── public/
│   ├── index.html              使用者介面
│   ├── app.js                  選檔、掃描、人工確認及下載
│   ├── styles.css
│   ├── field-overrides.css
│   └── assets/                 來源包封面
├── cad/
│   ├── DrawingScanner.cs       隨附掃描器原始碼
│   ├── DrawingList.CadPlugin.dll
│   ├── 2018/                   版本專用預編譯 DLL
│   ├── 2021/                   版本專用預編譯 DLL
│   └── 2026/                   版本專用預編譯 DLL 與 deps.json
├── workers/
│   ├── run-cad-scan.ps1         安裝偵測、Core Console、版本回退
│   ├── write-excel-template.ps1 XLSX：Excel COM 寫入
│   ├── write-excel-xls.ps1      XLS：ACE OLEDB 加 Excel COM
│   └── diagnose-autocad.ps1     安裝診斷
├── presets/
│   └── hba-drawing-list.json    設定參考；目前不由服務載入
└── tests/                      既有核心測試與 Excel 計畫 fixtures
docs/                           操作、設定、限制與發布說明
examples/                       合成資料與預覽範例
~~~

免安裝 Release 另含 `DrawingList.exe` 與 `runtime/node.exe`；儲存庫原始碼封存不包含這兩項。

## 資料流程

~~~mermaid
flowchart TB
  UI["瀏覽器介面"] -->|"DWG Base64"| S["Node.js 本機服務"]
  S --> C{"內容雜湊快取"}
  C -->|"未命中"| P["PowerShell 掃描工作程序"]
  P --> A["AutoCAD Core Console ＋版本專用 DLL"]
  A --> J["Layout／屬性 JSON"]
  C -->|"命中"| J
  J --> K["core.mjs 正規化、分類、驗證、預覽"]
  K --> UI
  UI -->|"掃描資料、設定、Excel 範本"| E{"Excel 匯出"}
  E --> X["XLSX：Excel COM"]
  E --> L["XLS：ACE OLEDB ＋ Excel COM"]
  X --> D["回傳下載檔"]
  L --> D
~~~

服務綁定 `127.0.0.1`，預設連接埠 4310。前端每 30 秒心跳，閒置約 120 秒後服務嘗試結束。介面將檔案以 Base64 傳給本機服務，工作程序使用暫存副本。

## 本機端點

以下為實作摘要，供維護使用，不是承諾穩定的外部 API。

| 方法與路徑 | 用途 |
| --- | --- |
| GET `/api/heartbeat` | 更新活動時間 |
| GET `/api/preset` | 回傳 core.mjs 的 defaultPreset |
| GET `/api/system` | 執行 AutoCAD 偵測 |
| POST `/api/scan` | 接受 fileName／dataBase64，掃描或讀快取 |
| POST `/api/preview` | 接受 scan／preset，建立預覽與問題清單 |
| POST `/api/generate` | 驗證後寫入 Excel，回傳下載資料 |
| POST `/api/open-diagnostics` | 開啟 Windows 診斷資料夾 |

`/api/scan` 使用 40 MiB JSON 請求上限，`/api/generate` 使用 50 MiB；Base64 與 JSON 會增加體積，因此這不是可直接對應的原始檔大小上限。

## CAD 掃描與 Field 修正

AutoCAD 安裝偵測涵蓋 2018／2021／2026，依版本由新到舊嘗試。每個版本必須有對應的預編譯 DLL，不能假定一個 DLL 可跨年使用。

2021 路徑啟動中性 Core Console 工作階段，以 `DLSCANFILE` 讀取側載資料庫；2018／2026 使用 `/i` 開啟 DWG 後執行 `DLSCAN`。每次 Core Console 嘗試最多等待 600 秒。

掃描器依 Tab Order 讀取非 Model Layout，找出直接放置且名稱符合的圖塊。動態圖塊使用動態定義名稱。圖框目前固定為 `A1_TITLE_EN`。

`DrawingScanner.cs` 只針對帶 Fields 的 DWG_NUMBER 做 Layout 字尾修正。`core.mjs` 的 `normalizeScanResult` 另外處理符合條件的 Model 或重複快取值，作為後端正規化。這些規則均不等同於通用 Field 求值。

## 分類與驗證

分類同時使用圖名與圖號。人工覆寫有效時優先；沒有覆寫時，圖名和圖號衝突會要求確認。未知類別必須明確確認 OTHER DRAWINGS。

`buildPreview` 產生 category、blank、drawing 三種列。`validate` 檢查必要工作表設定、儲存格格式、來源警告、分類確認、圖號缺漏與跨檔重複圖號。工作表是否存在則由 Excel 寫入階段確認。

## Excel 路徑

XLSX 使用桌面 Excel 複製範本列、寫入字串，再以格式 51 儲存成 XLSX。固定 Excel 執行路徑與 COM 執行個體處理是目前限制。

XLS 先複製範本，使用 ACE OLEDB 檢查既有內容。一般模式逐格更新；修訂模式合併既有圖紙與本次資料，再用 Excel COM 重排內容並套用格式。修訂模式存在固定欄位、歷史標記與讀取範圍假設。

## 開發

~~~powershell
cd app
npm start
~~~

另開終端機執行：

~~~powershell
cd app
npm test
~~~

`package.json` 未宣告外部 npm 套件。核心測試可以獨立執行，無須啟動 AutoCAD 或 Excel。本次在 Windows／Node.js v24.18.0 執行 9 項既有測試，全數通過。

測試未涵蓋 AutoCAD DLL、Excel COM／OLEDB、頁面互動或啟動器。隨附 `.github/workflows/core-tests.yml` 可在 GitHub 上執行同一組核心測試；新增 workflow 不代表已取得雲端通過紀錄。

## 建置缺口

來源包有 `DrawingScanner.cs` 與各年份 DLL，但沒有 `.csproj`、完整的版本別 SDK 參考與建置命令。`DrawingList.exe` 的原始碼也未提供。

因此，這份儲存庫可用來閱讀、修改及測試 Web／核心／PowerShell 程式，並使用原包 DLL；尚不能宣稱完整可重現建置。新增版本支援前，需補齊該版本專案、相依設定與實機驗證。
