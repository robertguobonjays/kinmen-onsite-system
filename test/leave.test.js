// 多人排班與請假
const { G, setNow, mails, as } = require('./env.js');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL:', m); } };
const err = (f, m, re) => { try { f(); fail++; console.log('FAIL (no error):', m); } catch (e) { if (re && !re.test(e.message)) { fail++; console.log('FAIL:', m, e.message); } else pass++; } };
as(''); setNow('2026-11-02 09:00');
const pw = G.setup().match(/admin ／ (\w+)/)[1];
let TA = G.api_login('admin', pw).token; G.api_changePassword(TA, pw, 'boss1234'); TA = G.api_login('admin', 'boss1234').token;
G.api_savePerson(TA, { email: 'a@c.com', account: 'aming', name: '阿明', role: '駐點', sched: true, active: true, password: 'pass111' });
G.api_savePerson(TA, { email: 'b@c.com', account: 'hua', name: '小華', role: '駐點', sched: true, active: true, password: 'pass222' });
G.api_savePerson(TA, { email: 'c@c.com', account: 'boss', name: '主管', role: '主管', sched: false, active: true, password: 'pass333' });
const login = (a, p) => { let t = G.api_login(a, p).token; G.api_changePassword(t, p, p + 'x'); return G.api_login(a, p + 'x').token; };
const TS = login('aming', 'pass111'), TB = login('hua', 'pass222'), TC = login('boss', 'pass333');
G.api_autoSchedule(TA, '2026-11', true);

// 指派：一天多人、只有主管以上能指派
G.api_setShift(TA, '2026-11-20', ['a@c.com', 'b@c.com'], '大活動');
let day = () => G.api_getSchedule(TA, '2026-11').days.find(d => d.date === '2026-11-20');
ok(day().people.length === 2 && day().name === '阿明、小華' && day().manual, 'two people');
err(() => G.api_setShift(TS, '2026-11-20', ['a@c.com'], ''), 'staff cannot assign', /主管/);
err(() => G.api_setShift(TA, '2026-11-20', ['no@c.com'], ''), 'unknown person', /找不到/);
G.api_autoSchedule(TA, '2026-11', true);
ok(day().people.length === 2, 'auto keeps both manual people');
const st = G.api_getSchedule(TA, '2026-11').stats;
ok(st['a@c.com'] + st['b@c.com'] + (st[Object.keys(st).find(k => !/@c\.com/.test(k))] || 0) === 31, 'stats count each person: ' + JSON.stringify(st));
G.api_publish(TA, '2026-11');
mails.length = 0;
G.api_setShift(TA, '2026-11-12', ['a@c.com', 'c@c.com'], '');
ok(mails.some(m => /班表異動/.test(m.subject) && /阿明/.test(m.html || m.body || JSON.stringify(m))), 'change mail');
ok(/主管/.test(G.api_getSchedule(TS, '2026-11').days.find(d => d.date === '2026-11-12').name), 'non-schedulable person assignable');
setNow('2026-11-12 10:00');
const TA3 = G.api_login('admin', 'boss1234').token;
let h = G.api_home(TA3);
ok(h.todayDuty === '阿明、主管' && h.punch.duties.length === 2, 'home shows both');
mails.length = 0;
setNow('2026-11-12 17:10'); G.hourlyJob();
setNow('2026-11-11 17:10'); G.hourlyJob();
ok(mails.filter(m => /輪您值班/.test(m.subject)).length >= 2, 'tomorrow reminder to both');
setNow('2026-11-02 09:00');

// 請假：駐點申請、規則
err(() => G.api_applyLeave(TS, { start: '2026-11-10', end: '2026-11-10', reason: '' }), 'reason required', /原因/);
err(() => G.api_applyLeave(TS, { start: '2026-11-01', end: '2026-11-01', reason: 'x' }), 'no past', /以前/);
err(() => G.api_applyLeave(TS, { start: '2026-11-12', end: '2026-11-10', reason: 'x' }), 'bad range', /格式/);
err(() => G.api_applyLeave(TS, { start: '2026-11-01', end: '2026-12-31', reason: 'x' }), 'too long');
mails.length = 0;
const sh = G.api_getSchedule(TA, '2026-11').days.filter(d => d.date > '2026-11-10' && d.email === 'a@c.com' && d.people.length === 1)[0].date;
const r1 = G.api_applyLeave(TS, { start: sh, end: sh, reason: '返台看醫生' });
ok(r1.advance >= 7 && mails.length === 1 && /待核可/.test(mails[0].subject), 'apply mails admins');
const soon = G.api_applyLeave(TB, { start: '2026-11-04', end: '2026-11-05', reason: '家裡有事' });
ok(soon.advance === 2, 'short notice still allowed');
err(() => G.api_applyLeave(TS, { start: sh, end: sh, reason: '再一次' }), 'overlap', /已經有/);

// 請假紀錄權限
ok(G.api_listLeave(TS).length === 1 && G.api_listLeave(TS)[0].email === 'a@c.com', 'staff sees own only');
ok(G.api_listLeave(TA).length === 2 && G.api_listLeave(TC).length === 2, 'admin and manager see all');
ok(G.api_getSchedule(TS, '2026-11').leaves.every(l => l.email === 'a@c.com') && G.api_getSchedule(TA, '2026-11').leaves.length === 2, 'calendar leaves scoped');
ok(G.api_home(TA).pendingLeave === 2 && G.api_home(TS).pendingLeave === 0, 'pending count');

// 審核
err(() => G.api_reviewLeave(TS, r1.id, 'approve', ''), 'staff cannot approve', /主管/);
mails.length = 0;
let rv = G.api_reviewLeave(TC, r1.id, 'approve', '');
ok(rv.status === '已核可' && rv.removed[0] === sh && rv.gaps[0] === sh, 'approve removes shift, gap reported');
const sd = G.api_getSchedule(TA, '2026-11').days.find(d => d.date === sh);
ok(!sd.email && !sd.conflict, 'person removed');
ok(mails.some(m => /已核可/.test(m.subject)) && mails.some(m => /缺人/.test(m.subject)), 'mails after approve');
err(() => G.api_reviewLeave(TA, r1.id, 'reject', ''), 'cannot review twice', /已經/);
err(() => G.api_cancelLeave(TS, r1.id), 'staff cannot cancel approved', /主管/);
G.api_autoSchedule(TA, '2026-11', true);
ok(!G.api_getSchedule(TA, '2026-11').days.find(d => d.date === sh).people.some(p => p.email === 'a@c.com'), 'auto avoids approved leave');
G.api_setShift(TA, sh, ['a@c.com'], '');
ok(G.api_getSchedule(TA, '2026-11').days.find(d => d.date === sh).conflict, 'manual assign on leave flagged');
rv = G.api_reviewLeave(TA, soon.id, 'reject', '人手不足');
ok(rv.status === '已駁回' && G.api_listLeave(TB)[0].note === '人手不足', 'reject with note');
const r3 = G.api_applyLeave(TB, { start: '2026-11-25', end: '2026-11-25', reason: 'x' });
err(() => G.api_cancelLeave(TS, r3.id), 'cannot cancel others');
G.api_cancelLeave(TB, r3.id);
ok(G.api_listLeave(TB).find(l => l.id === r3.id).status === '已取消', 'own cancel');

// 出勤簽到表標示請假
setNow('2026-12-05 09:00');
const rep = G.api_attendanceReport(G.api_login('admin', 'boss1234').token, sh, sh, 'a@c.com');
ok(rep.rows[0].note === '請假', 'attendance shows leave: ' + rep.rows[0].note);
ok(G.api_batch(G.api_login('aming', 'pass111x').token, [['api_listLeave', []], ['api_reviewLeave', [r3.id, 'approve', '']]])[1].error, 'batch refuses writes');
console.log('通過', pass, '失敗', fail);
process.exit(fail ? 1 : 0);
