/**
 * 金門小三通 駐點維運系統 V1
 * Google Apps Script（綁定 Google Sheet 當資料庫）
 * 功能：排班、叫修回報＋維護工作紀錄、定期巡檢、SOP／教育訓練、主管管理（人員、設定、月維護報告）
 * 依據：金廈(泉)票務系統暨服務採購案_系統保固與維護計畫書V2（附表一～四、陸、玖）
 */

var TZ = 'Asia/Taipei';

var SHEETS = {
  '人員': ['Email', '姓名', '角色', '電話', '啟用'],
  '設定': ['項目', '值', '說明'],
  '班表': ['日期', 'Email', '姓名', '手動', '備註', '更新時間'],
  '班表月份': ['月份', '狀態', '發布時間', '發布人'],
  '不可上班': ['日期', 'Email', '姓名', '原因', '登記時間'],
  '填寫確認': ['月份', 'Email', '姓名', '確認時間'],
  '叫修單': ['編號', '通報時間', '通報人', '通報單位', '通報電話', '設備系統', '位置編號', '故障現象', '等級',
    '回覆期限', '排除期限', '回覆時間', '回覆人', '處理過程', '排除時間', '備品', '機關確認人', '狀態',
    '照片', '事件報告', '建立者', '建立者Email', '更新時間', '已提醒'],
  '工作紀錄': ['ID', '日期', '時間', '類別', '內容摘要', '處理結果', '處理人', '關聯編號'],
  '巡檢項目': ['ID', '頻率', '區域', '檢查項目', '排序', '啟用'],
  '巡檢紀錄': ['紀錄ID', '頻率', '期別', '巡檢時間', '巡檢人Email', '巡檢人', '項目ID', '區域', '檢查項目', '結果', '說明', '機關確認人'],
  'SOP': ['ID', '分類', '標題', '內容', '文件連結', '版本', '必讀', '更新日', '更新人'],
  '已讀紀錄': ['SOPID', '版本', 'Email', '姓名', '時間']
};

var DEFAULT_SETTINGS = [
  ['系統名稱', '金門小三通駐點維運系統', '顯示在網頁標題與信件主旨'],
  ['上班時間', '08:00～17:30', '每日一班、一人，全年無休'],
  ['不可上班日登記截止日', '20', '每月幾號前要登記「下個月」哪幾天不能上班'],
  ['最多連續上班天數', '6', '自動排班時，同一人最多連續上幾天'],
  ['偏好連續天數', '2', '自動排班時，盡量讓同一人連上幾天再換人（1＝每天輪替）'],
  ['巡檢逾期提醒時間', '11', '幾點還沒做完當日巡檢就寄信提醒（24 小時制）'],
  ['明日值班提醒時間', '17', '幾點寄信提醒明天值班的人'],
  ['保固期滿日', '', 'yyyy-MM-dd，用來提醒「保固期滿前」檢查項目（可空白）'],
  ['系統網址', '', '部署後的網頁網址，信件裡的連結會用這個（空白則自動抓）'],
  ['檔案資料夾ID', '', '照片與月報存放的雲端硬碟資料夾（setup 自動建立）']
];

var EQUIP_LIST = ['售票櫃台', '自助機台', '閘門', '手持設備', '行李托運', '資訊看板', '線上售票／App', '後台', '機房', '其他'];

var SLA = { // 分鐘：回覆期限、排除期限（保固計畫書 伍、三）
  '1': { reply: 30, fix: 60, name: '第一級', desc: '完全無法正常售票或驗票' },
  '2': { reply: 60, fix: 240, name: '第二級', desc: '部分設備異常，可線上排除' },
  '3': { reply: 120, fix: 1440, name: '第三級', desc: '部分設備異常，需派人到現場' }
};

var FREQS = ['每日', '每週', '每月', '每季', '保固期滿前'];

/* ============================== 網頁入口 ============================== */

function doGet() {
  var s = getSettings_();
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle(s['系統名稱'] || '駐點維運系統')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function onOpen() {
  try {
    SpreadsheetApp.getUi().createMenu('駐點系統')
      .addItem('① 初始化（建立工作表、範本資料、排程）', 'setup')
      .addItem('② 重新安裝排程（寄信提醒）', 'installTriggers')
      .addToUi();
  } catch (e) { /* 非試算表介面時略過 */ }
}

/* ============================== 共用工具 ============================== */

function ss_() { return SpreadsheetApp.getActiveSpreadsheet(); }

function sh_(name) {
  var s = ss_().getSheetByName(name);
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

function header_(name) { return SHEETS[name]; }

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
    return { email: String(p['Email']).trim().toLowerCase(), name: p['姓名'], role: p['角色'] || '駐點', phone: p['電話'], active: p['啟用'] !== 'N', _row: p._row };
  }).filter(function (p) { return p.email && (includeInactive || p.active); });
}

function staff_() { return people_().filter(function (p) { return p.role === '駐點'; }); }
function admins_() { return people_().filter(function (p) { return p.role === '主管'; }); }
function nameOf_(email) { var p = people_(true).filter(function (x) { return x.email === email; })[0]; return p ? p.name : email; }

function me_() {
  var email = String(Session.getActiveUser().getEmail() || '').toLowerCase();
  if (!email) throw new Error('無法取得您的 Google 帳號，請用公司帳號登入後再開啟。');
  var p = people_().filter(function (x) { return x.email === email; })[0];
  if (!p) throw new Error('帳號 ' + email + ' 尚未加入系統，請聯絡主管在「人員」名單加入。');
  p.isAdmin = p.role === '主管';
  return p;
}

function requireAdmin_() {
  var me = me_();
  if (!me.isAdmin) throw new Error('這個功能只有主管可以使用。');
  return me;
}

function appUrl_() {
  var s = getSettings_();
  if (s['系統網址']) return s['系統網址'];
  try { return ScriptApp.getService().getUrl() || ''; } catch (e) { return ''; }
}

function folder_() {
  var s = getSettings_(), id = s['檔案資料夾ID'];
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) { } }
  var f = DriveApp.createFolder(s['系統名稱'] + '_檔案');
  setSetting_('檔案資料夾ID', f.getId());
  return f;
}

function setSetting_(key, val) {
  var rows = readTable_('設定'), r = rows.filter(function (x) { return x['項目'] === key; })[0];
  if (r) updateObj_('設定', r._row, { '值': val });
  else appendObj_('設定', { '項目': key, '值': val, '說明': '' });
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

/* ============================== 初始化 ============================== */

function api_init() {
  var me = me_(), s = getSettings_();
  return {
    me: { email: me.email, name: me.name, role: me.role, isAdmin: me.isAdmin },
    people: people_(true).map(function (p) { return { email: p.email, name: p.name, role: p.role, phone: p.phone, active: p.active }; }),
    settings: s, today: today_(), now: now_(), equip: EQUIP_LIST, sla: SLA, freqs: FREQS
  };
}

/* ============================== 首頁 ============================== */

function api_home() {
  var me = me_(), t = today_(), tm = addDays_(t, 1), month = t.slice(0, 7), s = getSettings_();
  var shifts = readTable_('班表'), months = monthStatusMap_();
  var pub = function (d) { return months[d.slice(0, 7)] === '已發布' || me.isAdmin; };
  var duty = function (d) { var r = shifts.filter(function (x) { return x['日期'] === d; })[0]; return r && pub(d) ? r['姓名'] : ''; };
  var mine = shifts.filter(function (x) { return x['Email'] === me.email && x['日期'] >= t && pub(x['日期']); })
    .sort(function (a, b) { return a['日期'] < b['日期'] ? -1 : 1; }).slice(0, 6)
    .map(function (x) { return x['日期']; });

  var insp = inspectionStatus_(t);
  var tickets = readTable_('叫修單').filter(function (x) { return x['狀態'] !== '已結案'; }).map(ticketView_);
  var nm = nextMonth_(month), deadline = Number(s['不可上班日登記截止日']) || 20;
  var confirmed = readTable_('填寫確認').some(function (x) { return x['月份'] === nm && x['Email'] === me.email; });
  var sops = readTable_('SOP'), reads = readTable_('已讀紀錄').filter(function (x) { return x['Email'] === me.email; });
  var unread = sops.filter(function (x) {
    return x['必讀'] === 'Y' && !reads.some(function (r) { return r['SOPID'] === x['ID'] && r['版本'] === x['版本']; });
  }).map(function (x) { return { id: x['ID'], title: x['標題'] }; });

  return {
    today: t, todayDuty: duty(t), tomorrowDuty: duty(tm), myShifts: mine,
    insp: insp, tickets: tickets,
    leave: { month: nm, deadline: month + '-' + (deadline < 10 ? '0' : '') + deadline, confirmed: confirmed, isStaff: me.role === '駐點' },
    unread: unread
  };
}

/* ============================== 排班 ============================== */

function monthStatusMap_() {
  var m = {};
  readTable_('班表月份').forEach(function (r) { m[r['月份']] = r['狀態']; });
  return m;
}

function api_getSchedule(month) {
  var me = me_(), status = monthStatusMap_()[month] || '未排班';
  var row = readTable_('班表月份').filter(function (r) { return r['月份'] === month; })[0];
  var show = me.isAdmin || status === '已發布';
  var shifts = readTable_('班表').filter(function (x) { return x['日期'].slice(0, 7) === month; });
  var map = {};
  shifts.forEach(function (x) { map[x['日期']] = x; });
  var days = monthDays_(month).map(function (d) {
    var r = map[d] || {};
    return { date: d, wd: weekday_(d), email: show ? (r['Email'] || '') : '', name: show ? (r['姓名'] || '') : '', manual: show && r['手動'] === 'Y', note: show ? (r['備註'] || '') : '' };
  });
  var unav = readTable_('不可上班').filter(function (x) { return x['日期'].slice(0, 7) === month; })
    .map(function (x) { return { date: x['日期'], email: x['Email'], name: x['姓名'], reason: x['原因'] }; });
  var confirms = readTable_('填寫確認').filter(function (x) { return x['月份'] === month; })
    .map(function (x) { return { email: x['Email'], name: x['姓名'], at: x['確認時間'] }; });
  var stats = {};
  days.forEach(function (d) { if (d.email) stats[d.email] = (stats[d.email] || 0) + 1; });
  var s = getSettings_(), dl = Number(s['不可上班日登記截止日']) || 20, pm = prevMonth_(month);
  return {
    month: month, status: status, publishedAt: row ? row['發布時間'] : '', visible: show,
    days: days, unavail: unav, confirms: confirms, stats: stats,
    staff: staff_().map(function (p) { return { email: p.email, name: p.name }; }),
    deadline: pm + '-' + (dl < 10 ? '0' : '') + dl, today: today_()
  };
}

function api_toggleUnavail(date, reason) {
  var me = me_();
  if (date < today_()) throw new Error('不能登記今天以前的日期。');
  return withLock_(function () {
    var rows = readTable_('不可上班').filter(function (x) { return x['日期'] === date && x['Email'] === me.email; });
    if (rows.length) {
      deleteRows_('不可上班', rows.map(function (r) { return r._row; }));
      return { on: false };
    }
    appendObj_('不可上班', { '日期': date, 'Email': me.email, '姓名': me.name, '原因': reason || '', '登記時間': now_() });
    // 已發布且當天是自己值班 → 通知主管調班
    var month = date.slice(0, 7);
    if (monthStatusMap_()[month] === '已發布') {
      var sh = readTable_('班表').filter(function (x) { return x['日期'] === date; })[0];
      if (sh && sh['Email'] === me.email) {
        mail_(admins_(), '班表衝突：' + me.name + ' ' + md_(date) + ' 無法上班',
          '<p>' + esc_(me.name) + ' 登記 <b>' + date + '（' + WD[weekday_(date)] + '）</b> 無法上班，但當天已排他值班。</p>' +
          '<p>原因：' + esc_(reason || '（未填）') + '</p><p>請到「班表」調整當天值班人員。</p>');
        return { on: true, conflict: true };
      }
    }
    return { on: true };
  });
}

function api_confirmMonth(month) {
  var me = me_();
  return withLock_(function () {
    var old = readTable_('填寫確認').filter(function (x) { return x['月份'] === month && x['Email'] === me.email; });
    deleteRows_('填寫確認', old.map(function (r) { return r._row; }));
    appendObj_('填寫確認', { '月份': month, 'Email': me.email, '姓名': me.name, '確認時間': now_() });
    var mine = readTable_('不可上班').filter(function (x) { return x['日期'].slice(0, 7) === month && x['Email'] === me.email; })
      .map(function (x) { return md_(x['日期']) + (x['原因'] ? '（' + x['原因'] + '）' : ''); });
    mail_(admins_(), me.name + ' 已完成 ' + month + ' 不可上班日登記',
      '<p>' + esc_(me.name) + ' 已確認 ' + month + ' 的不可上班日：</p><p><b>' + (mine.length ? esc_(mine.join('、')) : '沒有不可上班的日子') + '</b></p>');
    return true;
  });
}

function api_autoSchedule(month, keepManual) {
  requireAdmin_();
  return withLock_(function () {
    var s = getSettings_();
    var maxC = Math.max(1, Number(s['最多連續上班天數']) || 6);
    var block = Math.max(1, Number(s['偏好連續天數']) || 2);
    var staff = staff_();
    if (!staff.length) throw new Error('「人員」名單裡沒有角色為「駐點」的人員。');
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
    setMonthStatus_(month, monthStatusMap_()[month] === '已發布' ? '已發布' : '草稿', null);
    return { gaps: gaps };
  });
}

function setMonthStatus_(month, status, by) {
  var r = readTable_('班表月份').filter(function (x) { return x['月份'] === month; })[0];
  var o = { '月份': month, '狀態': status };
  if (by) { o['發布時間'] = now_(); o['發布人'] = by; }
  if (r) updateObj_('班表月份', r._row, o); else appendObj_('班表月份', o);
}

function api_setShift(date, email, note) {
  var me = requireAdmin_();
  return withLock_(function () {
    var rows = readTable_('班表'), r = rows.filter(function (x) { return x['日期'] === date; })[0];
    var oldEmail = r ? r['Email'] : '';
    var name = email ? nameOf_(email) : '';
    var o = { '日期': date, 'Email': email || '', '姓名': name, '手動': 'Y', '備註': note || '', '更新時間': now_() };
    if (r) updateObj_('班表', r._row, o); else appendObj_('班表', o);
    var month = date.slice(0, 7), st = monthStatusMap_()[month];
    if (!st) setMonthStatus_(month, '草稿', null);
    if (st === '已發布' && oldEmail !== (email || '')) {
      var txt = date + '（' + WD[weekday_(date)] + '）值班：' + (oldEmail ? nameOf_(oldEmail) : '（無）') + ' → ' + (name || '（無）');
      mail_([oldEmail, email].concat(admins_().map(function (a) { return a.email; })), '班表異動 ' + md_(date),
        '<p>' + esc_(me.name) + ' 調整了已發布的班表：</p><p><b>' + esc_(txt) + '</b></p>' + (note ? '<p>備註：' + esc_(note) + '</p>' : ''));
    }
    return true;
  });
}

function api_publish(month) {
  var me = requireAdmin_();
  var data = api_getSchedule(month);
  setMonthStatus_(month, '已發布', me.name);
  var s = getSettings_();
  var rows = data.days.map(function (d) { return [md_(d.date), WD[d.wd], d.name || '（缺人）', d.note]; });
  var stat = Object.keys(data.stats).map(function (e) { return [nameOf_(e), data.stats[e] + ' 天']; });
  mail_(people_(), month + ' 班表已發布' + (data.publishedAt ? '（更新版）' : ''),
    '<p>' + month + ' 駐點班表已發布，上班時間 ' + esc_(s['上班時間']) + '，每天一人。</p>' +
    table_(['日期', '星期', '值班', '備註'], rows) + '<p>本月天數統計：</p>' + table_(['人員', '天數'], stat));
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
    replyOver: !!replyOver, fixOver: !!fixOver, replyLate: !!replyLate, fixLate: !!fixLate
  };
}

function api_listTickets(filter) {
  me_();
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

function createTicket_(me, o) {
  if (!o.symptom) throw new Error('請填寫故障現象。');
  if (!o.equip) throw new Error('請選擇設備或系統。');
  var lv = SLA[String(o.level)] ? String(o.level) : '2';
  var at = o.at && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(o.at) ? o.at : now_();
  var id = nextTicketId_(at);
  var rec = {
    '編號': id, '通報時間': at, '通報人': o.reporter || me.name, '通報單位': o.unit || '', '通報電話': o.phone || '',
    '設備系統': o.equip, '位置編號': o.loc || '', '故障現象': o.symptom, '等級': lv,
    '回覆期限': addMin_(at, SLA[lv].reply), '排除期限': addMin_(at, SLA[lv].fix),
    '狀態': '待回覆', '照片': (o.photos || []).join('\n'), '建立者': me.name, '建立者Email': me.email, '更新時間': now_(), '已提醒': ''
  };
  appendObj_('叫修單', rec);
  addLog_('叫修', '受理 ' + id + '：' + o.equip + (o.loc ? '／' + o.loc : '') + '－' + o.symptom, '待回覆', me.name, id);
  var lvName = SLA[lv].name;
  mail_(people_(), '［' + lvName + '］新叫修 ' + id + '：' + o.equip,
    '<p style="font-size:16px"><b style="color:' + (lv === '1' ? '#c62828' : '#0b5cad') + '">' + lvName + '</b>（' + esc_(SLA[lv].desc) + '）</p>' +
    table_(['欄位', '內容'], [['編號', id], ['通報時間', at], ['通報人', rec['通報人'] + ' ' + rec['通報單位'] + ' ' + rec['通報電話']],
    ['設備或系統', o.equip], ['位置／編號', o.loc || ''], ['故障現象', o.symptom], ['回覆期限', rec['回覆期限']], ['排除期限', rec['排除期限']]]) +
    (lv === '1' ? '<p style="color:#c62828"><b>第一級：預估超過 10 分鐘無法恢復時，請立即通報現場主管，建議啟動人工應變。</b></p>' : ''));
  return id;
}

function api_createTicket(o) {
  var me = me_();
  return withLock_(function () { return createTicket_(me, o); });
}

function findTicket_(id) {
  var t = readTable_('叫修單').filter(function (x) { return x['編號'] === id; })[0];
  if (!t) throw new Error('找不到叫修單 ' + id);
  return t;
}

function api_ticketAction(id, action, data) {
  var me = me_();
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

function api_uploadPhoto(name, dataUrl) {
  me_();
  var m = String(dataUrl).match(/^data:([^;]+);base64,(.+)$/);
  if (!m) throw new Error('照片格式錯誤');
  var blob = Utilities.newBlob(Utilities.base64Decode(m[2]), m[1], name || ('photo_' + Date.now() + '.jpg'));
  var file = folder_().createFile(blob);
  try { file.setSharing(DriveApp.Access.DOMAIN_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) { }
  return file.getId();
}

/* ============================== 維護工作紀錄（附表三） ============================== */

function addLog_(cat, summary, result, by, ref) {
  var n = now_();
  appendObj_('工作紀錄', { 'ID': uid_('W'), '日期': n.slice(0, 10), '時間': n.slice(11), '類別': cat, '內容摘要': summary, '處理結果': result || '', '處理人': by, '關聯編號': ref || '' });
}

function api_listWorklog(month) {
  me_();
  return readTable_('工作紀錄').filter(function (x) { return x['日期'].slice(0, 7) === month; })
    .map(function (x) { return { id: x['ID'], date: x['日期'], time: x['時間'], cat: x['類別'], summary: x['內容摘要'], result: x['處理結果'], by: x['處理人'], ref: x['關聯編號'] }; })
    .sort(function (a, b) { return (a.date + a.time) < (b.date + b.time) ? 1 : -1; });
}

function api_addWorklog(o) {
  var me = me_();
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

function api_deleteWorklog(id) {
  var me = me_();
  return withLock_(function () {
    var r = readTable_('工作紀錄').filter(function (x) { return x['ID'] === id; })[0];
    if (!r) return true;
    if (!me.isAdmin && r['處理人'] !== me.name) throw new Error('只能刪除自己的紀錄。');
    deleteRows_('工作紀錄', [r._row]);
    return true;
  });
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

function api_getInspections(dateStr) {
  var me = me_();
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

function api_submitInspection(freq, dateStr, results, confirmBy) {
  var me = me_();
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
        tickets.push(createTicket_(me, { equip: guessEquip_(it.area), loc: it.area, symptom: '［' + freq + '巡檢異常］' + (r.note || it.item), level: r.level || '2' }));
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

function api_inspectionHistory(month) {
  me_();
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

function api_saveInspItem(o) {
  requireAdmin_();
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

function api_listInspItems() { requireAdmin_(); return inspItems_(false); }

/* ============================== SOP／教育訓練 ============================== */

function api_listSOP() {
  var me = me_();
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

function api_saveSOP(o) {
  var me = requireAdmin_();
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

function api_deleteSOP(id) {
  requireAdmin_();
  return withLock_(function () {
    var r = readTable_('SOP').filter(function (x) { return x['ID'] === id; })[0];
    if (r) deleteRows_('SOP', [r._row]);
    return true;
  });
}

function api_markRead(id) {
  var me = me_();
  return withLock_(function () {
    var s = readTable_('SOP').filter(function (x) { return x['ID'] === id; })[0];
    if (!s) throw new Error('找不到文件');
    var has = readTable_('已讀紀錄').some(function (r) { return r['SOPID'] === id && r['版本'] === s['版本'] && r['Email'] === me.email; });
    if (!has) appendObj_('已讀紀錄', { 'SOPID': id, '版本': s['版本'], 'Email': me.email, '姓名': me.name, '時間': now_() });
    return true;
  });
}

/* ============================== 主管管理 ============================== */

function api_savePerson(o) {
  requireAdmin_();
  var email = String(o.email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+$/.test(email)) throw new Error('Email 格式錯誤');
  if (!o.name) throw new Error('請填寫姓名');
  return withLock_(function () {
    var r = people_(true).filter(function (p) { return p.email === email; })[0];
    var rec = { 'Email': email, '姓名': o.name, '角色': o.role === '主管' ? '主管' : '駐點', '電話': o.phone || '', '啟用': o.active === false ? 'N' : 'Y' };
    if (r) updateObj_('人員', r._row, rec); else appendObj_('人員', rec);
    return api_init().people;
  });
}

function api_saveSettings(map) {
  requireAdmin_();
  return withLock_(function () {
    Object.keys(map).forEach(function (k) { if (k !== '檔案資料夾ID') setSetting_(k, map[k]); });
    return getSettings_();
  });
}

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
  var hist = api_inspectionHistory(month);
  var days = hist.days.filter(function (d) { return d <= today_(); });
  var dailyDone = days.filter(function (d) { return hist.doneDays[d]; }).length;
  var abn = [];
  hist.list.forEach(function (g) { g.rows.forEach(function (r) { if (r.result === '異常') abn.push([g.label, g.freq, r.area, r.note || r.item]); }); });
  var logs = api_listWorklog(month).reverse();
  var open = readTable_('叫修單').filter(function (x) { return x['狀態'] !== '已結案'; }).map(ticketView_);
  var freqDone = {};
  ['每週', '每月', '每季'].forEach(function (f) { freqDone[f] = hist.list.filter(function (g) { return g.freq === f; }).map(function (g) { return g.label + '（' + g.by + '）'; }); });
  return { month: month, tickets: tickets, byLv: byLv, dailyDone: dailyDone, dailyTotal: days.length, abn: abn, logs: logs, open: open, freqDone: freqDone };
}

function api_monthReport(month, makeDoc) {
  var me = requireAdmin_(), r = monthReport_(month);
  if (!makeDoc) return r;
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
  try { file.moveTo(folder_()); } catch (e) { }
  r.docUrl = doc.getUrl();
  return r;
}

/* ============================== 排程（寄信提醒） ============================== */

function installTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (['cronSla', 'hourlyJob'].indexOf(t.getHandlerFunction()) >= 0) ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('cronSla').timeBased().everyMinutes(10).create();
  ScriptApp.newTrigger('hourlyJob').timeBased().everyHours(1).create();
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

/** 每小時：依時段寄班表、巡檢提醒（同一天同一時段只寄一次） */
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
    var day = Number(t.slice(8, 10)), dl = Number(s['不可上班日登記截止日']) || 20, nm = nextMonth_(t.slice(0, 7));
    if (day >= dl - 5 && day <= dl) {
      var done = readTable_('填寫確認').filter(function (x) { return x['月份'] === nm; }).map(function (x) { return x['Email']; });
      staff_().filter(function (p) { return done.indexOf(p.email) < 0; }).forEach(function (p) {
        mail_(p.email, '請登記 ' + nm + ' 不能上班的日子（' + md_(t.slice(0, 8) + (dl < 10 ? '0' : '') + dl) + ' 截止）',
          '<p>' + esc_(p.name) + ' 您好：</p><p>請在 <b>' + dl + ' 號</b>前到「班表」切換到 ' + nm + '，點選您不能上班的日子，完成後按「我登記好了」。沒有不能上班的日子也請按一下。</p>');
      });
    }
    if (day === dl + 1) {
      var cf = readTable_('填寫確認').filter(function (x) { return x['月份'] === nm; }).map(function (x) { return x['姓名']; });
      var notYet = staff_().filter(function (p) { return cf.indexOf(p.name) < 0; }).map(function (p) { return p.name; });
      mail_(adminsE, nm + ' 不可上班日登記已截止，可以排班',
        '<p>已登記：' + esc_(cf.join('、') || '無') + '</p><p>未登記：' + esc_(notYet.join('、') || '無') + '</p><p>請到「班表」切換到 ' + nm + '，按「自動排班」後確認並「發布」。</p>');
    }
    var st = inspectionStatus_(t), wd = weekday_(t), duty = dutyOf(t), to = [duty ? duty['Email'] : ''].concat(adminsE);
    if (wd === 5 && !st['每週'].done) mail_(to, '本週「每週巡檢」尚未完成', '<p>' + st['每週'].label + '的每週巡檢（錯誤日誌、資料庫空間、介接結果、人工應變船班表）還沒填，請在本週內完成。</p>');
    if (day === 25 && !st['每月'].done) mail_(to, '本月「每月巡檢」尚未完成', '<p>' + st['每月'].label + '的每月巡檢（系統更新、帳號清查、清潔耗材、月報）還沒填，請在月底前完成。</p>');
    if ([3, 6, 9, 12].indexOf(Number(t.slice(5, 7))) >= 0 && day === 20 && !st['每季'].done) mail_(to, '本季「每季巡檢」尚未完成', '<p>' + st['每季'].label + '的每季巡檢（備份還原測試、UPS 與機房環境、SSL 憑證與網域）還沒填，請在季底前完成。</p>');
    if (s['保固期滿日'] && !st['保固期滿前'].done && day === 1) {
      var left = Math.round((parseDate_(s['保固期滿日']) - parseDate_(t)) / 86400000);
      if (left >= 0 && left <= 90) mail_(adminsE, '保固期滿前檢查提醒（剩 ' + left + ' 天）', '<p>保固期滿日 ' + s['保固期滿日'] + '，行李過磅設備須再經經濟部標準檢驗局檢定合格並附證書 3 份，檢定前要先通知機關。</p>');
    }
  }

  if (hour === (Number(s['巡檢逾期提醒時間']) || 11)) {
    var st2 = inspectionStatus_(t), duty2 = dutyOf(t);
    if (!st2['每日'].done) {
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

function cleanupProps_(props, t) {
  var all = props.getProperties();
  Object.keys(all).forEach(function (k) { if (k.indexOf('job_') === 0 && k.slice(4, 14) < addDays_(t, -3)) props.deleteProperty(k); });
}

/* ============================== 初始化 setup ============================== */

function setup() {
  var ss = ss_();
  Object.keys(SHEETS).forEach(function (name) {
    var s = ss.getSheetByName(name);
    if (!s) s = ss.insertSheet(name);
    var h = SHEETS[name];
    if (s.getLastRow() === 0) {
      s.getRange(1, 1, 1, h.length).setValues([h]).setFontWeight('bold').setBackground('#e8f0fe');
      s.setFrozenRows(1);
    } else {
      var cur = s.getRange(1, 1, 1, Math.max(s.getLastColumn(), h.length)).getValues()[0].map(String);
      h.forEach(function (k, i) { if (cur[i] !== k && cur.indexOf(k) < 0) s.getRange(1, i + 1).setValue(k).setFontWeight('bold').setBackground('#e8f0fe'); });
    }
    s.getRange(1, 1, s.getMaxRows(), h.length).setNumberFormat('@');
  });
  ['工作表1', 'Sheet1'].forEach(function (n) { var s = ss.getSheetByName(n); if (s && ss.getSheets().length > 1 && s.getLastRow() === 0) ss.deleteSheet(s); });

  if (!readTable_('設定').length) appendObjs_('設定', DEFAULT_SETTINGS.map(function (r) { return { '項目': r[0], '值': r[1], '說明': r[2] }; }));
  if (!readTable_('人員').length) {
    var owner = String(Session.getEffectiveUser().getEmail() || '').toLowerCase();
    if (owner) appendObj_('人員', { 'Email': owner, '姓名': '主管', '角色': '主管', '電話': '', '啟用': 'Y' });
  }
  if (!readTable_('巡檢項目').length) seedInspection_();
  if (!readTable_('SOP').length) seedSOP_();
  folder_();
  installTriggers();
  try { SpreadsheetApp.getUi().alert('初始化完成！\n\n下一步：\n1. 到「人員」工作表加入駐點人員 Email、姓名、角色（駐點／主管）\n2. 到 Apps Script 按「部署 → 新增部署作業 → 網頁應用程式」'); } catch (e) { }
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
  var d = today_();
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
      '3. 看「叫修回報」有沒有未結案的單要接手',
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
      '- 非駐點時段：撥打保固服務專線，並以通訊軟體或電子郵件留下文字紀錄',
      '- 不論哪種管道，都要在本系統「叫修回報」開單（電話通報就由我們補登）',
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
      '請主管把 Word／PDF 上傳到雲端硬碟後，把連結貼到「文件連結」。',
      '原始檔：專案資料夾 B3.執行 Execution\\1.會議紀錄\\20261007和12結案驗收會議\\操作手冊文件補件\\操作手冊V2\\POS人工售票'
    ]],
    ['操作手冊', '票務後台操作手冊（整合版 V2）', 'N', [
      '請主管把 Word／PDF 上傳到雲端硬碟後，把連結貼到「文件連結」。',
      '原始檔：操作手冊V2\\票務後台'
    ]],
    ['操作手冊', '管理後台操作手冊（整合版 V2）', 'N', [
      '請主管把 Word／PDF 上傳到雲端硬碟後，把連結貼到「文件連結」。',
      '原始檔：操作手冊V2\\管理後台'
    ]]
  ];
  appendObjs_('SOP', S.map(function (x, i) {
    return { 'ID': 'S' + (i < 9 ? '0' : '') + (i + 1), '分類': x[0], '標題': x[1], '內容': x[3].join('\n'), '文件連結': '', '版本': '1', '必讀': x[2], '更新日': d, '更新人': '系統' };
  }));
}
