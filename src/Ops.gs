/**
 * 叫修選單、交辦事項、備品耗材、每月工時與請假統計、公告與討論
 */

/* ============================== 選單（設備、單位、故障原因） ============================== */

var MENU_TYPES = ['設備', '單位', '故障原因'];

function listSetting_(key) { return String(getSettings_()[key] || '').split(/[,，、]/).map(function (x) { return x.trim(); }).filter(String); }

function seedMenu_() {
  var rows = [];
  EQUIP_LIST.forEach(function (e) { rows.push(['設備', e, '']); });
  ['浯江售票組', '服務台', '驗票口', '行李托運', '港務處', '其他單位'].forEach(function (u) { rows.push(['單位', u, '']); });
  [['無法開機', ''], ['當機或畫面卡住', ''], ['網路連不上', ''], ['登入失敗', ''], ['印表機卡紙或印不出來', '售票櫃台,自助機台,行李托運'], ['發票機異常', '售票櫃台,行李托運'],
    ['掃描或讀卡失敗', '售票櫃台,自助機台,閘門,手持設備'], ['付款異常', '自助機台,售票櫃台'], ['閘門不開或一直開', '閘門'], ['電池沒電或充不了電', '手持設備'],
    ['過磅不準', '行李托運'], ['畫面資料不正確', '資訊看板,線上售票／App,後台'], ['網頁或 App 打不開', '線上售票／App,後台'], ['主機或 UPS 警示', '機房']].forEach(function (c) { rows.push(['故障原因', c[0], c[1]]); });
  appendObjs_('選單', rows.map(function (r, i) { return { 'ID': 'M' + (i + 1), '類型': r[0], '名稱': r[1], '附加': r[2], '排序': i + 1, '啟用': 'Y' }; }));
}

function menuRows_() {
  return readTable_('選單').map(function (x) { return { id: x['ID'], type: x['類型'], name: x['名稱'], extra: x['附加'], order: Number(x['排序']) || 0, active: x['啟用'] !== 'N' }; })
    .sort(function (a, b) { return a.order - b.order; });
}

function menu_() {
  var rows = menuRows_().filter(function (m) { return m.active; });
  var of = function (t) { return rows.filter(function (m) { return m.type === t; }); };
  return {
    equip: of('設備').map(function (m) { return { name: m.name }; }),
    units: of('單位').map(function (m) { return { name: m.name, phone: m.extra }; }),
    causes: of('故障原因').map(function (m) { return { name: m.name, equip: String(m.extra || '').split(/[,，、]/).map(function (x) { return x.trim(); }).filter(String) }; })
  };
}

function api_listMenu(tk) { requireAdmin_(tk); return menuRows_(); }

function api_saveMenu(tk, o) {
  requireAdmin_(tk);
  o = o || {};
  var name = String(o.name || '').trim().slice(0, 60);
  if (MENU_TYPES.indexOf(o.type) < 0) throw new Error('類型錯誤');
  if (!name) throw new Error('請填寫名稱');
  return withLock_(function () {
    var rows = readTable_('選單');
    if (rows.some(function (x) { return x['類型'] === o.type && x['名稱'] === name && x['ID'] !== o.id; })) throw new Error('「' + name + '」已經有了');
    var rec = { '類型': o.type, '名稱': name, '附加': String(o.extra || '').trim().slice(0, 200), '排序': Number(o.order) || 99, '啟用': o.active === false ? 'N' : 'Y' };
    if (o.id) {
      var r = rows.filter(function (x) { return x['ID'] === o.id; })[0];
      if (!r) throw new Error('找不到這個選項');
      updateObj_('選單', r._row, rec);
    } else { rec['ID'] = uid_('M'); appendObj_('選單', rec); }
    return { rows: menuRows_(), menu: menu_() };
  });
}

function api_deleteMenu(tk, id) {
  requireAdmin_(tk);
  return withLock_(function () {
    var r = readTable_('選單').filter(function (x) { return x['ID'] === id; })[0];
    if (r) deleteRows_('選單', [r._row]);
    return { rows: menuRows_(), menu: menu_() };
  });
}

/* ============================== 交辦事項 ============================== */

var TASK_STATES = ['待處理', '處理中', '已完成', '已取消'];

function taskView_(x) {
  var t = today_(), open = x['狀態'] === '待處理' || x['狀態'] === '處理中';
  return { id: x['ID'], title: x['標題'], detail: x['內容'], from: x['交辦人'], ownerEmail: x['負責人Email'], owner: x['負責人'], due: x['期限'], priority: x['優先'] || '中',
    status: x['狀態'], log: x['進度'], creator: x['建立者'], at: x['建立時間'], doneAt: x['完成時間'], updated: x['更新時間'], overdue: !!(open && x['期限'] && x['期限'] < t) };
}

/** 主管以上看全部；駐點看交辦給自己的 */
function api_listTasks(tk) {
  var me = me_(tk);
  var rank = { '待處理': 0, '處理中': 0, '已完成': 1, '已取消': 2 };
  return readTable_('交辦事項').filter(function (x) { return me.isAdmin || x['負責人Email'] === me.email; }).map(taskView_)
    .sort(function (a, b) { return rank[a.status] - rank[b.status] || String(a.due || '9').localeCompare(String(b.due || '9')) || (a.at < b.at ? 1 : -1); });
}

function api_saveTask(tk, o) {
  var me = requireAdmin_(tk);
  o = o || {};
  var title = String(o.title || '').trim().slice(0, 100), from = String(o.from || '').trim().slice(0, 30);
  var due = String(o.due || ''), owner = people_().filter(function (p) { return p.email === String(o.owner || '').toLowerCase(); })[0];
  if (!title) throw new Error('請填寫交辦事項');
  if (!from) throw new Error('請填寫交辦人');
  if (!owner) throw new Error('請選負責人');
  if (due && !/^\d{4}-\d{2}-\d{2}$/.test(due)) throw new Error('期限格式錯誤');
  return withLock_(function () {
    var n = now_(), rec = { '標題': title, '內容': String(o.detail || '').slice(0, 2000), '交辦人': from, '負責人Email': owner.email, '負責人': owner.name, '期限': due, '優先': ['高', '中', '低'].indexOf(o.priority) >= 0 ? o.priority : '中', '更新時間': n };
    var r = o.id ? readTable_('交辦事項').filter(function (x) { return x['ID'] === o.id; })[0] : null;
    if (o.id && !r) throw new Error('找不到這筆交辦事項');
    var id = o.id || uid_('T');
    if (r) updateObj_('交辦事項', r._row, rec);
    else { rec['ID'] = id; rec['狀態'] = '待處理'; rec['建立者'] = me.name; rec['建立時間'] = n; appendObj_('交辦事項', rec); }
    if (!r || r['負責人Email'] !== owner.email) {
      mail_(owner.email, '交辦事項：' + title + (due ? '（' + md_(due) + ' 前）' : ''),
        '<p>' + esc_(from) + ' 交辦（' + esc_(me.name) + ' 登錄）：</p><p><b>' + esc_(title) + '</b></p>' + (o.detail ? '<p>' + esc_(o.detail) + '</p>' : '') + (due ? '<p>期限：' + due + '</p>' : '') + '<p>請到「交辦」回報進度。</p>');
    }
    return id;
  });
}

/** action：note 回報進度、start 開始處理、done 完成（負責人或主管）；cancel 取消、reopen 重開、delete 刪除（主管） */
function api_taskAction(tk, id, action, text) {
  var me = me_(tk);
  return withLock_(function () {
    var r = readTable_('交辦事項').filter(function (x) { return x['ID'] === id; })[0];
    if (!r || (!me.isAdmin && r['負責人Email'] !== me.email)) throw new Error('找不到這筆交辦事項');
    if (['cancel', 'reopen', 'delete'].indexOf(action) >= 0 && !me.isAdmin) throw new Error('只有主管可以這樣做');
    if (action === 'delete') { deleteRows_('交辦事項', [r._row]); return true; }
    var n = now_(), o = { '更新時間': n }, msg = String(text || '').trim().slice(0, 1000), label = { start: '開始處理', done: '完成', cancel: '取消', reopen: '重新開啟' }[action];
    if (action === 'note' && !msg) throw new Error('請填寫進度');
    if (action !== 'note' && !label) throw new Error('不支援的動作');
    if (action === 'start') o['狀態'] = '處理中';
    if (action === 'done') { o['狀態'] = '已完成'; o['完成時間'] = n; }
    if (action === 'cancel') o['狀態'] = '已取消';
    if (action === 'reopen') { o['狀態'] = '處理中'; o['完成時間'] = ''; o['已提醒'] = ''; }
    if (action === 'note' && r['狀態'] === '待處理') o['狀態'] = '處理中';
    o['進度'] = (r['進度'] ? r['進度'] + '\n' : '') + '[' + n.slice(5) + ' ' + me.name + '] ' + (label || '') + (label && msg ? '：' : '') + msg;
    updateObj_('交辦事項', r._row, o);
    if (action === 'done') mail_(admins_().filter(function (a) { return a.email !== me.email; }), '交辦完成：' + r['標題'], '<p>' + esc_(me.name) + ' 已完成 ' + esc_(r['交辦人']) + ' 交辦的「' + esc_(r['標題']) + '」。</p>' + (msg ? '<p>' + esc_(msg) + '</p>' : ''));
    return true;
  });
}

/** 每天早上：逾期或今天到期的交辦事項，一天提醒一次 */
function remindTasks_(t) {
  var adminsE = admins_().map(function (a) { return a.email; });
  readTable_('交辦事項').forEach(function (x) {
    if ((x['狀態'] !== '待處理' && x['狀態'] !== '處理中') || !x['期限'] || x['期限'] > t || x['已提醒'] === t) return;
    var over = x['期限'] < t;
    mail_([x['負責人Email']].concat(over ? adminsE : []), (over ? '⚠ 交辦逾期：' : '交辦今天到期：') + x['標題'], '<p>' + esc_(x['交辦人']) + ' 交辦、' + esc_(x['負責人']) + ' 負責的「' + esc_(x['標題']) + '」期限 ' + x['期限'] + (over ? '，已逾期' : '') + '。</p><p>請到「交辦」回報進度。</p>');
    updateObj_('交辦事項', x._row, { '已提醒': t });
  });
}

/* ============================== 備品耗材 ============================== */

function stockView_(x) {
  var qty = Number(x['現有量']) || 0, safe = Number(x['安全存量']) || 0;
  return { id: x['ID'], type: x['類型'], name: x['名稱'], spec: x['規格'], unit: x['單位'], place: x['位置'], safe: safe, qty: qty, note: x['備註'], active: x['啟用'] !== 'N', low: x['啟用'] !== 'N' && safe > 0 && qty <= safe };
}

function api_listStock(tk) {
  me_(tk);
  var moves = readTable_('備品異動').map(function (x) { return { id: x['ID'], itemId: x['品項ID'], name: x['品名'], type: x['異動'], qty: Number(x['數量']) || 0, after: Number(x['結存']) || 0, ref: x['關聯單號'], note: x['說明'], by: x['操作人'], at: x['時間'] }; })
    .sort(function (a, b) { return a.at < b.at ? 1 : -1; }).slice(0, 200);
  return { items: readTable_('備品耗材').map(stockView_).sort(function (a, b) { return (b.low ? 1 : 0) - (a.low ? 1 : 0) || a.type.localeCompare(b.type) || a.name.localeCompare(b.name); }), moves: moves };
}

function api_saveStock(tk, o) {
  var me = requireAdmin_(tk);
  o = o || {};
  var name = String(o.name || '').trim().slice(0, 60);
  if (['備品', '耗材'].indexOf(o.type) < 0) throw new Error('請選類型');
  if (!name) throw new Error('請填寫品名');
  var safe = Number(o.safe) || 0;
  if (safe < 0) throw new Error('安全存量不能小於 0');
  return withLock_(function () {
    var rec = { '類型': o.type, '名稱': name, '規格': String(o.spec || '').slice(0, 100), '單位': String(o.unit || '個').slice(0, 10), '位置': String(o.place || '').slice(0, 60), '安全存量': safe, '備註': String(o.note || '').slice(0, 200), '啟用': o.active === false ? 'N' : 'Y' };
    if (o.id) {
      var r = readTable_('備品耗材').filter(function (x) { return x['ID'] === o.id; })[0];
      if (!r) throw new Error('找不到品項');
      updateObj_('備品耗材', r._row, rec);
      return o.id;
    }
    var id = uid_('K'), first = Number(o.qty) || 0;
    if (first < 0) throw new Error('數量不能小於 0');
    rec['ID'] = id; rec['現有量'] = first;
    appendObj_('備品耗材', rec);
    if (first) logMove_(me, id, name, '入庫', first, first, '', '建立品項');
    return id;
  });
}

function logMove_(me, id, name, type, qty, after, ref, note) {
  appendObj_('備品異動', { 'ID': uid_('V'), '品項ID': id, '品名': name, '異動': type, '數量': qty, '結存': after, '關聯單號': ref || '', '說明': note || '', '操作人': me.name, '時間': now_() });
}

/** 異動庫存（呼叫端要持鎖）。回傳「品名 x 數量」給叫修單使用 */
function stockMove_(me, o) {
  var r = readTable_('備品耗材').filter(function (x) { return x['ID'] === o.id; })[0];
  if (!r) throw new Error('找不到品項');
  var type = o.type, qty = Number(o.qty), cur = Number(r['現有量']) || 0, after;
  if (['入庫', '領用', '盤點'].indexOf(type) < 0) throw new Error('異動類型錯誤');
  if (!isFinite(qty) || qty < 0 || (type !== '盤點' && qty === 0)) throw new Error('請填正確的數量');
  if (type === '領用' && qty > cur) throw new Error(r['名稱'] + ' 庫存只剩 ' + cur + ' ' + r['單位']);
  after = type === '入庫' ? cur + qty : type === '領用' ? cur - qty : qty;
  updateObj_('備品耗材', r._row, { '現有量': after });
  logMove_(me, r['ID'], r['名稱'], type, qty, after, o.ref, String(o.note || '').slice(0, 200));
  var safe = Number(r['安全存量']) || 0;
  if (safe > 0 && after <= safe && cur > safe) {
    mail_(admins_(), '庫存偏低：' + r['名稱'] + ' 剩 ' + after + ' ' + r['單位'], '<p>' + esc_(r['類型']) + '「' + esc_(r['名稱']) + '」目前 ' + after + ' ' + esc_(r['單位']) + '，低於或等於安全存量 ' + safe + '，請安排補貨。</p>');
  }
  return r['名稱'] + ' x ' + qty;
}

function api_stockMove(tk, o) {
  var me = me_(tk);
  o = o || {};
  if (o.type === '盤點' && !me.isAdmin) throw new Error('盤點只有主管可以使用');
  return withLock_(function () { stockMove_(me, o); return true; });
}

/* ============================== 每月工時與請假統計 ============================== */

function api_monthStats(tk, month) {
  requireAdmin_(tk);
  if (!/^\d{4}-\d{2}$/.test(String(month))) throw new Error('月份格式錯誤');
  var days = monthDays_(month), from = days[0], to = days[days.length - 1], t = today_();
  var kinds = listSetting_('假別'), rows = {}, detail = [];
  var row = function (email, name) {
    return rows[email] || (rows[email] = { email: email, name: name, schedDays: 0, schedHours: 0, workDays: 0, workHours: 0, late: 0, early: 0, missing: 0, leaveHours: 0, leave: {} });
  };
  people_(true).forEach(function (p) { if (p.active) row(p.email, p.name); });
  var shift = {};
  readTable_('班表').forEach(function (x) {
    if (x['日期'] < from || x['日期'] > to || !x['Email']) return;
    var sp = shiftSpan_(x), r = row(x['Email'], x['姓名']), k = x['日期'] + '|' + x['Email'];
    r.schedHours += netMin_(sp.s, sp.e) / 60;
    if (!shift[k]) r.schedDays++;
    (shift[k] = shift[k] || []).push(sp.s + '-' + sp.e);
  });
  var seen = {};
  punchSummary_(from, to, '').forEach(function (g) {
    var r = row(g.email, g.name), h = g.in && g.out ? round2_(netMin_(g.in, g.out) / 60) : 0;
    if (g.in || g.out) r.workDays++;
    r.workHours += h;
    if (/遲到/.test(g.note)) r.late++;
    if (/早退/.test(g.note)) r.early++;
    if ((!g.in || !g.out) && g.date < t) r.missing++;
    seen[g.date + '|' + g.email] = 1;
    detail.push({ date: g.date, name: g.name, shift: (shift[g.date + '|' + g.email] || []).join('、'), in: g.in, out: g.out, hours: h, note: g.note, leave: '' });
  });
  // 有排班但完全沒打卡（過去的日子）
  Object.keys(shift).forEach(function (k) {
    if (seen[k]) return;
    var p = k.split('|'), r = rows[p[1]];
    if (p[0] < t) r.missing++;
    detail.push({ date: p[0], name: r.name, shift: shift[k].join('、'), in: '', out: '', hours: 0, note: p[0] < t ? '未打卡' : '', leave: '' });
  });
  readTable_('請假').forEach(function (x) {
    if (x['狀態'] !== '已核可' || x['開始'] > to || x['結束'] < from) return;
    var r = row(x['Email'], x['姓名']), kind = x['假別'] || '未分類', h = round2_(leaveMinutes_(x, from, to) / 60);
    r.leave[kind] = round2_((r.leave[kind] || 0) + h);
    r.leaveHours += h;
    if (kinds.indexOf(kind) < 0) kinds.push(kind);
    for (var d = x['開始'] > from ? x['開始'] : from, end = x['結束'] < to ? x['結束'] : to; d <= end; d = addDays_(d, 1)) {
      var sp = leaveSpan_(x, d);
      if (sp) detail.push({ date: d, name: x['姓名'], shift: '', in: '', out: '', hours: 0, note: '', leave: kind + ' ' + sp.s + '-' + sp.e + '（' + round2_(netMin_(sp.s, sp.e) / 60) + ' 小時）' });
    }
  });
  var list = Object.keys(rows).map(function (k) { var r = rows[k]; r.schedHours = round2_(r.schedHours); r.workHours = round2_(r.workHours); r.leaveHours = round2_(r.leaveHours); return r; })
    .filter(function (r) { return r.schedDays || r.workDays || r.leaveHours; });
  detail.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : a.name.localeCompare(b.name); });
  return { month: month, kinds: kinds.filter(function (k) { return list.some(function (r) { return r.leave[k]; }); }), rows: list, detail: detail, lunch: getSettings_()['午休時間'] };
}

/* ============================== 公告與討論 ============================== */

function api_listBoard(tk) {
  var me = me_(tk), t = today_();
  var notices = readTable_('公告').filter(function (x) { return me.isAdmin || !x['到期日'] || x['到期日'] >= t; }).map(noticeView_)
    .sort(function (a, b) { return (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || (a.at < b.at ? 1 : -1); });
  var rows = readTable_('討論').map(function (x) { return { id: x['ID'], topic: x['主題ID'], title: x['標題'], body: x['內容'], email: x['Email'], name: x['姓名'], at: x['時間'] }; });
  var topics = rows.filter(function (x) { return !x.topic; }).map(function (x) {
    x.replies = rows.filter(function (y) { return y.topic === x.id; }).sort(function (a, b) { return a.at < b.at ? -1 : 1; });
    x.last = x.replies.length ? x.replies[x.replies.length - 1].at : x.at;
    return x;
  }).sort(function (a, b) { return a.last < b.last ? 1 : -1; });
  return { notices: notices, topics: topics };
}

function noticeView_(x) { return { id: x['ID'], title: x['標題'], body: x['內容'], pinned: x['置頂'] === 'Y', expire: x['到期日'], by: x['發布人'], at: x['時間'], atts: attsOf_(x['附件']) }; }

function api_saveNotice(tk, o) {
  var me = requireAdmin_(tk);
  o = o || {};
  var title = String(o.title || '').trim().slice(0, 100), body = String(o.body || '').slice(0, 5000), expire = String(o.expire || '');
  if (!title) throw new Error('請填寫公告標題');
  if (expire && !/^\d{4}-\d{2}-\d{2}$/.test(expire)) throw new Error('到期日格式錯誤');
  return withLock_(function () {
    var rec = { '標題': title, '內容': body, '置頂': o.pinned ? 'Y' : '', '到期日': expire, '附件': cleanAtts_(o.atts) };
    if (o.id) {
      var r = readTable_('公告').filter(function (x) { return x['ID'] === o.id; })[0];
      if (!r) throw new Error('找不到這則公告');
      updateObj_('公告', r._row, rec);
    } else { rec['ID'] = uid_('N'); rec['發布人'] = me.name; rec['時間'] = now_(); appendObj_('公告', rec); }
    if (o.mail) mail_(people_(), '公告：' + title, '<p><b>' + esc_(title) + '</b></p><p style="white-space:pre-wrap">' + esc_(body) + '</p>');
    return true;
  });
}

function api_deleteNotice(tk, id) {
  requireAdmin_(tk);
  return withLock_(function () {
    var r = readTable_('公告').filter(function (x) { return x['ID'] === id; })[0];
    if (r) deleteRows_('公告', [r._row]);
    return true;
  });
}

/** 發表主題（o.title）或回覆（o.topic） */
function api_postDiscuss(tk, o) {
  var me = me_(tk);
  o = o || {};
  var body = String(o.body || '').trim().slice(0, 3000), title = String(o.title || '').trim().slice(0, 100);
  if (!body) throw new Error('請填寫內容');
  if (!o.topic && !title) throw new Error('請填寫主題');
  return withLock_(function () {
    if (o.topic && !readTable_('討論').some(function (x) { return x['ID'] === o.topic && !x['主題ID']; })) throw new Error('找不到這個主題');
    var id = uid_('D');
    appendObj_('討論', { 'ID': id, '主題ID': o.topic || '', '標題': o.topic ? '' : title, '內容': body, 'Email': me.email, '姓名': me.name, '時間': now_() });
    return id;
  });
}

/** 刪除：本人或主管；刪主題連同回覆一起刪 */
function api_deleteDiscuss(tk, id) {
  var me = me_(tk);
  return withLock_(function () {
    var rows = readTable_('討論'), r = rows.filter(function (x) { return x['ID'] === id; })[0];
    if (!r) return true;
    if (!me.isAdmin && r['Email'] !== me.email) throw new Error('只能刪除自己的留言');
    deleteRows_('討論', rows.filter(function (x) { return x['ID'] === id || x['主題ID'] === id; }).map(function (x) { return x._row; }));
    return true;
  });
}

/* ============================== 首頁摘要 ============================== */

function homeWork_(me) {
  var t = today_(), tasks = readTable_('交辦事項').filter(function (x) { return x['狀態'] === '待處理' || x['狀態'] === '處理中'; });
  var mine = tasks.filter(function (x) { return x['負責人Email'] === me.email; });
  var watch = me.isAdmin ? tasks : mine;
  var low = me.isAdmin ? readTable_('備品耗材').map(stockView_).filter(function (x) { return x.low; }).map(function (x) { return x.name; }) : [];
  var week = addDays_(t, -7);
  var notices = readTable_('公告').filter(function (x) { return (!x['到期日'] || x['到期日'] >= t) && (x['置頂'] === 'Y' || x['時間'].slice(0, 10) >= week); }).map(noticeView_)
    .sort(function (a, b) { return (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || (a.at < b.at ? 1 : -1); }).slice(0, 3);
  return { myTasks: mine.length, overdue: watch.filter(function (x) { return x['期限'] && x['期限'] < t; }).length, openTasks: watch.length, low: low, notices: notices };
}
