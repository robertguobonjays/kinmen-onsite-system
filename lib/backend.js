// 後端：把請求轉給 Apps Script 網頁應用程式的 doPost（env GAS_URL），由 Apps Script 讀寫試算表、寄信
async function call(fn, args, origin, ip) {
  const url = process.env.GAS_URL;
  if (!url) throw new Error('伺服器未設定 GAS_URL');
  const r = await fetch(url, {
    method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ fn, args, origin: process.env.APP_URL || origin || '', ip: ip || '' })
  });
  const text = await r.text();
  let j;
  try { j = JSON.parse(text); } catch (e) { throw new Error('後端（Apps Script）回應錯誤（' + r.status + '），請稍後再試'); }
  if (j.error) throw new Error(j.error);
  return j.result === undefined ? null : j.result;
}

/** 使用者 IP：Vercel 會把真實 IP 放在 x-forwarded-for 第一個 */
function clientIp(req) {
  const h = (req && req.headers) || {};
  return String(h['x-real-ip'] || h['x-forwarded-for'] || '').split(',')[0].trim().slice(0, 64);
}

// 頻率限制（同一個 Vercel 執行個體內有效）
const hits = new Map();
function rateLimit(key, max, sec) {
  const now = Date.now();
  if (hits.size > 5000) hits.forEach((v, k) => { if (v.x < now) hits.delete(k); });
  const h = hits.get(key);
  if (!h || h.x < now) { hits.set(key, { n: 1, x: now + (sec || 600) * 1000 }); return; }
  if (h.n >= max) throw new Error('目前操作太頻繁，請稍後再試，或改用電話／LINE 通報。');
  h.n++;
}

module.exports = { call, rateLimit, clientIp };
