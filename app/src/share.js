// Session 03 · Exercise 1 — KPI context menu → "Share finding" → edit → review → confirm → send → verify.
import { state, PERIODS, scopeText } from './main.js';

const $ = (id) => document.getElementById(id);
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const OBJ = ['Debris', 'Payload', 'Rocket body'];
let current = null; // { tile, scope, link, requestId }
let config = null;

// ----- filters in the URL, so an emailed link opens the same scope -----
export function readUrlScope() {
  const q = new URLSearchParams(location.search);
  if (PERIODS[q.get('period')]) state.period = q.get('period');
  const pl = Number(q.get('plane'));
  if (pl >= 1 && pl <= 6) { state.plane = pl; state.focusPlane = pl; }
  if (OBJ.includes(q.get('obj'))) state.objType = q.get('obj');
  $('plane').value = state.plane || '';
  $('objtype').value = state.objType || '';
  document.querySelectorAll('#period button').forEach((x) => x.classList.toggle('on', x.dataset.p === state.period));
}
function scopeLink() {
  const q = new URLSearchParams({ period: state.period });
  if (state.plane) q.set('plane', state.plane);
  if (state.objType) q.set('obj', state.objType);
  return `${location.origin}/?${q}`;
}

// ----- KPI context menu -----
function closeMenu() { $('kpi-menu').classList.add('hidden'); }
function openMenu(btn) {
  const m = $('kpi-menu');
  m.dataset.kpi = btn.dataset.kpi;
  const r = btn.getBoundingClientRect();
  m.style.left = `${Math.min(r.left, innerWidth - 230)}px`;
  m.style.top = `${r.bottom + 4}px`;
  m.classList.remove('hidden');
  m.querySelector('button').focus();
}

// ----- dialog -----
function draft(t) {
  const p = PERIODS[state.period];
  return {
    subject: `Orbit Watch: ${t.label} ${t.value} ${t.unit} (${p.label}, ${scopeText()})`,
    message: `Hi,\n\nFinding from the Orbit Watch overview.\n\n${t.label}: ${t.value} ${t.unit}, ${t.dir} from ${t.cmp} in the ${t.cmpLabel}.\n${t.foot}.\n\nScope: ${p.label}, ${scopeText()}.\n\nWhy it matters: this feeds which satellites need an avoidance-maneuver decision this month.\n\nNick`,
  };
}
function scopeHtml() {
  const p = PERIODS[state.period];
  return `<b>${esc(p.label)}</b> · ${state.plane ? `Plane ${state.plane}` : 'All planes'} · ${state.objType ? `Other object: ${esc(state.objType)}` : 'All objects'}`;
}
function step(n) { ['share-edit', 'share-review', 'share-result'].forEach((id, i) => $(id).classList.toggle('hidden', i !== n)); }

async function loadConfig() {
  const el = $('share-conn');
  el.className = 'conn'; el.textContent = 'Checking the email connection…';
  try {
    const r = await fetch('/api/share-finding', { cache: 'no-store' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    config = await r.json();
    if (!config.configured) {
      el.className = 'conn warn';
      el.innerHTML = `<b>Email is not connected yet.</b> Missing server settings: ${config.missing.map((m) => `<code>${m}</code>`).join(', ')}. Add them in Vercel → Settings → Environment Variables, then redeploy. Sending will not work until then.${config.key !== 'missing' ? `<br/>Resend: ${esc(config.provider)}` : ''}`;
    } else {
      el.className = config.provider.startsWith('connected') ? 'conn ok' : 'conn warn';
      el.innerHTML = `<b>Resend:</b> ${esc(config.provider)}<br/><b>Sender:</b> ${esc(config.sender)} · <b>Permitted recipients:</b> ${config.permitted_recipients.map(esc).join(', ')}`;
      if (!$('share-to').value && config.permitted_recipients.length) $('share-to').value = config.permitted_recipients[0];
    }
  } catch (e) {
    config = null;
    el.className = 'conn warn';
    el.innerHTML = `<b>Could not reach the email service</b> (${esc(e.message)}). The server function may not be deployed here.`;
  }
}

function openShare(label) {
  const t = state.kpiTiles?.[label];
  if (!t) return;
  current = { tile: t, scope: { period: state.period, plane: state.plane, objType: state.objType }, link: scopeLink(), requestId: crypto.randomUUID() };
  const d = draft(t);
  $('share-kpi').innerHTML = `${esc(t.label)}: <b>${esc(t.value)}</b> ${esc(t.unit)}`;
  $('share-scope').innerHTML = scopeHtml();
  $('share-subject').value = d.subject;
  $('share-message').value = d.message;
  $('share-phrase').value = '';
  $('share-err').textContent = '';
  step(0);
  $('share').showModal();
  loadConfig();
}

function review() {
  const to = $('share-to').value.trim(), subject = $('share-subject').value.trim(), message = $('share-message').value.trim();
  const err = !to ? 'Enter a recipient.' : !subject ? 'Enter a subject.' : !message ? 'Enter a message.' : !$('share-phrase').value ? 'Enter the lab phrase.' : '';
  $('share-err').textContent = err;
  if (err) return;
  $('rv-to').textContent = to;
  $('rv-from').textContent = config?.sender || 'Orbit Watch <onboarding@resend.dev>';
  $('rv-subject').textContent = subject;
  $('rv-body').textContent = message;
  $('rv-scope').innerHTML = scopeHtml();
  $('rv-link').textContent = current.link;
  $('rv-req').textContent = current.requestId;
  const allowed = config?.permitted_recipients || [];
  $('rv-warn').textContent = config && !config.configured ? 'Email is not connected: confirming will show the missing settings and send nothing.'
    : allowed.length && !allowed.includes(to.toLowerCase()) ? `${to} is not a permitted test recipient, so the server will refuse it.` : '';
  step(1);
  $('share-confirm').focus();
}

async function confirmSend() {
  const btn = $('share-confirm');
  btn.disabled = true; btn.textContent = 'Sending…';
  const body = { confirm: true, to: $('share-to').value.trim(), subject: $('share-subject').value.trim(), message: $('share-message').value.trim(), lab_phrase: $('share-phrase').value, request_id: current.requestId, scope: current.scope, link: current.link };
  let r, j;
  try { r = await fetch('/api/share-finding', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); j = await r.json().catch(() => ({})); }
  catch (e) { r = { ok: false, status: 0 }; j = { message: `Network error (${e.message}). The request may not have reached the server; check Resend's Emails log before trying again.` }; }
  btn.disabled = false; btn.textContent = 'Confirm and send';
  const out = $('share-out');
  if (r.ok && j.ok) {
    out.className = 'result ok';
    out.innerHTML = `<b>Accepted by Resend.</b> This means the provider took the email, not yet that it reached the inbox.
      <dl><dt>Resend email ID</dt><dd><code id="sent-id">${esc(j.id)}</code></dd><dt>Action request</dt><dd><code>${esc(j.request_id)}</code></dd><dt>To</dt><dd>${esc(j.to)}</dd><dt>From</dt><dd>${esc(j.from)}</dd>
      <dt>Subject</dt><dd>${esc(j.subject)}</dd><dt>Scope</dt><dd>${esc(j.scope)}</dd><dt>Sent</dt><dd>${esc(new Date(j.sent_at).toUTCString())}</dd></dl>
      <button type="button" class="btn" id="share-verify">Read it back from Resend</button> <span id="verify-out" class="hint"></span>
      <p class="hint">Then open the permitted inbox and match the subject and the action request ID (it is printed in the email footer).</p>`;
    $('share-verify').onclick = () => verify(j.id);
  } else {
    out.className = 'result bad';
    out.innerHTML = `<b>Not sent.</b> ${esc(j.message || `HTTP ${r.status}`)}${j.missing ? `<br/>Missing: ${j.missing.map((m) => `<code>${m}</code>`).join(', ')}` : ''}`;
  }
  step(2);
}

async function verify(id) {
  const o = $('verify-out');
  o.textContent = 'Reading…';
  const r = await fetch(`/api/share-finding?id=${encodeURIComponent(id)}`, { cache: 'no-store' });
  const j = await r.json().catch(() => ({}));
  o.innerHTML = r.ok ? `Resend says: <b>${esc(j.last_event)}</b> · to ${esc((j.to || []).join(', '))} · “${esc(j.subject)}” · created ${esc(j.created_at)}`
    : `Read-back not available: ${esc(j.message || j.error || `HTTP ${r.status}`)}`;
}

export function bindShare() {
  $('kpis').addEventListener('click', (e) => { const b = e.target.closest('.kpi'); if (b) { e.stopPropagation(); openMenu(b); } });
  $('kpi-menu-share').addEventListener('click', () => { const k = $('kpi-menu').dataset.kpi; closeMenu(); openShare(k); });
  $('kpi-menu-defs').addEventListener('click', () => { closeMenu(); const d = document.querySelector('.defs'); d.open = true; d.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); });
  document.addEventListener('click', (e) => { if (!e.target.closest('#kpi-menu')) closeMenu(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });
  $('share-review-btn').addEventListener('click', review);
  $('share-back').addEventListener('click', () => step(0));
  $('share-confirm').addEventListener('click', confirmSend);
  document.querySelectorAll('[data-share-cancel]').forEach((b) => b.addEventListener('click', () => {
    $('share').close();
    const t = $('share-toast'); t.textContent = 'Cancelled. Nothing was sent.'; t.classList.remove('hidden'); setTimeout(() => t.classList.add('hidden'), 3500);
  }));
  $('share-done').addEventListener('click', () => $('share').close());
  // keep the URL in sync with filters, so the shared link and a reload show the same scope
  const sync = () => history.replaceState(history.state, '', scopeLink().replace(location.origin, '') + location.hash);
  ['plane', 'objtype'].forEach((id) => $(id).addEventListener('change', sync));
  document.querySelectorAll('#period button').forEach((b) => b.addEventListener('click', sync));
  $('reset').addEventListener('click', () => history.replaceState(history.state, '', `/${location.hash}`));
}
