// 後端：把請求轉給 Apps Script 網頁應用程式的 doPost（env GAS_URL），由 Apps Script 讀寫試算表、寄信
async function call(fn, args, origin) {
  const url = process.env.GAS_URL;
  if (!url) throw new Error('伺服器未設定 GAS_URL');
  const r = await fetch(url, {
    method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ fn, args, origin: process.env.APP_URL || origin || '' })
  });
  const text = await r.text();
  let j;
  try { j = JSON.parse(text); } catch (e) { throw new Error('後端（Apps Script）回應錯誤（' + r.status + '），請稍後再試'); }
  if (j.error) throw new Error(j.error);
  return j.result === undefined ? null : j.result;
}

// 公開上傳的頻率限制（同一個 Vercel 執行個體內有效）
const hits = new Map();
function rateLimit(key, max, sec) {
  const now = Date.now(), h = hits.get(key);
  if (!h || h.x < now) { hits.set(key, { n: 1, x: now + (sec || 600) * 1000 }); return; }
  if (h.n >= max) throw new Error('目前操作太頻繁，請稍後再試，或改用電話／LINE 通報。');
  h.n++;
}

module.exports = { call, rateLimit };
