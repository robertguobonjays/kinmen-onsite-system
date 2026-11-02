// 附件上傳權杖：只有主管拿得到，限檔案類型與大小
const backend = require('../lib/backend');
const { getPayloadFromClientToken } = require('@vercel/blob/client');
const handler = require('../api/upload-token');

process.env.BLOB_READ_WRITE_TOKEN = 'vercel_blob_rw_TESTSTORE_abcdefghijklmnop';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL:', m); } };
const call = body => new Promise(resolve => {
  const res = { setHeader() { }, status() { return this; }, json: resolve };
  handler({ method: 'POST', body }, res);
});

(async () => {
  backend.call = async (fn, args) => {
    if (fn !== 'api_checkAdmin') throw new Error('wrong fn');
    if (args[0] !== 'boss') throw new Error('這個功能只有主管可以使用。');
    return [];
  };
  let r = await call({ token: 'staff', name: 'a.pdf', size: 100 });
  ok(/主管/.test(r.error) && !r.clientToken, 'staff refused');
  r = await call({ token: 'boss', name: 'a.exe', size: 100 });
  ok(/只能上傳/.test(r.error), 'bad type refused');
  r = await call({ token: 'boss', name: 'a.html', size: 100 });
  ok(/只能上傳/.test(r.error), 'html refused');
  r = await call({ token: 'boss', name: 'a.pdf', size: 51 * 1024 * 1024 });
  ok(/50MB/.test(r.error), 'too big refused');
  for (const [n, t] of [['手冊 V2.PDF', 'application/pdf'], ['圖.png', 'image/png'], ['表.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'], ['文.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']]) {
    r = await call({ token: 'boss', name: n, size: 1000 });
    const p = r.clientToken && getPayloadFromClientToken(r.clientToken);
    ok(p && p.pathname === r.pathname && p.allowedContentTypes[0] === t && p.addRandomSuffix && r.pathname.startsWith('文件附件/') && !/\s/.test(r.pathname), 'token ' + n + ' ' + JSON.stringify(r));
  }
  console.log('通過', pass, '失敗', fail);
  process.exit(fail ? 1 : 0);
})();
