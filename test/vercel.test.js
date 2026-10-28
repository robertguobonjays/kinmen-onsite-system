// Vercel 版測試：模擬 Google Sheets API，驗證 runtime 讀寫、Apps Script 與 Vercel 共用資料
const http = require('http');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
process.env.SESSION_SECRET = 'test-secret-1234567890';
const env = require('./env.js');
const { G, sheets, mails, setNow, as } = env;
const rt = require('../lib/runtime');
rt._setDateClass(env.FDate); // 測試用模擬時鐘
const { toRequests } = require('../lib/sheets');

let pass = 0, fail = 0;
function ok(c, msg) { if (c) pass++; else { fail++; console.log('FAIL:', msg); } }
async function expectErr(p, msg, re) {
  try { await p; fail++; console.log('FAIL (no error):', msg); }
  catch (e) { if (re && !re.test(e.message)) { fail++; console.log('FAIL (wrong error):', msg, e.message); } else pass++; }
}

/* ---------- 模擬的 Google 試算表（遠端） ---------- */
const remote = {};
function trim(values) {
  const v = values.map(r => { r = r.slice(); while (r.length && (r[r.length - 1] === '' || r[r.length - 1] === undefined)) r.pop(); return r.map(x => x === undefined ? '' : x); });
  while (v.length && !v[v.length - 1].length) v.pop();
  return v;
}
let calls = { load: 0, apply: 0 };
const fake = {
  async load() { calls.load++; const out = {}; Object.keys(remote).forEach(t => { const s = remote[t]; out[t] = { sheetId: s.sheetId, rowCount: s.rowCount, colCount: s.colCount, values: trim(s.values) }; }); return { sheets: JSON.parse(JSON.stringify(out)) }; },
  async apply(ops, snap) {
    calls.apply++;
    const byId = {}; Object.keys(remote).forEach(t => { byId[remote[t].sheetId] = remote[t]; });
    toRequests(ops, snap).forEach(q => {
      if (q.deleteDimension) { const s = byId[q.deleteDimension.range.sheetId]; if (s.rowCount <= 1) throw new Error('cannot delete all rows'); s.values.splice(q.deleteDimension.range.startIndex, 1); s.rowCount--; }
      else if (q.appendDimension) { const s = byId[q.appendDimension.sheetId]; if (q.appendDimension.dimension === 'ROWS') s.rowCount += q.appendDimension.length; else s.colCount += q.appendDimension.length; }
      else if (q.updateCells) {
        const u = q.updateCells, s = byId[u.start.sheetId];
        u.rows.forEach((row, i) => {
          const ri = u.start.rowIndex + i;
          if (ri >= s.rowCount) throw new Error('row out of grid ' + ri + ' >= ' + s.rowCount);
          while (s.values.length <= ri) s.values.push([]);
          row.values.forEach((cell, j) => {
            const ci = u.start.columnIndex + j;
            if (ci >= s.colCount) throw new Error('col out of grid');
            s.values[ri][ci] = cell.userEnteredValue ? cell.userEnteredValue.stringValue : '';
          });
        });
      }
    });
  }
};
rt.setClient(fake);
function pushToRemote() { // Apps Script 環境 → 遠端
  let id = 100;
  Object.keys(sheets).forEach(t => { remote[t] = { sheetId: id++, rowCount: 1000, colCount: 26, values: JSON.parse(JSON.stringify(sheets[t].data)) }; });
}
function pullFromRemote() { // 遠端 → Apps Script 環境
  Object.keys(remote).forEach(t => { sheets[t].data = trim(remote[t].values); });
  G.HEAD_ = {};
}
const call = (fn, ...a) => rt.call(fn, a, { origin: 'https://kinmen.vercel.app' });

(async () => {
  // Apps Script 執行 setup（含寄信佇列、工作佇列）
  setNow('2026-11-02 09:00'); as('');
  const msg = G.setup();
  ok(sheets['寄信佇列'] && sheets['工作佇列'], 'queue sheets');
  const adminPw = msg.match(/admin ／ (\w+)/)[1];
  pushToRemote();

  // ---- Vercel：Apps Script 產生的密碼在 Node 上可驗證（雜湊一致） ----
  const login = await call('api_login', 'admin', adminPw);
  ok(login.token && /^[\w-]+\.[\w-]+$/.test(login.token) && login.mustChange, 'login on vercel with GAS hash');
  const TA = login.token;
  await call('api_changePassword', TA, adminPw, 'boss1234');
  await expectErr(call('api_init', TA + 'x'), 'tampered token', /NEED_LOGIN/);
  let init = await call('api_init', TA);
  ok(init.me.isOwner && init.reportUrl === 'https://kinmen.vercel.app/report', 'init + report url ' + init.reportUrl);
  ok(remote['設定'].values.some(r => r[0] === '系統網址' && r[1] === 'https://kinmen.vercel.app'), 'app url saved to settings');

  // 新帳號 → 信件進佇列（不直接寄）
  mails.length = 0;
  await call('api_savePerson', TA, { email: 'a@corp.com', account: 'aming', name: '阿明', role: '駐點', sched: true, password: 'pass111', sendMail: true });
  await call('api_savePerson', TA, { email: 'b@corp.com', account: 'hua', name: '小華', role: '駐點', sched: true, password: 'pass222' });
  ok(mails.length === 0, 'no direct mail on vercel');
  ok(remote['寄信佇列'].values.length === 2 && remote['寄信佇列'].values[1][5] === '待寄', 'mail queued');
  const TS = (await call('api_login', 'aming', 'pass111')).token;
  await call('api_changePassword', TS, 'pass111', 'pass1111');

  // 排班：登記、確認、主管打開即預排
  await call('api_toggleUnavail', TS, '2026-12-03', '返台');
  await call('api_toggleUnavail', TS, '2026-12-04', '');
  await call('api_toggleUnavail', TS, '2026-12-04', ''); // 取消 → 刪列
  ok(remote['不可上班'].values.filter(r => r[0]).length === 2, 'unavail rows after delete ' + remote['不可上班'].values.length);
  await call('api_confirmMonth', TS, '2026-12');
  let sch = await call('api_getSchedule', TA, '2026-12');
  ok(sch.auto === 'new' && sch.days.every(d => d.email) && sch.days.find(d => d.date === '2026-12-03').email !== 'a@corp.com', 'auto plan on vercel');
  await call('api_setShift', TA, '2026-12-10', 'b@corp.com', '指定');
  await call('api_publish', TA, '2026-12');
  ok((await call('api_getSchedule', TS, '2026-12')).days.find(d => d.date === '2026-12-10').name === '小華', 'staff sees published');

  // 叫修、報修頁、巡檢、工作紀錄刪除
  const tid = await call('api_createTicket', TS, { equip: '閘門', symptom: '讀不到', level: '1', photos: ['https://blob.example/x.jpg'] });
  ok(/^R261102-01$/.test(tid), 'ticket ' + tid);
  await call('api_ticketAction', TS, tid, 'fix', { text: '重開' });
  const pid = await call('api_publicReport', { reporter: '陳小姐', equip: '自助機台', symptom: '不出票', impact: 'part' });
  ok(pid === 'R261102-02', 'public report ' + pid);
  const ins = await call('api_getInspections', TS);
  await call('api_submitInspection', TS, '每日', null, ins.items.filter(i => i.freq === '每日').map(i => ({ id: i.id, result: '正常' })), '');
  await call('api_submitInspection', TS, '每日', null, ins.items.filter(i => i.freq === '每日').map(i => ({ id: i.id, result: '正常' })), ''); // 覆蓋 → 刪 7 列再加 7 列
  ok(remote['巡檢紀錄'].values.filter(r => r[0]).length === 8, 'insp overwrite rows ' + remote['巡檢紀錄'].values.length);
  await call('api_addWorklog', TS, { summary: '更新韌體' });
  const logs = await call('api_listWorklog', TS, '2026-11');
  await call('api_deleteWorklog', TS, logs.find(l => l.summary === '更新韌體').id);
  ok(!(await call('api_listWorklog', TS, '2026-11')).some(l => l.summary === '更新韌體'), 'worklog deleted');
  const rep = await call('api_monthReport', TA, '2026-11', true);
  ok(rep.queued && remote['工作佇列'].values.length === 2, 'month report queued');
  await expectErr(call('api_savePerson', TS, {}), 'staff no account mgmt', /管理員/);
  await expectErr(call('api_nope', TA), 'unknown fn', /不支援/);
  await expectErr(call('setup'), 'non-api fn', /不支援/);

  // 大量新增超過格子 → 自動擴充列
  remote['工作紀錄'].rowCount = remote['工作紀錄'].values.length + 1;
  for (let i = 0; i < 3; i++) await call('api_addWorklog', TS, { summary: '擴充測試' + i });
  ok(remote['工作紀錄'].rowCount > 100, 'grid expanded');

  // ---- 遠端資料回到 Apps Script：flushQueue 寄信、產生月報；Apps Script 看到的資料一致 ----
  pullFromRemote();
  mails.length = 0;
  G.flushQueue();
  const queued = G.readTable_('寄信佇列');
  ok(queued.every(m => m['狀態'] === '已寄'), 'all queued mails sent');
  ok(mails.length === queued.length + 1, 'mails sent incl. report mail: ' + mails.length + ' vs ' + queued.length);
  ok(mails.some(m => /月維護報告已產生/.test(m.subject)), 'report mail');
  ok(G.readTable_('工作佇列')[0]['狀態'] === '完成', 'job done');
  ok(G.readTable_('叫修單').length === 2 && G.readTable_('人員').length === 3, 'GAS sees vercel data ' + G.readTable_('叫修單').length + '/' + G.readTable_('人員').length);
  ok(G.api_login('aming', 'pass1111').token, 'password changed on vercel works in GAS');
  G.cronSla(); G.hourlyJob(); // 排程照常在 Apps Script 跑
  pushToRemote();

  // ---- HTTP 整合：本機伺服器跑 public/ 與 api/，jsdom 開網頁 ----
  require('child_process').execSync('node scripts/build-web.js', { cwd: path.join(__dirname, '..') });
  const handlers = { '/api/call': require('../api/call'), '/api/upload': require('../api/upload') };
  const server = http.createServer((req, res) => {
    res.status = c => { res.statusCode = c; return res; };
    res.json = o => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(o)); };
    if (handlers[req.url]) {
      let b = ''; req.on('data', d => { b += d; }); req.on('end', () => { req.body = b; handlers[req.url](req, res); });
      return;
    }
    const file = { '/': 'index.html', '/report': 'report.html', '/gas-shim.js': 'gas-shim.js' }[req.url];
    if (!file) { res.statusCode = 404; return res.end(); }
    res.end(fs.readFileSync(path.join(__dirname, '..', 'public', file)));
  });
  await new Promise(r => server.listen(0, r));
  const base = 'http://127.0.0.1:' + server.address().port;
  const errors = [];
  async function page(p) {
    const html = await (await fetch(base + p)).text();
    const dom = new JSDOM(html.replace('<script src="/gas-shim.js"></script>', '<script>' + fs.readFileSync(path.join(__dirname, '..', 'public', 'gas-shim.js'), 'utf8') + '</script>'), {
      runScripts: 'dangerously', url: base + p, beforeParse(w) {
        w.fetch = (u, o) => fetch(base + u, o); w.confirm = () => true; w.print = () => { };
        w.addEventListener('error', e => errors.push(e.message));
      }
    });
    return dom.window;
  }
  const wait = ms => new Promise(r => setTimeout(r, ms));
  let w = await page('/');
  await wait(300);
  ok(!!w.document.getElementById('lgA'), 'vercel login page');
  w.document.getElementById('lgA').value = 'hua'; w.document.getElementById('lgP').value = 'pass222'; w.doLogin();
  await wait(600);
  ok(/小華/.test(w.document.getElementById('who').textContent), 'logged in via http: ' + w.document.getElementById('who').textContent);
  ok(!!w.document.getElementById('pwO'), 'forced pw change shown');
  w.document.getElementById('pwO').value = 'pass222'; w.document.getElementById('pwN').value = 'pass2222'; w.document.getElementById('pwN2').value = 'pass2222'; w.pwSave();
  await wait(500);
  w.APP.month = '2026-12'; w.go('schedule'); await wait(600);
  ok(w.document.querySelectorAll('.cal .who').length >= 28, 'schedule rendered via http ' + w.document.querySelectorAll('.cal .who').length + ' ' + w.APP.month);
  w.go('tickets'); await wait(600);
  ok(/R261102-02/.test(w.document.getElementById('main').textContent) && /\/report/.test(w.document.getElementById('main').innerHTML), 'tickets + report link');
  // 上傳沒有 Blob token 時回傳錯誤訊息（不當機）
  const up = await (await fetch(base + '/api/upload', { method: 'POST', body: JSON.stringify({ fn: 'api_publicUpload', args: ['a.jpg', 'data:image/jpeg;base64,AAAA'] }) })).json();
  ok(up.error && !up.ok, 'upload without blob token returns error: ' + up.error);
  const bad = await (await fetch(base + '/api/upload', { method: 'POST', body: JSON.stringify({ fn: 'api_publicUpload', args: ['a.html', 'data:text/html;base64,AAAA'] }) })).json();
  ok(/只能上傳照片/.test(bad.error), 'upload type check');
  w = await page('/report');
  await wait(400);
  ok(w.document.querySelectorAll('input[name=eq]').length === 10, 'report page via http');
  w.document.getElementById('rName').value = '林先生'; w.document.querySelector('input[name=eq][value="閘門"]').checked = true; w.document.getElementById('rSym').value = '不開';
  w.send(); await wait(600);
  ok(/R261102-0\d/.test((w.document.querySelector('.done .id') || {}).textContent || ''), 'report submitted via http');
  server.close();
  ok(!errors.length, 'no page errors ' + errors);

  console.log('Sheets API 讀取', calls.load, '次、寫入', calls.apply, '次');
  console.log('\n通過', pass, '失敗', fail);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
