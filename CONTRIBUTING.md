# 貢獻指南

一般問題請使用 Issues 的錯誤回報或功能建議表單。提交前先閱讀 [README](README.md) 與[疑難排解](docs/TROUBLESHOOTING.zh-TW.md)，確認目前圖框、Excel 路徑及 AutoCAD 版本限制。

## 回報錯誤

請附程式版本、Windows／AutoCAD／Excel 環境、輸入格式、最小重現步驟，以及預期與實際結果。掃描錯誤附 Diagnostic ID；分類錯誤附去識別後的圖號、圖名及預期分類。

公開回報可使用合成資料、遮蔽內容的畫面或最小化屬性 JSON。涉及客戶圖紙與未公開安全問題，請依 [SECURITY.md](SECURITY.md) 處理。

## 修改程式

1. 從目前主分支建立工作分支。
2. 保持變更範圍清楚，說明使用者操作前後的差異。
3. 修改 `app/core.mjs` 時，執行既有測試；若新增或修正重要邏輯，補上能重現問題的案例。
4. 修改 CAD 或 Excel 工作程序時，記錄實際測試的產品版本與範本條件。
5. 更新涉及的操作文件與版本說明，再提交 Pull Request。

~~~powershell
cd app
npm test
~~~

核心測試不會驗證 AutoCAD 或 Excel。請把未測項目直接寫在 PR，避免將單元測試結果延伸成完整相容性宣告。

## 提交內容

請勿提交 `app/scan-cache/`、`logs/`、真實專案 DWG／Excel、暫存資料或個人路徑。預編譯 DLL 若有更換，須附相應原始碼、版本別建置資訊與驗證結果；目前來源缺少完整重建設定，見[架構文件](docs/ARCHITECTURE.md)。

本專案採用 [MIT License](LICENSE)。提交內容應為你有權提供的程式或文件，第三方內容請保留其授權與來源說明。
