# 合成資料範例

`sample-scan.json` 使用虛構的 sample.dwg 與兩筆圖框資料，未包含任何實際客戶圖紙。

從儲存庫根目錄執行：

~~~powershell
node examples/preview-example.mjs
~~~

程式呼叫實際 `buildPreview`，將分類、目標儲存格與驗證結果輸出為 JSON。`sample-preview.json` 是本次整理時由同一指令產生的參考結果。

這個範例展示掃描結果之後的核心邏輯；它不會呼叫 AutoCAD 或 Excel。要驗證 DWG 解析與 Excel 版面，仍需準備相容的真實測試檔。
