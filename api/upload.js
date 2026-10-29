// POST /api/upload  照片與 SOP 附件存到 Vercel Blob，回傳檔案網址
//  api_uploadPhoto(token, name, dataUrl)：登入者上傳叫修照片
//  api_publicUpload(name, dataUrl)：機關報修頁上傳照片（有頻率限制）
//  api_uploadFile(token, name, dataUrl)：主管上傳 SOP 附件
const backend = require('../lib/backend');

const MAX = 4 * 1024 * 1024; // Vercel 單次請求上限約 4.5MB

function safeName(n) { return String(n || 'file').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 80) || 'file'; }

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  try {
    let body = req.body;
    if (typeof body === 'string') body = JSON.parse(body || '{}');
    const fn = body && body.fn, args = (body && body.args) || [];
    let name, dataUrl, folder, imageOnly = true;
    if (fn === 'api_publicUpload') {
      [name, dataUrl] = args;
      backend.rateLimit('pub_upload', 30);
      folder = '叫修照片';
    } else if (fn === 'api_uploadPhoto') {
      [, name, dataUrl] = args;
      await backend.call('api_init', [args[0]]); // 檢查登入
      folder = '叫修照片';
    } else if (fn === 'api_uploadFile') {
      [, name, dataUrl] = args;
      await backend.call('api_listPeople', [args[0]]); // 檢查主管權限
      folder = 'SOP文件'; imageOnly = false;
    } else return res.status(400).json({ error: '不支援的功能' });

    const m = String(dataUrl || '').match(/^data:([\w.+-]+\/[\w.+-]+)?;base64,(.+)$/);
    if (!m) throw new Error('檔案格式錯誤');
    const type = m[1] || 'application/octet-stream';
    if (imageOnly && !/^image\//.test(type)) throw new Error('只能上傳照片');
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length > MAX) throw new Error('檔案太大（上限 4MB），請直接放到雲端硬碟資料夾後貼連結');
    const { put } = require('@vercel/blob');
    const blob = await put(folder + '/' + safeName(name), buf, { access: 'public', contentType: type, addRandomSuffix: true });
    res.status(200).json({ ok: true, result: blob.url });
  } catch (e) {
    res.status(200).json({ error: String((e && e.message) || e) });
  }
};
