// 後端選擇：
//  - 有設 GAS_URL（建議）：轉呼叫 Apps Script 網頁應用程式的 doPost（Apps Script 直接讀寫試算表、寄信、上鎖）
//  - 沒設 GAS_URL：在 Vercel 上用服務帳戶讀寫試算表（lib/runtime.js，需 GOOGLE_SERVICE_ACCOUNT_JSON）
async function call(fn, args, origin) {
  const url = process.env.GAS_URL;
  if (!url) return require('./runtime').call(fn, args, { origin });
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

module.exports = { call };
