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
      w.dayClick('2026-12-05'); await wait(10); w.adminSelfOff('2026-12-05', false); await wait(100);
      w.dayClick('2026-12-06'); await wait(10); w.document.getElementById('shWho').value = 'b@corp.com'; w.saveShift('2026-12-06'); await wait(100);
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
      for (const s of ['settings', 'items', 'report']) { w.APP.adminSub = s; w.go('admin'); await wait(90); }
      w.APP.adminSub = 'settings'; w.go('admin'); await wait(60); w.saveSettings(); await wait(80);
      w.go('sop'); await wait(80); w.sopForm(w.APP.sops[0].id); await wait(10);
      console.log('  sop upload ui:', !!w.document.getElementById('sFile'));
      w.sopSave(w.APP.sops[0].id); await wait(100);
    } else {
      w.dayClick('2026-11-20'); await wait(20); w.document.getElementById('unReason').value = '測試'; w.saveUnavail('2026-11-20'); await wait(100);
      console.log('  unavail ->', w.document.getElementById('toast').textContent);
      w.APP.month = '2026-12'; w.pageSchedule(); await wait(100);
      console.log('  Dec staff sees:', w.APP.sch.visible, '| button:', [...w.document.querySelectorAll('#main button')].map(b => b.textContent).filter(t => /聽安排|登記好/.test(t)).join());
      w.confirmMonth(); await wait(100);
    }
    w.go('tickets'); await wait(80);
    console.log('  report link card:', /免登入報修網址/.test(w.document.getElementById('main').textContent));
    w.ticketForm(); await wait(10);
    w.document.querySelector('input[name=tkEq][value="機房"]').checked = true; w.document.getElementById('tkSym').value = 'UPS 嗶嗶叫';
    w.saveTicket(); await wait(150); console.log('  ticket ->', w.document.getElementById('toast').textContent);
    w.ticketDetail(w.APP.tickets[0].id); await wait(10);
    w.tkAct(w.APP.tickets[0].id, 'reply'); w.tkGo(w.APP.tickets[0].id, 'reply'); await wait(100);
    w.printTicket(w.APP.tickets[0].id); await wait(150);
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
  w.document.getElementById('rName').value = '陳小姐';
  w.document.querySelector('input[name=eq][value="閘門"]').checked = true;
  w.document.getElementById('rSym').value = '閘門不開';
  w.send(); await wait(150);
  console.log('  sent ->', w.document.querySelector('.done .id') && w.document.querySelector('.done .id').textContent);

  console.log('\nERRORS:', errors.length ? errors : 'none');
  process.exit(errors.length ? 1 : 0);
})();
