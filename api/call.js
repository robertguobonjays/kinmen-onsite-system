// POST /api/call  { fn: 'api_xxx', args: [...] } → { ok, result } 或 { error }
const backend = require('../lib/backend');

const DENY = new Set(['api_uploadPhoto', 'api_publicUpload', 'api_uploadFile', 'api_uploadPunch']); // 檔案走 /api/upload

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
  const fn = body && body.fn, args = body && body.args;
  if (typeof fn !== 'string' || !/^api_[A-Za-z]+$/.test(fn) || DENY.has(fn)) return res.status(400).json({ error: '不支援的功能' });
  try {
    const result = await backend.call(fn, Array.isArray(args) ? args : [], origin(req));
    res.status(200).json({ ok: true, result });
  } catch (e) {
    const msg = String((e && e.message) || e);
    if (!/NEED_LOGIN|請|錯誤|不能|只有|找不到|頻繁|已被|至少|格式/.test(msg)) console.error(fn, e);
    res.status(200).json({ error: msg });
  }
};
