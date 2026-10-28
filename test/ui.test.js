const { JSDOM } = require('jsdom');
const fs = require('fs');
const env = require('./env.js');
const { G, setNow, as } = env;
setNow('2026-11-02 09:00');
G.setup(); as('boss@corp.com');
G.api_savePerson({ email: 'a@corp.com', name: '阿明', role: '駐點' });
G.api_savePerson({ email: 'b@corp.com', name: '小華', role: '駐點' });
G.api_autoSchedule('2026-11', true); G.api_publish('2026-11');
G.api_createTicket({ equip: '閘門', symptom: '讀不到', level: '1' });
const html = fs.readFileSync(__dirname + '/../src/Index.html', 'utf8');
const errors = [];
function open(user) {
  as(user);
  const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'https://x.test/', beforeParse(w) {
    w.alert = () => {}; w.confirm = () => true; w.print = () => {};
    const run = {};
    const mk = (s, f) => new Proxy({}, { get(_, k) {
      if (k === 'withSuccessHandler') return h => mk(h, f);
      if (k === 'withFailureHandler') return h => mk(s, h);
      return (...a) => setTimeout(() => { try { const r = JSON.parse(JSON.stringify(G[k](...a) ?? null)); s && s(r); } catch (e) { errors.push(k + ': ' + e.message); f && f(e); } }, 0);
    } });
    w.google = { script: { run: mk(null, null) } };
    w.addEventListener('error', e => errors.push('JS: ' + e.message));
  } });
  return dom.window;
}
const wait = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  for (const user of ['boss@corp.com', 'a@corp.com']) {
    const w = open(user); await wait(80);
    const txt = () => w.document.getElementById('main').textContent;
    console.log('==', user, '| nav:', w.document.getElementById('nav').textContent);
    console.log(' home:', txt().slice(0, 120).replace(/\s+/g, ' '));
    for (const p of ['schedule', 'tickets', 'insp', 'sop'].concat(user.startsWith('boss') ? ['admin'] : [])) {
      w.go(p); await wait(80);
      console.log(' ', p, ':', txt().slice(0, 90).replace(/\s+/g, ' '));
    }
    // 互動
    w.go('schedule'); await wait(60);
    w.dayClick('2026-11-20'); await wait(30);
    if (user.startsWith('a')) { w.document.getElementById('unReason').value = '測試'; w.saveUnavail('2026-11-20'); await wait(80); console.log('  unavail ->', w.document.getElementById('toast').textContent); }
    else { w.document.getElementById('shWho').value = 'b@corp.com'; w.saveShift('2026-11-20'); await wait(80); console.log('  setShift ->', w.document.getElementById('toast').textContent); }
    w.go('tickets'); await wait(60); w.ticketForm(); await wait(10);
    w.document.querySelector('input[name=tkEq][value="機房"]').checked = true; w.document.getElementById('tkSym').value = 'UPS 嗶嗶叫';
    w.saveTicket(); await wait(120); console.log('  ticket ->', w.document.getElementById('toast').textContent);
    w.ticketDetail(w.APP.tickets[0].id); await wait(10); console.log('  detail ->', w.document.getElementById('modal').textContent.slice(0, 60));
    w.tkAct(w.APP.tickets[0].id, 'reply'); w.tkGo(w.APP.tickets[0].id, 'reply'); await wait(100);
    w.printTicket(w.APP.tickets[0].id); await wait(150);
    w.APP.tkSub = 'log'; w.go('tickets'); await wait(80); console.log('  log rows:', w.document.querySelectorAll('#tkBody tr').length);
    w.APP.inspSub = 'fill'; w.go('insp'); await wait(80); if (w.APP.insp.status['每日'].done) { w.APP.inspEdit='每日'; w.drawInsp(); } w.allOk('每日');
    w.APP.insp.items.filter(i => i.freq === '每日').forEach(i => w.setChk(i.id, '正常'));
    w.submitInsp('每日'); await wait(120); console.log('  insp ->', w.document.getElementById('toast').textContent);
    w.APP.inspSub = 'hist'; w.go('insp'); await wait(80); w.printHist(0); await wait(150);
    w.go('sop'); await wait(80); w.sopDetail(w.APP.sops[0].id); await wait(10); w.sopRead(w.APP.sops[0].id); await wait(120);
    w.APP.sopQ = '發票'; w.drawSop(); console.log('  sop search 發票:', w.document.querySelectorAll('#main .list-item').length);
    if (user.startsWith('boss')) {
      w.sopForm(w.APP.sops[0].id); await wait(10); w.sopSave(w.APP.sops[0].id); await wait(100);
      for (const s of ['people', 'settings', 'items', 'report']) { w.APP.adminSub = s; w.go('admin'); await wait(80); }
      w.makeDoc('2026-11'); await wait(120); console.log('  report doc ->', !!w.document.querySelector('a[href*="DOC1"]'));
      w.APP.adminSub = 'settings'; w.go('admin'); await wait(60); w.saveSettings(); await wait(80);
      w.go('schedule'); await wait(60); w.autoSchedule(); await wait(100); w.publishSchedule(); await wait(100); w.printSchedule(); await wait(150);
    }
    w.go('home'); await wait(80);
    console.log('  calendar cells:', (w.go('schedule'), await wait(80), w.document.querySelectorAll('.cal .d').length));
  }
  console.log('\nERRORS:', errors.length ? errors : 'none');
})();
