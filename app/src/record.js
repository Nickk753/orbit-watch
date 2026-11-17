// Session 03 · Level 3 record actions on a close-approach record:
//   Exercise 3 — click the Pc cell → edit inline (value + reason) → review with predicted effects → confirm → saved in Supabase → reload + compare.
//   Exercise 4 — record menu ⋯ → Report data issue → edit → review → confirm → GitHub issue → read back.
import { state, PERIODS, scopeText, kpi, oneIn, reloadData, select, DATA_ref } from './main.js';

const $ = (id) => document.getElementById(id);
const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const SB_URL = 'https://xglluiuymeqzlykvauft.supabase.co';
const SB_KEY = 'sb_publishable_NHMHR3WqfGaFKCE1jzLSfw_2vfhDDHM';
const sb = async (path) => { const r = await fetch(`${SB_URL}/rest/v1/${path}`, { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` }, cache: 'no-store' }); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); };
const tierOf = (pc) => (pc >= 1e-4 ? 'High' : pc >= 1e-5 ? 'Medium' : 'Low');
const f = (n, d) => Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const phrase = () => $('share-phrase')?.value || $('as-phrase')?.value || '';
let rec = null; // the record currently shown { c, s, audit, corrections }
let pending = null; // reviewed correction
let issue = null;

// ---------- record extras: audit note, last correction, inline editor ----------
export async function decorateRecord(c, s) {
  rec = { c, s, audit: null, corrections: [] };
  $('pc-cell').onclick = () => openEditor();
  $('rec-menu-btn').onclick = (e) => { e.stopPropagation(); openRecMenu(e.currentTarget); };
  const box = $('rec-extra');
  try {
    const [a, k] = await Promise.all([
      sb(`conjunction_audit_note?conjunction_id=eq.${c.conjunction_id}`),
      sb(`conjunction_correction?conjunction_id=eq.${c.conjunction_id}&order=correction_id.desc&limit=3`),
    ]);
    if (rec?.c.conjunction_id !== c.conjunction_id) return;
    rec.audit = a[0] || null; rec.corrections = k;
    box.innerHTML = (rec.audit ? `<div class="audit"><span class="tag syn">Synthetic audit note</span> ${esc(rec.audit.note)}</div>` : '')
      + (k.length ? `<div class="corr-log"><b>Saved corrections</b>${k.map((x) => `<div>rev ${x.revision_after}: Pc ${x.old_value} → ${x.new_value} (${x.old_risk_tier} → ${x.new_risk_tier}) · ${esc(new Date(x.created_at).toUTCString().slice(5, 22))} UTC · “${esc(x.reason)}”</div>`).join('')}</div>` : '');
  } catch { /* tables not created yet: no extras */ }
}

function openEditor() {
  const { c } = rec;
  const box = $('rec-extra');
  const hint = rec.audit && Number(rec.audit.recorded_value) === Number(c.pc) ? `The audit note supports ${rec.audit.supported_value}.` : '';
  box.innerHTML = `<div class="inline-edit">
    <label>New Pc (current ${Number(c.pc).toPrecision(5)}, revision ${c.revision ?? 0}) <input id="ed-val" type="number" step="any" min="0" max="1" inputmode="decimal" /></label>
    <p class="hint">${esc(hint)} Must be between 0 and 1.</p>
    <label>Reason <textarea id="ed-reason" rows="3" maxlength="1000" placeholder="Why this value is right, and what evidence supports it"></textarea></label>
    <label>Lab phrase <input id="ed-phrase" type="password" autocomplete="off" /></label>
    <p class="err" id="ed-err"></p>
    <div class="actions"><button type="button" class="btn ghost" id="ed-cancel">Cancel</button><button type="button" class="btn" id="ed-review">Review change →</button></div></div>`;
  $('ed-phrase').value = phrase();
  $('ed-val').focus();
  $('ed-cancel').onclick = () => { decorateRecord(rec.c, rec.s); toast('Cancelled. Nothing was saved.'); };
  $('ed-review').onclick = reviewChange;
}

async function reviewChange() {
  const { c } = rec;
  const v = Number($('ed-val').value), reason = $('ed-reason').value.trim();
  const err = $('ed-val').value === '' || !(v >= 0 && v <= 1) ? 'Enter a Pc between 0 and 1.' : v === Number(c.pc) ? 'That is the current value.' : reason.length < 5 ? 'Give a reason (at least 5 characters).' : !$('ed-phrase').value ? 'Enter the lab phrase.' : '';
  $('ed-err').textContent = err;
  if (err) return;
  const p = PERIODS[state.period];
  const before = await kpi(p.start, p.end, state.plane).catch(() => null);
  const oldT = c.risk_tier, newT = tierOf(v);
  const inScope = c.tca_date >= p.start && c.tca_date <= p.end && (!state.plane || c.plane === state.plane) && (!state.objType || c.object_type === state.objType);
  const dHigh = (newT === 'High') - (oldT === 'High');
  const elevChange = (oldT !== 'Low') !== (newT !== 'Low');
  const pred = before && inScope ? {
    high: Number(before.high_risk) + dHigh,
    share: (100 * (Number(before.high_risk) + dHigh)) / Number(before.conjunctions),
    expected: Number(before.expected_collisions) + (v - Number(c.pc)),
  } : null;
  const awaitingDelta = state.period === 'next30' && c.status === 'Awaiting decision' && inScope ? dHigh : 0;
  pending = { c, v, reason, oldT, newT, before, pred, scope: { period: state.period, plane: state.plane, objType: state.objType }, requestId: crypto.randomUUID(), phrase: $('ed-phrase').value, awaitingDelta, elevChange };
  $('cr-body').innerHTML = `
    <dl class="review"><dt>Record</dt><dd>${esc(c.conjunction_id)} · ${esc(rec.s.name)} × ${esc(c.object_name)} · plane ${c.plane}</dd>
      <dt>Field</dt><dd>pc (probability of collision)</dd>
      <dt>Old value</dt><dd><b>${Number(c.pc).toPrecision(5)}</b> (${oneIn(c.pc)}, ${oldT}) · revision ${c.revision ?? 0}</dd>
      <dt>New value</dt><dd><b>${v.toPrecision(5)}</b> (${oneIn(v)}, ${newT})</dd>
      <dt>Reason</dt><dd>${esc(reason)}</dd>
      <dt>Request ID</dt><dd class="mono">${pending.requestId}</dd></dl>
    <h3 class="sub-h">Predicted effect · ${esc(PERIODS[state.period].label)}, ${esc(scopeText())}</h3>
    ${pred ? `<table class="pred"><thead><tr><th>Figure</th><th class="n">Now</th><th class="n">Predicted</th></tr></thead><tbody>
      <tr><td>Risk tier of ${esc(c.conjunction_id)}</td><td class="n">${oldT}</td><td class="n">${newT}</td></tr>
      <tr><td>High-risk events</td><td class="n">${before.high_risk}</td><td class="n">${pred.high}</td></tr>
      <tr><td>High-risk share</td><td class="n">${f(before.high_risk_share_pct, 2)}%</td><td class="n">${f(pred.share, 2)}%</td></tr>
      <tr><td>Expected collisions (sum of Pc)</td><td class="n">${f(before.expected_collisions, 6)}</td><td class="n">${f(pred.expected, 6)}</td></tr>
      ${awaitingDelta ? `<tr><td>“Awaiting a maneuver decision” (banner)</td><td class="n" colspan="2">${awaitingDelta > 0 ? '+' : ''}${awaitingDelta}</td></tr>` : ''}
      </tbody></table>
      <p class="hint"><b>Should stay unchanged:</b> number of close approaches (${before.conjunctions}), close approaches per satellite (${f(before.conjunctions_per_sat_30d, 2)}), avoidance maneuvers (${before.avoidance_maneuvers}), miss distance and TCA of the record${elevChange ? '' : ', and the elevated-risk counts in the plane view (it stays high or medium)'}.</p>`
      : '<p class="hint">This record is outside the current filters, so the overview KPIs shown now should not change. Switch filters to include it to see its effect.</p>'}`;
  $('cr-out').className = 'hidden';
  $('cr-actions').classList.remove('hidden');
  $('correct').showModal();
}

async function confirmChange() {
  const btn = $('cr-confirm');
  btn.disabled = true; btn.textContent = 'Saving…';
  const P = pending;
  let r, j;
  try {
    r = await fetch('/api/correct-record', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm: true, lab_phrase: P.phrase, request_id: P.requestId, conjunction_id: P.c.conjunction_id, field: 'pc', expected_value: Number(P.c.pc), expected_revision: Number(P.c.revision ?? 0), new_value: P.v, reason: P.reason }) });
    j = await r.json().catch(() => ({}));
  } catch (e) { r = { ok: false, status: 0 }; j = { status: 'unknown', message: `Network error (${e.message}). Read the record again before retrying.` }; }
  btn.disabled = false; btn.textContent = 'Confirm and save';
  const out = $('cr-out');
  out.classList.remove('hidden');
  $('cr-actions').classList.add('hidden');
  if (r.ok && (j.status === 'saved' || j.status === 'duplicate')) {
    const p = PERIODS[P.scope.period];
    await reloadData(); // fresh read of every record from the database, then all views recompute
    const after = await kpi(p.start, p.end, P.scope.plane).catch(() => null);
    const fresh = DATA_ref().conj.find((x) => x.conjunction_id === P.c.conjunction_id);
    const ok = (a, b, d) => (Math.abs(Number(a) - Number(b)) < d ? '✓' : '✗');
    out.className = 'result ok';
    out.innerHTML = `<b>${j.status === 'duplicate' ? 'Already saved earlier (same request ID), nothing written twice.' : 'Saved in Supabase.'}</b>
      <dl><dt>Database read-back</dt><dd>${esc(j.readback.conjunction_id)}: Pc <b>${j.readback.pc}</b>, tier ${esc(j.readback.risk_tier)}, revision <b>${j.readback.revision}</b> (read ${esc(j.read_at)})</dd>
      <dt>Correction log</dt><dd>#${j.correction.correction_id} · ${j.correction.old_value} → ${j.correction.new_value} · request <code>${esc(j.correction.request_id)}</code></dd>
      <dt>App after reload</dt><dd>${fresh ? `Pc ${fresh.pc} (${fresh.risk_tier}), revision ${fresh.revision}` : '–'}</dd></dl>
      ${P.pred && after ? `<table class="pred"><thead><tr><th>Figure</th><th class="n">Before</th><th class="n">Predicted</th><th class="n">Observed</th><th></th></tr></thead><tbody>
        <tr><td>High-risk events</td><td class="n">${P.before.high_risk}</td><td class="n">${P.pred.high}</td><td class="n">${after.high_risk}</td><td>${ok(after.high_risk, P.pred.high, 0.5)}</td></tr>
        <tr><td>High-risk share</td><td class="n">${f(P.before.high_risk_share_pct, 2)}%</td><td class="n">${f(P.pred.share, 2)}%</td><td class="n">${f(after.high_risk_share_pct, 2)}%</td><td>${ok(after.high_risk_share_pct, P.pred.share, 0.006)}</td></tr>
        <tr><td>Expected collisions</td><td class="n">${f(P.before.expected_collisions, 6)}</td><td class="n">${f(P.pred.expected, 6)}</td><td class="n">${f(after.expected_collisions, 6)}</td><td>${ok(after.expected_collisions, P.pred.expected, 2e-6)}</td></tr>
        <tr><td>Close approaches (unchanged)</td><td class="n">${P.before.conjunctions}</td><td class="n">${P.before.conjunctions}</td><td class="n">${after.conjunctions}</td><td>${ok(after.conjunctions, P.before.conjunctions, 0.5)}</td></tr>
      </tbody></table>` : ''}
      <p class="hint">Reload the page: the record and KPIs keep the saved values. Check the row in Supabase Table Editor → fact_conjunction and conjunction_correction.</p>`;
    select({ sat: P.c.satellite_id, conj: P.c.conjunction_id });
  } else if (r.status === 409 || j.status === 'conflict') {
    await reloadData();
    out.className = 'result bad';
    out.innerHTML = `<b>Conflict: nothing was overwritten.</b> The record changed since you read it. The database now has Pc <b>${esc(j.current?.pc)}</b> (${esc(j.current?.risk_tier)}), revision <b>${esc(j.current?.revision)}</b>. The app has re-read the data; review the newer value before deciding again.`;
    select({ sat: P.c.satellite_id, conj: P.c.conjunction_id });
  } else {
    out.className = 'result bad';
    out.innerHTML = `<b>Not saved.</b> ${esc(j.message || j.status || `HTTP ${r.status}`)}${j.missing ? `<br/>Missing: ${j.missing.map((m) => `<code>${esc(m)}</code>`).join(', ')}` : ''}`;
  }
}

// ---------- record menu → Report data issue (GitHub) ----------
function openRecMenu(btn) {
  const m = $('rec-menu');
  const r = btn.getBoundingClientRect();
  m.style.left = `${Math.min(r.left, innerWidth - 230)}px`;
  m.style.top = `${r.bottom + 4}px`;
  m.classList.remove('hidden');
  $('rec-menu-issue').focus();
}

async function openIssue() {
  const { c, s } = rec;
  issue = { requestId: crypto.randomUUID(), c };
  const last = rec.corrections[0];
  $('is-rec').innerHTML = `<b>${esc(c.conjunction_id)}</b>: ${esc(s.name)} × ${esc(c.object_name)} · plane ${c.plane} · TCA ${esc(c.tca_utc.slice(0, 16).replace('T', ' '))} UTC`;
  $('is-title').value = `Duplicate CDM ingestion doubled Pc for ${c.conjunction_id} (${s.name} × ${c.object_name})`;
  $('is-desc').value = `## What happened\n${rec.audit ? `${rec.audit.note}\n\n` : ''}Record ${c.conjunction_id} currently has Pc ${c.pc} (${oneIn(c.pc)}, ${c.risk_tier}), revision ${c.revision ?? 0}.${last ? ` It was corrected from ${last.old_value} to ${last.new_value} (${last.old_risk_tier} → ${last.new_risk_tier}) in revision ${last.revision_after}.` : ''}\n\n## Request\nPlease review the CDM import step: when two messages describe the same pass (same satellite, object and TCA), keep the newest one instead of adding their probabilities. Add a check that flags duplicate (satellite, object, TCA) rows before load.\n\n## Out of scope\nThis issue asks for a technical review only. It does not change data; the record value was corrected separately.`;
  $('is-phrase').value = phrase();
  $('is-err').textContent = '';
  ['is-edit', 'is-review', 'is-result'].forEach((id, i) => $(id).classList.toggle('hidden', i !== 0));
  $('issue').showModal();
  const el = $('is-conn'); el.className = 'conn'; el.textContent = 'Checking the GitHub connection…';
  try {
    const r = await fetch('/api/report-issue', { cache: 'no-store' }); const j = await r.json();
    issue.config = j;
    el.className = j.configured && j.provider?.startsWith('connected') ? 'conn ok' : 'conn warn';
    el.innerHTML = j.configured ? `<b>GitHub:</b> ${esc(j.provider)}${j.repository ? `<br/><b>Destination:</b> ${esc(j.repository)} (issues)` : ''}` : `<b>GitHub is not connected yet.</b> Missing: ${j.missing.map((m) => `<code>${m}</code>`).join(', ')}. Add them in Vercel (project orbit-watch) → Settings → Environment Variables, then redeploy.`;
  } catch (e) { el.className = 'conn warn'; el.textContent = `Could not reach the GitHub service (${e.message}).`; }
}

function reviewIssue() {
  const t = $('is-title').value.trim(), d = $('is-desc').value.trim();
  const err = !t ? 'Enter a title.' : !d ? 'Enter a description.' : !$('is-phrase').value ? 'Enter the lab phrase.' : '';
  $('is-err').textContent = err;
  if (err) return;
  $('isr-dest').textContent = issue.config?.repository ? `${issue.config.repository} → new issue` : '(not connected)';
  $('isr-title').textContent = t;
  $('isr-rec').innerHTML = $('is-rec').innerHTML;
  $('isr-req').textContent = issue.requestId;
  $('isr-desc').textContent = d;
  ['is-edit', 'is-review', 'is-result'].forEach((id, i) => $(id).classList.toggle('hidden', i !== 1));
  $('is-confirm').focus();
}

async function confirmIssue() {
  const btn = $('is-confirm');
  btn.disabled = true; btn.textContent = 'Opening issue…';
  let r, j;
  try {
    r = await fetch('/api/report-issue', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm: true, request_id: issue.requestId, lab_phrase: $('is-phrase').value, title: $('is-title').value.trim(), body: $('is-desc').value.trim(), conjunction_id: issue.c.conjunction_id, link: `${location.origin}/?period=${state.period}${state.plane ? `&plane=${state.plane}` : ''}` }) });
    j = await r.json().catch(() => ({}));
  } catch (e) { r = { ok: false, status: 0 }; j = { message: `Network error (${e.message}). Check the repository's issues before retrying.` }; }
  btn.disabled = false; btn.textContent = 'Confirm and open issue';
  const out = $('is-out');
  if (r.ok && j.ok) {
    out.className = 'result ok';
    out.innerHTML = `<b>Issue opened.</b> It requests a technical review; it changes no data and does not fix the import.
      <dl><dt>Issue</dt><dd><a href="${esc(j.url)}" target="_blank" rel="noopener">${esc(j.url)}</a></dd><dt>Record</dt><dd>${esc(j.record_line)}</dd>
      <dt>Action request</dt><dd><code>${esc(j.request_id)}</code></dd><dt>Read-back</dt><dd>${j.readback.match ? '✓ title and body match what you approved' : '⚠ read-back did not match, open the issue and compare'}</dd></dl>
      <button type="button" class="btn" id="is-verify">Read the issue again</button> <span id="is-verify-out" class="hint"></span>`;
    $('is-verify').onclick = async () => {
      const o = $('is-verify-out'); o.textContent = 'Reading…';
      const rr = await fetch(`/api/report-issue?number=${j.number}`, { cache: 'no-store' }); const jj = await rr.json().catch(() => ({}));
      o.innerHTML = rr.ok ? `GitHub says: #${jj.number} “${esc(jj.title)}” · ${esc(jj.state)} · created ${esc(jj.created_at)} · body contains record ${jj.body_has_record ? '✓' : '✗'} and request ID ${jj.body_has_request ? '✓' : '✗'}` : `Read-back failed: ${esc(jj.message || rr.status)}`;
    };
  } else {
    out.className = 'result bad';
    out.innerHTML = `<b>No issue opened.</b> ${esc(j.message || `HTTP ${r.status}`)}${j.missing ? `<br/>Missing: ${j.missing.map((m) => `<code>${m}</code>`).join(', ')}` : ''}`;
  }
  ['is-edit', 'is-review', 'is-result'].forEach((id, i) => $(id).classList.toggle('hidden', i !== 2));
}

function toast(t) { const el = $('share-toast'); el.textContent = t; el.classList.remove('hidden'); setTimeout(() => el.classList.add('hidden'), 3500); }

export function bindRecord() {
  $('cr-confirm').addEventListener('click', confirmChange);
  $('cr-cancel').addEventListener('click', () => { $('correct').close(); toast('Cancelled. Nothing was saved.'); });
  $('cr-back').addEventListener('click', () => $('correct').close());
  $('cr-done').addEventListener('click', () => $('correct').close());
  $('rec-menu-issue').addEventListener('click', () => { $('rec-menu').classList.add('hidden'); openIssue(); });
  $('rec-menu-edit').addEventListener('click', () => { $('rec-menu').classList.add('hidden'); openEditor(); });
  document.addEventListener('click', (e) => { if (!e.target.closest('#rec-menu')) $('rec-menu').classList.add('hidden'); });
  $('is-review-btn').addEventListener('click', reviewIssue);
  $('is-back').addEventListener('click', () => ['is-edit', 'is-review', 'is-result'].forEach((id, i) => $(id).classList.toggle('hidden', i !== 0)));
  $('is-confirm').addEventListener('click', confirmIssue);
  document.querySelectorAll('[data-is-cancel]').forEach((b) => b.addEventListener('click', () => { $('issue').close(); toast('Cancelled. No issue was opened.'); }));
  $('is-done').addEventListener('click', () => $('issue').close());
}
