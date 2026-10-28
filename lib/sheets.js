// Google Sheets API（服務帳戶）：讀整份試算表、把寫入動作轉成一次 batchUpdate
const { GoogleAuth } = require('google-auth-library');

const BASE = 'https://sheets.googleapis.com/v4/spreadsheets';
let auth = null;

function credentials() {
  const raw = (process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '').trim();
  if (!raw) throw new Error('伺服器未設定 GOOGLE_SERVICE_ACCOUNT_JSON');
  return JSON.parse(raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8'));
}

function sheetId() {
  const id = process.env.SHEET_ID;
  if (!id) throw new Error('伺服器未設定 SHEET_ID');
  return id;
}

async function gfetch(url, opts) {
  if (!auth) auth = new GoogleAuth({ credentials: credentials(), scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
  const token = (await (await auth.getClient()).getAccessToken()).token;
  const r = await fetch(url, Object.assign({}, opts, { headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' } }));
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('Google 試算表錯誤：' + ((j.error && j.error.message) || r.status));
  return j;
}

/** 回傳 { sheets: { 標題: { sheetId, rowCount, colCount, values } } } */
async function load() {
  const id = sheetId();
  const meta = await gfetch(BASE + '/' + id + '?fields=sheets.properties(sheetId,title,gridProperties(rowCount,columnCount))');
  const props = meta.sheets.map(s => s.properties);
  const q = props.map(p => 'ranges=' + encodeURIComponent("'" + p.title.replace(/'/g, "''") + "'")).join('&');
  const vals = await gfetch(BASE + '/' + id + '/values:batchGet?' + q + '&valueRenderOption=FORMATTED_VALUE&majorDimension=ROWS');
  const out = {};
  props.forEach((p, i) => {
    out[p.title] = { sheetId: p.sheetId, rowCount: p.gridProperties.rowCount, colCount: p.gridProperties.columnCount, values: (vals.valueRanges[i] && vals.valueRanges[i].values) || [] };
  });
  return { sheets: out };
}

/** 把 runtime 記錄的動作（set／del）轉成 Sheets batchUpdate requests */
function toRequests(ops, snap) {
  const size = {};
  Object.keys(snap.sheets).forEach(t => { size[t] = { rows: snap.sheets[t].rowCount, cols: snap.sheets[t].colCount, id: snap.sheets[t].sheetId }; });
  const reqs = [];
  ops.forEach(op => {
    const z = size[op.sheet];
    if (op.t === 'del') {
      reqs.push({ deleteDimension: { range: { sheetId: z.id, dimension: 'ROWS', startIndex: op.r - 1, endIndex: op.r } } });
      z.rows--;
      return;
    }
    const needR = op.r - 1 + op.values.length, needC = op.c - 1 + op.values[0].length;
    if (needR > z.rows) { reqs.push({ appendDimension: { sheetId: z.id, dimension: 'ROWS', length: needR - z.rows + 100 } }); z.rows = needR + 100; }
    if (needC > z.cols) { reqs.push({ appendDimension: { sheetId: z.id, dimension: 'COLUMNS', length: needC - z.cols } }); z.cols = needC; }
    reqs.push({
      updateCells: {
        start: { sheetId: z.id, rowIndex: op.r - 1, columnIndex: op.c - 1 },
        rows: op.values.map(row => ({ values: row.map(v => (v === '' ? {} : { userEnteredValue: { stringValue: v } })) })),
        fields: 'userEnteredValue'
      }
    });
  });
  return reqs;
}

async function apply(ops, snap) {
  const requests = toRequests(ops, snap);
  if (!requests.length) return;
  await gfetch(BASE + '/' + sheetId() + ':batchUpdate', { method: 'POST', body: JSON.stringify({ requests }) });
}

module.exports = { load, apply, toRequests };
