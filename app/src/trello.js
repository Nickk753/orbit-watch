// Session 03 · Exercise 2 — segment bar → menu (Explore / Assign investigation) → edit → review → confirm → card → verify.
import { state, PERIODS } from './main.js';

const $ = (id) => document.getElementById(id);
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let menuCtx = null; // { seg, explore }
let current = null; // { seg, requestId, link }
let config = null;

const segName = (s) => (s.kind === 'plane' ? `Plane ${s.value}` : s.label);
function segScope(s) {
  return `${s.kind === 'plane' ? `Plane ${s.value}` : `Source: ${esc(s.label)}${s.plane ? ` · Plane ${s.plane}` : ''}`} · ${esc(PERIODS[s.period].label)} · ${s.objType ? `Other object: ${esc(s.objType)}` : 'All objects'}`;
}
function segLink(s) {
  const q = new URLSearchParams({ period: s.period });
  if (s.kind === 'plane') q.set('plane', s.value); else if (s.plane) q.set('plane', s.plane);
  if (s.objType) q.set('obj', s.objType);
  return `${location.origin}/?${q}#${s.kind === 'plane' ? 'where' : 'why'}`;
}

// ----- segment menu (called from the plane / source bars in main.js) -----
export function openSegMenu(btn, seg, explore) {
  menuCtx = { seg, explore };
  const m = $('seg-menu');
  m.querySelector('.menu-h').textContent = segName(seg);
  $('seg-menu-explore').textContent = seg.kind === 'plane' ? '🔍 Explore its satellites' : '🔍 Explore its riskiest events';
  const r = btn.getBoundingClientRect();
  m.style.left = `${Math.max(8, Math.min(r.left + 40, innerWidth - 240))}px`;
  m.style.top = `${Math.min(r.bottom + 4, innerHeight - 140)}px`;
  m.classList.remove('hidden');
  $('seg-menu-explore').focus();
}
const closeMenu = () => $('seg-menu').classList.add('hidden');

function draft(s) {
  const p = PERIODS[s.period];
  const scope = s.objType ? `, ${s.objType.toLowerCase()} only` : '';
  return s.kind === 'plane'
    ? { title: `Investigate plane ${s.value} collision risk (${p.label.split(' (')[0].toLowerCase()})`, description: `Plane ${s.value} has ${s.stats}. ${p.label}${scope}.\n\nPlease check:\n1. Are the high-risk close approaches on the same few satellites?\n2. Is fresh tracking (new CDMs) available that could lower or confirm their Pc?\n3. Which ones need a maneuver decision this week?\n\nOwner: flight dynamics. Due: before the earliest high-risk TCA.` }
    : { title: `Investigate rising risk from ${s.label} (next 30 days)`, description: `Objects from ${s.label} show ${s.stats} in the next 30 days${scope}.\n\nPlease check:\n1. Is the rise from closer approaches or just more of them?\n2. Is the tracking for these objects recent and consistent?\n3. Which satellites are most exposed?\n\nOwner: space situational awareness analyst.` };
}
function step(n) { ['as-edit', 'as-review', 'as-result'].forEach((id, i) => $(id).classList.toggle('hidden', i !== n)); }

async function loadConfig() {
  const el = $('as-conn');
  el.className = 'conn'; el.textContent = 'Checking the Trello connection…';
  try {
    const r = await fetch('/api/assign-investigation', { cache: 'no-store' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    config = await r.json();
    if (!config.configured) {
      el.className = 'conn warn';
      el.innerHTML = `<b>Trello is not connected yet.</b> Missing or invalid server settings: ${config.missing.map((m) => `<code>${m}</code>`).join(', ')}. Add them in Vercel (project orbit-watch) → Settings → Environment Variables, then redeploy. No card can be created until then.${config.list ? `<br/>Trello: ${esc(config.provider)}` : ''}`;
    } else if (!config.list) {
      el.className = 'conn warn'; el.innerHTML = `<b>Trello:</b> ${esc(config.provider)}`;
    } else {
      el.className = 'conn ok';
      el.innerHTML = `<b>Trello:</b> ${esc(config.provider)}<br/><b>Destination:</b> board “${esc(config.board)}” → list “${esc(config.list)}”${config.list_closed ? ' (archived!)' : ''}`;
    }
  } catch (e) {
    config = null; el.className = 'conn warn';
    el.innerHTML = `<b>Could not reach the Trello service</b> (${esc(e.message)}).`;
  }
}

function openAssign(seg) {
  current = { seg, requestId: crypto.randomUUID(), link: segLink(seg) };
  const d = draft(seg);
  $('as-seg').innerHTML = `<b>${esc(segName(seg))}</b>: ${esc(seg.stats)}`;
  $('as-scope').innerHTML = segScope(seg);
  $('as-title').value = d.title;
  $('as-desc').value = d.description;
  $('as-phrase').value = $('share-phrase')?.value || '';
  $('as-err').textContent = '';
  step(0);
  $('assign').showModal();
  loadConfig();
}

function review() {
  const title = $('as-title').value.trim(), desc = $('as-desc').value.trim();
  const err = !title ? 'Enter a title.' : !desc ? 'Enter a description.' : !$('as-phrase').value ? 'Enter the lab phrase.' : '';
  $('as-err').textContent = err;
  if (err) return;
  $('asr-dest').textContent = config?.list ? `${config.board} → ${config.list}` : '(not connected)';
  $('asr-title').textContent = title;
  $('asr-scope').innerHTML = segScope(current.seg);
  $('asr-link').textContent = current.link;
  $('asr-req').textContent = current.requestId;
  $('asr-desc').textContent = desc;
  $('asr-warn').textContent = config && !config.configured ? 'Trello is not connected: confirming will show the missing settings and create nothing.' : '';
  step(1);
  $('as-confirm').focus();
}

async function confirmCreate() {
  const btn = $('as-confirm');
  btn.disabled = true; btn.textContent = 'Creating…';
  const s = current.seg;
  const body = { confirm: true, request_id: current.requestId, lab_phrase: $('as-phrase').value, title: $('as-title').value.trim(), description: $('as-desc').value.trim(), link: current.link,
    segment: { kind: s.kind, value: s.value, plane: s.plane, period: s.period, objType: s.objType } };
  let r, j;
  try { r = await fetch('/api/assign-investigation', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); j = await r.json().catch(() => ({})); }
  catch (e) { r = { ok: false, status: 0 }; j = { message: `Network error (${e.message}). Check your Trello list before trying again.` }; }
  btn.disabled = false; btn.textContent = 'Confirm and create card';
  const out = $('as-out');
  if (r.ok && j.ok) {
    out.className = 'result ok';
    out.innerHTML = `<b>Card created in Trello.</b> A card asks for an investigation; it does not resolve the risk.
      <dl><dt>Card</dt><dd><a href="${esc(j.url)}" target="_blank" rel="noopener">${esc(j.url)}</a></dd><dt>List</dt><dd>${esc(j.list || '')}</dd>
      <dt>Segment</dt><dd>${esc(j.segment)}</dd><dt>Records</dt><dd>${esc(j.snapshot.top.join(', ') || 'none elevated')}</dd>
      <dt>Action request</dt><dd><code>${esc(j.request_id)}</code></dd><dt>Read-back</dt><dd>${j.readback.match ? '✓ title, description and list match what you approved' : '⚠ read-back did not match, open the card and compare'}</dd></dl>
      <button type="button" class="btn" id="as-verify">Read the card again</button> <span id="as-verify-out" class="hint"></span>`;
    $('as-verify').onclick = () => verify(j.id);
  } else {
    out.className = 'result bad';
    out.innerHTML = `<b>No card created.</b> ${esc(j.message || `HTTP ${r.status}`)}${j.missing ? `<br/>Missing: ${j.missing.map((m) => `<code>${m}</code>`).join(', ')}` : ''}`;
  }
  step(2);
}

async function verify(id) {
  const o = $('as-verify-out');
  o.textContent = 'Reading…';
  const r = await fetch(`/api/assign-investigation?id=${encodeURIComponent(id)}`, { cache: 'no-store' });
  const j = await r.json().catch(() => ({}));
  o.innerHTML = r.ok ? `Trello says: “${esc(j.name)}” in list <b>${esc(j.list)}</b> on board ${esc(j.board)} · last activity ${esc(j.last_activity)}` : `Read-back failed: ${esc(j.message || j.error || `HTTP ${r.status}`)}`;
}

export function bindTrello() {
  $('seg-menu-explore').addEventListener('click', () => { closeMenu(); menuCtx?.explore(); });
  $('seg-menu-assign').addEventListener('click', () => { closeMenu(); openAssign(menuCtx.seg); });
  document.addEventListener('click', (e) => { if (!e.target.closest('#seg-menu') && !e.target.closest('.plane-row, .src-row')) closeMenu(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });
  $('as-review-btn').addEventListener('click', review);
  $('as-back').addEventListener('click', () => step(0));
  $('as-confirm').addEventListener('click', confirmCreate);
  document.querySelectorAll('[data-as-cancel]').forEach((b) => b.addEventListener('click', () => {
    $('assign').close();
    const t = $('share-toast'); t.textContent = 'Cancelled. No card was created.'; t.classList.remove('hidden'); setTimeout(() => t.classList.add('hidden'), 3500);
  }));
  $('as-done').addEventListener('click', () => $('assign').close());
  void state;
}
