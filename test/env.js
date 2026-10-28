// 模擬 Apps Script 環境測試 Code.gs
const fs = require('fs'), vm = require('vm'), path = require('path');
const code = fs.readFileSync(path.join(__dirname, '../src/Code.gs'), 'utf8');

let FAKE_NOW = null; // ms
const RealDate = Date;
class FDate extends RealDate { constructor(...a) { if (!a.length && FAKE_NOW) super(FAKE_NOW); else super(...a); } static now() { return FAKE_NOW || RealDate.now(); } }

function pad(n, l = 2) { return String(n).padStart(l, '0'); }
function fmt(d, tz, p) {
  const x = new RealDate(d.getTime() + 8 * 3600000);
  const Y = x.getUTCFullYear(), M = x.getUTCMonth() + 1, D = x.getUTCDate(), h = x.getUTCHours(), m = x.getUTCMinutes(), s = x.getUTCSeconds();
  const u = x.getUTCDay() === 0 ? 7 : x.getUTCDay();
  return p.replace(/yyyy|yy|MM|dd|HH|mm|ss|u|H/g, t => ({ yyyy: Y, yy: pad(Y % 100), MM: pad(M), dd: pad(D), HH: pad(h), mm: pad(m), ss: pad(s), u: u, H: h })[t]);
}

class Sheet {
  constructor(name) { this.name = name; this.data = []; }
  getName() { return this.name; }
  getLastRow() { return this.data.length; }
  getLastColumn() { return this.data.reduce((a, r) => Math.max(a, r.length), 0); }
  getMaxRows() { return Math.max(1000, this.data.length); }
  getDataRange() { return this.getRange(1, 1, Math.max(1, this.data.length), Math.max(1, this.getLastColumn())); }
  getRange(r, c, nr = 1, nc = 1) { return new Range(this, r, c, nr, nc); }
  deleteRow(r) { this.data.splice(r - 1, 1); }
  setFrozenRows() { }
}
class Range {
  constructor(s, r, c, nr, nc) { Object.assign(this, { s, r, c, nr, nc }); }
  getValues() { const out = []; for (let i = 0; i < this.nr; i++) { const row = this.s.data[this.r - 1 + i] || []; const o = []; for (let j = 0; j < this.nc; j++) o.push(row[this.c - 1 + j] === undefined ? '' : row[this.c - 1 + j]); out.push(o); } return out; }
  setValues(v) { if (v.length !== this.nr || v[0].length !== this.nc) throw new Error('size mismatch ' + v.length + 'x' + v[0].length + ' vs ' + this.nr + 'x' + this.nc); for (let i = 0; i < this.nr; i++) { while (this.s.data.length < this.r + i) this.s.data.push([]); const row = this.s.data[this.r - 1 + i]; for (let j = 0; j < this.nc; j++) row[this.c - 1 + j] = v[i][j]; } return this; }
  setValue(x) { return this.setValues([[x]]); }
  clearContent() { for (let i = 0; i < this.nr; i++) { const row = this.s.data[this.r - 1 + i]; if (row) for (let j = 0; j < this.nc; j++) row[this.c - 1 + j] = ''; } while (this.s.data.length && this.s.data[this.s.data.length - 1].every(x => x === '')) this.s.data.pop(); return this; }
  setNumberFormat() { return this; } setFontWeight() { return this; } setBackground() { return this; }
}
const sheets = {};
const ss = {
  getSheetByName: n => sheets[n] || null,
  insertSheet: n => (sheets[n] = new Sheet(n)),
  getSheets: () => Object.values(sheets),
  deleteSheet: s => delete sheets[s.name]
};
const mails = [];
let ACTIVE = 'boss@corp.com';
const props = {};
const ctx = {
  console, Date: FDate, Math, JSON, String, Number, Object, Array, Error, RegExp, parseInt,
  SpreadsheetApp: { getActiveSpreadsheet: () => ss, getUi: () => { throw new Error('no ui'); } },
  Utilities: {
    formatDate: fmt, base64Decode: s => Buffer.from(s, 'base64'),
    newBlob: (b, t, n) => ({ b, t, n })
  },
  Session: { getActiveUser: () => ({ getEmail: () => ACTIVE }), getEffectiveUser: () => ({ getEmail: () => 'boss@corp.com' }) },
  MailApp: { sendEmail: o => mails.push(o) },
  LockService: { getScriptLock: () => ({ waitLock() { }, releaseLock() { } }) },
  PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] || null, setProperty: (k, v) => { props[k] = v; }, getProperties: () => ({ ...props }), deleteProperty: k => delete props[k] }) },
  DriveApp: {
    createFolder: n => ({ getId: () => 'FOLDER1', createFile: b => ({ getId: () => 'FILE' + mails.length, setSharing() { } }) }),
    getFolderById: id => ({ getId: () => id, createFile: b => ({ getId: () => 'FILEX', setSharing() { } }) }),
    getFileById: id => ({ moveTo() { } }), Access: {}, Permission: {}
  },
  ScriptApp: {
    getProjectTriggers: () => [], deleteTrigger() { },
    newTrigger: () => { const c = { timeBased: () => c, everyMinutes: () => c, everyHours: () => c, create: () => c }; return c; },
    getService: () => ({ getUrl: () => 'https://script.google.com/a/macros/corp.com/s/XXX/exec' })
  },
  DocumentApp: {
    ParagraphHeading: {},
    create: t => { const body = { items: [], appendParagraph(x) { this.items.push(x); return { setHeading() { } }; }, appendTable(rows) { rows.forEach(r => r.forEach(c => { if (typeof c !== 'string') throw new Error('table cell not string: ' + c); })); this.items.push(rows); } }; return { getBody: () => body, saveAndClose() { }, getId: () => 'DOC1', getUrl: () => 'https://docs.google.com/DOC1' }; }
  },
  HtmlService: {}
};
vm.createContext(ctx);
vm.runInContext(code, ctx);
const G = ctx;
function setNow(s) { FAKE_NOW = new RealDate(s.replace(' ', 'T') + ':00+08:00').getTime(); }
module.exports = { G, sheets, mails, props, setNow, as: e => { ACTIVE = e; } };
