# 金門小三通駐點維運系統

整合駐點人員的排班、叫修回報、定期巡檢、SOP／教育訓練。

## 架構
```
瀏覽器 ──► Vercel（public/ 網頁 ＋ api/ 伺服器程式）──► Google 試算表（資料庫）
                     │                                   ▲
                     └─ 照片／附件 → Vercel Blob           │
Apps Script（綁定同一份試算表）──────────────────────────────┘
  每分鐘 flushQueue：寄出「寄信佇列」、產生月報（工作佇列）
  每 10 分鐘 cronSla：叫修逾期提醒；每小時 hourlyJob：登記／預排／巡檢／值班提醒
```
- 商業邏輯只有一份：`src/Code.gs`。Vercel 的 `lib/runtime.js` 在 Node 上執行它（模擬 SpreadsheetApp，寫入轉成 Sheets API batchUpdate）。
- 網頁只有一份：`src/Index.html`、`src/Report.html`；Vercel 建置時加上 `web/gas-shim.js`，把 `google.script.run` 轉成呼叫 `/api/call`。
- 同時只有少數人操作的前提下設計（每次請求讀整份試算表）；多人同時寫入同一張表時，後寫的可能覆蓋先寫的列位。

## Vercel 環境變數
| 名稱 | 內容 |
|---|---|
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Google 服務帳戶金鑰 JSON（整段，或 base64） |
| `SHEET_ID` | 試算表 ID |
| `SESSION_SECRET` | 登入簽章用的隨機字串（32 字以上） |
| `BLOB_READ_WRITE_TOKEN` | 連結 Vercel Blob 儲存區後自動產生 |
| `APP_URL` | （選填）正式網址，例 `https://kinmen-onsite-system.vercel.app` |

服務帳戶的 Email 要加到試算表的「共用 → 編輯者」。

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
| `src/` | 共用程式：`Code.gs`（商業邏輯，Apps Script 與 Vercel 共用）、`Index.html`、`Report.html`、`appsscript.json` |
| `api/` | Vercel 伺服器程式（`call.js`、`upload.js`） |
| `lib/` | `runtime.js`（在 Node 執行 Code.gs）、`sheets.js`（Google Sheets API） |
| `web/`、`scripts/` | 前端轉接程式、建置腳本（輸出到 `public/`） |
| `test/` | 模擬 Apps Script 環境的自動測試 |
| `docs/` | 安裝與使用說明（`mkdoc.py` 產生 docx） |

## Google 上的位置
- 試算表（資料庫）：https://docs.google.com/spreadsheets/d/1lUR5UJSrvrYCNZT14-sXg41rnZIWBbQTVqu4cz0cQxE
- Apps Script：https://script.google.com/d/1Ly9JjQxvyS8ynG_QomiXOlu3iIyNfE-T9hgnQ6YK5UMxubBb35sGVwUo/edit
- Apps Script 網頁（舊，已改用 Vercel）：https://script.google.com/macros/s/AKfycbyAbd9Kz8-Xe0qdFScCi87vR8VOalclsW0eo_eOjEPkFgbVdD2m4tE6ZA94HpBD4AAz/exec
- 雲端硬碟資料夾：https://drive.google.com/drive/folders/1GJbVi85Fbp3KOe6Z4_3wP3bBjgogN2T1
- clasp 帳號：`clasp --user work`（robertguo@bonjays.com）

## 開發
```bash
npm install        # 只需第一次（測試用 jsdom）
npm test           # 後端流程＋網頁畫面＋Vercel 整合測試
npm run build      # 產生 public/（Vercel 會自動做）
clasp --user work push      # 上傳到 Apps Script（.clasp.json 的 rootDir 是 src）
git push           # 推到 GitHub main → Vercel 自動部署
```
