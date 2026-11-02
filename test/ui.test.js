// 網頁畫面測試（jsdom＋模擬後端）
const { JSDOM } = require('jsdom');
const fs = require('fs');
const { G, setNow, as } = require('./env.js');
as(''); // 匿名部署：取不到 Google 帳號
setNow('2026-11-02 09:00');
const msg = G.setup();
const adminPw = msg.match(/admin ／ (\w+)/)[1];
const TA = G.api_login('admin', adminPw).token;
G.api_changePassword(TA, adminPw, 'boss1234');
G.api_savePerson(TA, { email: 'a@corp.com', account: 'aming', name: '阿明', role: '駐點', sched: true, password: 'pass111' });
G.api_savePerson(TA, { email: 'b@corp.com', account: 'hua', name: '小華', role: '駐點', sched: true, password: 'pass222' });
G.api_autoSchedule(TA, '2026-11', true); G.api_publish(TA, '2026-11');
G.api_createTicket(TA, { equip: '閘門', symptom: '讀不到', level: '1' });

const errors = [];
const wait = ms => new Promise(r => setTimeout(r, ms));
function open(file, query) {
  const html = fs.readFileSync(__dirname + '/../src/' + file, 'utf8');
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', url: 'https://x.test/' + (query || ''), beforeParse(w) {
      w.scrollTo = () => { }; w.alert = () => { }; w.confirm = () => true; w.prompt = () => ''; w.print = () => { };
      const mk = (s, f) => new Proxy({}, {
        get(_, k) {
          if (k === 'withSuccessHandler') return h => mk(h, f);
          if (k === 'withFailureHandler') return h => mk(s, h);
          return (...a) => setTimeout(() => {
            try { const r = JSON.parse(JSON.stringify(G[k](...a) ?? null)); s && s(r); }
            catch (e) { if (!/NEED_LOGIN|錯誤|已被使用/.test(e.message)) errors.push(k + ': ' + e.message); f && f(e); }
          }, 0);
        }
      });
      w.google = { script: { run: mk(null, null) } };
      w.addEventListener('error', e => errors.push('JS: ' + e.message));
    }
  });
  return dom.window;
}
async function login(w, a, p) {
  await wait(60);
  w.document.getElementById('lgA').value = a; w.document.getElementById('lgP').value = p;
  w.doLogin(); await wait(120);
}

const TA2 = () => G.api_login('admin', 'boss1234').token;
(async () => {
  // 登入畫面與錯誤密碼
  let w = open('Index.html');
  await wait(60);
  console.log('login screen:', !!w.document.getElementById('lgA'));
  await login(w, 'aming', 'bad');
  console.log('  bad pw toast:', w.document.getElementById('toast').textContent);

  for (const [acct, pw] of [['admin', 'boss1234'], ['aming', 'pass111']]) {
    w = open('Index.html');
    await login(w, acct, pw);
    if (w.document.getElementById('pwO')) { // 第一次登入改密碼
      w.document.getElementById('pwO').value = pw; w.document.getElementById('pwN').value = pw + 'x'; w.document.getElementById('pwN2').value = pw + 'x';
      w.pwSave(); await wait(80);
      console.log('  forced pw change ->', w.document.getElementById('toast').textContent);
    }
    const txt = () => w.document.getElementById('main').textContent.replace(/\s+/g, ' ');
    console.log('==', acct, '| nav:', w.document.getElementById('nav').textContent, '| who:', w.document.getElementById('who').textContent);
    console.log(' home:', txt().slice(0, 140));
    for (const p of ['punch', 'schedule', 'tickets', 'insp', 'sop'].concat(acct === 'admin' ? ['admin'] : [])) {
      w.go(p); await wait(90);
      console.log('  ', p, ':', txt().slice(0, 100));
    }
    w.go('schedule'); await wait(80);
    if (acct === 'admin') {
      w.windowForm(); w.document.getElementById('wS').value = '2026-11-02'; w.document.getElementById('wE').value = '2026-11-20'; w.windowSave(); await wait(80);
      console.log('  window ->', w.document.getElementById('toast').textContent);
      w.APP.month = '2026-12'; w.pageSchedule(); await wait(120);
      console.log('  open Dec ->', w.document.getElementById('toast').textContent, '| cells:', w.document.querySelectorAll('.cal .d .who').length);
      w.availForm('2026-12-05'); await wait(10); w.availSave('2026-12-05'); await wait(100);
      if (!w.APP.sch.avail.some(a => a.date === '2026-12-05')) errors.push('admin own avail');
      if (!w.document.querySelector('.avt')) errors.push('availability table');
      w.dayClick('2026-12-06'); await wait(10); w.document.querySelector('input[name=shWho][value="b@corp.com"]').checked = true; w.saveShift('2026-12-06'); await wait(100);
      w.autoSchedule(); await wait(120); w.publishSchedule(); await wait(100); w.printSchedule(); await wait(150);
      // 帳號
      w.APP.adminSub = 'people'; w.go('admin'); await wait(80);
      w.personForm(); await wait(10);
      w.document.getElementById('pN').value = '新人'; w.document.getElementById('pAc').value = 'newbie'; w.document.getElementById('pE').value = 'n@corp.com';
      w.personSave(null); await wait(100);
      console.log('  add account ->', w.document.getElementById('toast').textContent, '| rows:', w.document.querySelectorAll('#adBody tr').length);
      const i = w.APP.init.people.findIndex(p => p.account === 'newbie');
      w.personForm(i); await wait(10); w.document.querySelector('input[name=pR][value="主管"]').checked = true; w.personSave('n@corp.com'); await wait(100);
      w.personDel('n@corp.com'); await wait(100);
      for (const s of ['settings', 'items', 'report', 'stats', 'menu']) { w.APP.adminSub = s; w.go('admin'); await wait(90); }
      w.APP.adminSub = 'settings'; w.go('admin'); await wait(60); w.saveSettings(); await wait(80);
      w.APP.adminSub = 'sop'; w.go('admin'); await wait(80); w.sopForm(w.APP.sops[0].id); await wait(10);
      console.log('  sop upload ui:', !!w.document.getElementById('sFile'));
      w.sopSave(w.APP.sops[0].id); await wait(100);
    } else {
      w.dayClick('2026-11-20'); await wait(20); // 已發布的月份：點日期是申請請假
      if (w.document.getElementById('lvS').value !== '2026-11-20') errors.push('published day opens leave form');
      w.closeModal();
      w.APP.month = '2026-12'; w.pageSchedule(); await wait(100);
      console.log('  Dec staff sees:', w.APP.sch.visible, '| button:', [...w.document.querySelectorAll('#main button')].map(b => b.textContent).filter(t => /聽安排|填好/.test(t)).join());
      w.APP.month = '2027-01'; w.pageSchedule(); await wait(100);
      w.dayClick('2027-01-17'); await wait(10);
      w.document.getElementById('avS').value = '09:00'; w.document.getElementById('avE').value = '12:00'; w.document.getElementById('avR').value = 'wd';
      w.availSave('2027-01-17'); await wait(120);
      const mineAv = w.APP.sch.avail.filter(a => a.email === 'a@corp.com');
      if (mineAv.length !== 5 || mineAv[0].start !== '09:00') errors.push('avail whole weekday ' + mineAv.length);
      if (!/可 09:00-12:00/.test(w.document.getElementById('main').textContent)) errors.push('avail on calendar');
      w.confirmMonth(); await wait(100);
    }
    w.go('tickets'); await wait(80);
    console.log('  report link card:', /免登入報修網址/.test(w.document.getElementById('main').textContent));
    w.ticketForm(); await wait(10);
    w.document.querySelector('input[name=tkEq][value="機房"]').click(); await wait(5);
    if (!w.document.querySelector('input[name=tkC][value="主機或 UPS 警示"]')) errors.push('cause follows equipment');
    if (w.document.querySelector('input[name=tkC][value="閘門不開或一直開"]')) errors.push('gate cause hidden for server room');
    w.document.querySelector('input[name=tkC][value="其他"]').click(); await wait(5);
    if (w.document.getElementById('tkSym').style.display === 'none') errors.push('other shows text');
    w.saveTicket(); await wait(20);
    if (!w.document.getElementById('mask').classList.contains('on')) errors.push('other needs text');
    w.document.getElementById('tkSym').value = 'UPS 嗶嗶叫';
    w.saveTicket(); await wait(150); console.log('  ticket ->', w.document.getElementById('toast').textContent);
    w.ticketDetail(w.APP.tickets[0].id); await wait(10);
    w.tkAct(w.APP.tickets[0].id, 'reply'); w.tkGo(w.APP.tickets[0].id, 'reply'); await wait(100);
    w.printTicket(w.APP.tickets[0].id); await wait(150);
    w.APP.tkSub = 'tickets'; w.go('tickets'); await wait(80);
    if (!w.document.querySelector('table.tkt') || !/完修期限/.test(w.document.querySelector('table.tkt').textContent) || !/第一級/.test(w.document.querySelector('table.tkt').textContent)) errors.push('ticket table');
    if (!/故障等級與完修時限/.test(w.document.getElementById('main').textContent)) errors.push('sla card');
    w.APP.tkSub = 'log'; w.go('tickets'); await wait(80);
    w.APP.inspSub = 'fill'; w.go('insp'); await wait(80);
    if (w.APP.insp.status['每日'].done) { w.APP.inspEdit = '每日'; w.drawInsp(); }
    w.APP.insp.items.filter(i => i.freq === '每日').forEach(i => w.setChk(i.id, '正常'));
    w.submitInsp('每日'); await wait(120); console.log('  insp ->', w.document.getElementById('toast').textContent);
    w.go('sop'); await wait(80); w.sopDetail(w.APP.sops[0].id); await wait(10); w.sopRead(w.APP.sops[0].id); await wait(120);
    w.go('home'); await wait(100);
    console.log('  home after:', w.document.getElementById('main').textContent.replace(/\s+/g, ' ').slice(0, 90));
    w.logout(); await wait(80);
    console.log('  logout ->', !!w.document.getElementById('lgA'));
  }

  // 點表單外面不會關閉（新增帳號打到一半不會消失）
  w = open('Index.html');
  await login(w, 'admin', 'boss1234');
  if (w.document.getElementById('pwO')) { w.closeModal(); }
  w.APP.adminSub = 'people'; w.go('admin'); await wait(80);
  w.personForm(); await wait(10);
  w.document.getElementById('pN').value = '打到一半';
  w.document.getElementById('mask').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  console.log('modal stays:', w.document.getElementById('mask').classList.contains('on'));
  if (!w.document.getElementById('mask').classList.contains('on') || w.document.getElementById('pN').value !== '打到一半') errors.push('modal closed by backdrop');
  // 帳號重複時保留內容，可以改完再送
  w.document.getElementById('pAc').value = 'aming'; w.document.getElementById('pE').value = 'x@corp.com';
  w.personSave(null); await wait(100);
  if (w.document.getElementById('pN').value !== '打到一半' || w.document.getElementById('pGoSave').disabled) errors.push('person form lost on error');
  w.APP.personDraft = null; w.closeModal();
  // 駐點：SOP 沒有新增／編輯／刪除；巡檢沒有編輯入口；附件可下載
  w = open('Index.html');
  await login(w, 'hua', 'pass222');
  if (w.document.getElementById('pwO')) { w.document.getElementById('pwO').value = 'pass222'; w.document.getElementById('pwN').value = 'pass222x'; w.document.getElementById('pwN2').value = 'pass222x'; w.pwSave(); await wait(80); }
  w.go('sop'); await wait(100);
  const staffBtns = () => [...w.document.querySelectorAll('button')].map(b => b.textContent).join('|');
  w.APP.sops[0].atts = [{ name: '手冊.docx', url: 'https://a.public.blob.vercel-storage.com/x.docx', size: 2048 }];
  w.sopDetail(w.APP.sops[0].id); await wait(10);
  const dl = w.document.querySelector('#modal a[href$="?download=1"]');
  if (!dl || /編輯|刪除/.test(staffBtns())) errors.push('staff sop view');
  console.log('staff sop download:', !!dl);
  w.closeModal(); w.go('insp'); await wait(100);
  if (/編輯巡檢項目/.test(w.document.getElementById('main').textContent)) errors.push('staff sees insp edit');

  // 載入失敗不會卡在載入畫面
  w = open('Index.html');
  await login(w, 'hua', 'pass222x');
  w.document.getElementById('main').innerHTML = w.LOADER;
  w.api('api_attendance', '2026-11-30', '2026-11-01', '').catch(() => { });
  await wait(40);
  console.log('load failed retry:', /重新載入/.test(w.document.getElementById('main').textContent), '| bar:', w.document.getElementById('loading').style.display);
  if (!/重新載入/.test(w.document.getElementById('main').textContent) || w.document.getElementById('loading').style.display !== 'none') errors.push('load fail UI');

  // 排班：管理員多選指派；駐點看到清楚說明與請假
  w = open('Index.html');
  await login(w, 'admin', 'boss1234');
  w.go('schedule'); await wait(120);
  if (!/排\s*\d+ 月的班|班表已發布/.test(w.document.querySelector('.notice').textContent)) errors.push('admin schedule notice');
  w.shiftModal('2026-11-20'); await wait(10);
  const boxes = w.document.querySelectorAll('input[name=shWho]');
  if (boxes.length < 3) errors.push('assign list');
  boxes.forEach((b, i) => { b.checked = i < 2; });
  w.saveShift('2026-11-20'); await wait(120);
  const d20 = w.APP.sch.days.find(d => d.date === '2026-11-20');
  if (d20.people.length !== 2) errors.push('multi assign ui');
  w = open('Index.html');
  await login(w, 'hua', 'pass222x');
  await wait(20); w.closeModal();
  w.go('schedule'); await wait(120);
  if (!/排班|班表/.test(w.document.querySelector('.notice').textContent)) errors.push('staff schedule notice');
  w.APP.schSub = 'leave'; w.pageSchedule(); await wait(100);
  if (!/我的請假紀錄/.test(w.document.getElementById('main').textContent)) errors.push('staff leave title');
  w.leaveForm('2026-11-04'); await wait(10);
  w.document.getElementById('lvP').value = 'a@corp.com';
  w.document.getElementById('lvSt').value = '13:00'; w.leaveHint();
  if (!/共 4\.5 小時/.test(w.document.getElementById('lvHint').textContent)) errors.push('leave hours hint ' + w.document.getElementById('lvHint').textContent);
  if (!/未滿 1 週/.test(w.document.getElementById('lvHint').textContent)) errors.push('leave short notice hint');
  w.leaveSend(); await wait(30);
  if (!w.document.getElementById('mask').classList.contains('on')) errors.push('reason required keeps form');
  w.document.getElementById('lvR').value = '看醫生'; w.leaveSend(); await wait(120);
  if (!/看醫生/.test(w.document.getElementById('main').textContent)) errors.push('leave listed');
  w = open('Index.html');
  await login(w, 'admin', 'boss1234');
  w.APP.schSub = 'leave'; w.go('schedule'); await wait(120);
  const mt = w.document.getElementById('main').textContent;
  if (!/全部請假紀錄/.test(mt) || !/待核可/.test(mt) || !/核可/.test(mt)) errors.push('admin leave page');
  w.leaveApprove(w.APP.leaves[0].id); await wait(120);
  if (w.APP.leaves[0].status !== '已核可') errors.push('admin approve ui');
  console.log('schedule+leave ui ok');

  // 改密碼：眼睛可切換顯示
  w = open('Index.html');
  await login(w, 'admin', 'boss1234');
  w.pwForm(); await wait(10);
  for (const id of ['pwO', 'pwN', 'pwN2']) {
    const i = w.document.getElementById(id), b = i.parentNode.querySelector('.eye');
    i.value = 'abc123'; b.click();
    if (i.type !== 'text' || i.value !== 'abc123' || b.title !== '隱藏密碼') errors.push('eye show ' + id);
    b.click();
    if (i.type !== 'password' || i.value !== 'abc123') errors.push('eye hide ' + id);
  }
  w.closeModal();

  // SOP 管理放在「管理」；SOP 頁只看不改
  w = open('Index.html');
  await login(w, 'admin', 'boss1234');
  w.APP.adminSub = 'sop'; w.go('admin'); await wait(120);
  const adTxt = w.document.getElementById('adBody').textContent;
  if (!/新增文件/.test(adTxt) || !/編輯/.test(adTxt) || !/刪除/.test(adTxt)) errors.push('admin sop tab');
  w.sopForm(); await wait(10);
  w.document.getElementById('sCat').value = '測試'; w.document.getElementById('sTitle').value = '新文件X';
  w.sopSave(''); await wait(120);
  if (!/新文件X/.test(w.document.getElementById('adBody').textContent)) errors.push('admin sop add');
  const newId = w.APP.sops.filter(s => s.title === '新文件X')[0].id;
  w.sopDel(newId); await wait(120);
  if (/新文件X/.test(w.document.getElementById('adBody').textContent)) errors.push('admin sop delete');
  w.go('sop'); await wait(100);
  w.sopDetail(w.APP.sops[0].id); await wait(10);
  if (/編輯|刪除/.test(w.document.getElementById('modal').textContent)) errors.push('sop page should be view only');
  w.closeModal();

  // 換頁：看過的頁面不用等；寫入後不會看到舊資料
  let calls = 0;
  const realRun = w.google.script.run;
  w.google.script.run = new Proxy({}, { get(_, k) { return (...a) => { if (k !== 'withSuccessHandler' && k !== 'withFailureHandler') calls++; return realRun[k](...a); }; } });
  w.go('sop'); await wait(0);
  if (w.document.querySelector('.loader')) errors.push('cached page should show at once');
  w.google.script.run = realRun;
  w.clearTimeout(w.APP._pf); // 登入後那一次預先載入不算
  const before = w.CACHE;
  w.sopRead(w.APP.sops[0].id); await wait(100);
  if (w.CACHE === before) errors.push('write should clear cache');
  await wait(1700);
  if (Object.keys(w.CACHE).some(k => k.indexOf('api_getSchedule') === 0)) errors.push('write must not trigger a full prefetch');
  // 背景更新到新資料時要重畫；有開表單就不重畫
  G.api_saveSOP(TA2(), { cat: '測試', title: '別人新增的', content: '', ver: '1' });
  w.go('sop'); await wait(100);
  Object.keys(w.CACHE).forEach(k => { w.CACHE[k].t = 0; });
  w.go('sop'); await wait(100);
  if (!/別人新增的/.test(w.document.getElementById('main').textContent)) errors.push('background refresh should redraw');
  // 預先載入：唯讀資料一次拿回，不接受寫入功能
  w.cacheClear(); w.prefetch(); await wait(80);
  if (!Object.keys(w.CACHE).some(k => k.indexOf('api_home') === 0) || !Object.keys(w.CACHE).some(k => k.indexOf('api_getSchedule') === 0)) errors.push('prefetch');
  const tk = w.APP.token, br = G.api_batch(tk, [['api_deleteSOP', [newId]], ['api_listSOP', []]]);
  if (!br[0].error || !br[1].ok) errors.push('batch whitelist');
  console.log('cache+prefetch ok');

  // 新功能頁
  w = open('Index.html');
  await login(w, 'admin', 'boss1234');
  const ids = v => w.document.getElementById(v);
  w.go('tasks'); await wait(100);
  w.taskForm(); await wait(5);
  ids('taN').value = '盤點備料'; ids('taF').value = '蔡總'; ids('taO').value = 'a@corp.com'; ids('taD').value = '2026-11-20';
  w.taskSave(''); await wait(120);
  if (!/盤點備料/.test(ids('main').textContent) || !/蔡總/.test(ids('main').textContent)) errors.push('task list');
  w.taskDetail(w.APP.tasks[0].id); await wait(5); ids('taT').value = '進行中'; w.taskAct(w.APP.tasks[0].id, 'note'); await wait(120);
  if (w.APP.tasks[0].status !== '處理中') errors.push('task progress');
  w.go('stock'); await wait(100);
  w.stockForm(); await wait(5);
  ids('skN').value = '感熱紙'; ids('skF').value = '5'; ids('skQ').value = '6'; w.stockSave(''); await wait(120);
  if (!/感熱紙/.test(ids('main').textContent)) errors.push('stock list');
  w.stockMoveForm(w.APP.stock.items[0].id, '領用'); await wait(5); ids('smQ').value = '2'; w.stockMoveGo(w.APP.stock.items[0].id, '領用'); await wait(120);
  if (!/庫存偏低/.test(ids('main').textContent)) errors.push('stock low notice');
  w.APP.stockSub = 'moves'; w.drawStock(); if (!/領用/.test(ids('main').textContent)) errors.push('stock moves');
  w.go('board'); await wait(100);
  w.noticeForm(); await wait(5); ids('nT').value = '歲修通知'; ids('nB').value = '<b>不轉義就錯</b>'; w.noticeSave(''); await wait(120);
  if (!/歲修通知/.test(ids('main').textContent) || w.document.querySelector('.post b b')) errors.push('notice list/escape');
  w.APP.boardSub = 'talk'; w.drawBoard(); w.topicForm(); await wait(5); ids('dT').value = '交接'; ids('dB').value = '鑰匙放哪'; w.topicSave(); await wait(120);
  const tp = w.APP.board.topics[0]; ids('rp_' + tp.id).value = '櫃子'; w.talkReply(tp.id); await wait(120);
  if (w.APP.board.topics[0].replies.length !== 1) errors.push('reply');
  w.moreMenu(); await wait(5); if (!/交辦/.test(ids('modal').textContent)) errors.push('more menu'); w.closeModal();
  w.go('home'); await wait(100);
  if (!/交辦事項未完成/.test(ids('main').textContent) || !/庫存偏低/.test(ids('main').textContent) || !/歲修通知/.test(ids('main').textContent)) errors.push('home new todos');
  // 巡檢：三層分組、檢查列表、取消勾選＝異常
  w.go('insp'); await wait(100);
  if (!w.document.querySelector('.major') || !w.document.querySelector('.minor') || !w.document.querySelector('.ln input')) errors.push('insp tree');
  w.APP.inspEdit = '每日'; w.drawInsp();
  const it = w.APP.insp.items.find(i => i.freq === '每日' && i.checks.length);
  w.APP.insp.items.filter(i => i.freq === '每日').forEach(i => w.setChk(i.id, '正常'));
  w.setLine(it.id, 0, false);
  if (w.APP.inspDraft[it.id].result !== '異常') errors.push('unchecking marks abnormal');
  w.submitInsp('每日'); await wait(150);
  const autoTk = G.api_listTickets(G.api_login('admin', 'boss1234').token, { open: true }).find(t => t.source === '巡檢');
  if (!autoTk) errors.push('insp auto ticket ui');
  // 巡檢設定：新增自訂週期
  w.APP.adminSub = 'items'; w.go('admin'); await wait(100);
  w.itemForm(); await wait(5);
  ids('iF').value = 'custom'; ids('iN').value = '14'; ids('iM').value = '現場設備'; ids('iA').value = '閘門'; ids('iI').value = '潤滑'; ids('iC').value = '軌道\n上油';
  w.itemSave(''); await wait(150);
  if (!/每14天/.test(ids('adBody').textContent)) errors.push('custom cycle item');
  // 統計與下載
  w.APP.adminSub = 'stats'; w.go('admin'); await wait(100);
  if (!/實際工時/.test(ids('adBody').textContent) && !/還沒有資料/.test(ids('adBody').textContent)) errors.push('stats page');
  let csv = null;
  w.URL.createObjectURL = b => { csv = b; return 'blob:x'; }; w.URL.revokeObjectURL = () => { };
  w.statCsv(true); await wait(5);
  if (!csv) errors.push('csv download');
  // 叫修選單
  w.APP.adminSub = 'menu'; w.go('admin'); await wait(100);
  w.menuForm('單位'); await wait(5); ids('mN').value = '測試單位'; ids('mX').value = '082-111'; w.menuSave('單位', ''); await wait(120);
  if (!w.APP.init.menu.units.some(u => u.name === '測試單位')) errors.push('menu add');
  w.go('tickets'); await wait(100); w.ticketForm(); await wait(5);
  ids('tkUnit').value = '測試單位'; w.tkUnitPick();
  if (ids('tkPhone').value !== '082-111') errors.push('phone auto fill');
  w.closeModal();
  console.log('new pages ok');

  // 記住登入：localStorage 有 token 直接進入
  w = open('Index.html');
  await login(w, 'hua', 'pass222x');
  const saved = w.localStorage.getItem('kos_token');
  console.log('token saved:', !!saved);

  // 報修頁
  w = open('Report.html', '?p=report');
  await wait(60);
  console.log('report page hotline:', w.document.getElementById('hotline').textContent, '| equip:', w.document.querySelectorAll('input[name=eq]').length);
  w.send(); await wait(10); console.log('  empty ->', w.document.getElementById('err').textContent);
  w.document.getElementById('rUnit').value = '測試單位'; w.unitPick();
  if (w.document.getElementById('rPhone').value !== '082-111') errors.push('report phone auto fill');
  w.document.querySelector('input[name=eq][value="閘門"]').click(); await wait(5);
  w.document.querySelector('input[name=ca][value="閘門不開或一直開"]').click(); await wait(5);
  if (!/完修/.test(w.document.getElementById('imps').textContent)) errors.push('report shows fix time');
  w.send(); await wait(150);
  if (!/內完修/.test(w.document.querySelector('.done').textContent)) errors.push('report promise');
  console.log('  sent ->', w.document.querySelector('.done .id') && w.document.querySelector('.done .id').textContent);

  console.log('\nERRORS:', errors.length ? errors : 'none');
  process.exit(errors.length ? 1 : 0);
})();
