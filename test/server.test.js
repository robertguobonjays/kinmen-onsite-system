// 後端流程測試（模擬 Apps Script 環境）
const { G, sheets, mails, folders, setNow, as } = require('./env.js');
let pass = 0, fail = 0;
function ok(c, msg) { if (c) pass++; else { fail++; console.log('FAIL:', msg); } }
function expectErr(fn, msg, re) {
  try { fn(); fail++; console.log('FAIL (no error):', msg); }
  catch (e) { if (re && !re.test(e.message)) { fail++; console.log('FAIL (wrong error):', msg, e.message); } else pass++; }
}

// ---------- setup ----------
setNow('2026-10-28 09:05');
const msg = G.setup();
ok(Object.keys(sheets).length === 15, 'sheets created');
ok(G.readTable_('巡檢項目').length === 20 && G.readTable_('SOP').length === 14, 'seeds');
ok(/02-7733-5686/.test(G.readTable_('SOP')[1]['內容']), 'hotline in SOP');
const adminPw = (msg.match(/admin ／ (\w+)/) || [])[1];
ok(!!adminPw, 'temp password shown');
ok(folders['1GJbVi85Fbp3KOe6Z4_3wP3bBjgogN2T1'] && folders['1GJbVi85Fbp3KOe6Z4_3wP3bBjgogN2T1'].subs['SOP文件'], 'subfolders in shared folder');
G.setup(); // 再跑一次不重複、不重設密碼
ok(G.readTable_('SOP').length === 14 && G.readTable_('人員').length === 1, 'idempotent setup');
ok(G.readTable_('設定').length === 13, 'settings count ' + G.readTable_('設定').length);

// ---------- 登入 ----------
expectErr(() => G.api_init('x'), 'no token', /NEED_LOGIN/);
expectErr(() => G.api_login('admin', 'wrong'), 'bad pw', /錯誤/);
let r = G.api_login('ADMIN', adminPw);
ok(r.token && r.mustChange, 'admin login, must change');
const TA = r.token;
let init = G.api_init(TA);
ok(init.me.isOwner && init.me.isAdmin && init.me.sched, 'admin flags');
G.api_changePassword(TA, adminPw, 'boss1234');
ok(!G.api_init(TA).me.mustChange, 'mustChange cleared');
expectErr(() => G.api_changePassword(TA, 'nope', 'abcdef'), 'old pw wrong');
// 鎖定
for (let i = 0; i < 5; i++) { try { G.api_login('admin', 'x'); } catch (e) { } }
expectErr(() => G.api_login('admin', 'boss1234'), 'locked after 5 fails', /10 分鐘/);
require('./env.js').cache['fail_admin'] = '0';
ok(G.api_login('admin', 'boss1234').token, 'unlock');
// Google 帳號登入（網域部署時）
as('boss@corp.com'); ok(G.api_googleLogin() && G.api_googleLogin().token, 'google login for owner email');
as(''); ok(G.api_googleLogin() === null, 'anonymous google login null');

// ---------- 帳號管理 ----------
mails.length = 0;
G.api_savePerson(TA, { email: 'A@corp.com', account: 'aming', name: '阿明', role: '駐點', sched: true, password: 'pass111', sendMail: true });
ok(mails.length === 1 && /帳號已建立/.test(mails[0].subject), 'account mail');
G.api_savePerson(TA, { email: 'b@gmail.com', account: 'hua', name: '小華', role: '駐點', sched: true, password: 'pass222' });
G.api_savePerson(TA, { email: 'c@corp.com', account: 'chiang', name: '志強', role: '主管', sched: false, password: 'pass333' });
expectErr(() => G.api_savePerson(TA, { email: 'd@corp.com', account: 'aming', name: 'x', role: '駐點', password: 'pass444' }), 'dup account', /已被使用/);
expectErr(() => G.api_savePerson(TA, { email: 'e@corp.com', account: 'Bad Name', name: 'x', role: '駐點', password: 'pass444' }), 'bad account');
expectErr(() => G.api_savePerson(TA, { email: 'e@corp.com', account: 'eee', name: 'x', role: '駐點' }), 'new needs pw');
expectErr(() => G.api_savePerson(TA, { origEmail: 'boss@corp.com', email: 'boss@corp.com', account: 'admin', name: '管理員', role: '駐點' }), 'keep one owner', /管理員/);
const TS = G.api_login('aming', 'pass111').token, TB = G.api_login('b@gmail.com', 'pass222').token, TC = G.api_login('chiang', 'pass333').token;
expectErr(() => G.api_savePerson(TC, { email: 'z@corp.com', account: 'zz', name: 'z', role: '駐點', password: 'pass999' }), 'manager cannot manage accounts', /管理員/);
expectErr(() => G.api_autoSchedule(TS, '2026-11', true), 'staff cannot schedule');
ok(G.api_init(TC).me.isAdmin && !G.api_init(TC).me.isOwner, 'manager role');
ok(G.staff_().map(p => p.name).join() === '管理員,阿明,小華', 'schedulable incl. admin: ' + G.staff_().map(p => p.name));
// 改名、改 Email 同步
G.api_toggleUnavail(TB, '2026-11-12', '');
G.api_savePerson(TA, { origEmail: 'b@gmail.com', email: 'hua@gmail.com', account: 'hua', name: '小華', role: '駐點', sched: true });
ok(G.readTable_('不可上班').some(x => x['Email'] === 'hua@gmail.com'), 'email migrated');
const TB2 = G.api_login('hua', 'pass222').token;
G.api_toggleUnavail(TB2, '2026-11-12', ''); // 取消
// 停用的人不能登入
G.api_savePerson(TA, { email: 'x@corp.com', account: 'xman', name: 'X', role: '駐點', sched: true, password: 'pass000' });
const TX = G.api_login('xman', 'pass000').token;
G.api_savePerson(TA, { origEmail: 'x@corp.com', email: 'x@corp.com', account: 'xman', name: 'X', role: '駐點', sched: true, active: false });
expectErr(() => G.api_init(TX), 'disabled session invalid', /NEED_LOGIN/);
expectErr(() => G.api_login('xman', 'pass000'), 'disabled cannot login');
G.api_deletePerson(TA, 'x@corp.com');
expectErr(() => G.api_deletePerson(TA, 'boss@corp.com'), 'cannot delete self');
G.api_logout(TC); expectErr(() => G.api_init(TC), 'logout', /NEED_LOGIN/);

// ---------- 登記期間與提醒 ----------
let sch = G.api_getSchedule(TS, '2026-11');
ok(sch.window.start === '2026-10-15' && sch.window.end === '2026-10-20', 'default window ' + JSON.stringify(sch.window));
mails.length = 0;
G.api_setWindow(TA, '2026-11', '2026-10-27', '2026-10-30');
ok(mails.length === 1 && /開放登記/.test(mails[0].subject) && mails[0].to.split(',').length === 3, 'window open mail ' + (mails[0] && mails[0].to));
expectErr(() => G.api_setWindow(TA, '2026-11', '2026-10-30', '2026-10-27'), 'bad window');
G.api_toggleUnavail(TS, '2026-11-03', '返台'); G.api_toggleUnavail(TS, '2026-11-04', '返台');
G.api_toggleUnavail(TB2, '2026-11-03', ''); G.api_toggleUnavail(TB2, '2026-11-10', '');
G.api_confirmMonth(TS, '2026-11');
setNow('2026-10-29 09:01');
mails.length = 0; G.hourlyJob();
let rem = mails.filter(m => /請登記 2026-11/.test(m.subject));
ok(rem.length === 2 && !rem.some(m => m.to === 'a@corp.com'), 'daily reminders to unconfirmed only: ' + rem.map(m => m.to));
ok(/剩 1 天/.test(rem[0].subject), 'days left in subject ' + rem[0].subject);
G.api_confirmMonth(TB2, '2026-11');
setNow('2026-10-30 09:01');
mails.length = 0; G.hourlyJob();
rem = mails.filter(m => /請登記 2026-11/.test(m.subject));
ok(rem.length === 1 && rem[0].to === 'boss@corp.com' && /最後一天/.test(rem[0].subject), 'only admin left, last day');
ok(G.readTable_('填寫確認').find(x => x['Email'] === 'hua@gmail.com')['說明'] === '不能上班 2 天', 'confirm note');

// ---------- 截止隔天：系統預排並通知 ----------
setNow('2026-10-31 09:01');
mails.length = 0; G.hourlyJob();
const pre = mails.filter(m => /已由系統預排/.test(m.subject));
ok(pre.length === 1 && /未登記（視為都可以）：管理員/.test(pre[0].htmlBody), 'preschedule mail');
ok(/缺人：11\/3/.test(pre[0].htmlBody) === false, 'admin is available on 11/3 so no gap');
mails.length = 0; G.hourlyJob(); ok(mails.length === 0, 'once per hour');
setNow('2026-11-01 09:01'); mails.length = 0; G.hourlyJob();
ok(!mails.some(m => /2026-11 班表已由系統預排/.test(m.subject)), 'preschedule mail only once');
sch = G.api_getSchedule(TA, '2026-11');
ok(sch.status === '草稿' && sch.auto === '' && sch.days.every(d => d.email), 'draft visible to admin');
ok(sch.days.find(d => d.date === '2026-11-03').name === '管理員', '11/03 only admin available');
ok(!sch.days.some(d => d.conflict), 'no conflicts');
ok(G.api_getSchedule(TS, '2026-11').days.every(d => !d.email), 'staff cannot see draft');

// 草稿期間有人改登記 → 主管打開時自動重排（保留手動）
setNow('2026-11-01 10:00');
G.api_setShift(TA, '2026-11-20', 'a@corp.com', '指定');
const hua15 = sch.days.find(d => d.email === 'hua@gmail.com' && d.date > '2026-11-05' && d.date !== '2026-11-20');
setNow('2026-11-01 10:01');
G.api_toggleUnavail(TB2, hua15.date, '臨時有事');
setNow('2026-11-01 10:02');
sch = G.api_getSchedule(TA, '2026-11');
ok(sch.auto === 'redo', 'auto redo');
ok(sch.days.find(d => d.date === hua15.date).email !== 'hua@gmail.com', 'reassigned after new unavail');
ok(sch.days.find(d => d.date === '2026-11-20').email === 'a@corp.com', 'manual kept on redo');
ok(G.api_getSchedule(TA, '2026-11').auto === '', 'no redo when unchanged');
let seq = sch.days.map(d => d.email), maxRun = 0, run = 0, last = '';
seq.forEach(e => { run = e && e === last ? run + 1 : 1; last = e; maxRun = Math.max(maxRun, run); });
ok(maxRun <= 6, 'max run ' + maxRun);
console.log('11月預排：', sch.days.map(d => d.date.slice(8) + d.name).join(' '));
// 未排班月份主管一打開就預排
sch = G.api_getSchedule(TA, '2026-12');
ok(sch.auto === 'new' && sch.status === '草稿' && sch.days.every(d => d.email), 'open unscheduled month auto plans');
// 手動指定衝突顯示
G.api_setShift(TA, '2026-11-04', 'a@corp.com', '');
ok(G.api_getSchedule(TA, '2026-11').days.find(d => d.date === '2026-11-04').conflict, 'conflict flagged');
G.api_setShift(TA, '2026-11-04', 'hua@gmail.com', '');
// 主管自己登記
G.api_toggleUnavail(TA, '2026-11-25', '開會');
mails.length = 0;
G.api_publish(TA, '2026-11');
ok(mails.length === 1 && mails[0].to.split(',').length === 4, 'publish to all');
ok(G.api_getSchedule(TS, '2026-11').days.some(d => d.email), 'staff sees published');
// 發布後衝突
const aDay = G.api_getSchedule(TS, '2026-11').days.find(d => d.email === 'a@corp.com' && d.date > '2026-11-05');
mails.length = 0;
r = G.api_toggleUnavail(TS, aDay.date, '家裡有事');
ok(r.conflict && mails.length === 1 && mails[0].to.split(',').length === 2, 'conflict mail to admins');
expectErr(() => G.api_toggleUnavail(TS, '2026-11-26', '', 'hua@gmail.com'), 'staff cannot register for others');

// ---------- 首頁 ----------
setNow('2026-11-02 08:30');
let home = G.api_home(TA);
ok(home.plan && home.plan.month === '2026-12' && home.plan.status === '草稿', 'admin plan card');
home = G.api_home(TS);
ok(home.plan === null && home.unread.length === 7, 'staff home');

// ---------- 叫修 ----------
mails.length = 0;
const tid = G.api_createTicket(TS, { equip: '閘門', loc: '閘門 2', symptom: '讀不到 QR', level: '1', photos: [] });
ok(tid === 'R261102-01' && mails.length === 1 && /第一級/.test(mails[0].subject), 'ticket');
setNow('2026-11-02 09:10');
mails.length = 0; G.cronSla();
ok(mails.some(m => /回覆逾期 R261102-01/.test(m.subject)), 'reply overdue mail');
G.api_ticketAction(TS, tid, 'reply', { text: '處理中' });
setNow('2026-11-02 09:40');
G.api_ticketAction(TS, tid, 'fix', { text: '更換讀碼器' });
G.api_ticketAction(TS, tid, 'close', { confirmBy: '王課長', toFaq: true });
ok(G.readTable_('SOP').some(s => s['分類'] === '常見問題'), 'faq');
const photo = G.api_uploadPhoto(TS, 'a.jpg', 'data:image/jpeg;base64,AAAA');
ok(/^FILE/.test(photo), 'upload photo');
expectErr(() => G.api_uploadPhoto(TS, 'a.html', 'data:text/html;base64,AAAA'), 'only images');

// ---------- 機關免登入報修 ----------
ok(G.api_publicInfo().hotline.indexOf('02-7733-5686') === 0, 'public info');
mails.length = 0;
const pid = G.api_publicReport({ reporter: '陳小姐', unit: '浯江售票組', phone: '0912', equip: '自助機台', loc: '3 號', symptom: '不出票', impact: 'all', photos: [photo] });
ok(/^R261102-0\d$/.test(pid), 'public ticket id ' + pid);
let pt = G.api_listTickets(TA, {}).find(t => t.id === pid);
ok(pt.source === '報修頁' && pt.level === '1' && pt.reporter === '陳小姐' && pt.photos.length === 1, 'public ticket fields');
ok(mails.length === 1 && /機關報修/.test(mails[0].subject), 'public mail');
expectErr(() => G.api_publicReport({ reporter: '', symptom: 'x' }), 'public needs name');
ok(G.api_publicReport({ reporter: 'bot', symptom: 'x', website: 'http://spam' }) === 'OK', 'honeypot');
for (let i = 0; i < 25; i++) { try { G.api_publicReport({ reporter: 'x', symptom: 'y' }); } catch (e) { } }
expectErr(() => G.api_publicReport({ reporter: 'x', symptom: 'y' }), 'rate limit', /頻繁/);
expectErr(() => G.api_publicUpload('x', 'data:image/png;base64,' + 'A'.repeat(4000001)), 'upload size');

// ---------- 巡檢 ----------
setNow('2026-11-02 10:00');
let ins = G.api_getInspections(TS);
const daily = ins.items.filter(i => i.freq === '每日');
let sr = G.api_submitInspection(TS, '每日', null, daily.map((i, k) => ({ id: i.id, result: k === 2 ? '異常' : '正常', note: k === 2 ? '通道 3 不開' : '', ticket: k === 2 })), '');
ok(sr.abnormal === 1 && sr.tickets.length === 1, 'insp abnormal ticket');
ok(G.api_listTickets(TA, {}).find(t => t.id === sr.tickets[0]).source === '巡檢', 'insp ticket source');

// ---------- SOP 附件 ----------
const url = G.api_uploadFile(TA, '手冊.pdf', 'data:application/pdf;base64,AAAA');
ok(/drive\.google\.com/.test(url), 'sop upload url');
expectErr(() => G.api_uploadFile(TS, 'x.pdf', 'data:application/pdf;base64,AAAA'), 'staff cannot upload sop');
const ATT = [{ name: '手冊.pdf', url: 'https://abc.public.blob.vercel-storage.com/文件附件/a.pdf', size: 100 }, { name: '壞.pdf', url: 'https://evil.example.com/a.pdf' }];
const sid = G.api_saveSOP(TA, { cat: '測試', title: '附件文件', ver: '1', atts: ATT });
const sa = G.api_listSOP(TS).list.find(s => s.id === sid);
ok(sa.atts.length === 1 && sa.atts[0].name === '手冊.pdf', 'sop atts for staff, bad url dropped');
expectErr(() => G.api_saveSOP(TS, { id: sid, cat: '測試', title: '改', atts: [] }), 'staff cannot edit sop');
expectErr(() => G.api_deleteSOP(TS, sid), 'staff cannot delete sop');
const it0 = G.api_listInspItems(TA)[0];
G.api_saveInspItem(TA, Object.assign({}, it0, { atts: ATT }));
ok(G.api_getInspections(TS).items.find(x => x.id === it0.id).atts.length === 1, 'insp item atts for staff');
expectErr(() => G.api_saveInspItem(TS, Object.assign({}, it0, { atts: [] })), 'staff cannot edit insp item');
expectErr(() => G.api_listInspItems(TS), 'staff cannot list insp editor');
G.api_saveInspItem(TA, Object.assign({}, it0, { atts: [] }));
G.api_deleteSOP(TA, sid);
// 舊試算表沒有「附件」欄：讀得到、存檔時自動補欄
G.ensureCol_('SOP', '附件');
const sops = G.api_listSOP(TS).list;
G.api_markRead(TS, sops[0].id);
ok(G.api_listSOP(TS).list[0].readAt, 'read');

// ---------- 月報 ----------
setNow('2026-11-30 12:00');
const TA2 = G.api_login('admin', 'boss1234').token;
const rep = G.api_monthReport(TA2, '2026-11', true);
ok(rep.docUrl && rep.byLv['1'].total >= 2, 'month report');

// ---------- 升級：V1 舊資料 ----------
const s = sheets['人員'];
s.data[0] = s.data[0].slice(0, 5); // 模擬只有 V1 欄位
s.data = [s.data[0], ['old@corp.com', '', '舊人員', '駐點', '', 'Y']];
G.HEAD_ = {};
const m2 = G.setup();
ok(/old ／ \w+（舊人員）/.test(m2), 'migration temp pw: ' + m2.split('\n')[3]);
ok(G.readTable_('人員')[0]['帳號'] === 'old', 'migrated account');

// 過期 session 清除
setNow('2027-01-01 09:00');
expectErr(() => G.api_init(TA), 'session expired', /NEED_LOGIN/);

console.log('\n通過', pass, '失敗', fail);
process.exit(fail ? 1 : 0);
