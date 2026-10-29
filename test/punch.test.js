// 打卡與出勤簽到表測試
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const { G, mails, setNow, as } = require('./env.js');
const { buildAttendanceDocx, imageSize } = require('../lib/docx');
const JSZip = require('jszip');

let pass = 0, fail = 0;
function ok(c, m) { if (c) pass++; else { fail++; console.log('FAIL:', m); } }
function expectErr(fn, m, re) { try { fn(); fail++; console.log('FAIL (no error):', m); } catch (e) { if (re && !re.test(e.message)) { fail++; console.log('FAIL (wrong):', m, e.message); } else pass++; } }

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAIAAAA2iEnWAAAAEklEQVR42mP4z8DAwMDAwMAAAB0AAf8m4f5WAAAAAElFTkSuQmCC', 'base64');
const BLOB = 'https://abc.public.blob.vercel-storage.com/打卡照片/';

(async () => {
  setNow('2026-10-01 07:50'); as('');
  const pw = G.setup().match(/admin ／ (\w+)/)[1];
  const TA = G.api_login('admin', pw).token;
  G.api_changePassword(TA, pw, 'boss1234');
  G.api_savePerson(TA, { email: 'a@corp.com', account: 'aming', name: '洪雅玟', role: '駐點', sched: true, password: 'pass111' });
  G.api_savePerson(TA, { email: 'b@corp.com', account: 'hua', name: '小華', role: '駐點', sched: true, password: 'pass222' });
  G.api_savePerson(TA, { origEmail: G.people_(true)[0].email, email: G.people_(true)[0].email, account: 'admin', name: '管理員', role: '管理員', sched: false });
  const TS = G.api_login('aming', 'pass111').token, TB = G.api_login('hua', 'pass222').token;
  G.api_autoSchedule(TA, '2026-10', false);
  // 10/1、10/2 指定洪雅玟，10/3 小華
  G.api_setShift(TA, '2026-10-01', 'a@corp.com', ''); G.api_setShift(TA, '2026-10-02', 'a@corp.com', ''); G.api_setShift(TA, '2026-10-03', 'b@corp.com', '');
  G.api_publish(TA, '2026-10');

  // ---- 打卡 ----
  expectErr(() => G.api_punch(TS, '上班', ''), 'photo required', /照片/);
  expectErr(() => G.api_punch(TS, '午休', BLOB + 'a.jpg'), 'type check');
  let r = G.api_punch(TS, '上班', BLOB + 'in1.jpg', BLOB + 'in1_t.jpg', '24.4,118.3', '');
  ok(r.time === '07:50' && r.today.in === '07:50' && r.today.note === '未打上班卡'.replace('未打上班卡', '') + '' || r.today.note === '', 'punch in ' + JSON.stringify(r.today));
  setNow('2026-10-01 17:35'); G.api_punch(TS, '下班', BLOB + 'out1.jpg', BLOB + 'out1_t.jpg', '', '');
  setNow('2026-10-01 17:40'); G.api_punch(TS, '下班', BLOB + 'out1b.jpg', '', '', ''); // 最晚的下班為準
  let home = G.api_home(TS);
  ok(home.punch.mine.in === '07:50' && home.punch.mine.out === '17:40' && home.punch.mine.note === '', 'home punch summary ' + JSON.stringify(home.punch.mine));
  ok(G.api_home(TA).punch.duty.name === '洪雅玟', 'admin sees duty punch');
  setNow('2026-10-02 08:12'); G.api_punch(TS, '上班', BLOB + 'in2.jpg', BLOB + 'in2_t.jpg', '', '船班延誤');
  setNow('2026-10-02 17:00'); G.api_punch(TS, '下班', BLOB + 'out2.jpg', BLOB + 'out2_t.jpg', '', '');
  let s2 = G.api_attendance(TS, '2026-10-02', '2026-10-02', '').summary[0];
  ok(/遲到/.test(s2.note) && /早退/.test(s2.note) && /船班延誤/.test(s2.note), 'late/early/note ' + s2.note);
  // 10/3 小華忘記打下班 → 主管補登
  setNow('2026-10-03 07:58'); G.api_punch(TB, '上班', BLOB + 'in3.jpg', BLOB + 'in3_t.jpg', '', '');
  setNow('2026-10-04 09:00');
  expectErr(() => G.api_punchFix(TB, { email: 'b@corp.com', date: '2026-10-03', time: '17:31', type: '下班', note: 'x' }), 'staff cannot fix');
  expectErr(() => G.api_punchFix(TA, { email: 'b@corp.com', date: '2026-10-03', time: '17:31', type: '下班' }), 'fix needs reason', /原因/);
  G.api_punchFix(TA, { email: 'b@corp.com', date: '2026-10-03', time: '17:31', type: '下班', note: '忘記打卡' });
  ok(G.api_attendance(TA, '2026-10-03', '2026-10-03', 'b@corp.com').summary[0].note === '補登下班：忘記打卡', 'fix note');
  // 駐點只看得到自己
  ok(G.api_attendance(TS, '2026-10-01', '2026-10-31', 'b@corp.com').summary.every(x => x.email === 'a@corp.com'), 'staff sees own only');
  ok(G.api_attendance(TA, '2026-10-01', '2026-10-31', '').summary.length === 3, 'admin sees all');
  expectErr(() => G.api_attendance(TA, '2026-10-31', '2026-10-01', ''), 'bad range');
  // 刪除
  const extra = G.api_attendance(TA, '2026-10-01', '2026-10-01', '').records.find(x => x.photo === BLOB + 'out1b.jpg');
  G.api_punchDelete(TA, extra.id);
  ok(G.api_attendance(TA, '2026-10-01', '2026-10-01', '').summary[0].out === '17:35', 'delete punch');

  // ---- 打卡提醒（10/4 沒人排班 → 換 10/5 測） ----
  G.api_setShift(TA, '2026-10-05', 'a@corp.com', '');
  setNow('2026-10-05 09:10'); mails.length = 0; G.hourlyJob();
  ok(mails.some(m => /洪雅玟 今天（10\/5）還沒打上班卡/.test(m.subject)), 'clock-in reminder');
  setNow('2026-10-05 18:10'); mails.length = 0; G.hourlyJob();
  ok(mails.some(m => /還沒打下班卡/.test(m.subject)), 'clock-out reminder');

  // ---- 出勤簽到表資料 ----
  setNow('2026-10-06 10:00');
  expectErr(() => G.api_attendanceReport(TS, '2026-10-01', '2026-10-31', ''), 'staff cannot export');
  expectErr(() => G.api_attendanceReport(TA, '2026-10-01', '2026-12-31', ''), 'range limit', /最多/);
  let rep = G.api_attendanceReport(TA, '2026-10-01', '2026-10-31', 'a@corp.com');
  ok(rep.title === '出勤簽到表115年10月份（洪雅玟）', 'title month ' + rep.title);
  ok(rep.filename === '金門駐點人員出勤簽到表1001-1031', 'filename ' + rep.filename);
  ok(rep.rows.length === 31 && rep.rows[0].date === '10/1' && rep.rows[0].wd === '四' && rep.rows[0].name === '洪雅玟' && rep.rows[0].in === '07:50', 'rows ' + JSON.stringify(rep.rows[0]));
  ok(rep.rows[2].note === '休' && rep.rows[4].note === '未打卡', 'rest/missing notes ' + rep.rows[2].note + '/' + rep.rows[4].note);
  rep = G.api_attendanceReport(TA, '2026-10-21', '2026-11-20', '');
  ok(rep.title === '出勤簽到表115年10月21日至11月20日' && rep.filename === '金門駐點人員出勤簽到表1021-1120', 'range title ' + rep.title);
  rep = G.api_attendanceReport(TA, '2026-12-25', '2027-01-05', '');
  ok(rep.title === '出勤簽到表115年12月25日至116年1月5日', 'cross-year title ' + rep.title);
  rep = G.api_attendanceReport(TA, '2026-10-01', '2026-10-05', '');
  ok(rep.rows.length === 5 && rep.rows[2].name === '小華' && rep.rows[4].note === '未打卡（洪雅玟）', 'all-person rows');

  // ---- 產生 Word ----
  ok(imageSize(PNG).w === 2 && imageSize(PNG).h === 3, 'png size');
  const tpl = fs.readFileSync(path.join(__dirname, '..', 'templates', 'attendance-template.docx'));
  rep = G.api_attendanceReport(TA, '2026-10-01', '2026-10-31', 'a@corp.com');
  const images = {}; rep.rows.forEach(r => { if (r.thumb) images[r.thumb] = PNG; });
  const buf = await buildAttendanceDocx(tpl, rep, images);
  const zip = await JSZip.loadAsync(buf);
  const doc = await zip.file('word/document.xml').async('string');
  ok(doc.includes('出勤簽到表115年10月份（洪雅玟）') && doc.includes('金門水頭港務大樓駐點維護服務'), 'titles in doc');
  ok((doc.match(/<w:tr[ >]/g) || []).length === 32, 'table rows = header + 31');
  ok((doc.match(/<w:drawing>/g) || []).length === 2 && Object.keys(zip.files).filter(f => f.startsWith('word/media/punch')).length === 2, 'two photos embedded');
  ok(/Extension="png"/.test(await zip.file('[Content_Types].xml').async('string')), 'png content type');
  ok(/rIdPunch1/.test(await zip.file('word/_rels/document.xml.rels').async('string')), 'image rel');
  ok(!/w14:paraId="([^"]+)"[\s\S]*w14:paraId="\1"/.test(doc), 'no duplicate paraIds');
  const out = path.join(os.tmpdir(), 'kos_attendance_test.docx');
  fs.writeFileSync(out, buf);
  // 用 python-docx 重新開啟，確認檔案結構正確
  const py = execFileSync('python', ['-I', '-c', [
    'import sys, io, docx', 'sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")', 'd = docx.Document(sys.argv[1])', 't = d.tables[0]',
    'print(len(t.rows), "|", "/".join(c.text for c in t.rows[1].cells), "|", "/".join(c.text for c in t.rows[3].cells), "|", d.paragraphs[1].text)'
  ].join('\n'), out], { env: Object.assign({}, process.env, { PYTHONIOENCODING: 'utf-8' }) }).toString('utf8').trim();
  ok(/^32 \| 10\/1\/四\/洪雅玟\s*\/07:50\/17:35\/ \|/.test(py), 'python-docx reads: ' + py);
  ok(/10\/3\/六\/\/\/\/休/.test(py) && /出勤簽到表115年10月份（洪雅玟）/.test(py), 'python-docx rows ' + py);

  // ---- 下載 API（經 Apps Script doPost） ----
  process.env.GAS_URL = 'https://script.google.com/macros/s/TEST/exec';
  const realFetch = global.fetch;
  global.fetch = async (url, opts) => {
    if (url === process.env.GAS_URL) { const o = G.doPost({ postData: { contents: opts.body } }); return { status: 200, text: async () => o.text }; }
    if (String(url).startsWith('https://abc.public.blob.vercel-storage.com/')) return { ok: true, arrayBuffer: async () => PNG };
    return realFetch(url, opts);
  };
  const handler = require('../api/attendance');
  const resp = await new Promise(resolve => {
    const h = {}, res = { statusCode: 0, setHeader: (k, v) => { h[k] = v; }, end: b => resolve({ h, b, code: res.statusCode }) };
    handler({ method: 'POST', headers: { host: 'x' }, body: JSON.stringify({ token: TA, from: '2026-10-01', to: '2026-10-31', email: 'a@corp.com', photos: true }) }, res);
  });
  ok(/wordprocessingml/.test(resp.h['Content-Type']) && decodeURIComponent(resp.h['X-Filename']) === '金門駐點人員出勤簽到表1001-1031.docx', 'download headers ' + resp.h['X-Filename']);
  ok(/filename\*=UTF-8''%E9%87%91/.test(resp.h['Content-Disposition']), 'content-disposition utf8');
  ok((await JSZip.loadAsync(resp.b)).file('word/media/punch1.png'), 'download has photo');
  const bad = await new Promise(resolve => {
    const h = {}, res = { setHeader: (k, v) => { h[k] = v; }, end: b => resolve(JSON.parse(b)) };
    handler({ method: 'POST', headers: {}, body: JSON.stringify({ token: TS, from: '2026-10-01', to: '2026-10-31' }) }, res);
  });
  ok(/只有主管/.test(bad.error), 'staff export denied: ' + bad.error);
  global.fetch = realFetch;

  console.log('\n通過', pass, '失敗', fail);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
