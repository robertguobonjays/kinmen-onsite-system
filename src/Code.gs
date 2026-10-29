/**
 * 金門小三通 駐點維運系統 V2
 * Google Apps Script（綁定 Google Sheet 當資料庫）
 * 功能：帳號登入與權限、排班（登記期間＋系統預排）、叫修回報（含機關免登入報修頁）＋維護工作紀錄、
 *       定期巡檢、SOP／教育訓練（可上傳附件）、管理（帳號、設定、巡檢項目、月維護報告）
 * 依據：金廈(泉)票務系統暨服務採購案_系統保固與維護計畫書V2（附表一～四、陸、玖）
 */

var TZ = 'Asia/Taipei';

var SHEETS = {
  '人員': ['Email', '帳號', '姓名', '角色', '電話', '啟用', '排班', '密碼雜湊', '鹽', '需改密碼', '建立時間', '最後登入'],
  '設定': ['項目', '值', '說明'],
  '班表': ['日期', 'Email', '姓名', '手動', '備註', '更新時間'],
  '班表月份': ['月份', '狀態', '發布時間', '發布人', '登記開始', '登記截止', '登記異動', '預排時間', '預排通知'],
  '不可上班': ['日期', 'Email', '姓名', '原因', '登記時間'],
  '填寫確認': ['月份', 'Email', '姓名', '確認時間', '說明'],
  '叫修單': ['編號', '通報時間', '通報人', '通報單位', '通報電話', '設備系統', '位置編號', '故障現象', '等級',
    '回覆期限', '排除期限', '回覆時間', '回覆人', '處理過程', '排除時間', '備品', '機關確認人', '狀態',
    '照片', '事件報告', '建立者', '建立者Email', '更新時間', '已提醒', '來源'],
  '工作紀錄': ['ID', '日期', '時間', '類別', '內容摘要', '處理結果', '處理人', '關聯編號'],
  '巡檢項目': ['ID', '頻率', '區域', '檢查項目', '排序', '啟用'],
  '巡檢紀錄': ['紀錄ID', '頻率', '期別', '巡檢時間', '巡檢人Email', '巡檢人', '項目ID', '區域', '檢查項目', '結果', '說明', '機關確認人'],
  'SOP': ['ID', '分類', '標題', '內容', '文件連結', '版本', '必讀', '更新日', '更新人'],
  '已讀紀錄': ['SOPID', '版本', 'Email', '姓名', '時間'],
  '寄信佇列': ['ID', '建立時間', '收件者', '主旨', '內容', '狀態', '寄出時間', '錯誤'],
  '工作佇列': ['ID', '建立時間', '類型', '參數', '申請人Email', '狀態', '完成時間', '結果'],
  '打卡紀錄': ['ID', '日期', 'Email', '姓名', '類型', '時間', '照片', '縮圖', '位置', '備註', '補登', '建立者', '建立時間']
};

var DEFAULT_SETTINGS = [
  ['系統名稱', '金門小三通駐點維運系統', '顯示在網頁標題與信件主旨'],
  ['上班時間', '08:00～17:30', '每日一班、一人，全年無休'],
  ['登記開始日', '15', '每月幾號開始登記「下個月」不能上班的日子（各月可在班表頁另外調整）'],
  ['不可上班日登記截止日', '20', '每月幾號截止（截止隔天系統自動預排下個月班表）'],
  ['最多連續上班天數', '6', '自動排班時，同一人最多連續上幾天'],
  ['偏好連續天數', '2', '自動排班時，盡量讓同一人連上幾天再換人（1＝每天輪替）'],
  ['巡檢逾期提醒時間', '11', '幾點還沒做完當日巡檢就寄信提醒（24 小時制）'],
  ['明日值班提醒時間', '17', '幾點寄信提醒明天值班的人'],
  ['保固期滿日', '', 'yyyy-MM-dd，用來提醒「保固期滿前」檢查項目（可空白）'],
  ['保固服務專線', '02-7733-5686，或直接 LINE／群組通報', '非駐點時段的叫修管道，會顯示在報修頁與信件'],
  ['系統網址', '', '系統網頁網址（Vercel 網址），信件裡的連結會用這個（空白則自動抓）'],
  ['檔案資料夾ID', '1GJbVi85Fbp3KOe6Z4_3wP3bBjgogN2T1', '照片、月報、SOP 附件存放的雲端硬碟資料夾'],
  ['登入有效天數', '14', '登入後幾天內不用重新登入']
];

var ROLES = ['管理員', '主管', '駐點'];
var EQUIP_LIST = ['售票櫃台', '自助機台', '閘門', '手持設備', '行李托運', '資訊看板', '線上售票／App', '後台', '機房', '其他'];

var SLA = { // 分鐘：回覆期限、排除期限（保固計畫書 伍、三）
  '1': { reply: 30, fix: 60, name: '第一級', desc: '完全無法正常售票或驗票' },
  '2': { reply: 60, fix: 240, name: '第二級', desc: '部分設備異常，可線上排除' },
  '3': { reply: 120, fix: 1440, name: '第三級', desc: '部分設備異常，需派人到現場' }
};

var FREQS = ['每日', '每週', '每月', '每季', '保固期滿前'];

/* ============================== 網頁入口 ============================== */

function doGet(e) {
  var s = getSettings_();
  var page = e && e.parameter && e.parameter.p === 'report' ? 'Report' : 'Index';
  return HtmlService.createHtmlOutputFromFile(page)
    .setTitle(page === 'Report' ? '系統叫修通報' : (s['系統名稱'] || '駐點維運系統'))
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** Vercel 後端轉呼叫：POST {fn:'api_xxx', args:[...], origin:'https://…vercel.app'} → JSON { ok, result } 或 { error } */
function doPost(e) {
  var out;
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var fn = String(body.fn || '');
    if (!/^api_[A-Za-z]+$/.test(fn) || typeof globalThis[fn] !== 'function') throw new Error('不支援的功能');
    if (body.origin && /^https:\/\/[\w.-]+$/.test(body.origin) && !getSettings_()['系統網址']) setSetting_('系統網址', body.origin);
    var r = globalThis[fn].apply(null, Array.isArray(body.args) ? body.args : []);
    out = { ok: true, result: r === undefined ? null : r };
  } catch (err) {
    out = { error: String((err && err.message) || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function onOpen() {
  try {
    SpreadsheetApp.getUi().createMenu('駐點系統')
      .addItem('① 初始化／升級（建立工作表、範本資料、排程）', 'setup')
      .addItem('② 重新安裝排程（寄信提醒）', 'installTriggers')
      .addToUi();
  } catch (e) { /* 非試算表介面時略過 */ }
}

/* ============================== 共用工具 ============================== */

var HEAD_ = {};

function ss_() { return SpreadsheetApp.getActiveSpreadsheet(); }

function sh_(name) {
  var ss = ss_(), s = ss.getSheetByName(name);
  if (!s && SHEETS[name]) { // 新版本新增的工作表：第一次用到時自動建立
    s = ss.insertSheet(name);
    s.getRange(1, 1, 1, SHEETS[name].length).setValues([SHEETS[name]]).setFontWeight('bold').setBackground('#e8f0fe');
    s.setFrozenRows(1);
    s.getRange(1, 1, s.getMaxRows(), SHEETS[name].length).setNumberFormat('@');
    delete HEAD_[name];
  }
  if (!s) throw new Error('找不到工作表「' + name + '」，請先在試算表選單執行「駐點系統 → 初始化」');
  return s;
}

function fmt_(d, p) { return Utilities.formatDate(d, TZ, p || 'yyyy-MM-dd HH:mm'); }
function now_() { return fmt_(new Date()); }
function today_() { return fmt_(new Date(), 'yyyy-MM-dd'); }

function parseDate_(s) { // 'yyyy-MM-dd' 或 'yyyy-MM-dd HH:mm' → Date（以 Asia/Taipei 解讀）
  var m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/);
  if (!m) return null;
  return new Date(m[1] + '-' + m[2] + '-' + m[3] + 'T' + (m[4] || '00') + ':' + (m[5] || '00') + ':00+08:00');
}

function addMin_(s, min) { return fmt_(new Date(parseDate_(s).getTime() + min * 60000)); }

function addDays_(dateStr, n) {
  var d = parseDate_(dateStr);
  return fmt_(new Date(d.getTime() + n * 86400000), 'yyyy-MM-dd');
}

function weekday_(dateStr) { return Number(fmt_(parseDate_(dateStr), 'u')); } // 1=一 … 7=日

function monthDays_(month) { // 'yyyy-MM' → ['yyyy-MM-01', …]
  var p = month.split('-'), y = Number(p[0]), m = Number(p[1]);
  var n = new Date(Date.UTC(y, m, 0)).getUTCDate(), out = [];
  for (var i = 1; i <= n; i++) out.push(month + '-' + (i < 10 ? '0' : '') + i);
  return out;
}

function nextMonth_(month) {
  var p = month.split('-'), y = Number(p[0]), m = Number(p[1]) + 1;
  if (m > 12) { m = 1; y++; }
  return y + '-' + (m < 10 ? '0' : '') + m;
}

function prevMonth_(month) {
  var p = month.split('-'), y = Number(p[0]), m = Number(p[1]) - 1;
  if (m < 1) { m = 12; y--; }
  return y + '-' + (m < 10 ? '0' : '') + m;
}

function dayOf_(month, day) { // 某月第 day 天（超過月底取月底）
  var days = monthDays_(month);
  return days[Math.min(Math.max(1, day), days.length) - 1];
}

function cell_(v) {
  if (v instanceof Date) {
    return fmt_(v, 'HH:mm') === '00:00' ? fmt_(v, 'yyyy-MM-dd') : fmt_(v);
  }
  return v === null || v === undefined ? '' : String(v);
}

function readTable_(name) {
  var s = sh_(name), vals = s.getDataRange().getValues();
  var head = vals[0].map(String), out = [];
  for (var r = 1; r < vals.length; r++) {
    var o = { _row: r + 1 }, empty = true;
    for (var c = 0; c < head.length; c++) {
      if (!head[c]) continue;
      o[head[c]] = cell_(vals[r][c]);
      if (o[head[c]] !== '') empty = false;
    }
    if (!empty) out.push(o);
  }
  return out;
}

function header_(name) { // 以工作表實際標題列為準（升級時新增的欄位會在最後面）
  if (!HEAD_[name]) {
    var s = sh_(name), lc = s.getLastColumn();
    var h = lc ? s.getRange(1, 1, 1, lc).getValues()[0].map(String) : [];
    while (h.length && !h[h.length - 1]) h.pop();
    HEAD_[name] = h.length ? h : SHEETS[name];
  }
  return HEAD_[name];
}

function rowOf_(name, obj) {
  return header_(name).map(function (h) { var v = obj[h]; return v === undefined || v === null ? '' : String(v); });
}

function appendObjs_(name, objs) {
  if (!objs.length) return;
  var s = sh_(name), h = header_(name);
  var rows = objs.map(function (o) { return rowOf_(name, o); });
  var r = s.getLastRow() + 1;
  s.getRange(r, 1, rows.length, h.length).setNumberFormat('@').setValues(rows);
}

function appendObj_(name, obj) { appendObjs_(name, [obj]); }

function updateObj_(name, rowNum, obj) {
  var s = sh_(name), h = header_(name);
  var rng = s.getRange(rowNum, 1, 1, h.length);
  var cur = rng.getValues()[0].map(cell_);
  h.forEach(function (k, i) { if (obj.hasOwnProperty(k)) cur[i] = obj[k] === null || obj[k] === undefined ? '' : String(obj[k]); });
  rng.setNumberFormat('@').setValues([cur]);
}

function deleteRows_(name, rowNums) {
  var s = sh_(name);
  rowNums.slice().sort(function (a, b) { return b - a; }).forEach(function (r) { s.deleteRow(r); });
}

function rewrite_(name, objs) { // 整張表重寫（排班用，資料量小）
  var s = sh_(name), h = header_(name), last = s.getLastRow();
  if (last > 1) s.getRange(2, 1, last - 1, h.length).clearContent();
  if (objs.length) s.getRange(2, 1, objs.length, h.length).setNumberFormat('@').setValues(objs.map(function (o) { return rowOf_(name, o); }));
}

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally { lock.releaseLock(); }
}

function uid_(prefix) { return prefix + fmt_(new Date(), 'yyMMddHHmmss') + Math.floor(Math.random() * 900 + 100); }

function esc_(s) {
  return String(s === undefined || s === null ? '' : s).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
  });
}

function md_(s) { var p = s.split('-'); return Number(p[1]) + '/' + Number(p[2]); }

var WD = ['', '一', '二', '三', '四', '五', '六', '日'];

/* ============================== 設定與人員 ============================== */

function getSettings_() {
  var out = {};
  DEFAULT_SETTINGS.forEach(function (r) { out[r[0]] = r[1]; });
  try { readTable_('設定').forEach(function (r) { out[r['項目']] = r['值']; }); } catch (e) { }
  return out;
}

function people_(includeInactive) {
  return readTable_('人員').map(function (p) {
    var role = ROLES.indexOf(p['角色']) >= 0 ? p['角色'] : '駐點';
    return {
      email: String(p['Email']).trim().toLowerCase(), account: String(p['帳號'] || '').trim().toLowerCase(),
      name: p['姓名'], role: role, phone: p['電話'], active: p['啟用'] !== 'N',
      sched: p['排班'] ? p['排班'] === 'Y' : role === '駐點',
      hash: p['密碼雜湊'], salt: p['鹽'], mustChange: p['需改密碼'] === 'Y', lastLogin: p['最後登入'], _row: p._row
    };
  }).filter(function (p) { return p.email && (includeInactive || p.active); });
}

function staff_() { return people_().filter(function (p) { return p.sched; }); }
function admins_() { return people_().filter(function (p) { return p.role === '管理員' || p.role === '主管'; }); }
function nameOf_(email) { var p = people_(true).filter(function (x) { return x.email === email; })[0]; return p ? p.name : email; }

function publicPerson_(p) {
  return { email: p.email, account: p.account, name: p.name, role: p.role, phone: p.phone, active: p.active, sched: p.sched, lastLogin: p.lastLogin, hasPw: !!p.hash };
}

function appUrl_() {
  var s = getSettings_();
  if (s['系統網址']) return s['系統網址'];
  try { return ScriptApp.getService().getUrl() || ''; } catch (e) { return ''; }
}

function reportUrl_() {
  var u = appUrl_();
  if (!u) return '';
  return /script\.google/.test(u) ? u + '?p=report' : u.replace(/\/+$/, '') + '/report';
}

function folder_() {
  var s = getSettings_(), id = s['檔案資料夾ID'];
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) { console.error('無法開啟資料夾 ' + id + '：' + e); } }
  var f = DriveApp.createFolder(s['系統名稱'] + '_檔案');
  setSetting_('檔案資料夾ID', f.getId());
  return f;
}

function subFolder_(name) {
  var root = folder_(), it = root.getFoldersByName(name);
  return it.hasNext() ? it.next() : root.createFolder(name);
}

function setSetting_(key, val) {
  var rows = readTable_('設定'), r = rows.filter(function (x) { return x['項目'] === key; })[0];
  if (r) updateObj_('設定', r._row, { '值': val });
  else {
    var d = DEFAULT_SETTINGS.filter(function (x) { return x[0] === key; })[0];
    appendObj_('設定', { '項目': key, '值': val, '說明': d ? d[2] : '' });
  }
}

/* ============================== 登入與權限 ============================== */

function hash_(salt, pw) {
  var v = salt + '|' + pw;
  for (var i = 0; i < 200; i++) {
    v = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, v + salt, Utilities.Charset.UTF_8));
  }
  return v;
}

function newSalt_() { return Utilities.getUuid().replace(/-/g, ''); }

function tempPassword_() {
  var c = 'abcdefghjkmnpqrstuvwxyz23456789', s = '';
  for (var i = 0; i < 8; i++) s += c.charAt(Math.floor(Math.random() * c.length));
  return s;
}

function checkPassword_(pw) {
  if (!pw || String(pw).length < 6) throw new Error('密碼至少 6 個字');
}

function startSession_(p) {
  var tk = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  var days = Number(getSettings_()['登入有效天數']) || 14;
  PropertiesService.getScriptProperties().setProperty('sess_' + tk, JSON.stringify({ e: p.email, x: Date.now() + days * 86400000 }));
  updateObj_('人員', p._row, { '最後登入': now_() });
  return tk;
}

function sessionEmail_(tk) {
  if (!tk || !/^[0-9a-f]{64}$/.test(String(tk))) return '';
  var props = PropertiesService.getScriptProperties(), raw = props.getProperty('sess_' + tk);
  if (!raw) return '';
  try {
    var s = JSON.parse(raw);
    if (s.x < Date.now()) { props.deleteProperty('sess_' + tk); return ''; }
    return s.e;
  } catch (e) { return ''; }
}

function me_(tk) {
  var email = sessionEmail_(tk);
  if (!email) throw new Error('NEED_LOGIN');
  var p = people_().filter(function (x) { return x.email === email; })[0];
  if (!p) { PropertiesService.getScriptProperties().deleteProperty('sess_' + tk); throw new Error('NEED_LOGIN'); }
  p.isAdmin = p.role === '管理員' || p.role === '主管';
  p.isOwner = p.role === '管理員';
  return p;
}

function requireAdmin_(tk) {
  var me = me_(tk);
  if (!me.isAdmin) throw new Error('這個功能只有主管可以使用。');
  return me;
}

function requireOwner_(tk) {
  var me = me_(tk);
  if (!me.isOwner) throw new Error('帳號管理只有「管理員」可以使用。');
  return me;
}

function api_login(account, password) {
  account = String(account || '').trim().toLowerCase();
  if (!account || !password) throw new Error('請輸入帳號與密碼');
  var cache = CacheService.getScriptCache(), key = 'fail_' + account, fails = Number(cache.get(key) || 0);
  if (fails >= 5) throw new Error('密碼錯誤太多次，請 10 分鐘後再試，或請管理員重設密碼。');
  var p = people_().filter(function (x) { return x.account === account || x.email === account; })[0];
  if (!p || !p.hash || hash_(p.salt, password) !== p.hash) {
    cache.put(key, String(fails + 1), 600);
    throw new Error('帳號或密碼錯誤');
  }
  cache.remove(key);
  return { token: startSession_(p), mustChange: p.mustChange };
}

/** 公司 Google 帳號登入（網頁部署為「網域內使用者」時才取得到 Email） */
function api_googleLogin() {
  var email = '';
  try { email = String(Session.getActiveUser().getEmail() || '').toLowerCase(); } catch (e) { }
  if (!email) return null;
  var p = people_().filter(function (x) { return x.email === email; })[0];
  return p ? { token: startSession_(p), mustChange: false } : null;
}

function api_logout(tk) {
  if (tk && /^[0-9a-f]{64}$/.test(String(tk))) PropertiesService.getScriptProperties().deleteProperty('sess_' + tk);
  return true;
}

function api_changePassword(tk, oldPw, newPw) {
  var me = me_(tk);
  if (me.hash && hash_(me.salt, oldPw) !== me.hash) throw new Error('目前密碼不正確');
  checkPassword_(newPw);
  var salt = newSalt_();
  updateObj_('人員', me._row, { '密碼雜湊': hash_(salt, newPw), '鹽': salt, '需改密碼': '' });
  return true;
}

/* ============================== 寄信 ============================== */

function mail_(to, subject, html) {
  var list = [].concat(to).map(function (x) { return typeof x === 'string' ? x : (x && x.email); })
    .filter(function (x, i, a) { return x && a.indexOf(x) === i; });
  if (!list.length) return;
  var s = getSettings_(), url = appUrl_();
  var body = '<div style="font-family:Microsoft JhengHei,PingFang TC,sans-serif;font-size:14px;line-height:1.7;color:#222">' +
    html + (url ? '<p style="margin-top:20px"><a href="' + url + '" style="background:#0b5cad;color:#fff;padding:8px 16px;border-radius:6px;text-decoration:none">開啟' + esc_(s['系統名稱']) + '</a></p>' : '') +
    '<p style="color:#888;font-size:12px">此信由系統自動寄出。</p></div>';
  try {
    MailApp.sendEmail({ to: list.join(','), subject: '【' + s['系統名稱'] + '】' + subject, htmlBody: body, name: s['系統名稱'] });
  } catch (e) { console.error('寄信失敗：' + e); }
}

function table_(head, rows) {
  var th = 'style="border:1px solid #ccc;padding:4px 8px;background:#f0f4f8;text-align:left"';
  var td = 'style="border:1px solid #ccc;padding:4px 8px"';
  return '<table style="border-collapse:collapse;margin:8px 0">' +
    '<tr>' + head.map(function (h) { return '<th ' + th + '>' + esc_(h) + '</th>'; }).join('') + '</tr>' +
    rows.map(function (r) { return '<tr>' + r.map(function (c) { return '<td ' + td + '>' + esc_(c) + '</td>'; }).join('') + '</tr>'; }).join('') +
    '</table>';
}

/* ============================== 初始化資料 ============================== */

function api_init(tk) {
  var me = me_(tk), s = getSettings_(), t = today_();
  var nm = nextMonth_(t.slice(0, 7)), w = windowOf_(nm);
  return {
    me: { email: me.email, account: me.account, name: me.name, role: me.role, isAdmin: me.isAdmin, isOwner: me.isOwner, sched: me.sched, mustChange: me.mustChange },
    people: people_(true).map(publicPerson_),
    settings: s, today: t, now: now_(), equip: EQUIP_LIST, sla: SLA, freqs: FREQS, roles: ROLES,
    defaultMonth: t >= w.start ? nm : t.slice(0, 7),
    reportUrl: reportUrl_()
  };
}

/* ============================== 首頁 ============================== */

function api_home(tk) {
  var me = me_(tk), t = today_(), tm = addDays_(t, 1), month = t.slice(0, 7);
  var shifts = readTable_('班表'), months = monthStatusMap_();
  var pub = function (d) { return months[d.slice(0, 7)] === '已發布' || me.isAdmin; };
  var duty = function (d) { var r = shifts.filter(function (x) { return x['日期'] === d; })[0]; return r && pub(d) ? r['姓名'] : ''; };
  var mine = shifts.filter(function (x) { return x['Email'] === me.email && x['日期'] >= t && pub(x['日期']); })
    .sort(function (a, b) { return a['日期'] < b['日期'] ? -1 : 1; }).slice(0, 6)
    .map(function (x) { return x['日期']; });

  var insp = inspectionStatus_(t);
  var tickets = readTable_('叫修單').filter(function (x) { return x['狀態'] !== '已結案'; }).map(ticketView_);
  var sops = readTable_('SOP'), reads = readTable_('已讀紀錄').filter(function (x) { return x['Email'] === me.email; });
  var unread = sops.filter(function (x) {
    return x['必讀'] === 'Y' && !reads.some(function (r) { return r['SOPID'] === x['ID'] && r['版本'] === x['版本']; });
  }).map(function (x) { return { id: x['ID'], title: x['標題'] }; });

  // 登記提醒：目前開放登記中的月份
  var confirms = readTable_('填寫確認'), leave = null;
  [month, nextMonth_(month), nextMonth_(nextMonth_(month))].forEach(function (m) {
    if (leave) return;
    var w = windowOf_(m);
    if (t >= w.start && t <= w.end && months[m] !== '已發布') {
      leave = { month: m, start: w.start, end: w.end, sched: me.sched,
        confirmed: confirms.some(function (x) { return x['月份'] === m && x['Email'] === me.email; }) };
    }
  });

  // 主管：下個月班表概況
  var plan = null;
  if (me.isAdmin) {
    var nm = nextMonth_(month), w2 = windowOf_(nm), st = staff_();
    plan = {
      month: nm, status: months[nm] || '未排班', start: w2.start, end: w2.end,
      done: st.filter(function (p) { return confirms.some(function (x) { return x['月份'] === nm && x['Email'] === p.email; }); }).map(function (p) { return p.name; }),
      notYet: st.filter(function (p) { return !confirms.some(function (x) { return x['月份'] === nm && x['Email'] === p.email; }); }).map(function (p) { return p.name; })
    };
  }

  var dutyRow = shifts.filter(function (x) { return x['日期'] === t; })[0];
  var punch = { mine: punchSummary_(t, t, me.email)[0] || null, hours: workHours_() };
  if (me.isAdmin && dutyRow && dutyRow['Email']) punch.duty = { name: dutyRow['姓名'], rec: punchSummary_(t, t, dutyRow['Email'])[0] || null };
  return { today: t, todayDuty: duty(t), tomorrowDuty: duty(tm), myShifts: mine, insp: insp, tickets: tickets, leave: leave, plan: plan, unread: unread, punch: punch };
}

/* ============================== 排班 ============================== */

function monthRows_() {
  var m = {};
  readTable_('班表月份').forEach(function (r) { m[r['月份']] = r; });
  return m;
}

function monthStatusMap_() {
  var m = {}, rows = monthRows_();
  Object.keys(rows).forEach(function (k) { m[k] = rows[k]['狀態'] || '未排班'; });
  return m;
}

function windowOf_(month, row) {
  row = row || monthRows_()[month] || {};
  var s = getSettings_(), pm = prevMonth_(month);
  var sd = Number(s['登記開始日']) || 15, ed = Number(s['不可上班日登記截止日']) || 20;
  return { start: row['登記開始'] || dayOf_(pm, sd), end: row['登記截止'] || dayOf_(pm, Math.max(sd, ed)) };
}

function setMonthRow_(month, obj) {
  var r = readTable_('班表月份').filter(function (x) { return x['月份'] === month; })[0];
  if (r) updateObj_('班表月份', r._row, obj);
  else { obj['月份'] = month; if (!obj['狀態']) obj['狀態'] = '未排班'; appendObj_('班表月份', obj); }
}

function touchMonth_(month) { setMonthRow_(month, { '登記異動': fmt_(new Date(), 'yyyy-MM-dd HH:mm:ss') }); }

function api_getSchedule(tk, month) {
  var me = me_(tk), t = today_(), auto = '';
  if (me.isAdmin && month >= t.slice(0, 7) && staff_().length) {
    var row0 = monthRows_()[month] || {}, st0 = row0['狀態'] || '未排班';
    if (st0 === '未排班') { autoSchedule_(month, true); auto = 'new'; }
    else if (st0 === '草稿' && row0['登記異動'] && row0['登記異動'] > (row0['預排時間'] || '')) { autoSchedule_(month, true); auto = 'redo'; }
  }
  var row = monthRows_()[month] || {}, status = row['狀態'] || '未排班';
  var show = me.isAdmin || status === '已發布';
  var shifts = readTable_('班表').filter(function (x) { return x['日期'].slice(0, 7) === month; });
  var map = {};
  shifts.forEach(function (x) { map[x['日期']] = x; });
  var unav = readTable_('不可上班').filter(function (x) { return x['日期'].slice(0, 7) === month; })
    .map(function (x) { return { date: x['日期'], email: x['Email'], name: x['姓名'], reason: x['原因'] }; });
  var days = monthDays_(month).map(function (d) {
    var r = map[d] || {}, em = show ? (r['Email'] || '') : '';
    return {
      date: d, wd: weekday_(d), email: em, name: show ? (r['姓名'] || '') : '', manual: show && r['手動'] === 'Y', note: show ? (r['備註'] || '') : '',
      conflict: !!em && unav.some(function (u) { return u.date === d && u.email === em; })
    };
  });
  var confirms = readTable_('填寫確認').filter(function (x) { return x['月份'] === month; })
    .map(function (x) { return { email: x['Email'], name: x['姓名'], at: x['確認時間'], note: x['說明'] }; });
  var stats = {};
  days.forEach(function (d) { if (d.email) stats[d.email] = (stats[d.email] || 0) + 1; });
  var w = windowOf_(month, row);
  return {
    month: month, status: status, publishedAt: row['發布時間'] || '', plannedAt: row['預排時間'] || '', visible: show, auto: auto,
    days: days, unavail: unav, confirms: confirms, stats: stats,
    staff: staff_().map(function (p) { return { email: p.email, name: p.name }; }),
    window: { start: w.start, end: w.end, open: t >= w.start && t <= w.end, custom: !!row['登記開始'] },
    deadline: w.end, today: t
  };
}

function api_setWindow(tk, month, start, end) {
  var me = requireAdmin_(tk);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || start > end) throw new Error('登記期間格式錯誤（開始日要早於截止日）');
  withLock_(function () { setMonthRow_(month, { '登記開始': start, '登記截止': end, '預排通知': '' }); });
  var t = today_();
  if (t >= start && t <= end) {
    mail_(staff_(), month + ' 開放登記不能上班的日子（' + md_(start) + '～' + md_(end) + '）',
      '<p>' + esc_(me.name) + ' 開放登記 <b>' + month + '</b> 不能上班的日子，期間 <b>' + start + ' ～ ' + end + '</b>。</p>' +
      '<p>請到「班表」點選不能上班的日子後按「我登記好了」；都可以的話按「我都可以，聽安排」。完成前系統每天早上會提醒一次。</p>');
  }
  return true;
}

function api_toggleUnavail(tk, date, reason, forEmail) {
  var me = me_(tk);
  if (forEmail && forEmail !== me.email && !me.isAdmin) throw new Error('只能登記自己的日子');
  var who = forEmail ? people_().filter(function (p) { return p.email === forEmail; })[0] : me;
  if (!who) throw new Error('找不到人員');
  if (date < today_()) throw new Error('不能登記今天以前的日期。');
  return withLock_(function () {
    var month = date.slice(0, 7);
    var rows = readTable_('不可上班').filter(function (x) { return x['日期'] === date && x['Email'] === who.email; });
    if (rows.length) {
      deleteRows_('不可上班', rows.map(function (r) { return r._row; }));
      touchMonth_(month);
      return { on: false };
    }
    appendObj_('不可上班', { '日期': date, 'Email': who.email, '姓名': who.name, '原因': reason || '', '登記時間': now_() });
    touchMonth_(month);
    // 已發布且當天是他值班 → 通知主管調班
    if (monthStatusMap_()[month] === '已發布') {
      var sh = readTable_('班表').filter(function (x) { return x['日期'] === date; })[0];
      if (sh && sh['Email'] === who.email) {
        mail_(admins_(), '班表衝突：' + who.name + ' ' + md_(date) + ' 無法上班',
          '<p>' + esc_(who.name) + ' 登記 <b>' + date + '（' + WD[weekday_(date)] + '）</b> 無法上班，但當天已排他值班。</p>' +
          '<p>原因：' + esc_(reason || '（未填）') + '</p><p>請到「班表」調整當天值班人員。</p>');
        return { on: true, conflict: true };
      }
    }
    return { on: true };
  });
}

function api_confirmMonth(tk, month) {
  var me = me_(tk);
  return withLock_(function () {
    var old = readTable_('填寫確認').filter(function (x) { return x['月份'] === month && x['Email'] === me.email; });
    deleteRows_('填寫確認', old.map(function (r) { return r._row; }));
    var mine = readTable_('不可上班').filter(function (x) { return x['日期'].slice(0, 7) === month && x['Email'] === me.email; })
      .map(function (x) { return md_(x['日期']) + (x['原因'] ? '（' + x['原因'] + '）' : ''); });
    var note = mine.length ? '不能上班 ' + mine.length + ' 天' : '都可以，聽安排';
    appendObj_('填寫確認', { '月份': month, 'Email': me.email, '姓名': me.name, '確認時間': now_(), '說明': note });
    touchMonth_(month);
    mail_(admins_().filter(function (a) { return a.email !== me.email; }), me.name + ' 已完成 ' + month + ' 登記（' + note + '）',
      '<p>' + esc_(me.name) + ' 已確認 ' + month + ' 的班：</p><p><b>' + (mine.length ? '不能上班：' + esc_(mine.join('、')) : '都可以，聽安排') + '</b></p>');
    return true;
  });
}

function api_autoSchedule(tk, month, keepManual) {
  requireAdmin_(tk);
  return autoSchedule_(month, keepManual);
}

function autoSchedule_(month, keepManual) {
  return withLock_(function () {
    var s = getSettings_();
    var maxC = Math.max(1, Number(s['最多連續上班天數']) || 6);
    var block = Math.max(1, Number(s['偏好連續天數']) || 2);
    var staff = staff_();
    if (!staff.length) throw new Error('沒有可排班的人員，請到「管理 → 帳號」把人員設為「可排班」。');
    var days = monthDays_(month);
    var un = {};
    readTable_('不可上班').forEach(function (x) { un[x['日期'] + '|' + x['Email']] = true; });
    var all = readTable_('班表');
    var kept = {};
    if (keepManual) all.forEach(function (x) { if (x['日期'].slice(0, 7) === month && x['手動'] === 'Y') kept[x['日期']] = x; });

    // 上個月最後幾天的連續狀態
    var last = '', run = 0;
    var before = all.filter(function (x) { return x['日期'] < days[0]; }).sort(function (a, b) { return a['日期'] < b['日期'] ? -1 : 1; });
    for (var i = before.length - 1, expect = addDays_(days[0], -1); i >= 0 && before[i]['日期'] === expect; i--, expect = addDays_(expect, -1)) {
      if (!last) last = before[i]['Email'];
      if (before[i]['Email'] !== last) break;
      run++;
    }

    var counts = {};
    staff.forEach(function (p) { counts[p.email] = 0; });
    Object.keys(kept).forEach(function (d) { if (counts.hasOwnProperty(kept[d]['Email'])) counts[kept[d]['Email']]++; });
    var futureAvail = function (email, fromIdx) {
      var n = 0;
      for (var k = fromIdx; k < days.length; k++) if (!un[days[k] + '|' + email] && !kept[days[k]]) n++;
      return n;
    };

    var result = [], gaps = [], t = now_();
    days.forEach(function (d, idx) {
      if (kept[d]) {
        var k = kept[d];
        result.push(k);
        run = k['Email'] === last ? run + 1 : 1; last = k['Email'];
        return;
      }
      var avail = staff.filter(function (p) { return !un[d + '|' + p.email]; });
      if (!avail.length) {
        result.push({ '日期': d, 'Email': '', '姓名': '', '手動': '', '備註': '缺人（全部不可上班）', '更新時間': t });
        gaps.push(d); last = ''; run = 0;
        return;
      }
      var ok = avail.filter(function (p) { return !(p.email === last && run >= maxC); });
      var note = '';
      if (!ok.length) { ok = avail; note = '超過連續上班上限'; }
      var minC = Math.min.apply(null, ok.map(function (p) { return counts[p.email]; }));
      var pick = null;
      var lastOk = ok.filter(function (p) { return p.email === last; })[0];
      if (lastOk && run < block && counts[last] <= minC + 1) pick = lastOk;
      if (!pick) {
        var pool = ok.length > 1 ? ok.filter(function (p) { return p.email !== last; }) : ok;
        pool.sort(function (a, b) {
          return (counts[a.email] - counts[b.email]) || (futureAvail(a.email, idx) - futureAvail(b.email, idx));
        });
        pick = pool[0];
      }
      counts[pick.email]++;
      run = pick.email === last ? run + 1 : 1; last = pick.email;
      result.push({ '日期': d, 'Email': pick.email, '姓名': pick.name, '手動': '', '備註': note, '更新時間': t });
    });

    var others = all.filter(function (x) { return x['日期'].slice(0, 7) !== month; });
    rewrite_('班表', others.concat(result).sort(function (a, b) { return a['日期'] < b['日期'] ? -1 : 1; }));
    var st = monthStatusMap_()[month];
    setMonthRow_(month, { '狀態': st === '已發布' ? '已發布' : '草稿', '預排時間': fmt_(new Date(), 'yyyy-MM-dd HH:mm:ss') });
    return { gaps: gaps };
  });
}

function api_setShift(tk, date, email, note) {
  var me = requireAdmin_(tk);
  return withLock_(function () {
    var rows = readTable_('班表'), r = rows.filter(function (x) { return x['日期'] === date; })[0];
    var oldEmail = r ? r['Email'] : '';
    var name = email ? nameOf_(email) : '';
    var o = { '日期': date, 'Email': email || '', '姓名': name, '手動': 'Y', '備註': note || '', '更新時間': now_() };
    if (r) updateObj_('班表', r._row, o); else appendObj_('班表', o);
    var month = date.slice(0, 7), st = monthStatusMap_()[month];
    if (!st || st === '未排班') setMonthRow_(month, { '狀態': '草稿' });
    if (st === '已發布' && oldEmail !== (email || '')) {
      var txt = date + '（' + WD[weekday_(date)] + '）值班：' + (oldEmail ? nameOf_(oldEmail) : '（無）') + ' → ' + (name || '（無）');
      mail_([oldEmail, email].concat(admins_().map(function (a) { return a.email; })), '班表異動 ' + md_(date),
        '<p>' + esc_(me.name) + ' 調整了已發布的班表：</p><p><b>' + esc_(txt) + '</b></p>' + (note ? '<p>備註：' + esc_(note) + '</p>' : ''));
    }
    return true;
  });
}

function scheduleMailHtml_(data) {
  var s = getSettings_();
  var rows = data.days.map(function (d) { return [md_(d.date), WD[d.wd], d.name || '（缺人）', d.note]; });
  var stat = Object.keys(data.stats).map(function (e) { return [nameOf_(e), data.stats[e] + ' 天']; });
  return '<p>上班時間 ' + esc_(s['上班時間']) + '，每天一人。</p>' + table_(['日期', '星期', '值班', '備註'], rows) + '<p>天數統計：</p>' + table_(['人員', '天數'], stat);
}

function api_publish(tk, month) {
  var me = requireAdmin_(tk);
  var data = api_getSchedule(tk, month);
  setMonthRow_(month, { '狀態': '已發布', '發布時間': now_(), '發布人': me.name });
  mail_(people_(), month + ' 班表已發布' + (data.publishedAt ? '（更新版）' : ''), '<p>' + month + ' 駐點班表已發布。</p>' + scheduleMailHtml_(data));
  return true;
}

/* ============================== 叫修單（附表一） ============================== */

function ticketView_(t) {
  var n = now_(), lv = SLA[t['等級']] || SLA['2'];
  var replyOver = !t['回覆時間'] && t['回覆期限'] && n > t['回覆期限'];
  var fixOver = !t['排除時間'] && t['排除期限'] && n > t['排除期限'];
  var replyLate = t['回覆時間'] && t['回覆時間'] > t['回覆期限'];
  var fixLate = t['排除時間'] && t['排除時間'] > t['排除期限'];
  var photos = String(t['照片'] || '').split('\n').filter(String);
  return {
    id: t['編號'], at: t['通報時間'], reporter: t['通報人'], unit: t['通報單位'], phone: t['通報電話'],
    equip: t['設備系統'], loc: t['位置編號'], symptom: t['故障現象'], level: t['等級'], levelName: lv.name,
    replyDue: t['回覆期限'], fixDue: t['排除期限'], replyAt: t['回覆時間'], replyBy: t['回覆人'],
    process: t['處理過程'], fixAt: t['排除時間'], spare: t['備品'], confirmBy: t['機關確認人'], status: t['狀態'],
    photos: photos, eventReport: t['事件報告'], creator: t['建立者'], creatorEmail: t['建立者Email'], updated: t['更新時間'],
    source: t['來源'] || '系統',
    replyOver: !!replyOver, fixOver: !!fixOver, replyLate: !!replyLate, fixLate: !!fixLate
  };
}

function api_listTickets(tk, filter) {
  me_(tk);
  filter = filter || {};
  var list = readTable_('叫修單');
  if (filter.month) list = list.filter(function (x) { return x['通報時間'].slice(0, 7) === filter.month; });
  if (filter.open) list = list.filter(function (x) { return x['狀態'] !== '已結案'; });
  return list.map(ticketView_).sort(function (a, b) { return a.at < b.at ? 1 : -1; });
}

function nextTicketId_(at) {
  var prefix = 'R' + at.slice(2, 4) + at.slice(5, 7) + at.slice(8, 10) + '-';
  var n = readTable_('叫修單').filter(function (x) { return String(x['編號']).indexOf(prefix) === 0; }).length + 1;
  return prefix + (n < 10 ? '0' : '') + n;
}

function createTicket_(me, o, source) {
  if (!o.symptom) throw new Error('請填寫故障現象。');
  if (!o.equip) throw new Error('請選擇設備或系統。');
  var lv = SLA[String(o.level)] ? String(o.level) : '2';
  var at = o.at && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(o.at) ? o.at : now_();
  var id = nextTicketId_(at);
  var rec = {
    '編號': id, '通報時間': at, '通報人': o.reporter || me.name, '通報單位': o.unit || '', '通報電話': o.phone || '',
    '設備系統': o.equip, '位置編號': o.loc || '', '故障現象': o.symptom, '等級': lv,
    '回覆期限': addMin_(at, SLA[lv].reply), '排除期限': addMin_(at, SLA[lv].fix),
    '狀態': '待回覆', '照片': (o.photos || []).join('\n'), '建立者': me.name, '建立者Email': me.email || '', '更新時間': now_(), '已提醒': '',
    '來源': source || '系統'
  };
  appendObj_('叫修單', rec);
  addLog_('叫修', '受理 ' + id + '：' + o.equip + (o.loc ? '／' + o.loc : '') + '－' + o.symptom, '待回覆', me.name, id);
  var lvName = SLA[lv].name;
  mail_(people_(), '［' + lvName + '］新叫修 ' + id + '：' + o.equip + (source === '報修頁' ? '（機關報修）' : ''),
    '<p style="font-size:16px"><b style="color:' + (lv === '1' ? '#c62828' : '#0b5cad') + '">' + lvName + '</b>（' + esc_(SLA[lv].desc) + '）</p>' +
    table_(['欄位', '內容'], [['編號', id], ['來源', rec['來源']], ['通報時間', at], ['通報人', rec['通報人'] + ' ' + rec['通報單位'] + ' ' + rec['通報電話']],
    ['設備或系統', o.equip], ['位置／編號', o.loc || ''], ['故障現象', o.symptom], ['回覆期限', rec['回覆期限']], ['排除期限', rec['排除期限']]]) +
    (lv === '1' ? '<p style="color:#c62828"><b>第一級：預估超過 10 分鐘無法恢復時，請立即通報現場主管，建議啟動人工應變。</b></p>' : ''));
  return id;
}

function api_createTicket(tk, o) {
  var me = me_(tk);
  return withLock_(function () { return createTicket_(me, o, '系統'); });
}

/* ---------- 機關免登入報修頁 ---------- */

function publicLimit_(key, max) {
  var c = CacheService.getScriptCache(), n = Number(c.get(key) || 0);
  if (n >= max) throw new Error('目前通報太頻繁，請改用電話或 LINE 通報：' + getSettings_()['保固服務專線']);
  c.put(key, String(n + 1), 600);
}

function api_publicInfo() {
  var s = getSettings_();
  return { name: s['系統名稱'], hotline: s['保固服務專線'], hours: s['上班時間'], equip: EQUIP_LIST };
}

function api_publicReport(o) {
  o = o || {};
  if (o.website) return 'OK'; // 防機器人欄位
  publicLimit_('pub_report', 20);
  var clip = function (v, n) { return String(v || '').trim().slice(0, n); };
  var data = {
    reporter: clip(o.reporter, 30), unit: clip(o.unit, 40), phone: clip(o.phone, 30),
    equip: EQUIP_LIST.indexOf(o.equip) >= 0 ? o.equip : '其他', loc: clip(o.loc, 60), symptom: clip(o.symptom, 1000),
    level: ({ all: '1', part: '2', later: '3' })[o.impact] || '2',
    photos: (o.photos || []).filter(function (x) { return /^[\w-]{10,80}$/.test(x); }).slice(0, 5)
  };
  if (!data.reporter) throw new Error('請填寫您的姓名');
  if (!data.symptom) throw new Error('請描述發生什麼問題');
  return withLock_(function () { return createTicket_({ name: '機關報修', email: '' }, data, '報修頁'); });
}

function api_publicUpload(name, dataUrl) {
  publicLimit_('pub_upload', 30);
  if (String(dataUrl).length > 4000000) throw new Error('照片太大');
  return savePhoto_(name, dataUrl);
}

function savePhoto_(name, dataUrl) {
  var m = String(dataUrl).match(/^data:(image\/[\w.+-]+);base64,(.+)$/);
  if (!m) throw new Error('照片格式錯誤');
  var blob = Utilities.newBlob(Utilities.base64Decode(m[2]), m[1], String(name || 'photo').slice(0, 60) || ('photo_' + Date.now() + '.jpg'));
  var file = subFolder_('叫修照片').createFile(blob);
  try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) { }
  return file.getId();
}

function findTicket_(id) {
  var t = readTable_('叫修單').filter(function (x) { return x['編號'] === id; })[0];
  if (!t) throw new Error('找不到叫修單 ' + id);
  return t;
}

function api_ticketAction(tk, id, action, data) {
  var me = me_(tk);
  data = data || {};
  return withLock_(function () {
    var t = findTicket_(id), n = now_(), o = { '更新時間': n };
    var line = function (txt) { return (t['處理過程'] ? t['處理過程'] + '\n' : '') + '[' + n.slice(5) + ' ' + me.name + '] ' + txt; };
    var notify = [t['建立者Email']].concat(admins_().map(function (a) { return a.email; }));
    if (action === 'reply') {
      if (!t['回覆時間']) { o['回覆時間'] = n; o['回覆人'] = me.name; }
      o['處理過程'] = line('回覆：' + (data.text || '已受理，處理中'));
      if (t['狀態'] === '待回覆') o['狀態'] = '處理中';
      mail_(notify, id + ' 已回覆', '<p>' + esc_(me.name) + ' 回覆叫修 ' + id + '（' + esc_(t['設備系統']) + '）：</p><p>' + esc_(data.text || '已受理，處理中') + '</p>');
    } else if (action === 'note') {
      if (!data.text) throw new Error('請輸入處理內容。');
      o['處理過程'] = line(data.text);
      if (!t['回覆時間']) { o['回覆時間'] = n; o['回覆人'] = me.name; o['狀態'] = '處理中'; }
    } else if (action === 'fix') {
      if (!t['回覆時間']) { o['回覆時間'] = n; o['回覆人'] = me.name; }
      o['排除時間'] = data.fixAt && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(data.fixAt) ? data.fixAt : n;
      o['處理過程'] = line('排除：' + (data.text || '已排除'));
      o['備品'] = data.spare || '';
      o['狀態'] = '已排除';
      addLog_('叫修', '排除 ' + id + '：' + t['設備系統'] + '－' + t['故障現象'], data.text || '已排除', me.name, id);
      var late = o['排除時間'] > t['排除期限'];
      mail_(notify, id + ' 已排除' + (late ? '（逾期）' : ''),
        '<p>叫修 ' + id + '（' + esc_(t['設備系統']) + '－' + esc_(t['故障現象']) + '）已排除。</p><p>處理：' + esc_(data.text || '') + '</p>' +
        '<p>排除時間 ' + o['排除時間'] + '，期限 ' + t['排除期限'] + (late ? ' <b style="color:#c62828">逾期</b>' : '') + '</p>' +
        (t['等級'] === '1' ? '<p style="color:#c62828"><b>第一級事件：請於 48 小時內提出事件報告（原因、影響、處置、預防措施）。</b></p>' : '') +
        '<p>請機關人員確認恢復正常後，在系統按「結案」並填寫確認人。</p>');
    } else if (action === 'close') {
      if (!data.confirmBy) throw new Error('請填寫機關確認人。');
      o['機關確認人'] = data.confirmBy;
      o['狀態'] = '已結案';
      o['處理過程'] = line('結案（機關確認：' + data.confirmBy + '）');
      if (data.toFaq) {
        appendObj_('SOP', {
          'ID': uid_('S'), '分類': '常見問題', '標題': t['設備系統'] + '：' + String(t['故障現象']).slice(0, 30),
          '內容': '# 現象\n' + t['故障現象'] + '\n\n# 處理過程\n' + o['處理過程'].replace(/^\[[^\]]+\] /gm, '- ') + '\n\n（來源：叫修單 ' + id + '）',
          '文件連結': '', '版本': '1', '必讀': 'N', '更新日': today_(), '更新人': me.name
        });
      }
    } else if (action === 'event') {
      o['事件報告'] = data.text || '';
      o['處理過程'] = line('提出事件報告');
    } else if (action === 'photo') {
      o['照片'] = (t['照片'] ? t['照片'] + '\n' : '') + (data.photos || []).join('\n');
    } else if (action === 'edit') {
      if (!me.isAdmin && t['建立者Email'] !== me.email) throw new Error('只有建立者或主管可以修改。');
      ['通報人', '通報單位', '通報電話', '設備系統', '位置編號', '故障現象'].forEach(function (k) { if (data[k] !== undefined) o[k] = data[k]; });
      if (data['等級'] && SLA[data['等級']] && data['等級'] !== t['等級']) {
        o['等級'] = data['等級'];
        o['回覆期限'] = addMin_(t['通報時間'], SLA[data['等級']].reply);
        o['排除期限'] = addMin_(t['通報時間'], SLA[data['等級']].fix);
        o['處理過程'] = line('等級改為' + SLA[data['等級']].name);
      }
    } else if (action === 'delete') {
      if (!me.isAdmin) throw new Error('只有主管可以刪除。');
      deleteRows_('叫修單', [t._row]);
      return true;
    } else throw new Error('未知的動作');
    updateObj_('叫修單', t._row, o);
    return true;
  });
}

function api_uploadPunch(tk, name, dataUrl) {
  me_(tk);
  return 'https://drive.google.com/thumbnail?sz=w1280&id=' + savePhoto_(name, dataUrl);
}

function api_uploadPhoto(tk, name, dataUrl) {
  me_(tk);
  return savePhoto_(name, dataUrl);
}

/* ============================== 維護工作紀錄（附表三） ============================== */

function addLog_(cat, summary, result, by, ref) {
  var n = now_();
  appendObj_('工作紀錄', { 'ID': uid_('W'), '日期': n.slice(0, 10), '時間': n.slice(11), '類別': cat, '內容摘要': summary, '處理結果': result || '', '處理人': by, '關聯編號': ref || '' });
}

function listWorklog_(month) {
  return readTable_('工作紀錄').filter(function (x) { return x['日期'].slice(0, 7) === month; })
    .map(function (x) { return { id: x['ID'], date: x['日期'], time: x['時間'], cat: x['類別'], summary: x['內容摘要'], result: x['處理結果'], by: x['處理人'], ref: x['關聯編號'] }; })
    .sort(function (a, b) { return (a.date + a.time) < (b.date + b.time) ? 1 : -1; });
}

function api_listWorklog(tk, month) { me_(tk); return listWorklog_(month); }

function api_addWorklog(tk, o) {
  var me = me_(tk);
  if (!o || !o.summary) throw new Error('請填寫內容摘要。');
  withLock_(function () {
    var n = now_();
    appendObj_('工作紀錄', {
      'ID': uid_('W'), '日期': o.date || n.slice(0, 10), '時間': o.time || n.slice(11), '類別': o.cat || '協助',
      '內容摘要': o.summary, '處理結果': o.result || '', '處理人': me.name, '關聯編號': ''
    });
  });
  return true;
}

function api_deleteWorklog(tk, id) {
  var me = me_(tk);
  return withLock_(function () {
    var r = readTable_('工作紀錄').filter(function (x) { return x['ID'] === id; })[0];
    if (!r) return true;
    if (!me.isAdmin && r['處理人'] !== me.name) throw new Error('只能刪除自己的紀錄。');
    deleteRows_('工作紀錄', [r._row]);
    return true;
  });
}

/* ============================== 每日打卡 ============================== */

function workHours_() {
  var m = String(getSettings_()['上班時間'] || '').match(/(\d{1,2}):(\d{2})\D+(\d{1,2}):(\d{2})/);
  var p = function (h, mm) { return (h.length < 2 ? '0' : '') + h + ':' + mm; };
  return m ? { start: p(m[1], m[2]), end: p(m[3], m[4]) } : { start: '08:00', end: '17:30' };
}

function punchRecords_(from, to, email) {
  return readTable_('打卡紀錄').filter(function (r) {
    return r['日期'] >= from && r['日期'] <= to && (!email || r['Email'] === email);
  }).map(function (r) {
    return { id: r['ID'], date: r['日期'], email: r['Email'], name: r['姓名'], type: r['類型'], time: r['時間'], photo: r['照片'], thumb: r['縮圖'] || r['照片'],
      loc: r['位置'], note: r['備註'], fixed: r['補登'] === 'Y', by: r['建立者'], at: r['建立時間'] };
  }).sort(function (a, b) { return (a.date + a.time) < (b.date + b.time) ? -1 : 1; });
}

/** 補登的實際操作時間與操作人，例：10/4 09:00 小華 */
function fixStamp_(r) {
  var at = String(r.at || ''), m = at.match(/^\d{4}-(\d{2})-(\d{2}) (\d{2}:\d{2})/);
  return (m ? Number(m[1]) + '/' + Number(m[2]) + ' ' + m[3] + ' ' : '') + (r.by || '');
}

/** 每人每天一筆：最早的上班、最晚的下班；備註自動加遲到、早退、補登原因 */
function punchSummary_(from, to, email) {
  var h = workHours_(), map = {}, out = [];
  punchRecords_(from, to, email).forEach(function (r) {
    var k = r.date + '|' + r.email;
    var g = map[k] || (map[k] = { date: r.date, email: r.email, name: r.name, in: null, out: null });
    if (r.type === '上班' && (!g.in || r.time < g.in.time)) g.in = r;
    if (r.type === '下班' && (!g.out || r.time > g.out.time)) g.out = r;
  });
  Object.keys(map).sort().forEach(function (k) {
    var g = map[k], notes = [];
    if (g.in && g.in.time > h.start) notes.push('遲到');
    if (g.out && g.out.time < h.end) notes.push('早退');
    if (!g.in) notes.push('未打上班卡');
    if (!g.out && g.date < today_()) notes.push('未打下班卡');
    [g.in, g.out].forEach(function (r) {
      if (r && r.fixed) notes.push('補登' + r.type + '（' + fixStamp_(r) + '）' + (r.note ? '：' + r.note : ''));
      else if (r && r.note) notes.push(r.note);
    });
    out.push({ date: g.date, email: g.email, name: g.name, in: g.in ? g.in.time : '', out: g.out ? g.out.time : '',
      inFixed: !!(g.in && g.in.fixed), outFixed: !!(g.out && g.out.fixed),
      inAt: g.in ? String(g.in.at || '') : '', outAt: g.out ? String(g.out.at || '') : '',
      inPhoto: g.in ? g.in.photo : '', inThumb: g.in ? g.in.thumb : '', outPhoto: g.out ? g.out.photo : '', outThumb: g.out ? g.out.thumb : '', note: notes.join('；') });
  });
  return out;
}

function api_punch(tk, type, photo, thumb, loc, note) {
  var me = me_(tk);
  if (type !== '上班' && type !== '下班') throw new Error('打卡類型錯誤');
  if (!/^https:\/\/\S+$/.test(String(photo || ''))) throw new Error('打卡一定要附照片');
  return withLock_(function () {
    var n = now_();
    appendObj_('打卡紀錄', {
      'ID': uid_('P'), '日期': n.slice(0, 10), 'Email': me.email, '姓名': me.name, '類型': type, '時間': n.slice(11),
      '照片': photo, '縮圖': /^https:\/\/\S+$/.test(String(thumb || '')) ? thumb : photo,
      '位置': String(loc || '').slice(0, 60), '備註': String(note || '').slice(0, 100), '補登': '', '建立者': me.name, '建立時間': n
    });
    return { time: n.slice(11), today: punchSummary_(n.slice(0, 10), n.slice(0, 10), me.email)[0] };
  });
}

function checkRange_(from, to, maxDays) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(from)) || !/^\d{4}-\d{2}-\d{2}$/.test(String(to)) || from > to) throw new Error('日期區間錯誤');
  if ((parseDate_(to) - parseDate_(from)) / 86400000 > maxDays) throw new Error('區間最多 ' + (maxDays + 1) + ' 天');
}

/** 打卡紀錄查詢：駐點只能看自己的；主管可篩選人員 */
function api_attendance(tk, from, to, email) {
  var me = me_(tk);
  checkRange_(from, to, 92);
  if (!me.isAdmin) email = me.email;
  return { from: from, to: to, email: email || '', summary: punchSummary_(from, to, email), records: punchRecords_(from, to, email), hours: workHours_() };
}

/** 補登：主管可替任何人補登、修改；駐點只能替自己補打（新增），不能補未來時間。建立時間＝實際操作時間 */
function api_punchFix(tk, o) {
  var me = me_(tk);
  o = o || {};
  if (!me.isAdmin) {
    if (o.id) throw new Error('只有主管可以修改打卡紀錄');
    o.email = me.email;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(o.date || '') || !/^\d{2}:\d{2}$/.test(o.time || '')) throw new Error('請填日期與時間');
  if (o.type !== '上班' && o.type !== '下班') throw new Error('請選上班或下班');
  var p = people_(true).filter(function (x) { return x.email === o.email; })[0];
  if (!p) throw new Error('請選人員');
  if (!o.note) throw new Error('補登請填原因（例：忘記打卡）');
  if (!me.isAdmin) {
    var n0 = now_();
    if (o.date + ' ' + o.time > n0) throw new Error('不能補打未來的時間');
    if ((parseDate_(n0.slice(0, 10)) - parseDate_(o.date)) / 86400000 > 31) throw new Error('只能補打 31 天內的打卡，更早的請找主管');
  }
  return withLock_(function () {
    var rec = { '日期': o.date, 'Email': p.email, '姓名': p.name, '類型': o.type, '時間': o.time, '備註': String(o.note).slice(0, 100), '補登': 'Y', '建立者': me.name, '建立時間': now_() };
    if (o.id) {
      var r = readTable_('打卡紀錄').filter(function (x) { return x['ID'] === o.id; })[0];
      if (!r) throw new Error('找不到紀錄');
      updateObj_('打卡紀錄', r._row, rec);
    } else { rec['ID'] = uid_('P'); appendObj_('打卡紀錄', rec); }
    return true;
  });
}

function api_punchDelete(tk, id) {
  requireAdmin_(tk);
  return withLock_(function () {
    var r = readTable_('打卡紀錄').filter(function (x) { return x['ID'] === id; })[0];
    if (r) deleteRows_('打卡紀錄', [r._row]);
    return true;
  });
}

/** 出勤簽到表資料（Vercel 產生 Word 用）：每天一列；指定人員時，沒打卡的日子依已發布班表標「休」或「未打卡」 */
function api_attendanceReport(tk, from, to, email) {
  requireAdmin_(tk);
  checkRange_(from, to, 62);
  var person = email ? people_(true).filter(function (p) { return p.email === email; })[0] : null;
  if (email && !person) throw new Error('找不到人員');
  var sum = punchSummary_(from, to, email || '');
  var shifts = {}, months = monthStatusMap_();
  readTable_('班表').forEach(function (x) { if (x['日期'] >= from && x['日期'] <= to && months[x['日期'].slice(0, 7)] === '已發布') shifts[x['日期']] = x['Email']; });
  var rows = [], d = from, t = today_();
  while (d <= to) {
    var day = sum.filter(function (x) { return x.date === d; });
    if (day.length) day.forEach(function (x) { rows.push({ date: d, wd: WD[weekday_(d)], name: x.name, in: x.in, out: x.out, note: x.note, thumb: x.inThumb || x.outThumb }); });
    else {
      var duty = shifts[d], note = '';
      if (person) note = duty === person.email ? (d < t ? '未打卡' : '') : (duty ? '休' : '');
      else if (duty && d < t) note = '未打卡（' + nameOf_(duty) + '）';
      rows.push({ date: d, wd: WD[weekday_(d)], name: '', in: '', out: '', note: note, thumb: '' });
    }
    d = addDays_(d, 1);
  }
  rows.forEach(function (r) { r.date = md_(r.date); });
  var roc = function (x) { return Number(x.slice(0, 4)) - 1911; };
  var mm = function (x) { return Number(x.slice(5, 7)); }, dd = function (x) { return Number(x.slice(8, 10)); };
  var wholeMonth = from.slice(0, 7) === to.slice(0, 7) && dd(from) === 1 && to === monthDays_(to.slice(0, 7)).pop();
  var title = '出勤簽到表' + roc(from) + '年' + (wholeMonth ? mm(from) + '月份'
    : mm(from) + '月' + dd(from) + '日至' + (roc(to) !== roc(from) ? roc(to) + '年' : '') + mm(to) + '月' + dd(to) + '日');
  if (person) title += '（' + person.name + '）';
  var mmdd = function (x) { return x.slice(5, 7) + x.slice(8, 10); };
  return { title: title, filename: '金門駐點人員出勤簽到表' + mmdd(from) + '-' + mmdd(to), rows: rows };
}

/* ============================== 定期巡檢（附表二、陸） ============================== */

function periodOf_(freq, dateStr) {
  if (freq === '每日') return dateStr;
  if (freq === '每週') return 'W' + addDays_(dateStr, 1 - weekday_(dateStr)); // 週一日期
  if (freq === '每月') return dateStr.slice(0, 7);
  if (freq === '每季') return dateStr.slice(0, 4) + '-Q' + Math.ceil(Number(dateStr.slice(5, 7)) / 3);
  return 'ONCE';
}

function periodLabel_(freq, p) {
  if (freq === '每日') return md_(p) + '（' + WD[weekday_(p)] + '）';
  if (freq === '每週') { var m = p.slice(1); return md_(m) + '～' + md_(addDays_(m, 6)) + ' 這週'; }
  if (freq === '每月') return p.replace('-', ' 年 ') + ' 月';
  if (freq === '每季') return p.replace('-Q', ' 年第 ') + ' 季';
  return '保固期滿前一次';
}

function inspectionStatus_(dateStr) {
  var recs = readTable_('巡檢紀錄'), out = {};
  FREQS.forEach(function (f) {
    var p = periodOf_(f, dateStr);
    var rs = recs.filter(function (r) { return r['頻率'] === f && r['期別'] === p; });
    out[f] = {
      period: p, label: periodLabel_(f, p), done: rs.length > 0,
      by: rs.length ? rs[0]['巡檢人'] : '', at: rs.length ? rs[0]['巡檢時間'] : '',
      abnormal: rs.filter(function (r) { return r['結果'] === '異常'; }).length
    };
  });
  return out;
}

function inspItems_(activeOnly) {
  return readTable_('巡檢項目').filter(function (x) { return !activeOnly || x['啟用'] !== 'N'; })
    .map(function (x) { return { id: x['ID'], freq: x['頻率'], area: x['區域'], item: x['檢查項目'], order: Number(x['排序']) || 0, active: x['啟用'] !== 'N' }; })
    .sort(function (a, b) { return FREQS.indexOf(a.freq) - FREQS.indexOf(b.freq) || a.order - b.order; });
}

function api_getInspections(tk, dateStr) {
  var me = me_(tk);
  dateStr = dateStr || today_();
  if (dateStr > today_()) throw new Error('不能填未來日期的巡檢。');
  var s = getSettings_(), status = inspectionStatus_(dateStr), recs = readTable_('巡檢紀錄');
  var last = {};
  FREQS.forEach(function (f) {
    last[f] = recs.filter(function (r) { return r['頻率'] === f && r['期別'] === status[f].period; })
      .map(function (r) { return { itemId: r['項目ID'], result: r['結果'], note: r['說明'], confirmBy: r['機關確認人'] }; });
  });
  return { date: dateStr, items: inspItems_(true), status: status, last: last, warrantyEnd: s['保固期滿日'], me: me.name };
}

function api_submitInspection(tk, freq, dateStr, results, confirmBy) {
  var me = me_(tk);
  if (FREQS.indexOf(freq) < 0) throw new Error('頻率錯誤');
  dateStr = dateStr || today_();
  if (dateStr > today_()) throw new Error('不能填未來日期的巡檢。');
  var items = inspItems_(false), period = periodOf_(freq, dateStr);
  var missing = items.filter(function (it) { return it.active && it.freq === freq && !results.some(function (r) { return r.id === it.id && r.result; }); });
  if (missing.length) throw new Error('還有 ' + missing.length + ' 個項目沒有勾選：' + missing.map(function (x) { return x.area; }).join('、'));
  return withLock_(function () {
    var old = readTable_('巡檢紀錄').filter(function (r) { return r['頻率'] === freq && r['期別'] === period; });
    deleteRows_('巡檢紀錄', old.map(function (r) { return r._row; }));
    var rid = uid_('I'), n = now_(), abn = [], tickets = [];
    var rows = results.map(function (r) {
      var it = items.filter(function (x) { return x.id === r.id; })[0] || { area: '', item: '' };
      if (r.result === '異常') abn.push([it.area, it.item, r.note || '']);
      return { '紀錄ID': rid, '頻率': freq, '期別': period, '巡檢時間': n, '巡檢人Email': me.email, '巡檢人': me.name, '項目ID': r.id, '區域': it.area, '檢查項目': it.item, '結果': r.result, '說明': r.note || '', '機關確認人': confirmBy || '' };
    });
    appendObjs_('巡檢紀錄', rows);
    results.forEach(function (r) {
      if (r.result === '異常' && r.ticket) {
        var it = items.filter(function (x) { return x.id === r.id; })[0] || { area: '其他', item: '' };
        tickets.push(createTicket_(me, { equip: guessEquip_(it.area), loc: it.area, symptom: '［' + freq + '巡檢異常］' + (r.note || it.item), level: r.level || '2' }, '巡檢'));
      }
    });
    addLog_('巡檢', freq + '巡檢（' + periodLabel_(freq, period) + '）' + rows.length + ' 項', abn.length ? '異常 ' + abn.length + ' 項' : '全部正常', me.name, tickets.join(','));
    if (abn.length) {
      mail_(admins_(), freq + '巡檢有 ' + abn.length + ' 項異常（' + periodLabel_(freq, period) + '）',
        '<p>' + esc_(me.name) + ' 於 ' + n + ' 完成' + freq + '巡檢，異常項目：</p>' + table_(['區域', '檢查項目', '說明'], abn) +
        (tickets.length ? '<p>已自動開立叫修單：' + tickets.join('、') + '</p>' : ''));
    }
    return { abnormal: abn.length, tickets: tickets };
  });
}

function guessEquip_(area) {
  var map = [['售票', '售票櫃台'], ['自助', '自助機台'], ['閘門', '閘門'], ['手持', '手持設備'], ['行李', '行李托運'], ['看板', '資訊看板'], ['機房', '機房'], ['資料庫', '機房'], ['備份', '機房'], ['UPS', '機房']];
  for (var i = 0; i < map.length; i++) if (String(area).indexOf(map[i][0]) >= 0) return map[i][1];
  return '其他';
}

function inspectionHistory_(month) {
  var recs = readTable_('巡檢紀錄').filter(function (r) {
    var p = r['期別'];
    return r['巡檢時間'].slice(0, 7) === month || p.slice(0, 7) === month || (p.charAt(0) === 'W' && p.slice(1, 8) === month);
  });
  var groups = {};
  recs.forEach(function (r) {
    var g = groups[r['紀錄ID']] || (groups[r['紀錄ID']] = { id: r['紀錄ID'], freq: r['頻率'], period: r['期別'], label: periodLabel_(r['頻率'], r['期別']), at: r['巡檢時間'], by: r['巡檢人'], confirmBy: r['機關確認人'], rows: [] });
    g.rows.push({ area: r['區域'], item: r['檢查項目'], result: r['結果'], note: r['說明'] });
  });
  var list = Object.keys(groups).map(function (k) { return groups[k]; }).sort(function (a, b) { return a.at < b.at ? 1 : -1; });
  var doneDays = {};
  list.forEach(function (g) { if (g.freq === '每日') doneDays[g.period] = g.rows.some(function (r) { return r.result === '異常'; }) ? '異常' : '正常'; });
  return { month: month, list: list, doneDays: doneDays, days: monthDays_(month), today: today_() };
}

function api_inspectionHistory(tk, month) { me_(tk); return inspectionHistory_(month); }

function api_saveInspItem(tk, o) {
  requireAdmin_(tk);
  return withLock_(function () {
    if (!o.area || !o.item || FREQS.indexOf(o.freq) < 0) throw new Error('請填寫頻率、區域與檢查項目。');
    var rec = { '頻率': o.freq, '區域': o.area, '檢查項目': o.item, '排序': o.order || 99, '啟用': o.active === false ? 'N' : 'Y' };
    if (o.id) {
      var r = readTable_('巡檢項目').filter(function (x) { return x['ID'] === o.id; })[0];
      if (!r) throw new Error('找不到項目');
      updateObj_('巡檢項目', r._row, rec);
    } else { rec['ID'] = uid_('C'); appendObj_('巡檢項目', rec); }
    return inspItems_(false);
  });
}

function api_listInspItems(tk) { requireAdmin_(tk); return inspItems_(false); }

/* ============================== SOP／教育訓練 ============================== */

function api_listSOP(tk) {
  var me = me_(tk);
  var sops = readTable_('SOP'), reads = readTable_('已讀紀錄'), ppl = people_();
  return {
    list: sops.map(function (x) {
      var rs = reads.filter(function (r) { return r['SOPID'] === x['ID'] && r['版本'] === x['版本']; });
      var mine = rs.filter(function (r) { return r['Email'] === me.email; })[0];
      return {
        id: x['ID'], cat: x['分類'], title: x['標題'], content: x['內容'], link: x['文件連結'], ver: x['版本'], must: x['必讀'] === 'Y',
        updated: x['更新日'], by: x['更新人'], readAt: mine ? mine['時間'] : '',
        readers: me.isAdmin ? ppl.map(function (p) {
          var r = rs.filter(function (z) { return z['Email'] === p.email; })[0];
          return { name: p.name, at: r ? r['時間'] : '' };
        }) : null
      };
    })
  };
}

function api_saveSOP(tk, o) {
  var me = requireAdmin_(tk);
  if (!o.title || !o.cat) throw new Error('請填寫分類與標題。');
  return withLock_(function () {
    var rec = { '分類': o.cat, '標題': o.title, '內容': o.content || '', '文件連結': o.link || '', '版本': o.ver || '1', '必讀': o.must ? 'Y' : 'N', '更新日': today_(), '更新人': me.name };
    var r = o.id ? readTable_('SOP').filter(function (x) { return x['ID'] === o.id; })[0] : null;
    var verChanged = !r || r['版本'] !== rec['版本'];
    if (r) updateObj_('SOP', r._row, rec); else { rec['ID'] = uid_('S'); appendObj_('SOP', rec); }
    if (o.must && verChanged && o.notify) {
      mail_(people_(), '必讀文件' + (r ? '更新' : '新增') + '：' + o.title,
        '<p>' + esc_(me.name) + (r ? ' 更新了' : ' 新增了') + '必讀文件「<b>' + esc_(o.title) + '</b>」（第 ' + esc_(rec['版本']) + ' 版），請到「SOP」頁閱讀並按「我已讀完」。</p>');
    }
    return rec['ID'] || o.id;
  });
}

/** SOP 附件上傳（Word／PDF／圖片／影片），存到資料夾「SOP文件」，回傳連結 */
function api_uploadFile(tk, name, dataUrl) {
  requireAdmin_(tk);
  var m = String(dataUrl).match(/^data:([^;]*);base64,(.+)$/);
  if (!m) throw new Error('檔案格式錯誤');
  var blob = Utilities.newBlob(Utilities.base64Decode(m[2]), m[1] || 'application/octet-stream', String(name || 'file').slice(0, 120));
  var file = subFolder_('SOP文件').createFile(blob);
  try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) { }
  return file.getUrl();
}

function api_deleteSOP(tk, id) {
  requireAdmin_(tk);
  return withLock_(function () {
    var r = readTable_('SOP').filter(function (x) { return x['ID'] === id; })[0];
    if (r) deleteRows_('SOP', [r._row]);
    return true;
  });
}

function api_markRead(tk, id) {
  var me = me_(tk);
  return withLock_(function () {
    var s = readTable_('SOP').filter(function (x) { return x['ID'] === id; })[0];
    if (!s) throw new Error('找不到文件');
    var has = readTable_('已讀紀錄').some(function (r) { return r['SOPID'] === id && r['版本'] === s['版本'] && r['Email'] === me.email; });
    if (!has) appendObj_('已讀紀錄', { 'SOPID': id, '版本': s['版本'], 'Email': me.email, '姓名': me.name, '時間': now_() });
    return true;
  });
}

/* ============================== 帳號管理（管理員） ============================== */

function api_listPeople(tk) { requireAdmin_(tk); return people_(true).map(publicPerson_); }

function api_savePerson(tk, o) {
  var me = requireOwner_(tk);
  var email = String(o.email || '').trim().toLowerCase();
  var account = String(o.account || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Email 格式錯誤（系統通知會寄到這個信箱）');
  if (!/^[a-z0-9._-]{3,30}$/.test(account)) throw new Error('帳號只能用英文小寫、數字、. _ -，3～30 個字');
  if (!o.name) throw new Error('請填寫姓名');
  if (ROLES.indexOf(o.role) < 0) throw new Error('角色錯誤');
  return withLock_(function () {
    var all = people_(true);
    var r = all.filter(function (p) { return p.email === (o.origEmail || email); })[0];
    if (!o.origEmail && r) throw new Error('這個 Email 已經有帳號了');
    if (all.some(function (p) { return p.account === account && p !== r; })) throw new Error('帳號「' + account + '」已被使用');
    if (all.some(function (p) { return p.email === email && p !== r; })) throw new Error('Email 已被其他帳號使用');
    var active = o.active !== false;
    if (r && r.role === '管理員' && (o.role !== '管理員' || !active) &&
      all.filter(function (p) { return p.role === '管理員' && p.active; }).length <= 1) throw new Error('至少要保留一位啟用中的管理員');
    var rec = { 'Email': email, '帳號': account, '姓名': o.name, '角色': o.role, '電話': o.phone || '', '啟用': active ? 'Y' : 'N', '排班': o.sched ? 'Y' : 'N' };
    if (o.password) {
      checkPassword_(o.password);
      rec['鹽'] = newSalt_(); rec['密碼雜湊'] = hash_(rec['鹽'], o.password); rec['需改密碼'] = 'Y';
    } else if (!r) throw new Error('新帳號請設定初始密碼');
    if (r) {
      updateObj_('人員', r._row, rec);
      if (r.email !== email) migrateEmail_(r.email, email);
    } else { rec['建立時間'] = now_(); appendObj_('人員', rec); }
    if (o.password && o.sendMail) {
      mail_(email, '您的系統帳號' + (r ? '密碼已重設' : '已建立'),
        '<p>' + esc_(o.name) + ' 您好：' + esc_(me.name) + (r ? ' 已重設您的密碼。' : ' 已為您建立帳號。') + '</p>' +
        table_(['項目', '內容'], [['帳號', account], ['密碼', o.password], ['角色', o.role]]) + '<p>第一次登入後系統會要求您改密碼。</p>');
    }
    return people_(true).map(publicPerson_);
  });
}

function migrateEmail_(oldE, newE) { // Email 變更時，同步更新其他表的 Email 欄
  [['班表', 'Email'], ['不可上班', 'Email'], ['填寫確認', 'Email'], ['已讀紀錄', 'Email'], ['巡檢紀錄', '巡檢人Email'], ['叫修單', '建立者Email']].forEach(function (x) {
    readTable_(x[0]).forEach(function (r) { if (r[x[1]] === oldE) { var o = {}; o[x[1]] = newE; updateObj_(x[0], r._row, o); } });
  });
}

function api_deletePerson(tk, email) {
  var me = requireOwner_(tk);
  if (email === me.email) throw new Error('不能刪除自己的帳號');
  return withLock_(function () {
    var r = people_(true).filter(function (p) { return p.email === email; })[0];
    if (r) deleteRows_('人員', [r._row]);
    return people_(true).map(publicPerson_);
  });
}

function api_saveSettings(tk, map) {
  requireAdmin_(tk);
  return withLock_(function () {
    Object.keys(map).forEach(function (k) { setSetting_(k, map[k]); });
    return getSettings_();
  });
}

/* ============================== 月維護報告 ============================== */

function monthReport_(month) {
  var tickets = readTable_('叫修單').filter(function (x) { return x['通報時間'].slice(0, 7) === month; }).map(ticketView_);
  var byLv = {};
  ['1', '2', '3'].forEach(function (l) {
    var ts = tickets.filter(function (t) { return t.level === l; });
    byLv[l] = {
      total: ts.length,
      replyOk: ts.filter(function (t) { return t.replyAt && !t.replyLate; }).length,
      fixOk: ts.filter(function (t) { return t.fixAt && !t.fixLate; }).length,
      fixed: ts.filter(function (t) { return t.fixAt; }).length
    };
  });
  var hist = inspectionHistory_(month);
  var days = hist.days.filter(function (d) { return d <= today_(); });
  var dailyDone = days.filter(function (d) { return hist.doneDays[d]; }).length;
  var abn = [];
  hist.list.forEach(function (g) { g.rows.forEach(function (r) { if (r.result === '異常') abn.push([g.label, g.freq, r.area, r.note || r.item]); }); });
  var logs = listWorklog_(month).reverse();
  var open = readTable_('叫修單').filter(function (x) { return x['狀態'] !== '已結案'; }).map(ticketView_);
  var freqDone = {};
  ['每週', '每月', '每季'].forEach(function (f) { freqDone[f] = hist.list.filter(function (g) { return g.freq === f; }).map(function (g) { return g.label + '（' + g.by + '）'; }); });
  return { month: month, tickets: tickets, byLv: byLv, dailyDone: dailyDone, dailyTotal: days.length, abn: abn, logs: logs, open: open, freqDone: freqDone };
}

function api_monthReport(tk, month, makeDoc) {
  var me = requireAdmin_(tk), r = monthReport_(month);
  if (!makeDoc) return r;
  r.docUrl = makeMonthDoc_(month, me.name, r);
  return r;
}

function makeMonthDoc_(month, byName, r) {
  r = r || monthReport_(month);
  var me = { name: byName };
  var s = getSettings_();
  var doc = DocumentApp.create(month + ' 月維護報告');
  var b = doc.getBody();
  b.appendParagraph(s['系統名稱'] + '　' + month + ' 月維護報告').setHeading(DocumentApp.ParagraphHeading.TITLE);
  b.appendParagraph('產出：' + me.name + '　' + now_());
  b.appendParagraph('一、叫修統計與時限達成').setHeading(DocumentApp.ParagraphHeading.HEADING2);
  var t1 = [['等級', '件數', '回覆準時', '已排除', '排除準時']];
  ['1', '2', '3'].forEach(function (l) { var x = r.byLv[l]; t1.push([SLA[l].name, String(x.total), String(x.replyOk), String(x.fixed), String(x.fixOk)]); });
  b.appendTable(t1);
  if (r.tickets.length) {
    b.appendParagraph('叫修明細').setHeading(DocumentApp.ParagraphHeading.HEADING3);
    b.appendTable([['編號', '等級', '設備', '現象', '排除時間', '狀態']].concat(r.tickets.map(function (t) { return [t.id, t.levelName, t.equip, t.symptom, t.fixAt || '', t.status]; })));
  }
  b.appendParagraph('二、巡檢執行情形').setHeading(DocumentApp.ParagraphHeading.HEADING2);
  b.appendParagraph('每日巡檢：' + r.dailyDone + ' / ' + r.dailyTotal + ' 天');
  ['每週', '每月', '每季'].forEach(function (f) { b.appendParagraph(f + '：' + (r.freqDone[f].join('、') || '本月無紀錄')); });
  if (r.abn.length) b.appendTable([['期別', '頻率', '區域', '異常說明']].concat(r.abn));
  else b.appendParagraph('巡檢異常：無');
  b.appendParagraph('三、維護工作紀錄').setHeading(DocumentApp.ParagraphHeading.HEADING2);
  if (r.logs.length) b.appendTable([['日期', '時間', '類別', '內容摘要', '處理結果', '處理人']].concat(r.logs.map(function (l) { return [l.date, l.time, l.cat, l.summary, l.result, l.by]; })));
  else b.appendParagraph('無');
  b.appendParagraph('四、待辦事項（未結案叫修）').setHeading(DocumentApp.ParagraphHeading.HEADING2);
  if (r.open.length) b.appendTable([['編號', '等級', '設備', '現象', '狀態']].concat(r.open.map(function (t) { return [t.id, t.levelName, t.equip, t.symptom, t.status]; })));
  else b.appendParagraph('無');
  doc.saveAndClose();
  var file = DriveApp.getFileById(doc.getId());
  try { file.moveTo(subFolder_('月維護報告')); } catch (e) { }
  return doc.getUrl();
}

/* ============================== 排程（寄信提醒） ============================== */

function installTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (['cronSla', 'hourlyJob', 'flushQueue'].indexOf(t.getHandlerFunction()) >= 0) ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('cronSla').timeBased().everyMinutes(10).create();
  ScriptApp.newTrigger('hourlyJob').timeBased().everyHours(1).create();
  ScriptApp.newTrigger('flushQueue').timeBased().everyMinutes(1).create();
}

/** 每分鐘：寄出 Vercel 網頁排進佇列的信、處理工作（產生月報）。Vercel 不能直接寄 Gmail，所以由這裡代寄 */
function flushQueue() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;
  try {
    var s = getSettings_(), n = now_(), old = addDays_(today_(), -30), del = [];
    readTable_('寄信佇列').forEach(function (m) {
      if (m['狀態'] === '待寄') {
        try {
          MailApp.sendEmail({ to: m['收件者'], subject: m['主旨'], htmlBody: m['內容'], name: s['系統名稱'] });
          updateObj_('寄信佇列', m._row, { '狀態': '已寄', '寄出時間': n });
        } catch (e) { updateObj_('寄信佇列', m._row, { '狀態': '失敗', '錯誤': String(e) }); }
      } else if (m['建立時間'].slice(0, 10) < old) del.push(m._row);
    });
    if (del.length) deleteRows_('寄信佇列', del);
    readTable_('工作佇列').forEach(function (j) {
      if (j['狀態'] !== '待處理') return;
      try {
        if (j['類型'] === '月報') {
          var who = people_(true).filter(function (p) { return p.email === j['申請人Email']; })[0];
          var url = makeMonthDoc_(j['參數'], who ? who.name : '系統');
          updateObj_('工作佇列', j._row, { '狀態': '完成', '完成時間': now_(), '結果': url });
          sendMailNow_(j['申請人Email'], j['參數'] + ' 月維護報告已產生', '<p>' + esc_(j['參數']) + ' 月維護報告已產生：</p><p><a href="' + url + '">開啟 Google 文件</a></p>');
        } else updateObj_('工作佇列', j._row, { '狀態': '失敗', '結果': '未知的工作類型' });
      } catch (e) { updateObj_('工作佇列', j._row, { '狀態': '失敗', '結果': String(e) }); }
    });
  } finally { lock.releaseLock(); }
}

function sendMailNow_(to, subject, html) {
  var s = getSettings_();
  MailApp.sendEmail({ to: to, subject: '【' + s['系統名稱'] + '】' + subject, htmlBody: '<div style="font-family:Microsoft JhengHei,PingFang TC,sans-serif;font-size:14px;line-height:1.7">' + html + '</div>', name: s['系統名稱'] });
}

/** 每 10 分鐘：叫修單回覆／排除逾期、第一級事件報告提醒 */
function cronSla() {
  var n = now_();
  readTable_('叫修單').forEach(function (t) {
    if (t['狀態'] === '已結案') return;
    var flags = String(t['已提醒'] || ''), add = '';
    var who = staff_().concat(admins_());
    if (!t['回覆時間'] && t['回覆期限'] && n > t['回覆期限'] && flags.indexOf('R') < 0) {
      mail_(who, '⚠ 回覆逾期 ' + t['編號'] + '（' + (SLA[t['等級']] || {}).name + '）', '<p>叫修 ' + t['編號'] + '（' + esc_(t['設備系統']) + '－' + esc_(t['故障現象']) + '）回覆期限 ' + t['回覆期限'] + ' 已過，尚未回覆。</p>');
      add += 'R';
    }
    if (!t['排除時間'] && t['排除期限'] && n > t['排除期限'] && flags.indexOf('F') < 0) {
      mail_(who, '⚠ 排除逾期 ' + t['編號'] + '（' + (SLA[t['等級']] || {}).name + '）', '<p>叫修 ' + t['編號'] + '（' + esc_(t['設備系統']) + '－' + esc_(t['故障現象']) + '）排除期限 ' + t['排除期限'] + ' 已過。逾期每 1 小時依保固金千分之五計罰，如無法修復請提供同級備品或與機關協調時間。</p>');
      add += 'F';
    }
    if (t['等級'] === '1' && t['排除時間'] && !t['事件報告'] && n > addMin_(t['排除時間'], 36 * 60) && flags.indexOf('E') < 0) {
      mail_(admins_(), '第一級事件報告即將到期 ' + t['編號'], '<p>叫修 ' + t['編號'] + ' 為第一級事件，排除時間 ' + t['排除時間'] + '，事件報告須於 48 小時內提出（原因、影響、處置、預防措施）。</p>');
      add += 'E';
    }
    if (add) updateObj_('叫修單', t._row, { '已提醒': flags + add });
  });
}

/** 每小時：依時段寄登記、預排、巡檢、值班提醒（同一天同一時段只做一次） */
function hourlyJob() {
  var d = new Date(), hour = Number(fmt_(d, 'H')), t = today_(), s = getSettings_();
  var props = PropertiesService.getScriptProperties(), key = 'job_' + t + '_' + hour;
  if (props.getProperty(key)) return;
  props.setProperty(key, '1');
  cleanupProps_(props, t);

  var shifts = readTable_('班表'), months = monthStatusMap_();
  var dutyOf = function (day) { var r = shifts.filter(function (x) { return x['日期'] === day; })[0]; return r && months[day.slice(0, 7)] === '已發布' ? r : null; };
  var adminsE = admins_().map(function (a) { return a.email; });

  if (hour === 9) {
    var day = Number(t.slice(8, 10)), m0 = t.slice(0, 7), rows = monthRows_();
    [m0, nextMonth_(m0), nextMonth_(nextMonth_(m0))].forEach(function (m) {
      var row = rows[m] || {}, st = row['狀態'] || '未排班', w = windowOf_(m, row);
      if (st === '已發布') return;
      var done = readTable_('填寫確認').filter(function (x) { return x['月份'] === m; }).map(function (x) { return x['Email']; });
      // 登記期間內：每天提醒還沒登記的人，直到他按「我登記好了／我都可以」
      if (t >= w.start && t <= w.end) {
        var left = Math.round((parseDate_(w.end) - parseDate_(t)) / 86400000);
        staff_().filter(function (p) { return done.indexOf(p.email) < 0; }).forEach(function (p) {
          mail_(p.email, '請登記 ' + m + ' 不能上班的日子（' + md_(w.end) + ' 截止' + (left === 0 ? '，今天最後一天' : '，剩 ' + left + ' 天') + '）',
            '<p>' + esc_(p.name) + ' 您好：</p><p>' + m + ' 的班表登記期間是 <b>' + w.start + ' ～ ' + w.end + '</b>。</p>' +
            '<p>請到「班表」點選您不能上班的日子後按「我登記好了」；都可以的話按「我都可以，聽安排」。完成前每天早上都會收到這封提醒。</p>');
        });
      }
      // 登記截止後：系統自動預排並通知主管（只做一次）
      if (t > w.end && !row['預排通知'] && staff_().length) {
        var redo = st === '未排班' || (row['登記異動'] && row['登記異動'] > (row['預排時間'] || ''));
        if (redo) autoSchedule_(m, true);
        setMonthRow_(m, { '預排通知': now_() });
        var data = scheduleData_(m);
        var notYet = staff_().filter(function (p) { return done.indexOf(p.email) < 0; }).map(function (p) { return p.name; });
        mail_(adminsE, m + ' 班表已由系統預排，請確認後發布',
          '<p>' + m + ' 登記已於 ' + w.end + ' 截止，系統已依大家登記的不能上班日預排好班表。</p>' +
          (notYet.length ? '<p style="color:#b06000">未登記（視為都可以）：' + esc_(notYet.join('、')) + '</p>' : '') +
          (data.gaps.length ? '<p style="color:#c62828">缺人：' + esc_(data.gaps.map(md_).join('、')) + '</p>' : '') +
          scheduleMailHtml_(data) + '<p>請到「班表」確認、手動調整後按「發布」。</p>');
      }
    });
    var st2 = inspectionStatus_(t), wd = weekday_(t), duty = dutyOf(t), to = [duty ? duty['Email'] : ''].concat(adminsE);
    if (wd === 5 && !st2['每週'].done) mail_(to, '本週「每週巡檢」尚未完成', '<p>' + st2['每週'].label + '的每週巡檢（錯誤日誌、資料庫空間、介接結果、人工應變船班表）還沒填，請在本週內完成。</p>');
    if (day === 25 && !st2['每月'].done) mail_(to, '本月「每月巡檢」尚未完成', '<p>' + st2['每月'].label + '的每月巡檢（系統更新、帳號清查、清潔耗材、月報）還沒填，請在月底前完成。</p>');
    if ([3, 6, 9, 12].indexOf(Number(t.slice(5, 7))) >= 0 && day === 20 && !st2['每季'].done) mail_(to, '本季「每季巡檢」尚未完成', '<p>' + st2['每季'].label + '的每季巡檢（備份還原測試、UPS 與機房環境、SSL 憑證與網域）還沒填，請在季底前完成。</p>');
    if (s['保固期滿日'] && !st2['保固期滿前'].done && day === 1) {
      var left2 = Math.round((parseDate_(s['保固期滿日']) - parseDate_(t)) / 86400000);
      if (left2 >= 0 && left2 <= 90) mail_(adminsE, '保固期滿前檢查提醒（剩 ' + left2 + ' 天）', '<p>保固期滿日 ' + s['保固期滿日'] + '，行李過磅設備須再經經濟部標準檢驗局檢定合格並附證書 3 份，檢定前要先通知機關。</p>');
    }
  }

  // 打卡提醒：上班時間的下一個整點還沒打上班卡、下班時間的下一個整點還沒打下班卡
  var wh = workHours_(), dutyP = dutyOf(t);
  if (dutyP && dutyP['Email']) {
    var ps = punchSummary_(t, t, dutyP['Email'])[0];
    if (hour === Number(wh.start.slice(0, 2)) + 1 && !(ps && ps.in)) {
      mail_([dutyP['Email']].concat(adminsE), dutyP['姓名'] + ' 今天（' + md_(t) + '）還沒打上班卡', '<p>' + esc_(dutyP['姓名']) + ' 今天值班，到現在還沒有上班打卡紀錄。請到系統首頁按「上班打卡」並拍照；忘記打卡請找主管補登。</p>');
    }
    if (hour === Number(wh.end.slice(0, 2)) + 1 && !(ps && ps.out)) {
      mail_([dutyP['Email']].concat(adminsE), dutyP['姓名'] + ' 今天（' + md_(t) + '）還沒打下班卡', '<p>' + esc_(dutyP['姓名']) + ' 今天值班，到現在還沒有下班打卡紀錄。請到系統首頁按「下班打卡」並拍照；忘記打卡請找主管補登。</p>');
    }
  }

  if (hour === (Number(s['巡檢逾期提醒時間']) || 11)) {
    var st3 = inspectionStatus_(t), duty2 = dutyOf(t);
    if (!st3['每日'].done) {
      mail_([duty2 ? duty2['Email'] : ''].concat(adminsE), '今日巡檢尚未完成（' + md_(t) + '）',
        '<p>' + (duty2 ? esc_(duty2['姓名']) + ' 今天值班，' : '') + '今天的每日巡檢（附表二）還沒填，請盡快完成。</p>');
    }
  }

  if (hour === (Number(s['明日值班提醒時間']) || 17)) {
    var tm = addDays_(t, 1), dt = dutyOf(tm);
    if (dt && dt['Email']) {
      mail_(dt['Email'], '明天（' + md_(tm) + ' ' + WD[weekday_(tm)] + '）輪您值班',
        '<p>' + esc_(dt['姓名']) + ' 您好：明天 ' + tm + ' 由您駐點，上班時間 ' + esc_(s['上班時間']) + '。</p><p>到班後請先完成每日巡檢。</p>');
    } else if (months[tm.slice(0, 7)] === '已發布') {
      mail_(adminsE, '明天（' + md_(tm) + '）沒有人值班', '<p>' + tm + ' 班表上沒有值班人員，請確認。</p>');
    }
  }
}

function scheduleData_(month) { // 排程用（不需登入）的班表資料
  var shifts = readTable_('班表').filter(function (x) { return x['日期'].slice(0, 7) === month; }), map = {}, stats = {};
  shifts.forEach(function (x) { map[x['日期']] = x; });
  var days = monthDays_(month).map(function (d) {
    var r = map[d] || {};
    if (r['Email']) stats[r['Email']] = (stats[r['Email']] || 0) + 1;
    return { date: d, wd: weekday_(d), email: r['Email'] || '', name: r['姓名'] || '', note: r['備註'] || '' };
  });
  return { days: days, stats: stats, gaps: days.filter(function (d) { return !d.email; }).map(function (d) { return d.date; }) };
}

function cleanupProps_(props, t) {
  var all = props.getProperties(), now = Date.now();
  Object.keys(all).forEach(function (k) {
    if (k.indexOf('job_') === 0 && k.slice(4, 14) < addDays_(t, -3)) props.deleteProperty(k);
    if (k.indexOf('sess_') === 0) { try { if (JSON.parse(all[k]).x < now) props.deleteProperty(k); } catch (e) { props.deleteProperty(k); } }
  });
}

/* ============================== 初始化／升級 setup ============================== */

function setup() {
  var ss = ss_();
  HEAD_ = {};
  Object.keys(SHEETS).forEach(function (name) {
    var s = ss.getSheetByName(name);
    if (!s) s = ss.insertSheet(name);
    var h = SHEETS[name];
    if (s.getLastRow() === 0) {
      s.getRange(1, 1, 1, h.length).setValues([h]).setFontWeight('bold').setBackground('#e8f0fe');
      s.setFrozenRows(1);
    } else { // 升級：缺少的欄位加在最後面，不動既有欄位
      var lc = s.getLastColumn(), cur = lc ? s.getRange(1, 1, 1, lc).getValues()[0].map(String) : [];
      while (cur.length && !cur[cur.length - 1]) cur.pop();
      var missing = h.filter(function (k) { return cur.indexOf(k) < 0; });
      if (missing.length) s.getRange(1, cur.length + 1, 1, missing.length).setValues([missing]).setFontWeight('bold').setBackground('#e8f0fe');
    }
    s.getRange(1, 1, s.getMaxRows(), s.getLastColumn()).setNumberFormat('@');
  });
  HEAD_ = {};
  ['工作表1', 'Sheet1'].forEach(function (n) { var s = ss.getSheetByName(n); if (s && ss.getSheets().length > 1 && s.getLastRow() === 0) ss.deleteSheet(s); });

  // 設定：補上新項目
  var have = readTable_('設定').map(function (r) { return r['項目']; });
  appendObjs_('設定', DEFAULT_SETTINGS.filter(function (r) { return have.indexOf(r[0]) < 0; }).map(function (r) { return { '項目': r[0], '值': r[1], '說明': r[2] }; }));

  // 人員：第一次建立管理員；舊資料補帳號與臨時密碼
  var notes = [];
  if (!readTable_('人員').length) {
    var owner = String(Session.getEffectiveUser().getEmail() || '').toLowerCase();
    appendObj_('人員', { 'Email': owner || 'admin@example.com', '帳號': 'admin', '姓名': '管理員', '角色': '管理員', '啟用': 'Y', '排班': 'Y', '建立時間': now_() });
  }
  people_(true).forEach(function (p) {
    var o = {};
    if (!p.account) o['帳號'] = p.email.split('@')[0].toLowerCase().replace(/[^a-z0-9._-]/g, '') || ('user' + p._row);
    if (!p.hash) {
      var pw = tempPassword_(), salt = newSalt_();
      o['鹽'] = salt; o['密碼雜湊'] = hash_(salt, pw); o['需改密碼'] = 'Y';
      notes.push((o['帳號'] || p.account) + ' ／ ' + pw + '（' + p.name + '）');
    }
    if (Object.keys(o).length) updateObj_('人員', p._row, o);
  });

  if (!readTable_('巡檢項目').length) seedInspection_();
  if (!readTable_('SOP').length) seedSOP_();
  try { subFolder_('叫修照片'); subFolder_('SOP文件'); subFolder_('月維護報告'); } catch (e) { console.error('建立資料夾失敗：' + e); }
  installTriggers();
  var msg = '初始化完成！\n\n' + (notes.length ? '以下帳號的臨時密碼（第一次登入後要改密碼，請抄下來）：\n' + notes.join('\n') + '\n\n' : '') +
    '下一步：部署 → 新增部署作業 → 網頁應用程式，用 admin 帳號登入後到「管理 → 帳號」新增駐點人員。';
  console.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) { }
  return msg;
}

function seedInspection_() {
  var rows = [
    ['每日', '售票櫃台', '櫃台售票系統登入、證件掃描、印表機出票、發票機'],
    ['每日', '自助機台（5台）', '開機、證件掃描、出票、紙量、付款設備'],
    ['每日', '驗票（閘門）', '3通道讀碼、開門、警示、顯示螢幕'],
    ['每日', '驗票（手持設備）', '6台電量、登入、掃碼'],
    ['每日', '行李托運', '電腦、過磅輸送機歸零、行李條列印、發票'],
    ['每日', '資訊看板', '離港、候補、票價顯示正確'],
    ['每日', '機房設備', '主機燈號、UPS、交換器、溫度、前一日備份結果'],
    ['每週', '系統日誌', '系統錯誤日誌與告警檢視'],
    ['每週', '資料庫', '資料庫空間'],
    ['每週', '介接', '介接傳送結果（航港局、移民署、TDX）'],
    ['每週', '人工應變程式', '各櫃台電腦人工應變程式船班表更新狀態'],
    ['每月', '作業系統', '作業系統與防毒更新'],
    ['每月', '帳號', '帳號清查（停用離職人員帳號）'],
    ['每月', '硬體', '硬體清潔與耗材狀況'],
    ['每月', '人工應變物品', '提醒機關檢查第三級人工作業物品存量（票券、手開發票本、托運單、計數器）'],
    ['每月', '月維護報告', '彙整當月叫修統計、時限達成、版本更新、巡檢異常、待辦事項'],
    ['每季', '備份', '備份還原測試'],
    ['每季', '機房環境', 'UPS 與機房環境檢查'],
    ['每季', '憑證', 'SSL 憑證與網域到期日檢查'],
    ['保固期滿前', '行李過磅設備', '經濟部標準檢驗局再檢定合格，附檢定合格證書3份（檢定前先通知機關）']
  ];
  appendObjs_('巡檢項目', rows.map(function (r, i) { return { 'ID': 'C' + (i < 9 ? '0' : '') + (i + 1), '頻率': r[0], '區域': r[1], '檢查項目': r[2], '排序': i + 1, '啟用': 'Y' }; }));
}

function seedSOP_() {
  var d = today_(), hotline = getSettings_()['保固服務專線'];
  var S = [
    ['駐點工作', '駐點每日工作流程', 'Y', [
      '# 時間與地點',
      '- 每日 08:00～17:30，每天一人駐點，全年無休',
      '- 地點：水頭新旅運大樓小三通部門',
      '- 遇連續假期或突發事件，依機關需求配合',
      '',
      '# 到班後',
      '1. 打開本系統「巡檢」頁，完成每日巡檢（售票櫃台、自助機台、閘門、手持設備、行李托運、資訊看板、機房）',
      '2. 有異常 → 勾「異常」並寫說明，可直接勾「開叫修單」',
      '3. 看「叫修回報」有沒有未結案的單要接手（包含機關從報修頁送來的單）',
      '',
      '# 主要任務',
      '- 本案軟硬體系統維護、故障排除',
      '- 二線技術支援：受理現場人員反映的系統問題，判斷原因並排除；不是本案系統的問題，要告知問題點',
      '- 資料更新與調整：票務後台通關及登船驗證、網頁購票系統、備援設備',
      '- 韌體更新（要先經機關同意）',
      '- 每天的維護、更新、協助事項都要記在「叫修回報 → 工作紀錄」',
      '',
      '# 支援服務（主要任務完成後）',
      '- 協助旅客操作自助機台',
      '- 協助判斷機關設備問題點並告知機關（維修由機關自行或找原廠）',
      '- 新進人員或作業異動時，依機關需求做系統操作說明',
      '- 機關臨時交辦的本案系統相關事項',
      '',
      '# 注意',
      '- 現場營運作業（售票、驗票、托運、旅客服務）由機關人員負責，駐點人員不代為操作'
    ]],
    ['故障處理', '故障通報與處理程序（叫修）', 'Y', [
      '# 通報管道',
      '- 駐點時段：機關人員直接找駐點工程師（現場或電話）',
      '- 非駐點時段：' + hotline,
      '- 機關人員也可以用「報修網址」直接填報修單（不用登入，可附照片）',
      '- 電話、LINE 通報的，由駐點人員在本系統「叫修回報」補開單',
      '',
      '# 處理流程',
      '1. 受理登錄：記錄通報時間、通報人、設備或功能、現象。「收到通知時間」就是期限起算點',
      '2. 判定等級並告知機關',
      '3. 在回覆期限內回覆處理方式與預計排除時間（系統按「回覆」）',
      '4. 遠端或到場排除；期限內修不好，先提供同級（或更高級）備品替代，或經機關同意延後',
      '5. 排除後請機關人員確認恢復正常（系統按「結案」並填確認人）',
      '6. 第一級事件另提事件報告（原因、影響、處置、預防措施），48 小時內',
      '',
      '# 等級與時限',
      '- 第一級：完全無法正常售票或驗票 → 回覆 30 分鐘內、排除 1 小時內',
      '- 第二級：部分設備異常，可線上排除 → 回覆 1 小時內、排除 4 小時內',
      '- 第三級：部分設備異常，無法線上排除需到現場 → 回覆 2 小時內、排除 24 小時內',
      '- 逾期每 1 小時依保固金千分之五計罰',
      '',
      '# 第一級事件現場應變',
      '- 10 分鐘內可切換備援 → 現場暫停等候切換',
      '- 預估超過 10 分鐘 → 立即通報現場主管，建議啟動人工應變，同時搶修系統'
    ]],
    ['人工應變', '三級應變判斷', 'Y', [
      '是否啟動人工應變由「現場主管」決定；我們提出建議並提供技術支援。',
      '',
      '# 第一級：系統備援切換',
      '- 情形：判斷 10 分鐘內可用備援恢復（A／B 主機切換、服務重啟等）',
      '- 現場：暫停作業，等候切換完成',
      '- 我們：立即切換並通知恢復時間，事後提出原因說明',
      '',
      '# 第二級：人工應變程式',
      '- 情形：需要超過 10 分鐘才能恢復；或網路中斷但電腦、印表機還能用',
      '- 售票：人工應變售票程式（可匯入預報、產出確報）',
      '- 驗票：人工應變驗票程式（通關、登船）',
      '- 行李托運：行李托運人工應變程式（秤重、收費、行李條、發票）',
      '- 候補：使用預先印製的候補號碼單，裁切後發放',
      '- 我們：通知切換、協助操作、同步搶修；恢復後協助把確報、行李回填資料匯回系統並對帳',
      '',
      '# 第三級：完全人工作業',
      '- 情形：整個場站停電、斷網，電腦與印表機都不能用',
      '- 人工出票（預印票或手寫）、驗票人工核對並點算人數、行李手寫托運單、發票用手開發票本',
      '- 我們：平時提醒機關備妥物品；恢復後協助資料補登'
    ]],
    ['人工應變', '人工應變（斷網）售票／驗票一頁說明', 'Y', [
      '# 什麼時候啟用',
      '- 網路斷線或售票系統不能用，但電腦可以開機、印表機可以印',
      '- 由值班主管宣布「啟用人工應變」後才開始；網路恢復後回到正常系統',
      '',
      '# 售票人員',
      '1. 開「售票\\人工應變售票.exe」，輸入姓名與櫃號（每台電腦不同，例 A1、A2）',
      '2. 到 mail 下載這班的預報名單 →「匯入預報」→ 選開航日期、船班 → 選檔案匯入（檔名不用改）',
      '3. 「售票」選船班、登船口 → 打第一證號（有預報會自動帶入）→ 核對資料 → 現金／信用卡出票',
      '4. 紫色「已預付 出票」＝線上／i海台已預付，不收錢；團體電客只收服務費',
      '5. 橘底「預報票種…請確認」→ 要跟旅客確認票種',
      '6. 劃位截止：開航前 20 分鐘（橘色＝剩 10 分鐘，紅色＝已截止）',
      '7. 打錯：右側「本航班我的劃位」選該筆 →「修改選取」→ 補印，收回舊票；退票：「劃位取消」，收回紙本票',
      '8. 這班賣完：「匯出確報／結帳」→「匯出我的確報」→ 檔案交給確報整合人員',
      '9. 旅客退票：到有發票機的櫃台 →「退票」頁掃票 → 印出「退票手續費」發票（票價 10%，無條件進位），服務費全退。i海台的票到原平台退；團體電客只退服務費，船票到船公司退',
      '',
      '# 確報整合人員（一位）',
      '1. 收齊每位售票員的確報檔與退票櫃台的「退票清單」',
      '2. 「匯出確報／結帳」→「選擇要合併的確報檔」→ 全選（含退票清單）→ 產出正式確報',
      '3. 有「證號重複」提醒時，找相關售票員確認後再送出',
      '',
      '# 驗票人員',
      '1. 開「驗票\\人工應變驗票.exe」，輸入姓名 → 選航班與檢查點（通關＝驗1／登船＝驗3）',
      '2. 刷票上的 QR：綠色＝通過；紅色＝重複或非本航班，不可放行',
      '3. 舊系統的票（核銷碼）：刷完要輸入旅客姓名',
      '4. 沒有 QR：「手動驗票」，必填登船證號或第一證號（擇一）＋姓名',
      '5. 驗1、驗3 驗完都要跟櫃台確認人數；結束後「匯出通關／登船 Excel」交給櫃台',
      '',
      '# 小提醒',
      '- 資料自動存檔，不要刪除「售票\\資料」「驗票\\資料」資料夾',
      '- 船班表每 3 天自動更新；斷線找不到船班可按「＋ 手動新增船班」',
      '- 結束後確報、售票紀錄、驗票 Excel 交主管存查'
    ]],
    ['人工應變', '行李托運人工應變（斷網）一頁說明', 'Y', [
      '# 什麼時候用',
      '- 網路斷線或行李系統不能用，但電腦、磅秤、行李條標籤機還能用；由值班主管宣布啟用',
      '- 開「行李托運\\行李托運人工應變.exe」→ 輸入自己的姓名（承辦人）',
      '',
      '# 托運',
      '1. 航班：確認日期 → 下拉選航班；找不到 →「＋船班」',
      '2. 旅客：掃船票 QR；沒有票 →「無票手動輸入」（登船證號、姓名必填）',
      '3. 行李明細：放上磅秤（「已連線」時自動帶入，可「鎖定」或直接打）；有打包費就改金額',
      '4. 多件行李按「＋加行李」；協運請在備註寫「協運」',
      '5. 看「總金額」收錢 → 現金／信用卡（統編、載具按「發票…」）→「完成」：行李條和發票一起印',
      '6. 補印、退運、作廢：右邊紀錄勾選後操作（退運發票一起作廢）；行李牌每班從 001 開始',
      '7. 只收打包費：「純打包費」分頁',
      '',
      '# 開船前：三聯單',
      '- 「報表列印／匯出」→ 選日期船班 →「三聯單：核對／列印」→ 核對後「列印三聯單」（A4、3 份）',
      '',
      '# 當天結束',
      '1. 行李統計報表（營收表）匯出或列印，和收到的錢核對後交主管',
      '2. 「匯出回填檔」→「行李托運\\匯出」資料夾裡的回填檔交給工程師，網路恢復後由工程師匯回系統',
      '',
      '# 收費規則（同正式系統）',
      '- 每人免費 5 公斤，以同一人所有行李總重計；小數點無條件進位（6.1 算 7）',
      '- 每人總重超過 20 公斤紅字提醒（仍可托運）',
      '',
      '# 小提醒',
      '- 發票由本機 PrintInvoice 印出，請保持開著；黃字「發票程式沒在處理」→ 打開發票程式；「發票失敗」→ 托運紀錄選那筆「重送發票」',
      '- 斷線前系統這班已印到幾號，到「設定」把「本班下一個行李牌號碼」改成下一號；兩台電腦托運同一班時，第二台設 501',
      '- 有網路時點「立即更新航班資料.cmd」先下載 45 天航班'
    ]],
    ['人工應變', '人工應變平時準備', 'N', [
      '- 維護人工應變程式（人工應變售票／驗票、行李托運人工應變、取航班工具）',
      '- 駐點期間每週確認各櫃台電腦的船班資料保持更新（每週巡檢項目）',
      '- 第三級所需的票券、手開發票本、托運單等由機關準備保管；我們在演練或巡檢時提醒檢查存量（每月巡檢項目）',
      '- 依機關需求協助人工應變演練，並依演練結果回饋修正作業程序書'
    ]],
    ['保固範圍', '不在保固範圍的處理方式', 'Y', [
      '# 不在保固範圍',
      '- 人為不當操作、外力撞擊、浸水、天災、電力異常、未經同意拆裝改造造成的損壞 → 提供檢測與報價，經機關同意後修復',
      '- 消耗性材料補充（船票、登船卡、熱感紙、行李條紙捲、電子發票紙等）',
      '- 機關自有設備、網路線路、非本案建置的系統（電信線路、機關網路設備、收單銀行刷卡機、外部機關系統等）',
      '- 外部機關或服務商變更介接規格所需的調整（法規修正或主管機關行文要求者除外）',
      '',
      '# 駐點人員怎麼做',
      '1. 先排查本案系統是否正常',
      '2. 確認不是本案系統的問題 → 告知機關問題點，由機關與相關單位溝通處理',
      '3. 一樣要在系統開叫修單並記錄處理過程，結案時寫明「非本案範圍」'
    ]],
    ['系統維護', '軟體維護與版本更新', 'N', [
      '- 保固期內負責：系統無法正常運作的排除修正、回應時間不佳或程序繁複的調整、安全性漏洞修正、程式錯誤修正',
      '- 版本更新採 A／B 雙主機：先在測試主機與測試資料庫驗證並經現場確認 → 切換上線 → 異常立即切回 → 穩定 1～2 週後同步到另一台',
      '- 更新安排在離峰或非營運時段，事先通知機關並記錄版本與更新內容（記在工作紀錄，類別選「更新」）',
      '- 設備韌體有新版時，主動提供韌體更新程式，經機關同意後免費更新',
      '- 需求異動：契約範圍內的瑕疵改善在保固期內處理；新增功能經雙方評估後另行議定'
    ]],
    ['資安', '資通安全與個人資料保護', 'Y', [
      '- 遵守資通安全管理法、個人資料保護法與機關資安規定；機關可對我們稽核',
      '- 發生資安事件：知悉後立即通報機關，提出緊急應變處置，配合後續調查',
      '- 不可任意變更或攜出機關電腦硬體、軟體或資料；不可對程式及軟體私設密碼',
      '- 遠端維護必須經機關同意的管道進行並留存紀錄',
      '- 系統操作日誌及資料庫操作紀錄至少保存 6 個月',
      '- 旅客個資不可拍照外傳、不可存在個人電腦或手機'
    ]],
    ['設備', '保固設備清冊', 'N', [
      '1. 網頁伺服主機 Dell PowerEdge R770 ×2（機房）',
      '2. 資料庫伺服主機 Dell PowerEdge R770 ×2（機房）',
      '3. 自助取(售)票候補機台 ×5（人工售票處）',
      '4. 多功能列印機 TSC TH240 ×22（含自助機台內 5 台；行李托運、人工售票處、自助機台）',
      '5. 行李托運電腦 ×2（行李托運櫃台）',
      '6. 櫃檯行李過磅輸送機 芃昕 LS-MC-130 ×4 組（行李托運櫃台）',
      '7. 閘門式驗票機（3通道）和鼎 HD9323 ×4（驗1）',
      '8. 閘門顯示螢幕 ×4（含備品 1 個；驗1）',
      '9. 手持式驗票設備 Opticon H-37 ×6（人工售票處）',
      '10. 桌上型二維影像掃描器 DT8630 ×13（驗1、驗3、售票櫃台）',
      '11. 櫃台熱感印表機 EPSON TM-T82 ×5（售票櫃台）',
      '12. 24埠網路交換器 Ruckus ICX8200-24 ×2（機房、人工售票處）',
      '13. 8埠網路交換器 ZYXEL GS-108B V5 ×3（機房、驗1、驗3）',
      '14. KVM 切換器 ATEN CL5708N ×1（機房）',
      '15. 不斷電系統 Eaton C-3000RN（3KVA 在線式）×1（機房）',
      '16. 41U 機櫃 ×1（機房）',
      '17. 網路佈線 Cat.6 ×1 式（全區）',
      '',
      '數量與位置以硬體設備交付清單及現場點交紀錄為準；設備移位時要更新本清冊。'
    ]],
    ['設備', '本案系統範圍（12 項）', 'N', [
      '1. 票務管理系統（後台）',
      '2. 線上售票網頁與 App',
      '3. 自助取(售)票候補系統',
      '4. 人工售票系統（櫃台 POS）',
      '5. 閘門式驗票系統',
      '6. 手持式設備驗票系統',
      '7. 候補系統（登記、叫號、看板）',
      '8. 船班資訊系統（資訊看板）',
      '9. 行李托運(收費)系統',
      '10. 船票查驗系統（通關、登船、未登船名單）',
      '11. 對外資料介接（TDX、航港局乘客名冊、移民署航前旅客資訊、金流、電子發票、i海台）',
      '12. 人工應變程式'
    ]],
    ['操作手冊', 'POS 人工售票操作手冊（整合版 V2）', 'N', [
      '附件在雲端硬碟資料夾「SOP文件」。主管可在編輯畫面按「上傳附件」更新版本。'
    ]],
    ['操作手冊', '票務後台操作手冊（整合版 V2）', 'N', [
      '附件在雲端硬碟資料夾「SOP文件」。主管可在編輯畫面按「上傳附件」更新版本。'
    ]],
    ['操作手冊', '管理後台操作手冊（整合版 V2）', 'N', [
      '附件在雲端硬碟資料夾「SOP文件」。主管可在編輯畫面按「上傳附件」更新版本。'
    ]]
  ];
  appendObjs_('SOP', S.map(function (x, i) {
    return { 'ID': 'S' + (i < 9 ? '0' : '') + (i + 1), '分類': x[0], '標題': x[1], '內容': x[3].join('\n'), '文件連結': '', '版本': '1', '必讀': x[2], '更新日': d, '更新人': '系統' };
  }));
}
