const { chromium } = require('playwright');
const URL = process.argv[2] || 'http://localhost:4173/';
const O = '/tmp/vis/b03/';
const loaded = () => document.querySelector('#loading').classList.contains('hidden') && document.querySelectorAll('.kpi').length === 4;
const args = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const log = (...a) => console.log(...a);
(async () => {
  require('fs').mkdirSync(O, { recursive: true });
  const b = await chromium.launch({ proxy: { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' }, args });
  const errs = [];
  const p = await b.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5 });
  p.on('pageerror', (e) => errs.push(e.message));
  const kpis = () => p.$$eval('.kpi .value', (a) => a.map((x) => x.textContent.trim()).join(' | '));
  const chips = () => p.textContent('#active-chips');
  await p.goto(URL);
  await p.waitForFunction(loaded, null, { timeout: 90000 });
  await p.waitForTimeout(4000);

  // Journey 1: overview (Debris filter) -> View A -> plane -> satellite -> back
  await p.selectOption('#objtype', 'Debris');
  await p.waitForTimeout(2500);
  const k0 = await kpis(), c0 = await chips();
  log('STEP1 overview  chips:', c0, '| kpis:', k0);
  await p.screenshot({ path: O + 'j1_overview_start.png' });
  await p.click('[data-go-view=where]');
  await p.waitForTimeout(2500);
  log('STEP2 view A    chips:', await chips(), '| hash:', await p.evaluate(() => location.hash), '| crumbs:', (await p.textContent('#crumbs')).replace(/\s+/g, ' '));
  log('  where summary:', await p.textContent('#where-summary'));
  log('  reconciliation:', (await p.textContent('#where-check')).replace(/\s+/g, ' '));
  await p.screenshot({ path: O + 'ex2_viewA.png' });
  await p.click('.plane-row[data-pl="1"]');
  await p.waitForTimeout(2000);
  await p.click('.sat-row');
  await p.waitForTimeout(2500);
  log('  selected sat card:', (await p.textContent('#selection')).replace(/\s+/g, ' ').slice(0, 140));
  await p.screenshot({ path: O + 'ex2_viewA_plane1_selected.png' });
  await p.click('#crumb-back');
  await p.waitForTimeout(2500);
  const k1 = await kpis(), c1 = await chips();
  log('STEP3 back      chips:', c1, '| kpis:', k1, '| SAME:', k0 === k1 && c0 === c1);
  await p.screenshot({ path: O + 'j3_back_overview.png' });

  // Journey 2: -> View B -> source -> event; browser back
  await p.click('[data-go-view=why]');
  await p.waitForTimeout(2000);
  log('STEP4 view B    chips:', await chips(), '| hash:', await p.evaluate(() => location.hash));
  log('  annotation:', (await p.textContent('.annot')).replace(/\s+/g, ' '));
  await p.screenshot({ path: O + 'ex3_viewB.png' });
  await p.click('.src-row');
  await p.waitForTimeout(800);
  await p.evaluate(() => document.getElementById('src-events').scrollIntoView({ block: 'center' }));
  await p.screenshot({ path: O + 'ex3_viewB_source_selected.png' });
  await p.goBack();
  await p.waitForTimeout(2500);
  const k2 = await kpis();
  log('STEP5 browser back -> hash:', await p.evaluate(() => location.hash), '| overview visible:', await p.$eval('#view-overview', (e) => !e.classList.contains('hidden')), '| kpis same:', k2 === k0);

  // Empty selection in View A
  await p.selectOption('#plane', '1');
  await p.selectOption('#objtype', 'Rocket body');
  await p.click('[data-go-view=where]');
  await p.waitForTimeout(2500);
  log('EMPTY view A:', (await p.textContent('#view-where')).replace(/\s+/g, ' ').slice(0, 160));
  await p.screenshot({ path: O + 'ex4_empty_viewA.png' });
  await p.click('#reset');
  await p.waitForTimeout(2500);
  log('after reset in view A: chips', await chips(), '| still view A:', await p.$eval('#view-where', (e) => !e.classList.contains('hidden')));
  await p.screenshot({ path: O + 'viewA_default.png' });
  // keyboard in view A
  await p.focus('#crumb-back');
  const seq = [];
  for (let i = 0; i < 6; i++) { await p.keyboard.press('Tab'); seq.push(await p.evaluate(() => { const a = document.activeElement; return a.dataset.pl ? `plane ${a.dataset.pl}` : (a.id || a.textContent.trim().slice(0, 20)); })); }
  log('tab order view A:', seq.join(' → '));
  await p.keyboard.press('Enter');
  await p.waitForTimeout(800);
  log('Enter on focused plane row -> selected:', await p.$$eval('.plane-row.sel', (a) => a.map((x) => x.dataset.pl).join(',')));
  await p.close();

  // narrow
  const n = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  n.on('pageerror', (e) => errs.push(e.message));
  await n.goto(URL + '#where');
  await n.waitForFunction(loaded, null, { timeout: 90000 });
  await n.waitForTimeout(3000);
  await n.evaluate(() => document.querySelector('#crumbs').scrollIntoView());
  await n.screenshot({ path: O + 'ex4_narrow_viewA.png' });
  log('narrow A overflow:', await n.evaluate(() => document.documentElement.scrollWidth - innerWidth));
  await n.click('#crumb-back');
  await n.click('[data-go-view=why]');
  await n.waitForTimeout(1500);
  await n.evaluate(() => document.querySelector('#crumbs').scrollIntoView());
  await n.screenshot({ path: O + 'ex4_narrow_viewB.png' });
  log('narrow B overflow:', await n.evaluate(() => document.documentElement.scrollWidth - innerWidth));
  log('page errors:', errs.length ? errs.join(' | ') : 'none');
  await b.close();
})();
