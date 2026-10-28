// 在 Vercel（Node.js）上執行 src/Code.gs 的商業邏輯。
// 做法：每次呼叫先把整份 Google 試算表讀進記憶體，用模擬的 SpreadsheetApp 執行 Code.gs 的 api_ 函式，
// 再把過程中的寫入（改儲存格、刪列）依序送回 Google Sheets。信件寫進「寄信佇列」，由 Apps Script 每分鐘寄出。
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const CODE = fs.readFileSync(path.join(__dirname, '..', 'src', 'Code.gs'), 'utf8');
const SCRIPT = new vm.Script(CODE, { filename: 'Code.gs' });

let client = null; // { load(), apply(ops, snapshot) }
function setClient(c) { client = c; }
function getClient() { if (!client) client = require('./sheets'); return client; }

/* ---------- 記憶體快取（同一個 Vercel 執行個體內有效） ---------- */
const memCache = new Map();
const memProps = new Map();
const CacheService = {
  getScriptCache: () => ({
    get: k => { const v = memCache.get(k); if (!v) return null; if (v.x < Date.now()) { memCache.delete(k); return null; } return v.v; },
    put: (k, v, sec) => { memCache.set(k, { v: String(v), x: Date.now() + (sec || 600) * 1000 }); },
    remove: k => { memCache.delete(k); }
  })
};
function rateLimit(key, max, sec) {
  const c = CacheService.getScriptCache(), n = Number(c.get(key) || 0);
  if (n >= max) throw new Error('目前操作太頻繁，請稍後再試，或改用電話／LINE 通報。');
  c.put(key, String(n + 1), sec || 600);
}

/* ---------- Apps Script 服務的替身 ---------- */
function pad(n) { return String(n).padStart(2, '0'); }
function formatDate(d, tz, p) { // 只支援 Asia/Taipei（UTC+8，無日光節約）
  const x = new Date(d.getTime() + 8 * 3600000);
  const v = { yyyy: x.getUTCFullYear(), yy: pad(x.getUTCFullYear() % 100), MM: pad(x.getUTCMonth() + 1), dd: pad(x.getUTCDate()),
    HH: pad(x.getUTCHours()), mm: pad(x.getUTCMinutes()), ss: pad(x.getUTCSeconds()), u: x.getUTCDay() === 0 ? 7 : x.getUTCDay(), H: x.getUTCHours() };
  return p.replace(/yyyy|yy|MM|dd|HH|mm|ss|u|H/g, t => v[t]);
}

class Sheet {
  constructor(title, info, ops) {
    this.name = title; this.sheetId = info.sheetId; this.rowCount = info.rowCount; this.ops = ops;
    this.data = (info.values || []).map(r => r.map(v => (v === null || v === undefined ? '' : String(v))));
  }
  getName() { return this.name; }
  getLastRow() { let n = this.data.length; while (n && this.data[n - 1].every(v => v === '')) n--; return n; }
  getLastColumn() { return this.data.reduce((a, r) => { let n = r.length; while (n && r[n - 1] === '') n--; return Math.max(a, n); }, 0); }
  getMaxRows() { return Math.max(this.rowCount, this.data.length); }
  getDataRange() { return this.getRange(1, 1, Math.max(1, this.getLastRow()), Math.max(1, this.getLastColumn())); }
  getRange(r, c, nr, nc) { return new Range(this, r, c, nr || 1, nc || 1); }
  deleteRow(r) { this.data.splice(r - 1, 1); this.ops.push({ t: 'del', sheet: this.name, r }); }
  setFrozenRows() { }
}
class Range {
  constructor(s, r, c, nr, nc) { this.s = s; this.r = r; this.c = c; this.nr = nr; this.nc = nc; }
  getValues() {
    const out = [];
    for (let i = 0; i < this.nr; i++) {
      const row = this.s.data[this.r - 1 + i] || [], o = [];
      for (let j = 0; j < this.nc; j++) o.push(row[this.c - 1 + j] === undefined ? '' : row[this.c - 1 + j]);
      out.push(o);
    }
    return out;
  }
  setValues(v) {
    if (v.length !== this.nr || v.some(r => r.length !== this.nc)) throw new Error('setValues 大小不符');
    const vals = v.map(r => r.map(x => (x === null || x === undefined ? '' : String(x))));
    for (let i = 0; i < this.nr; i++) {
      while (this.s.data.length < this.r + i) this.s.data.push([]);
      const row = this.s.data[this.r - 1 + i];
      for (let j = 0; j < this.nc; j++) row[this.c - 1 + j] = vals[i][j];
      for (let j = 0; j < row.length; j++) if (row[j] === undefined) row[j] = '';
    }
    this.s.ops.push({ t: 'set', sheet: this.s.name, r: this.r, c: this.c, values: vals });
    return this;
  }
  setValue(x) { return this.setValues([[x]]); }
  clearContent() { return this.setValues(Array.from({ length: this.nr }, () => Array(this.nc).fill(''))); }
  setNumberFormat() { return this; }
  setFontWeight() { return this; }
  setBackground() { return this; }
}

const RT = { origin: '', sheets: {}, ops: [], DateClass: null };

function makeContext() {
  const notHere = name => () => { throw new Error(name + ' 只能在 Apps Script 執行'); };
  const ctx = {
    console, Date: RT.DateClass || Date, Math, JSON, String, Number, Object, Array, Error, RegExp, parseInt, isNaN,
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ({
        getSheetByName: n => RT.sheets[n] || null,
        getSheets: () => Object.values(RT.sheets),
        insertSheet: () => { throw new Error('工作表不完整，請先在 Apps Script 執行 setup（升級）'); },
        deleteSheet: notHere('deleteSheet')
      }),
      getUi: notHere('getUi')
    },
    Utilities: {
      formatDate,
      base64Encode: b => Buffer.from(b).toString('base64'),
      base64Decode: s => Array.from(Buffer.from(s, 'base64')),
      computeDigest: (alg, str) => Array.from(crypto.createHash('sha256').update(String(str), 'utf8').digest()),
      DigestAlgorithm: { SHA_256: 'SHA_256' }, Charset: { UTF_8: 'UTF_8' },
      getUuid: () => crypto.randomUUID(),
      newBlob: notHere('Utilities.newBlob')
    },
    Session: { getActiveUser: () => ({ getEmail: () => '' }), getEffectiveUser: () => ({ getEmail: () => '' }) },
    MailApp: {
      sendEmail: o => {
        ctx.appendObj_('寄信佇列', { 'ID': ctx.uid_('M'), '建立時間': ctx.now_(), '收件者': o.to, '主旨': o.subject, '內容': o.htmlBody, '狀態': '待寄' });
      }
    },
    LockService: { getScriptLock: () => ({ waitLock() { }, tryLock() { return true; }, releaseLock() { } }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => memProps.get(k) || null, setProperty: (k, v) => memProps.set(k, v), getProperties: () => Object.fromEntries(memProps), deleteProperty: k => memProps.delete(k) }) },
    CacheService,
    DriveApp: { getFolderById: notHere('DriveApp'), createFolder: notHere('DriveApp'), getFileById: notHere('DriveApp'), Access: {}, Permission: {} },
    ScriptApp: { getService: () => ({ getUrl: () => RT.origin }), getProjectTriggers: () => [], newTrigger: notHere('ScriptApp.newTrigger') },
    HtmlService: {}
  };
  vm.createContext(ctx);
  SCRIPT.runInContext(ctx);

  // 登入：改用簽章 token（不需要伺服器存 session）；停用或刪除帳號時 me_() 查不到人，token 立即失效
  ctx.startSession_ = function (p) {
    const days = Number(ctx.getSettings_()['登入有效天數']) || 14;
    const payload = Buffer.from(JSON.stringify({ e: p.email, x: Date.now() + days * 86400000 })).toString('base64url');
    ctx.updateObj_('人員', p._row, { '最後登入': ctx.now_() });
    return payload + '.' + sign(payload);
  };
  ctx.sessionEmail_ = function (tk) {
    const m = String(tk || '').match(/^([\w-]+)\.([\w-]+)$/);
    if (!m) return '';
    const expect = sign(m[1]);
    if (expect.length !== m[2].length || !crypto.timingSafeEqual(Buffer.from(expect), Buffer.from(m[2]))) return '';
    try { const s = JSON.parse(Buffer.from(m[1], 'base64url').toString()); return s.x > Date.now() ? s.e : ''; } catch (e) { return ''; }
  };
  ctx.api_logout = () => true;
  ctx.api_googleLogin = () => null;
  // 月報 Google 文件交給 Apps Script 產生（工作佇列），完成後寄信給申請人
  const monthReport = ctx.api_monthReport;
  ctx.api_monthReport = function (tk, month, makeDoc) {
    const r = monthReport(tk, month, false);
    if (makeDoc) {
      const me = ctx.me_(tk);
      ctx.appendObj_('工作佇列', { 'ID': ctx.uid_('J'), '建立時間': ctx.now_(), '類型': '月報', '參數': month, '申請人Email': me.email, '狀態': '待處理' });
      r.queued = true;
    }
    return r;
  };
  return ctx;
}

function sign(payload) {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 16) throw new Error('伺服器未設定 SESSION_SECRET');
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}

let ctx = null;
let chain = Promise.resolve();

/** 執行 Code.gs 的 api_ 函式（同一執行個體內依序執行，避免互相覆蓋） */
function call(fn, args, opts) {
  const run = async () => {
    if (!ctx) ctx = makeContext();
    if (typeof ctx[fn] !== 'function' || !/^api_\w+$/.test(fn)) throw new Error('不支援的功能');
    const c = getClient();
    const snap = await c.load();
    RT.ops = [];
    RT.sheets = {};
    Object.keys(snap.sheets).forEach(t => { RT.sheets[t] = new Sheet(t, snap.sheets[t], RT.ops); });
    if (!RT.sheets['寄信佇列'] || !RT.sheets['工作佇列']) throw new Error('試算表缺少「寄信佇列／工作佇列」，請先在 Apps Script 執行 setup（升級）');
    RT.origin = process.env.APP_URL || (opts && opts.origin) || '';
    ctx.HEAD_ = {};
    if (RT.origin && !ctx.getSettings_()['系統網址']) ctx.setSetting_('系統網址', RT.origin);
    let result, error;
    try { result = ctx[fn].apply(null, args || []); } catch (e) { error = e; }
    // 失敗時也送出已完成的寫入（與 Apps Script 行為相同：例外前的寫入不會回復）
    if (RT.ops.length) await c.apply(RT.ops, snap);
    if (error) throw error;
    return result === undefined ? null : JSON.parse(JSON.stringify(result));
  };
  const p = chain.then(run, run);
  chain = p.catch(() => { });
  return p;
}

module.exports = { call, setClient, rateLimit, _setDateClass: D => { RT.DateClass = D; ctx = null; } };
