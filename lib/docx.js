// 用「邦捷_金門駐點人員_出勤簽到表.docx」範本產生出勤簽到表：
// 保留範本的版面、字型、框線，只換掉第二行標題（出勤簽到表○年○月份）與表格資料列；簽到欄可放打卡照片縮圖
const JSZip = require('jszip');

const COLS = ['date', 'wd', 'name', 'in', 'out', 'note'];

function x(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/** JPEG／PNG 圖片尺寸 */
function imageSize(buf) {
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20), ext: 'png' };
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i < buf.length - 9) {
      if (buf[i] !== 0xff) { i++; continue; }
      const m = buf[i + 1];
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { w: buf.readUInt16BE(i + 7), h: buf.readUInt16BE(i + 5), ext: 'jpeg' };
      i += 2 + buf.readUInt16BE(i + 2);
    }
    return { w: 4, h: 3, ext: 'jpeg' };
  }
  return null;
}

function drawing(rid, id, w, h) {
  const H = 432000; // 1.2 cm
  let cy = H, cx = Math.round(H * w / h);
  if (cx > 900000) { cx = 900000; cy = Math.round(cx * h / w); }
  return '<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="' + cx + '" cy="' + cy + '"/>' +
    '<wp:docPr id="' + id + '" name="打卡照片' + id + '"/><wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr>' +
    '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
    '<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="' + id + '" name="punch' + id + '"/><pic:cNvPicPr/></pic:nvPicPr>' +
    '<pic:blipFill><a:blip r:embed="' + rid + '"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
    '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + cx + '" cy="' + cy + '"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>' +
    '</a:graphicData></a:graphic></wp:inline></w:drawing></w:r>';
}

function cellRPr(tc) {
  const pPr = (tc.match(/<w:pPr>[\s\S]*?<\/w:pPr>/) || [''])[0];
  return (pPr.match(/<w:rPr>[\s\S]*?<\/w:rPr>/) || [''])[0];
}

/** 在儲存格段落內放文字（字型沿用標題列同一欄，整張表一致） */
function fillCell(tc, text, extraParagraph, rPr) {
  let out = tc;
  if (text !== '') {
    const i = out.lastIndexOf('</w:p>');
    out = out.slice(0, i) + '<w:r>' + rPr + '<w:t xml:space="preserve">' + x(text) + '</w:t></w:r>' + out.slice(i);
  }
  if (extraParagraph) {
    const i = out.lastIndexOf('</w:tc>');
    out = out.slice(0, i) + extraParagraph + out.slice(i);
  }
  return out;
}

/**
 * @param {Buffer} tpl 範本 docx
 * @param {{title:string, rows:Array}} data api_attendanceReport 回傳
 * @param {Object<string, Buffer>} images 縮圖網址 → 圖片內容（不放照片時傳 {}）
 */
async function buildAttendanceDocx(tpl, data, images) {
  const zip = await JSZip.loadAsync(tpl);
  let doc = await zip.file('word/document.xml').async('string');

  // 第二個段落＝「出勤簽到表○年○月份」：保留段落格式與第一段文字的字型，換成新標題
  const tblAt = doc.indexOf('<w:tbl>');
  const head = doc.slice(0, tblAt);
  const paras = [...head.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)];
  if (paras.length < 2) throw new Error('範本格式不符（找不到標題）');
  const p2 = paras[1][0];
  const pPr = (p2.match(/<w:pPr>[\s\S]*?<\/w:pPr>/) || [''])[0];
  const rPr = ((p2.match(/<w:r[ >][\s\S]*?<\/w:r>/) || [''])[0].match(/<w:rPr>[\s\S]*?<\/w:rPr>/) || [''])[0];
  const openTag = p2.match(/^<w:p[^>]*>/)[0];
  const newP2 = openTag + pPr + '<w:r>' + rPr + '<w:t xml:space="preserve">' + x(data.title) + '</w:t></w:r></w:p>';
  const newHead = head.slice(0, paras[1].index) + newP2 + head.slice(paras[1].index + p2.length);

  // 表格：保留標題列，以第一個資料列為樣板產生每一天
  const tblEnd = doc.indexOf('</w:tbl>', tblAt) + '</w:tbl>'.length;
  const tbl = doc.slice(tblAt, tblEnd);
  const rows = [...tbl.matchAll(/<w:tr[ >][\s\S]*?<\/w:tr>/g)];
  if (rows.length < 2) throw new Error('範本格式不符（找不到表格列）');
  const rowTpl = rows[1][0].replace(/ w14:(paraId|textId)="[^"]*"/g, '');
  const headFonts = [...rows[0][0].matchAll(/<w:tc>[\s\S]*?<\/w:tc>/g)].map(m => cellRPr(m[0]));
  const before = tbl.slice(0, rows[0].index + rows[0][0].length);
  const after = tbl.slice(rows[rows.length - 1].index + rows[rows.length - 1][0].length);

  let rels = await zip.file('word/_rels/document.xml.rels').async('string');
  let types = await zip.file('[Content_Types].xml').async('string');
  const usedExt = new Set();
  let imgId = 0;

  const body = data.rows.map(r => {
    const cells = [...rowTpl.matchAll(/<w:tc>[\s\S]*?<\/w:tc>/g)];
    let rowXml = rowTpl, offset = 0;
    cells.forEach((m, ci) => {
      let extra = '';
      if (COLS[ci] === 'name' && r.thumb && images[r.thumb]) {
        const buf = images[r.thumb], sz = imageSize(buf);
        if (sz) {
          imgId++;
          const rid = 'rIdPunch' + imgId, file = 'punch' + imgId + '.' + (sz.ext === 'png' ? 'png' : 'jpeg');
          zip.file('word/media/' + file, buf);
          rels = rels.replace('</Relationships>', '<Relationship Id="' + rid + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/' + file + '"/></Relationships>');
          usedExt.add(sz.ext);
          extra = '<w:p><w:pPr><w:snapToGrid w:val="0"/><w:spacing w:before="40" w:after="40" w:line="240" w:lineRule="auto"/><w:jc w:val="center"/></w:pPr>' + drawing(rid, 5000 + imgId, sz.w, sz.h) + '</w:p>';
        }
      }
      const filled = fillCell(m[0], r[COLS[ci]] || '', extra, headFonts[ci] || cellRPr(m[0]));
      rowXml = rowXml.slice(0, m.index + offset) + filled + rowXml.slice(m.index + offset + m[0].length);
      offset += filled.length - m[0].length;
    });
    return rowXml;
  }).join('');

  usedExt.forEach(ext => {
    if (!new RegExp('Extension="' + ext + '"', 'i').test(types)) {
      types = types.replace('<Default Extension="xml"', '<Default Extension="' + ext + '" ContentType="image/' + ext + '"/><Default Extension="xml"');
    }
  });

  doc = newHead + before + body + after + doc.slice(tblEnd);
  zip.file('word/document.xml', doc);
  zip.file('word/_rels/document.xml.rels', rels);
  zip.file('[Content_Types].xml', types);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

module.exports = { buildAttendanceDocx, imageSize };
