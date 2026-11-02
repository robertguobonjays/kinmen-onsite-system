// POST /api/upload-token  { token, name, size } → 主管才拿得到的一次性上傳權杖（10 分鐘內有效、只限這個檔案類型與大小）
const backend = require('../lib/backend');

const MAX = 50 * 1024 * 1024;
const TYPES = {
  pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
};

function safeName(n) { return String(n || 'file').replace(/[\\/:*?"<>|\s]+/g, '_').slice(-80) || 'file'; }

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  try {
    let b = req.body;
    if (typeof b === 'string') b = JSON.parse(b || '{}');
    b = b || {};
    await backend.call('api_checkAdmin', [b.token]); // 檢查主管權限
    const ext = (String(b.name).match(/\.(\w+)$/) || [])[1];
    const type = ext && TYPES[ext.toLowerCase()];
    if (!type) throw new Error('只能上傳 PDF、圖檔、Word、Excel');
    if (!(Number(b.size) > 0) || Number(b.size) > MAX) throw new Error('檔案大小要在 50MB 以內');
    const { generateClientTokenFromReadWriteToken } = require('@vercel/blob/client');
    const pathname = '文件附件/' + safeName(b.name);
    const clientToken = await generateClientTokenFromReadWriteToken({
      pathname, allowedContentTypes: [type], maximumSizeInBytes: MAX, addRandomSuffix: true, validUntil: Date.now() + 10 * 60 * 1000
    });
    res.status(200).json({ pathname, clientToken });
  } catch (e) {
    res.status(200).json({ error: String((e && e.message) || e) });
  }
};
