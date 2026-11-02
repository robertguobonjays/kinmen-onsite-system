// 排班到小時、時段登記、假別與代理人、打卡 IP／定位、叫修選單、巡檢設定、交辦、備品、統計、公告討論、暫存與排程
const { G, sheets, setNow, mails, as, cache, props, resetRequest } = require('./env.js');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL:', m); } };
const err = (f, m, re) => { try { f(); fail++; console.log('FAIL (no error):', m); } catch (e) { if (re && !re.test(e.message)) { fail++; console.log('FAIL:', m, e.message); } else pass++; } };
as(''); setNow('2026-11-02 09:00');
const pw = G.setup().match(/admin ／ (\w+)/)[1];
const TA = G.api_login('admin', pw).token; G.api_changePassword(TA, pw, 'boss1234');
G.api_savePerson(TA, { email: 'a@c.com', account: 'aming', name: '阿明', role: '駐點', sched: true, active: true, password: 'pass111' });
G.api_savePerson(TA, { email: 'b@c.com', account: 'hua', name: '小華', role: '駐點', sched: true, active: true, password: 'pass222' });
G.api_savePerson(TA, { email: 'c@c.com', account: 'sis', name: '阿姐', role: '主管', sched: false, active: true, password: 'pass333' });
const TS = G.api_login('aming', 'pass111').token, TB = G.api_login('hua', 'pass222').token, TC = G.api_login('sis', 'pass333').token;
const M = '2026-12', day = (t, d) => G.api_getSchedule(t, M).days.find(x => x.date === d);

// ---------- 大家丟時段，管理員再安排 ----------
ok(G.api_getSchedule(TA, M).status === '未排班' && G.api_getSchedule(TA, M).days.every(d => !d.people.length), 'opening a month no longer auto-plans');
G.api_setAvail(TS, { dates: ['2026-12-01', '2026-12-02'], start: '08:00', end: '12:00', note: '上午' });
G.api_setAvail(TB, { dates: ['2026-12-01'], start: '13:00', end: '17:30' });
G.api_setAvail(TB, { dates: ['2026-12-02'], mode: 'off', note: '返台' });
err(() => G.api_setAvail(TS, { dates: ['2026-12-03'], start: '12:00', end: '08:00' }), 'bad time', /時段/);
err(() => G.api_setAvail(TS, { dates: ['2026-10-01'], start: '08:00', end: '12:00' }), 'past date', /以前/);
let s = G.api_getSchedule(TA, M);
ok(s.avail.length === 3 && s.unavail.length === 1, 'admin sees everyone');
ok(G.api_getSchedule(TS, M).avail.every(a => a.email === 'a@c.com') && G.api_getSchedule(TS, M).avail.length === 2, 'staff sees own avail only');
G.api_setAvail(TS, { dates: ['2026-12-02'], start: '09:00', end: '11:00' });
ok(G.readTable_('可上班').filter(x => x['日期'] === '2026-12-02' && x['Email'] === 'a@c.com').length === 1, 'resubmit replaces');
G.api_setAvail(TB, { dates: ['2026-12-02'], mode: 'clear' });
ok(!G.api_getSchedule(TA, M).unavail.length, 'clear removes off');
G.api_setAvail(TB, { dates: ['2026-12-02'], mode: 'off', note: '返台' });
G.api_confirmMonth(TS, M);
ok(G.readTable_('填寫確認').find(x => x['Email'] === 'a@c.com')['說明'] === '填了 2 天時段', 'confirm note');
// 系統帶入草稿：只排有填時段的人，時段照他填的
G.api_autoSchedule(TA, M, true);
ok(day(TA, '2026-12-02').people.every(p => p.email !== 'b@c.com'), 'off person not used');
const d1 = day(TA, '2026-12-01').people[0];
ok(d1.email === 'a@c.com' ? d1.start === '08:00' && d1.end === '12:00' : d1.start === '13:00', 'auto uses filled hours: ' + JSON.stringify(d1));

// ---------- 指派到小時 ----------
G.api_setShift(TA, '2026-12-05', [{ email: 'a@c.com', start: '08:00', end: '12:00' }, { email: 'b@c.com', start: '13:00', end: '17:30' }], '');
let d5 = day(TA, '2026-12-05');
ok(d5.people.length === 2 && d5.people[0].end === '12:00' && d5.people[1].start === '13:00', 'hourly assign');
ok(d5.label === '阿明 08:00-12:00、小華 13:00-17:30', 'label: ' + d5.label);
err(() => G.api_setShift(TA, '2026-12-05', [{ email: 'a@c.com', start: '13:00', end: '08:00' }], ''), 'bad span', /時段/);
G.api_setShift(TA, '2026-12-06', 'a@c.com', '');
ok(day(TA, '2026-12-06').people[0].start === '08:00' && day(TA, '2026-12-06').label === '阿明', 'string keeps default hours');
const st = G.api_getSchedule(TA, M);
ok(st.hours['a@c.com'] >= 4 + 8.5, 'hours stat minus lunch: ' + st.hours['a@c.com']);
G.api_publish(TA, M);
mails.length = 0;
G.api_setShift(TA, '2026-12-06', [{ email: 'a@c.com', start: '09:00', end: '17:30' }], '');
ok(mails.some(m => /班表異動/.test(m.subject)), 'time change mails');

// ---------- 假別、代理人、到小時 ----------
const ly = { kind: '事假', proxy: 'b@c.com', reason: '辦事' };
err(() => G.api_applyLeave(TS, { ...ly, kind: '亂寫', start: '2026-12-20', end: '2026-12-20' }), 'kind', /假別/);
err(() => G.api_applyLeave(TS, { ...ly, proxy: '', start: '2026-12-20', end: '2026-12-20' }), 'proxy', /代理/);
err(() => G.api_applyLeave(TS, { ...ly, proxy: 'a@c.com', start: '2026-12-20', end: '2026-12-20' }), 'self proxy', /自己/);
err(() => G.api_applyLeave(TS, { ...ly, start: '2026-12-20', startTime: '15:00', end: '2026-12-20', endTime: '09:00' }), 'time order', /時間/);
err(() => G.api_applyLeave(TS, { ...ly, start: '2026-12-20', startTime: '19:00', end: '2026-12-20', endTime: '20:00' }), 'outside work', /不用請假/);
G.api_setShift(TA, '2026-12-10', 'a@c.com', '');
mails.length = 0;
const lv = G.api_applyLeave(TS, { ...ly, start: '2026-12-10', startTime: '08:00', end: '2026-12-10', endTime: '12:00' });
ok(mails.some(m => m.to === 'b@c.com' && /代理/.test(m.subject)), 'proxy told');
let v = G.api_listLeave(TS)[0];
ok(v.kind === '事假' && v.proxy === '小華' && v.hours === 4 && v.startTime === '08:00', 'leave view ' + JSON.stringify(v));
const r2 = G.api_applyLeave(TS, { ...ly, start: '2026-12-10', startTime: '13:00', end: '2026-12-10', endTime: '15:00' });
ok(!!r2.id, 'same day, other hours is allowed');
err(() => G.api_applyLeave(TS, { ...ly, start: '2026-12-10', startTime: '11:00', end: '2026-12-10', endTime: '14:00' }), 'overlap by hour', /已經有/);
G.api_cancelLeave(TS, r2.id);
// 核可：上午給代理人、下午保留
mails.length = 0;
let rv = G.api_reviewLeave(TA, lv.id, 'approve', '');
const d10 = day(TA, '2026-12-10');
const a10 = d10.people.find(p => p.email === 'a@c.com'), b10 = d10.people.find(p => p.email === 'b@c.com');
ok(a10 && a10.start === '12:00' && a10.end === '17:30', 'shift trimmed ' + JSON.stringify(d10.people));
ok(b10 && b10.start === '08:00' && b10.end === '12:00' && !d10.conflict, 'proxy covers ' + JSON.stringify(b10));
ok(!rv.gaps.length && !rv.removed.length, 'partial leave: no gap');
ok(mails.some(m => /代理上班/.test(m.subject) && m.to === 'b@c.com'), 'proxy mail');
// 整天請假：整個班移給代理人
G.api_setShift(TA, '2026-12-11', 'a@c.com', '');
const lv3 = G.api_applyLeave(TS, { ...ly, kind: '病假', start: '2026-12-11', end: '2026-12-11' });
rv = G.api_reviewLeave(TC, lv3.id, 'approve', '');
ok(rv.removed[0] === '2026-12-11' && !rv.gaps.length, 'full day moved');
ok(day(TA, '2026-12-11').people.length === 1 && day(TA, '2026-12-11').people[0].email === 'b@c.com', 'proxy on full day');
// 請假跨多天的時數只算上班時間、扣午休
const lv4 = G.api_applyLeave(TB, { kind: '特休', proxy: 'a@c.com', reason: 'x', start: '2026-12-21', startTime: '13:00', end: '2026-12-22', endTime: '12:00' });
ok(G.api_listLeave(TB).find(l => l.id === lv4.id).hours === 4.5 + 4, 'multi day hours');
G.api_reviewLeave(TA, lv4.id, 'approve', '');

// ---------- 打卡 IP、定位 ----------
setNow('2026-12-10 11:55');
const TS2 = G.api_login('aming', 'pass111').token;
const out = G.doPost({ postData: { contents: JSON.stringify({ fn: 'api_punch', args: [TS2, '上班', 'https://x.test/p.jpg', 'https://x.test/t.jpg', '24.43000,118.32000', '', 12.6], ip: '203.0.113.9' }) } });
ok(JSON.parse(out.text).ok, 'punch via doPost ' + out.text);
let rec = G.api_attendance(TS2, '2026-12-10', '2026-12-10', '').records[0];
ok(rec.ip === '203.0.113.9' && rec.loc === '24.43000,118.32000' && String(rec.acc) === '13', 'ip/loc stored ' + JSON.stringify(rec));
ok(G.api_attendance(TS2, '2026-12-10', '2026-12-10', '').summary[0].inIp === '203.0.113.9', 'summary ip');
ok(!/遲到/.test(G.api_attendance(TS2, '2026-12-10', '2026-12-10', '').summary[0].note), 'lateness follows shift start 12:00');
setNow('2026-12-10 16:00');
const TS3 = G.api_login('aming', 'pass111').token;
G.api_punch(TS3, '下班', 'https://x.test/p2.jpg', '', 'javascript:alert(1)', '');
ok(G.api_attendance(TS3, '2026-12-10', '2026-12-10', '').records[1].loc === '', 'bad location rejected');
ok(/早退/.test(G.api_attendance(TS3, '2026-12-10', '2026-12-10', '').summary[0].note), 'early by shift end');

// ---------- 叫修選單與報修 ----------
setNow('2026-11-03 10:00');
const TAz = G.api_login('admin', 'boss1234').token, TSz = G.api_login('aming', 'pass111').token;
const info = G.api_publicInfo();
ok(info.equip.includes('閘門') && info.units.length && info.causes.length && info.sla['1'].fix === 60, 'public menus');
ok(info.causes.find(c => c.name === '閘門不開或一直開').equip[0] === '閘門', 'cause by equip');
err(() => G.api_saveMenu(TSz, { type: '單位', name: 'x' }), 'staff cannot edit menu', /主管/);
const m1 = G.api_saveMenu(TAz, { type: '單位', name: '第一航廈櫃台', extra: '082-123456' });
ok(m1.menu.units.find(u => u.name === '第一航廈櫃台').phone === '082-123456', 'unit phone');
err(() => G.api_saveMenu(TAz, { type: '單位', name: '第一航廈櫃台' }), 'dup', /已經有/);
const mid = m1.rows.find(r => r.name === '第一航廈櫃台').id;
ok(G.api_publicInfo().units.some(u => u.name === '第一航廈櫃台'), 'public sees new unit');
const pid = G.api_publicReport({ unit: '第一航廈櫃台', phone: '082-123456', equip: '閘門', cause: '閘門不開或一直開', impact: 'all', photos: ['https://abc.public.blob.vercel-storage.com/x.jpg', 'https://evil.test/x.jpg'] });
const pt = G.api_listTickets(TAz, {}).find(t => t.id === pid);
ok(pt.reporter === '第一航廈櫃台' && pt.symptom === '閘門不開或一直開' && pt.cause === '閘門不開或一直開' && pt.level === '1', 'public ticket by picks ' + JSON.stringify(pt));
ok(pt.photos.length === 1 && /blob/.test(pt.photos[0]), 'blob photo kept, others dropped');
ok(pt.fixDue === '2026-11-03 11:00', 'fix due');
err(() => G.api_publicReport({ equip: '閘門', cause: '當機' }), 'needs unit or name', /單位/);
err(() => G.api_publicReport({ unit: '第一航廈櫃台', equip: '閘門' }), 'needs cause', /原因/);
const pOther = G.api_publicReport({ unit: '第一航廈櫃台', equip: '閘門', cause: '其他', symptom: '門有怪聲' });
ok(G.api_listTickets(TAz, {}).find(t => t.id === pOther).symptom === '門有怪聲', 'other cause uses text');
G.api_deleteMenu(TAz, mid);
ok(!G.api_publicInfo().units.some(u => u.name === '第一航廈櫃台'), 'menu delete');

// ---------- 巡檢：設定項目與週期 ----------
let items = G.api_listInspItems(TAz);
const kiosk = items.find(i => i.area.indexOf('自助機台') >= 0);
ok(kiosk.major === '現場設備' && kiosk.item === '功能檢查' && kiosk.checks.length === 5, 'seed migrated ' + JSON.stringify(kiosk));
ok(items.find(i => i.area === '備份').major === '機房與主機', 'major guess');
err(() => G.api_saveInspItem(TAz, { freq: '每兩年', major: 'x', area: 'y', item: 'z' }), 'bad freq', /週期/);
items = G.api_saveInspItem(TAz, { freq: '每10天', major: '現場設備', area: '閘門', item: '機構潤滑', checks: '軌道清潔\n上油', order: 200 });
const cu = items.find(i => i.freq === '每10天');
ok(cu.checks.length === 2, 'checklist lines');
ok(G.api_init(TAz).freqs.includes('每10天'), 'custom freq listed');
G.api_saveInspItem(TAz, { freq: '每年', major: '行政與文件', area: '合約', item: '年度檢視', order: 201 });
let ins = G.api_getInspections(TSz, '2026-11-03');
ok(ins.status['每10天'].items === 1 && /～/.test(ins.status['每10天'].label) && ins.status['每年'].label === '2026 年', 'custom status ' + ins.status['每10天'].label);
let sr = G.api_submitInspection(TSz, '每10天', '2026-11-03', [{ id: cu.id, result: '異常', note: '', level: '1', checks: [{ t: '軌道清潔', ok: true }, { t: '上油', ok: false }] }], '');
ok(sr.tickets.length === 1, 'abnormal auto ticket, no opt-in');
const auto = G.api_listTickets(TAz, {}).find(t => t.id === sr.tickets[0]);
ok(auto.source === '巡檢' && auto.level === '1' && auto.equip === '閘門' && /上油/.test(auto.symptom), 'ticket details ' + JSON.stringify(auto));
ins = G.api_getInspections(TSz, '2026-11-03');
ok(ins.status['每10天'].done && ins.last['每10天'][0].checks[1].ok === false, 'same period, details back');
sr = G.api_submitInspection(TSz, '每10天', '2026-11-03', [{ id: cu.id, result: '異常', note: '還沒修', checks: [{ t: '上油', ok: false }] }], '');
ok(sr.tickets.length === 0, 'resubmit does not duplicate ticket');
ok(G.api_inspectionHistory(TSz, '2026-11').list.some(g => g.rows[0].checks.length && g.rows[0].major === '現場設備'), 'history has details');
ok(G.periodOf_('每10天', '2026-01-11') !== G.periodOf_('每10天', '2026-01-10'), 'period boundary');
items = G.api_deleteInspItem(TAz, cu.id);
ok(!items.some(i => i.id === cu.id), 'item delete');
err(() => G.api_deleteInspItem(TSz, kiosk.id), 'staff cannot delete item', /主管/);

// ---------- 交辦 ----------
mails.length = 0;
err(() => G.api_saveTask(TSz, { title: 'x', from: '蔡總', owner: 'a@c.com' }), 'staff cannot assign', /主管/);
err(() => G.api_saveTask(TAz, { title: '', from: '蔡總', owner: 'a@c.com' }), 'title');
err(() => G.api_saveTask(TAz, { title: 'x', from: '', owner: 'a@c.com' }), 'from');
err(() => G.api_saveTask(TAz, { title: 'x', from: '蔡總', owner: 'no@c.com' }), 'owner');
const tid = G.api_saveTask(TAz, { title: '盤點閘門備料', from: '蔡總', owner: 'a@c.com', due: '2026-11-05', priority: '高', detail: '週五前回報' });
const tid2 = G.api_saveTask(TAz, { title: '整理交接文件', from: '副總', owner: 'b@c.com' });
ok(mails.filter(m => /交辦事項/.test(m.subject)).length === 2 && mails[0].to === 'a@c.com', 'owner mailed');
ok(G.api_listTasks(TSz).length === 1 && G.api_listTasks(TAz).length === 2 && G.api_listTasks(TC).length === 2, 'scope');
err(() => G.api_taskAction(TSz, tid2, 'note', 'x'), 'not owner', /找不到/);
err(() => G.api_taskAction(TSz, tid, 'note', ''), 'need text', /進度/);
G.api_taskAction(TSz, tid, 'note', '已盤點一半');
let task = G.api_listTasks(TSz)[0];
ok(task.status === '處理中' && /已盤點一半/.test(task.log), 'progress');
ok(G.api_home(TSz).work.myTasks === 1, 'home count');
// 逾期提醒一天一次
setNow('2026-11-06 09:01'); mails.length = 0; G.remindTasks_('2026-11-06');
const over = mails.filter(m => /交辦逾期/.test(m.subject));
ok(over.length === 1 && over[0].to.includes('a@c.com') && over[0].to.includes('c@c.com'), 'overdue mail');
mails.length = 0; G.remindTasks_('2026-11-06'); ok(!mails.length, 'once a day');
const TSy = G.api_login('aming', 'pass111').token, TAy = G.api_login('admin', 'boss1234').token;
ok(G.api_listTasks(TSy)[0].overdue && G.api_home(TAy).work.overdue === 1, 'overdue flag');
err(() => G.api_taskAction(TSy, tid, 'cancel', ''), 'staff cannot cancel', /主管/);
mails.length = 0;
G.api_taskAction(TSy, tid, 'done', '完成');
ok(mails.some(m => /交辦完成/.test(m.subject)) && G.api_listTasks(TSy)[0].status === '已完成' && !G.api_listTasks(TSy)[0].overdue, 'done');
G.api_taskAction(TAy, tid, 'reopen', ''); ok(G.api_listTasks(TSy)[0].status === '處理中', 'reopen');
G.api_taskAction(TAy, tid2, 'delete', ''); ok(G.api_listTasks(TAy).length === 1, 'delete');

// ---------- 備品 ----------
err(() => G.api_saveStock(TSy, { type: '備品', name: 'x' }), 'staff cannot add', /主管/);
const sk = G.api_saveStock(TAy, { type: '耗材', name: '感熱紙', unit: '卷', safe: 3, qty: 5, place: '機房櫃 A' });
let stock = G.api_listStock(TSy);
ok(stock.items[0].qty === 5 && stock.moves[0].type === '入庫', 'first stock logged');
err(() => G.api_stockMove(TSy, { id: sk, type: '領用', qty: 99 }), 'not enough', /只剩/);
err(() => G.api_stockMove(TSy, { id: sk, type: '領用', qty: 0 }), 'zero qty', /數量/);
err(() => G.api_stockMove(TSy, { id: sk, type: '盤點', qty: 3 }), 'staff no count', /主管/);
mails.length = 0;
G.api_stockMove(TSy, { id: sk, type: '領用', qty: 2, note: '櫃台換紙' });
stock = G.api_listStock(TSy);
ok(stock.items[0].qty === 3 && stock.items[0].low, 'low flag');
ok(mails.some(m => /庫存偏低/.test(m.subject)), 'low mail');
mails.length = 0; G.api_stockMove(TSy, { id: sk, type: '領用', qty: 1 }); ok(!mails.some(m => /庫存偏低/.test(m.subject)), 'only when crossing');
ok(G.api_home(TAy).work.low[0] === '感熱紙' && !G.api_home(TSy).work.low.length, 'home low admin only');
G.api_stockMove(TSy, { id: sk, type: '入庫', qty: 10 });
G.api_stockMove(TAy, { id: sk, type: '盤點', qty: 7 });
ok(G.api_listStock(TSy).items[0].qty === 7 && G.api_listStock(TSy).moves[0].type === '盤點', 'count');
// 叫修排除時扣庫存
const tick = G.api_createTicket(TSy, { equip: '閘門', cause: '當機', level: '2' });
G.api_ticketAction(TSy, tick, 'fix', { text: '換紙', parts: [{ id: sk, qty: 2 }], spare: '' });
ok(G.api_listStock(TSy).items[0].qty === 5 && /感熱紙 x 2/.test(G.api_listTickets(TSy, {}).find(t => t.id === tick).spare), 'parts deducted');
ok(G.api_listStock(TSy).moves[0].ref === tick, 'move linked to ticket');
const before = G.api_listStock(TSy).items[0].qty, t2 = G.api_createTicket(TSy, { equip: '閘門', cause: '當機', level: '2' });
err(() => G.api_ticketAction(TSy, t2, 'fix', { parts: [{ id: sk, qty: 999 }] }), 'too many parts blocks fix', /只剩/);
ok(G.api_listStock(TSy).items[0].qty === before && G.api_listTickets(TSy, {}).find(t => t.id === t2).status !== '已排除', 'nothing changed on failure');

// ---------- 每月工時與請假統計 ----------
setNow('2027-01-05 09:00');
const TCx = G.api_login('sis', 'pass333').token, TSx = G.api_login('aming', 'pass111').token;
err(() => G.api_monthStats(TSx, M), 'staff cannot see stats', /主管/);
const stat = G.api_monthStats(TCx, M), ra = stat.rows.find(r => r.name === '阿明'), rb = stat.rows.find(r => r.name === '小華');
ok(ra.workHours === 3.08, 'work hours: ' + ra.workHours);
ok(ra.workDays === 1, 'work days ' + ra.workDays);
ok(ra.leave['事假'] === 4 && ra.leave['病假'] === 8.5 && ra.leaveHours === 12.5, 'leave by kind ' + JSON.stringify(ra.leave));
ok(rb.leave['特休'] === 8.5 && stat.kinds.includes('事假'), 'other person leave');
ok(ra.schedDays >= 3 && ra.schedHours > 0 && ra.missing > 0, 'sched and missing ' + JSON.stringify(ra));
ok(stat.detail.some(d => d.date === '2026-12-10' && d.in === '11:55') && stat.detail.some(d => /病假/.test(d.leave)), 'detail rows');
ok(G.netMin_('12:05', '16:00') === 180 && G.netMin_('08:00', '12:00') === 240 && G.netMin_('08:00', '17:30') === 510, 'lunch only cut when overlapping');

// ---------- 公告與討論 ----------
mails.length = 0;
const TAw = G.api_login('admin', 'boss1234').token;
err(() => G.api_saveNotice(TSx, { title: 'x' }), 'staff cannot post notice', /主管/);
G.api_saveNotice(TAw, { title: '歲修公告', body: '1/10 停機', pinned: true, mail: true });
ok(mails.some(m => /公告：歲修公告/.test(m.subject)), 'notice mail');
G.api_saveNotice(TAw, { title: '舊公告', body: 'x', expire: '2026-01-01' });
let bd = G.api_listBoard(TSx);
ok(bd.notices.length === 1 && bd.notices[0].pinned, 'expired hidden for staff');
ok(G.api_listBoard(TAw).notices.length === 2, 'admin sees expired');
ok(G.api_home(TSx).work.notices[0].title === '歲修公告', 'home notice');
err(() => G.api_postDiscuss(TSx, { title: '', body: 'x' }), 'topic title');
const top = G.api_postDiscuss(TSx, { title: '閘門換班交接', body: '請問鑰匙放哪？' });
const TBx = G.api_login('hua', 'pass222').token;
const rep = G.api_postDiscuss(TBx, { topic: top, body: '櫃子第二層' });
err(() => G.api_postDiscuss(TBx, { topic: 'nope', body: 'x' }), 'bad topic', /找不到/);
bd = G.api_listBoard(TBx);
ok(bd.topics[0].replies[0].body === '櫃子第二層', 'reply');
err(() => G.api_deleteDiscuss(TBx, top), 'cannot delete others', /自己/);
G.api_deleteDiscuss(TSx, top);
ok(!G.api_listBoard(TBx).topics.length && !G.readTable_('討論').some(x => x['ID'] === rep), 'topic delete cascades');

// ---------- 暫存：第二次請求不讀試算表，寫入後讀得到新資料 ----------
resetRequest();
G.readTable_('設定'); resetRequest();
const realSh = sheets['設定'].getDataRange; let reads = 0;
sheets['設定'].getDataRange = function () { reads++; return realSh.call(this); };
G.getSettings_();
ok(reads === 0, 'settings served from cache');
G.setSetting_('午休時間', '12:00～12:30');
resetRequest();
ok(G.getSettings_()['午休時間'] === '12:00～12:30' && reads === 1, 'write invalidates, reads ' + reads);
sheets['設定'].getDataRange = realSh;
G.setSetting_('午休時間', '12:00～13:00');
// 舊版讀到一半才存進暫存：放在舊版本號底下，新請求不會拿到
const oldGen = cache['g_設定'];
cache['t_設定_' + oldGen + 'x'] = '[]';
resetRequest();
ok(G.getSettings_()['午休時間'] === '12:00～13:00', 'stale key ignored');

// ---------- 排程：不再有每分鐘空跑 ----------
const made = [];
G.ScriptApp.newTrigger = n => { made.push(n); const c = { timeBased: () => c, everyMinutes: () => c, everyHours: () => c, create: () => c }; return c; };
props['schema'] = '舊版';
G.doPost({ postData: { contents: JSON.stringify({ fn: 'api_publicInfo', args: [] }) } });
ok(made.join() === 'cronSla,hourlyJob', 'triggers upgraded: ' + made);
ok(props['schema'] === G.SCHEMA_VER, 'schema stored');
made.length = 0;
G.doPost({ postData: { contents: JSON.stringify({ fn: 'api_publicInfo', args: [] }) } });
ok(!made.length, 'no reinstall when up to date');
G.flushQueue();

console.log('通過', pass, '失敗', fail);
process.exit(fail ? 1 : 0);
