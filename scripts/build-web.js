// Vercel 建置：把 src/ 的網頁加上 gas-shim.js 後輸出到 public/
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const out = path.join(root, 'public');
fs.mkdirSync(out, { recursive: true });

[['Index.html', 'index.html'], ['Report.html', 'report.html']].forEach(([src, dst]) => {
  let html = fs.readFileSync(path.join(root, 'src', src), 'utf8');
  const i = html.indexOf('<script>');
  if (i < 0) throw new Error(src + ' 找不到 <script>');
  html = html.replace('<base target="_top">\n', '');
  html = html.slice(0, html.indexOf('<script>')) + '<script src="/gas-shim.js"></script>\n' + html.slice(html.indexOf('<script>'));
  fs.writeFileSync(path.join(out, dst), html);
});
fs.copyFileSync(path.join(root, 'web', 'gas-shim.js'), path.join(out, 'gas-shim.js'));
console.log('已輸出 public/index.html、public/report.html、public/gas-shim.js');
