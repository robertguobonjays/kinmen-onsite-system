# 金門小三通駐點維運系統

Google Apps Script 網頁＋Google 試算表當資料庫，整合駐點人員的排班、叫修回報、定期巡檢、SOP／教育訓練。

## 功能
- **帳號與權限**：管理員／主管／駐點，帳號密碼登入（密碼只存雜湊），可新增、停用、重設密碼
- **排班**：每月登記期間（預設 15～20 號）每天提醒未登記者；截止隔天系統自動預排，主管調整後發布並寄信；每日一班 08:00～17:30、每天一人
- **叫修回報**：依保固計畫書附表一，第一～三級自動計算回覆／排除期限，逾期寄信；機關免登入報修頁 `?p=report`
- **維護工作紀錄**（附表三）、**月維護報告**（產生 Google 文件）
- **定期巡檢**：每日（附表二）、每週、每月、每季、保固期滿前
- **SOP／教育訓練**：必讀與已讀追蹤、附件上傳、叫修結案轉常見問題

## 資料夾
| 路徑 | 內容 |
|---|---|
| `src/` | Apps Script 程式（`Code.gs`、`Index.html`、`Report.html`、`appsscript.json`） |
| `test/` | 模擬 Apps Script 環境的自動測試 |
| `docs/` | 安裝與使用說明（`mkdoc.py` 產生 docx） |

## Google 上的位置
- 試算表（資料庫）：https://docs.google.com/spreadsheets/d/1lUR5UJSrvrYCNZT14-sXg41rnZIWBbQTVqu4cz0cQxE
- Apps Script：https://script.google.com/d/1Ly9JjQxvyS8ynG_QomiXOlu3iIyNfE-T9hgnQ6YK5UMxubBb35sGVwUo/edit
- 網頁（v2.0 部署）：https://script.google.com/macros/s/AKfycbyAbd9Kz8-Xe0qdFScCi87vR8VOalclsW0eo_eOjEPkFgbVdD2m4tE6ZA94HpBD4AAz/exec
- 機關報修頁：上面網址加 `?p=report`
- 雲端硬碟資料夾：https://drive.google.com/drive/folders/1GJbVi85Fbp3KOe6Z4_3wP3bBjgogN2T1
- clasp 帳號：`clasp --user work`（robertguo@bonjays.com）

## 開發
```bash
npm install        # 只需第一次（測試用 jsdom）
npm test           # 後端流程＋網頁畫面測試
clasp --user work push      # 上傳到 Apps Script（.clasp.json 的 rootDir 是 src）
clasp --user work redeploy AKfycbyAbd9Kz8-Xe0qdFScCi87vR8VOalclsW0eo_eOjEPkFgbVdD2m4tE6ZA94HpBD4AAz -d "說明"   # 更新網頁（網址不變）
```
