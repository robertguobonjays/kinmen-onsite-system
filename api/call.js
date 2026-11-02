// POST /api/call  { fn: 'api_xxx', args: [...] } → { ok, result } 或 { error }
const backend = require('../lib/backend');

const DENY = new Set(['api_uploadPhoto', 'api_publicUpload', 'api_uploadFile', 'api_uploadPunch']); // 檔案走 /api/upload
const NO_TOKEN = new Set(['api_login', 'api_publicInfo', 'api_publicReport']); // 不用登入的功能，其他一律要帶 token
const TOKEN = /^[0-9a-f]{64}$/;
const INFO_MS = 60000;
let info = null; // 報修頁基本資料暫存

function origin(req) {
  const h = req.headers['x-forwarded-host'] || req.headers.host;
  const p = req.headers['x-forwarded-proto'] || 'https';
  return h ? p + '://' + h : '';
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  let body = req.body;
  try { if (typeof body === 'string') body = JSON.parse(body || '{}'); } catch (e) { return res.status(400).json({ error: '格式錯誤' }); }
  const fn = body && body.fn, args = Array.isArray(body && body.args) ? body.args : [];
  if (typeof fn !== 'string' || !/^api_[A-Za-z]+$/.test(fn) || DENY.has(fn)) return res.status(400).json({ error: '不支援的功能' });

  // 以下幾種不必驚動 Apps Script：Google 登入在這個架構永遠拿不到身分、token 格式不對一定是沒登入
  if (fn === 'api_googleLogin') return res.status(200).json({ ok: true, result: null });
  if (!NO_TOKEN.has(fn) && !TOKEN.test(String(args[0] || ''))) return res.status(200).json({ error: 'NEED_LOGIN' });
  if (fn === 'api_publicInfo' && info && info.x > Date.now()) return res.status(200).json({ ok: true, result: info.v });

  try {
    const ip = backend.clientIp(req);
    backend.rateLimit('ip_' + ip, 240, 60);
    if (fn === 'api_login') backend.rateLimit('login_' + ip, 30, 600);
    const result = await backend.call(fn, args, origin(req), ip);
    if (fn === 'api_publicInfo') info = { v: result, x: Date.now() + INFO_MS };
    res.status(200).json({ ok: true, result });
  } catch (e) {
    const msg = String((e && e.message) || e);
    if (!/NEED_LOGIN|請|錯誤|不能|只有|找不到|頻繁|已被|至少|格式/.test(msg)) console.error(fn, e);
    res.status(200).json({ error: msg });
  }
};
