const { chromium } = require('playwright');
const URL = process.argv[2] || 'http://localhost:4173/';
const O = '/tmp/vis/b02/';
const loaded = () => document.querySelector('#loading').classList.contains('hidden') && document.querySelectorAll('.kpi').length === 4;
const args = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
(async () => {
  require('fs').mkdirSync(O, { recursive: true });
  const b = await chromium.launch({ proxy: { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' }, args });
  const errs = [];
  const log = (...a) => console.log(...a);

  // ---- desktop ----
  const p = await b.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5 });
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(URL);
  await p.waitForFunction(loaded, null, { timeout: 90000 });
  await p.waitForTimeout(5000);
  await p.screenshot({ path: O + 'ex2_overview_default.png' });
  log('default kpis:', await p.$$eval('.kpi .value', (a) => a.map((x) => x.textContent.trim())));
  await p.click('.defs summary');
  await p.waitForTimeout(300);
  await p.screenshot({ path: O + 'ex2_metric_definitions.png' });
  await p.click('.defs summary');

  // filtered: plane 5, payloads
  await p.selectOption('#plane', '5');
  await p.selectOption('#objtype', 'Payload');
  await p.waitForFunction(() => document.querySelectorAll('.kpi').length === 4 && document.querySelector('#kpis').textContent.includes('31 close'), null, { timeout: 30000 }).catch(() => {});
  await p.waitForTimeout(2500);
  await p.screenshot({ path: O + 'ex3_filtered_plane5_payload.png' });
  log('filtered kpis:', JSON.stringify(await p.$$eval('.kpi', (a) => a.map((x) => [x.querySelector('.label').textContent, x.querySelector('.value').textContent.trim(), x.querySelector('.delta').textContent.trim(), x.title]))));
  log('filtered decision:', await p.textContent('#decision'));
  log('chips:', await p.textContent('#active-chips'));

  // empty state: plane 1, rocket body
  await p.selectOption('#plane', '1');
  await p.selectOption('#objtype', 'Rocket body');
  await p.waitForTimeout(3000);
  await p.screenshot({ path: O + 'ex3_empty_state.png' });
  log('empty kpis:', await p.textContent('#kpis'));
  await p.click('.tabs button[data-t=charts]');
  await p.waitForTimeout(800);
  await p.screenshot({ path: O + 'ex3_empty_state_charts.png' });
  await p.click('#reset');
  await p.waitForTimeout(2500);
  log('after reset chips:', await p.textContent('#active-chips'), '| reset hidden:', await p.$eval('#reset', (e) => e.classList.contains('hidden')));
  await p.click('.tabs button[data-t=charts]');
  await p.click('#charts-open-dummy').catch(() => {});
  await p.$$eval('.table-alt', (a) => a.forEach((d) => { d.open = true; }));
  await p.waitForTimeout(500);
  await p.screenshot({ path: O + 'ex4_desktop_charts_text_alt.png' });
  log('weekly summary:', await p.textContent('#weekly-summary'));
  log('sources summary:', await p.textContent('#sources-summary'));

  // keyboard walk
  await p.click('.tabs button[data-t=overview]');
  await p.focus('#period button');
  const seq = [];
  for (let i = 0; i < 9; i++) { seq.push(await p.evaluate(() => { const a = document.activeElement; return (a.id || a.dataset.t || a.dataset.p || a.textContent.trim().slice(0, 24)); })); await p.keyboard.press('Tab'); }
  log('tab order:', seq.join(' → '));
  // keyboard: focus Charts tab and press Enter
  await p.focus('.tabs button[data-t=charts]');
  await p.keyboard.press('Enter');
  await p.waitForTimeout(400);
  log('Enter on Charts tab ->', await p.$eval('.tab[data-t=charts]', (e) => !e.classList.contains('hidden')));
  await p.focus('.tabs button[data-t=top]');
  await p.keyboard.press('Enter');
  await p.waitForTimeout(400);
  await p.focus('.row');
  await p.keyboard.press('Enter');
  await p.waitForTimeout(2500);
  log('Enter on top row -> selection visible:', await p.$eval('#selection', (e) => !e.classList.contains('hidden')));
  await p.focus('.tabs button[data-t=top]');
  await p.screenshot({ path: O + 'ex4_keyboard_focus.png' });
  await p.close();

  // ---- narrow ----
  const n = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  n.on('pageerror', (e) => errs.push(e.message));
  await n.goto(URL);
  await n.waitForFunction(loaded, null, { timeout: 90000 });
  await n.waitForTimeout(4000);
  await n.screenshot({ path: O + 'ex4_narrow_top.png' });
  await n.evaluate(() => document.querySelector('#panel').scrollIntoView());
  await n.screenshot({ path: O + 'ex4_narrow_panel.png' });
  await n.click('.tabs button[data-t=charts]');
  await n.$$eval('.table-alt', (a) => { a[0].open = true; });
  await n.waitForTimeout(600);
  await n.evaluate(() => document.querySelector('.tabs').scrollIntoView());
  await n.screenshot({ path: O + 'ex4_after_narrow_charts.png' });
  log('narrow horizontal overflow px:', await n.evaluate(() => document.documentElement.scrollWidth - innerWidth));
  await n.close();

  // ---- loading + error (controlled simulation) ----
  const e = await b.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await e.route('**/rest/v1/**', async (r) => { await new Promise((ok) => setTimeout(ok, 4000)); r.continue().catch(() => {}); });
  await e.goto(URL);
  await e.waitForTimeout(1500);
  await e.screenshot({ path: O + 'ex4_loading.png' });
  log('loading visible:', await e.$eval('#loading', (x) => !x.classList.contains('hidden')));
  await e.unrouteAll({ behavior: 'ignoreErrors' });
  await e.route('**/rest/v1/**', (r) => r.fulfill({ status: 503, body: 'down' }));
  await e.reload();
  await e.waitForTimeout(3000);
  await e.screenshot({ path: O + 'ex4_error.png' });
  log('error text:', await e.textContent('#error-msg'));
  await e.unroute('**/rest/v1/**');
  await e.click('#retry');
  await e.waitForFunction(loaded, null, { timeout: 90000 });
  log('retry recovered:', true);
  await e.close();

  log('page errors:', errs.length ? errs.join(' | ') : 'none');
  await b.close();
})();
