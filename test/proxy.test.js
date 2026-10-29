// Vercel → Apps Script 轉呼叫（GAS_URL 模式）測試：用模擬的 fetch 直接呼叫 Code.gs 的 doPost
const { G, sheets, mails, setNow, as } = require('./env.js');
process.env.GAS_URL = 'https://script.google.com/macros/s/TEST/exec';
process.env.APP_URL = 'https://kinmen-onsite-system.vercel.app';
const realFetch = global.fetch;
let posted = [];
global.fetch = async (url, opts) => {
  if (url !== process.env.GAS_URL) return realFetch(url, opts);
  posted.push(JSON.parse(opts.body));
  const out = G.doPost({ postData: { contents: opts.body } });
  return { status: 200, text: async () => out.text };
};
const call = require('../api/call');
let pass = 0, fail = 0;
function ok(c, m) { if (c) pass++; else { fail++; console.log('FAIL:', m); } }
function req(fn, args) {
  return new Promise(resolve => {
    const res = { headers: {}, setHeader() { }, status(c) { this.code = c; return this; }, json(o) { resolve(o); } };
    call({ method: 'POST', headers: { host: 'x.vercel.app' }, body: JSON.stringify({ fn, args }) }, res);
  });
}
(async () => {
  setNow('2026-11-02 09:00'); as('');
  const pw = G.setup().match(/admin ／ (\w+)/)[1];
  let r = await req('api_publicInfo', []);
  ok(r.ok && /02-7733-5686/.test(r.result.hotline), 'publicInfo via GAS');
  ok(G.getSettings_()['系統網址'] === process.env.APP_URL, 'app url set from proxy');
  r = await req('api_login', ['admin', 'bad']);
  ok(r.error === '帳號或密碼錯誤', 'bad login error passes through');
  r = await req('api_login', ['admin', pw]);
  ok(r.ok && /^[0-9a-f]{64}$/.test(r.result.token), 'GAS session token');
  const tk = r.result.token;
  r = await req('api_init', [tk]);
  ok(r.ok && r.result.reportUrl === 'https://kinmen-onsite-system.vercel.app/report', 'report url ' + (r.result && r.result.reportUrl));
  mails.length = 0;
  r = await req('api_publicReport', [{ reporter: '陳', equip: '閘門', symptom: '不開', impact: 'all' }]);
  ok(r.ok && /^R\d{6}-01$/.test(r.result) && mails.length === 1, 'report creates ticket and mails directly');
  r = await req('setup', []);
  ok(r.error === '不支援的功能', 'non-api blocked at vercel');
  ok(G.doPost({ postData: { contents: JSON.stringify({ fn: 'setup' }) } }).text.indexOf('不支援') > 0, 'non-api blocked at GAS');
  ok(JSON.parse(G.doPost({ postData: { contents: '{bad' } }).text).error, 'bad json handled');
  r = await req('api_uploadPhoto', [tk, 'a', 'b']);
  ok(r.error === '不支援的功能', 'upload not via call');
  console.log('\n通過', pass, '失敗', fail);
  process.exit(fail ? 1 : 0);
})();
