// POST /api/attendance  { token, from, to, email, photos } → 下載「金門駐點人員出勤簽到表mmdd-mmdd.docx」
const fs = require('fs');
const path = require('path');
const backend = require('../lib/backend');
const { buildAttendanceDocx } = require('../lib/docx');

const TPL = path.join(__dirname, '..', 'templates', 'attendance-template.docx');

function origin(req) {
  const h = req.headers['x-forwarded-host'] || req.headers.host;
  return h ? (req.headers['x-forwarded-proto'] || 'https') + '://' + h : '';
}

async function fetchImages(urls) {
  const out = {};
  const list = [...new Set(urls.filter(u => /^https:\/\/[\w.-]+\.public\.blob\.vercel-storage\.com\//.test(u)))];
  await Promise.all(list.map(async u => {
    try {
      const r = await fetch(u);
      if (!r.ok) return;
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length < 300 * 1024) out[u] = buf; // 縮圖才放進文件，避免檔案過大
    } catch (e) { /* 圖片抓不到就只放名字 */ }
  }));
  return out;
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const fail = (msg) => { res.statusCode = 200; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ error: msg })); };
  if (req.method !== 'POST') return fail('POST only');
  try {
    let b = req.body;
    if (typeof b === 'string') b = JSON.parse(b || '{}');
    b = b || {};
    const data = await backend.call('api_attendanceReport', [b.token, b.from, b.to, b.email || ''], origin(req));
    const images = b.photos ? await fetchImages(data.rows.map(r => r.thumb).filter(Boolean)) : {};
    const buf = await buildAttendanceDocx(fs.readFileSync(TPL), data, images);
    const name = data.filename + '.docx';
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', 'attachment; filename="attendance.docx"; filename*=UTF-8\'\'' + encodeURIComponent(name));
    res.setHeader('X-Filename', encodeURIComponent(name));
    res.end(buf);
  } catch (e) {
    fail(String((e && e.message) || e));
  }
};
