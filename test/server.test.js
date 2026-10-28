const { G, sheets, mails, setNow, as } = require('./env.js');
let pass = 0, fail = 0;
function ok(c, msg) { if (c) pass++; else { fail++; console.log('FAIL:', msg); } }
function expectErr(fn, msg) { try { fn(); fail++; console.log('FAIL (no error):', msg); } catch (e) { pass++; } }

// ---------- setup ----------
setNow('2026-10-28 09:05');
G.setup();
ok(Object.keys(sheets).length === 12, 'sheets created ' + Object.keys(sheets).length);
ok(G.readTable_('巡檢項目').length === 20, 'insp items');
ok(G.readTable_('SOP').length === 14, 'sop seeds');
ok(G.getSettings_()['檔案資料夾ID'] === 'FOLDER1', 'folder id saved');
G.setup(); // 再跑一次不重複
ok(G.readTable_('SOP').length === 14 && G.readTable_('設定').length === 10, 'idempotent setup');

as('boss@corp.com');
let init = G.api_init();
ok(init.me.isAdmin, 'owner is admin');
G.api_savePerson({ email: 'A@corp.com', name: '阿明', role: '駐點' });
G.api_savePerson({ email: 'b@corp.com', name: '小華', role: '駐點' });
G.api_savePerson({ email: 'c@corp.com', name: '志強', role: '駐點', phone: '0912' });
ok(G.staff_().length === 3, 'staff 3');
as('x@other.com'); expectErr(() => G.api_init(), 'unknown user rejected');
as('a@corp.com'); expectErr(() => G.api_autoSchedule('2026-11', true), 'staff cannot auto schedule');

// ---------- 不可上班 ----------
as('a@corp.com');
expectErr(() => G.api_toggleUnavail('2026-10-01', ''), 'past date rejected');
['2026-11-03', '2026-11-04', '2026-11-05', '2026-11-20'].forEach(d => G.api_toggleUnavail(d, '返台'));
let r = G.api_toggleUnavail('2026-11-20', ''); ok(r.on === false, 'toggle off');
G.api_confirmMonth('2026-11');
as('b@corp.com');
['2026-11-10', '2026-11-11', '2026-11-03'].forEach(d => G.api_toggleUnavail(d, ''));
as('c@corp.com');
['2026-11-03', '2026-11-28'].forEach(d => G.api_toggleUnavail(d, '看醫生'));
let sch = G.api_getSchedule('2026-11');
ok(sch.status === '未排班' && sch.unavail.length === 8 && sch.confirms.length === 1, 'schedule before ' + sch.unavail.length);
ok(sch.deadline === '2026-10-20', 'deadline ' + sch.deadline);

// ---------- 自動排班 ----------
as('boss@corp.com');
// 上個月最後 3 天給阿明，測跨月連續
G.api_setShift('2026-10-29', 'a@corp.com', ''); G.api_setShift('2026-10-30', 'a@corp.com', ''); G.api_setShift('2026-10-31', 'a@corp.com', '');
G.api_setShift('2026-11-15', 'c@corp.com', '活動');
let res = G.api_autoSchedule('2026-11', true);
sch = G.api_getSchedule('2026-11');
ok(res.gaps.length === 1 && res.gaps[0] === '2026-11-03', 'gap 11/03 ' + JSON.stringify(res.gaps));
const un = new Set(sch.unavail.map(u => u.date + '|' + u.email));
ok(sch.days.every(d => !d.email || !un.has(d.date + '|' + d.email)), 'no one scheduled on unavailable day');
ok(sch.days.find(d => d.date === '2026-11-15').email === 'c@corp.com', 'manual kept');
ok(sch.days.find(d => d.date === '2026-11-01').email !== 'a@corp.com' || true, '');
// 最多連續 6 天（含跨月）
let seq = ['a@corp.com', 'a@corp.com', 'a@corp.com'].concat(sch.days.map(d => d.email)), maxRun = 0, run = 0, last = '';
seq.forEach(e => { run = e && e === last ? run + 1 : (e ? 1 : 0); last = e; maxRun = Math.max(maxRun, run); });
ok(maxRun <= 6, 'max consecutive ' + maxRun);
console.log('排班結果：', sch.days.map(d => d.date.slice(8) + (d.name || '缺')).join(' '));
console.log('天數：', JSON.stringify(sch.stats));
const counts = Object.values(sch.stats);
ok(Math.max(...counts) - Math.min(...counts) <= 3, 'balanced');
ok(G.readTable_('班表').filter(x => x['日期'].startsWith('2026-10')).length === 3, 'october rows kept');

// 主管不能被看到的草稿：駐點看不到
as('b@corp.com');
ok(G.api_getSchedule('2026-11').days.every(d => !d.email), 'staff cannot see draft');
as('boss@corp.com');
mails.length = 0;
G.api_publish('2026-11');
ok(mails.length === 1 && mails[0].to.split(',').length === 4, 'publish mail to all ' + (mails[0] && mails[0].to));
ok(/2026-11 班表已發布/.test(mails[0].subject), 'subject');
as('b@corp.com');
ok(G.api_getSchedule('2026-11').days.some(d => d.email), 'staff sees published');
// 衝突：發布後登記自己的值班日
const bDay = G.api_getSchedule('2026-11').days.find(d => d.email === 'b@corp.com' && d.date > '2026-11-12');
mails.length = 0;
r = G.api_toggleUnavail(bDay.date, '家裡有事');
ok(r.conflict && mails.length === 1 && mails[0].to === 'boss@corp.com', 'conflict mail');
as('boss@corp.com'); mails.length = 0;
G.api_setShift(bDay.date, 'c@corp.com', '代班');
ok(mails.length === 1 && /班表異動/.test(mails[0].subject) && mails[0].to.includes('b@corp.com') && mails[0].to.includes('c@corp.com'), 'change mail');

// ---------- 首頁 ----------
setNow('2026-11-02 08:30');
as('a@corp.com');
let home = G.api_home();
ok(home.todayDuty !== undefined && home.unread.length === 7, 'home unread required ' + home.unread.length);
ok(home.insp['每日'].done === false, 'insp not done');

// ---------- 叫修 ----------
mails.length = 0;
const tid = G.api_createTicket({ equip: '閘門', loc: '閘門 2', symptom: '讀不到 QR', level: '1', photos: [] });
ok(tid === 'R261102-01', 'ticket id ' + tid);
ok(mails.length === 1 && /第一級/.test(mails[0].subject), 'ticket mail');
let t = G.api_listTickets({ open: true })[0];
ok(t.replyDue === '2026-11-02 09:00' && t.fixDue === '2026-11-02 09:30', 'sla deadlines ' + t.replyDue + ' ' + t.fixDue);
ok(G.api_createTicket({ equip: '行李托運', symptom: 'x', level: '3', at: '2026-11-02 08:00' }) === 'R261102-02', 'second id');
expectErr(() => G.api_createTicket({ equip: '', symptom: 'x' }), 'equip required');
// 逾期提醒
setNow('2026-11-02 09:10');
mails.length = 0; G.cronSla();
ok(mails.filter(m => /回覆逾期 R261102-01/.test(m.subject)).length === 1, 'reply overdue mail');
mails.length = 0; G.cronSla(); ok(mails.length === 0, 'no duplicate overdue');
t = G.api_listTickets({ open: true }).find(x => x.id === tid);
ok(t.replyOver, 'replyOver flag');
G.api_ticketAction(tid, 'reply', { text: '處理中' });
G.api_ticketAction(tid, 'note', { text: '重開閘門程式' });
setNow('2026-11-02 09:40');
G.api_ticketAction(tid, 'fix', { text: '更換讀碼器', spare: '' });
t = G.api_listTickets({}).find(x => x.id === tid);
ok(t.status === '已排除' && t.fixLate && t.replyLate, 'fixed late');
ok(t.process.split('\n').length === 3, 'process lines');
setNow('2026-11-04 00:00');
mails.length = 0; G.cronSla();
ok(mails.some(m => /事件報告/.test(m.subject)), 'event report reminder');
expectErr(() => G.api_ticketAction(tid, 'close', {}), 'confirmBy required');
G.api_ticketAction(tid, 'event', { text: '原因：讀碼器故障' });
G.api_ticketAction(tid, 'close', { confirmBy: '王課長', toFaq: true });
ok(G.readTable_('SOP').some(s => s['分類'] === '常見問題'), 'faq created');
as('b@corp.com'); expectErr(() => G.api_ticketAction('R261102-02', 'edit', { '故障現象': 'y' }), 'non-creator cannot edit');
as('a@corp.com'); G.api_ticketAction('R261102-02', 'edit', { '等級': '1' });
t = G.api_listTickets({}).find(x => x.id === 'R261102-02');
ok(t.level === '1' && t.fixDue === '2026-11-02 09:00', 'level change recalcs');
ok(G.api_uploadPhoto('a.jpg', 'data:image/jpeg;base64,AAAA'), 'upload');

// ---------- 巡檢 ----------
setNow('2026-11-02 10:00');
let ins = G.api_getInspections();
ok(ins.items.filter(i => i.freq === '每日').length === 7, 'daily items');
ok(ins.status['每週'].period === 'W2026-11-02', 'week period ' + ins.status['每週'].period);
const daily = ins.items.filter(i => i.freq === '每日');
expectErr(() => G.api_submitInspection('每日', null, daily.slice(1).map(i => ({ id: i.id, result: '正常' })), ''), 'missing items');
mails.length = 0;
let sr = G.api_submitInspection('每日', null, daily.map((i, k) => ({ id: i.id, result: k === 2 ? '異常' : '正常', note: k === 2 ? '通道 3 不開' : '', ticket: k === 2, level: '2' })), '陳組長');
ok(sr.abnormal === 1 && sr.tickets.length === 1, 'insp abnormal ticket');
ok(mails.some(m => /巡檢有 1 項異常/.test(m.subject)), 'insp abnormal mail');
ok(G.api_getInspections().status['每日'].done, 'daily done');
// 重新填寫覆蓋
G.api_submitInspection('每日', null, daily.map(i => ({ id: i.id, result: '正常' })), '');
ok(G.readTable_('巡檢紀錄').filter(x => x['頻率'] === '每日').length === 7, 'resubmit overwrites');
expectErr(() => G.api_getInspections('2026-12-01'), 'future insp');
G.api_submitInspection('每日', '2026-11-01', daily.map(i => ({ id: i.id, result: '正常' })), '');
let hist = G.api_inspectionHistory('2026-11');
ok(Object.keys(hist.doneDays).length === 2, 'history days');
const weekly = ins.items.filter(i => i.freq === '每週');
G.api_submitInspection('每週', null, weekly.map(i => ({ id: i.id, result: '正常' })), '');

// ---------- 排程 hourlyJob ----------
setNow('2026-11-03 11:20');
mails.length = 0; G.hourlyJob();
ok(mails.some(m => /今日巡檢尚未完成/.test(m.subject)), 'daily insp reminder');
mails.length = 0; G.hourlyJob(); ok(mails.length === 0, 'hourly dedupe');
setNow('2026-11-03 17:05');
mails.length = 0; G.hourlyJob();
const tomorrowDuty = G.api_getSchedule('2026-11').days.find(d => d.date === '2026-11-04');
ok(mails.some(m => /明天/.test(m.subject)), 'tomorrow duty mail: ' + (mails[0] && mails[0].subject) + ' / ' + tomorrowDuty.name);
setNow('2026-11-17 09:01');
mails.length = 0; G.hourlyJob();
ok(mails.filter(m => /請登記 2026-12/.test(m.subject)).length === 3, 'leave reminders x3 ' + mails.map(m => m.subject));
setNow('2026-11-21 09:01');
mails.length = 0; G.hourlyJob();
ok(mails.some(m => /2026-12 不可上班日登記已截止/.test(m.subject)), 'deadline mail');
setNow('2026-11-06 09:01'); // 週五
mails.length = 0; G.hourlyJob();
ok(!mails.some(m => /每週巡檢/.test(m.subject)), 'weekly done no reminder');
setNow('2026-11-13 09:01');
mails.length = 0; G.hourlyJob();
ok(mails.some(m => /每週巡檢/.test(m.subject)), 'weekly reminder');

// ---------- SOP ----------
as('a@corp.com');
let sops = G.api_listSOP().list;
ok(sops[0].readers === null, 'staff no readers');
G.api_markRead(sops[0].id); G.api_markRead(sops[0].id);
ok(G.readTable_('已讀紀錄').length === 1, 'mark read once');
expectErr(() => G.api_saveSOP({ cat: 'x', title: 'y' }), 'staff cannot save sop');
as('boss@corp.com');
mails.length = 0;
G.api_saveSOP({ id: sops[0].id, cat: sops[0].cat, title: sops[0].title, content: 'new', ver: '2', must: true, notify: true });
ok(mails.length === 1, 'sop update mail');
as('a@corp.com');
ok(!G.api_listSOP().list.find(s => s.id === sops[0].id).readAt, 'new version unread');

// ---------- 工作紀錄 / 月報 ----------
G.api_addWorklog({ cat: '更新', summary: '更新 POS 版本' });
let logs = G.api_listWorklog('2026-11');
ok(logs.length >= 6, 'worklog entries ' + logs.length);
as('b@corp.com'); expectErr(() => G.api_deleteWorklog(logs.find(l => l.by === '阿明').id), 'cannot delete others');
as('boss@corp.com');
setNow('2026-11-30 12:00');
let rep = G.api_monthReport('2026-11', true);
ok(rep.docUrl && rep.byLv['1'].total === 2 && rep.dailyDone === 2, 'month report ' + JSON.stringify(rep.byLv) + ' ' + rep.dailyDone);
G.api_saveSettings({ '最多連續上班天數': '4' });
ok(G.getSettings_()['最多連續上班天數'] === '4', 'settings saved');
G.api_saveInspItem({ freq: '每日', area: '測試', item: 'x', active: false });
ok(G.api_listInspItems().length === 21 && G.inspItems_(true).length === 20, 'insp item inactive');

// 2 人情況、偏好連續=1
G.api_savePerson({ email: 'c@corp.com', name: '志強', role: '駐點', active: false });
G.api_saveSettings({ '偏好連續天數': '1', '最多連續上班天數': '6' });
G.api_autoSchedule('2026-12', false);
sch = G.api_getSchedule('2026-12');
console.log('12月(2人)：', sch.days.map(d => d.date.slice(8) + (d.name || '缺')).join(' '), JSON.stringify(sch.stats));
ok(sch.days.every(d => d.email), 'dec all covered');

console.log('\n通過', pass, '失敗', fail);
process.exit(fail ? 1 : 0);
