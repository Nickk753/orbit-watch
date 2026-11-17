// Session 03 · Exercise 4 — "Report data issue" from a close-approach record → GitHub issue (not a PR).
//
// Server settings (Vercel project orbit-watch → Settings → Environment Variables → Production, then Redeploy):
//   LAB_GITHUB_TOKEN       fine-grained token, Only select repositories → Nickk753/orbit-watch, Issues: Read and write
//   LAB_GITHUB_REPOSITORY  owner/name, e.g. Nickk753/orbit-watch
//   LAB_ACCESS_KEY         shared lab password (32–256 characters)
//
// GET  /api/report-issue            → redacted connection check
// GET  /api/report-issue?number=<n> → independent read-back of the issue
// POST /api/report-issue            → open one issue after explicit confirmation

import { createHash, timingSafeEqual } from 'node:crypto';

const GH = 'https://api.github.com';
const SB_URL = 'https://xglluiuymeqzlykvauft.supabase.co';
const SB_KEY = 'sb_publishable_NHMHR3WqfGaFKCE1jzLSfw_2vfhDDHM'; // public, read-only
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const env = () => ({ token: process.env.LAB_GITHUB_TOKEN || '', repo: (process.env.LAB_GITHUB_REPOSITORY || '').trim().replace(/^https:\/\/github\.com\//, '').replace(/\/$/, ''), lab: process.env.LAB_ACCESS_KEY || '' });
const labOk = (e) => e.lab.length >= 32 && e.lab.length <= 256;
const repoOk = (e) => /^[\w.-]+\/[\w.-]+$/.test(e.repo);
const missing = (e) => [!e.token && 'LAB_GITHUB_TOKEN', !repoOk(e) && 'LAB_GITHUB_REPOSITORY', !labOk(e) && 'LAB_ACCESS_KEY'].filter(Boolean);
const sha = (t) => createHash('sha256').update(String(t)).digest();
const phraseOk = (e, g) => labOk(e) && typeof g === 'string' && timingSafeEqual(sha(g), sha(e.lab));
const send = (res, code, body) => { res.status(code).setHeader('Cache-Control', 'no-store'); res.json(body); };
const clean = (s, n) => String(s || '').replace(/\r/g, '').trim().slice(0, n);
const gh = async (path, e, init = {}) => {
  const r = await fetch(`${GH}${path}`, { ...init, headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${e.token}`, 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'orbit-watch-lab', ...(init.headers || {}) } });
  return { ok: r.ok, status: r.status, j: await r.json().catch(() => ({})) };
};
const sb = async (path) => { const r = await fetch(`${SB_URL}/rest/v1/${path}`, { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } }); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); };

async function check(res) {
  const e = env(); const miss = missing(e);
  const out = { configured: miss.length === 0, missing: miss, token: e.token ? 'set (value hidden)' : 'missing', repository: repoOk(e) ? e.repo : null, lab_phrase: labOk(e) ? 'set (value hidden)' : e.lab ? 'too short or too long (needs 32–256 characters)' : 'missing' };
  if (!e.token || !repoOk(e)) return send(res, 200, { ...out, provider: 'not checked: settings missing' });
  const r = await gh(`/repos/${e.repo}`, e);
  if (!r.ok) out.provider = `GitHub refused (HTTP ${r.status}: ${clean(r.j.message, 120)}). Check the token's repository access.`;
  else if (!r.j.has_issues) out.provider = 'repository found, but Issues are turned off in its settings';
  else out.provider = `connected: ${r.j.full_name} (${r.j.private ? 'private' : 'public'}), issues enabled`;
  return send(res, 200, out);
}

async function readBack(res, n) {
  const e = env();
  if (!e.token || !repoOk(e)) return send(res, 503, { error: 'not_configured' });
  if (!/^\d{1,7}$/.test(n)) return send(res, 400, { error: 'bad_number' });
  const r = await gh(`/repos/${e.repo}/issues/${n}`, e);
  if (!r.ok) return send(res, r.status, { error: 'provider_error', message: clean(r.j.message, 200) });
  const body = r.j.body || '';
  return send(res, 200, { number: r.j.number, url: r.j.html_url, title: r.j.title, state: r.j.state, created_at: r.j.created_at, body_has_record: /Record: C\d{6}/.test(body), body_has_request: /Action request: [0-9a-f-]{36}/.test(body) });
}

async function post(req, res) {
  const e = env(); const miss = missing(e);
  if (miss.length) return send(res, 503, { error: 'not_configured', missing: miss, message: `GitHub is not connected yet. Add ${miss.join(', ')} in Vercel (project orbit-watch → Settings → Environment Variables), then redeploy. No issue was opened.` });
  const b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
  if (!b.confirm) return send(res, 400, { error: 'not_confirmed', message: 'Review and confirm the issue first. No issue was opened.' });
  if (!UUID.test(String(b.request_id || ''))) return send(res, 400, { error: 'bad_request_id', message: 'Missing request ID. No issue was opened.' });
  if (!phraseOk(e, b.lab_phrase)) return send(res, 401, { error: 'bad_lab_phrase', message: 'The lab phrase is not correct. No issue was opened.' });
  const id = String(b.conjunction_id || '');
  if (!/^C\d{6}$/.test(id)) return send(res, 400, { error: 'bad_record', message: 'Unknown record. No issue was opened.' });
  const title = clean(b.title, 200), text = clean(b.body, 8000);
  if (!title || !text) return send(res, 400, { error: 'empty', message: 'Title and description are required. No issue was opened.' });

  // re-read the record as stored now, so the issue cites the database, not the browser
  let c, corr, note;
  try {
    [[c], corr, [note]] = await Promise.all([
      sb(`v_conjunction?conjunction_id=eq.${id}&select=conjunction_id,satellite_name,object_name,plane,tca_utc,miss_distance_m,pc,risk_tier,status,revision`),
      sb(`conjunction_correction?conjunction_id=eq.${id}&order=correction_id.desc&limit=1`).catch(() => []),
      sb(`conjunction_audit_note?conjunction_id=eq.${id}`).catch(() => []),
    ]);
  } catch (err) { return send(res, 502, { error: 'record_failed', message: `Could not read the record (${err.message}). No issue was opened.` }); }
  if (!c) return send(res, 404, { error: 'not_found', message: 'Record not found. No issue was opened.' });
  const recordLine = `${c.conjunction_id}: ${c.satellite_name} × ${c.object_name}, plane ${c.plane}, TCA ${c.tca_utc.slice(0, 16).replace('T', ' ')} UTC, Pc ${c.pc} (${c.risk_tier}), revision ${c.revision ?? 0}`;
  const k = corr[0];
  const footer = ['', '---', '**Record snapshot (read by the server when the issue was opened)**',
    `Record: ${recordLine}`,
    k ? `Last correction: Pc ${k.old_value} → ${k.new_value} (${k.old_risk_tier} → ${k.new_risk_tier}), revision ${k.revision_after}, ${k.created_at}, request ${k.request_id}` : 'Last correction: none',
    note ? `Audit note (synthetic): ${note.note}` : '',
    b.link ? `Dashboard: ${clean(b.link, 300)}` : '',
    `Action request: ${b.request_id}`,
    'Data: close approaches are synthetic (seed 20261110) for a course project; orbits are real (CelesTrak).',
  ].filter(Boolean).join('\n');
  const body = `${text}\n${footer}`;
  const r = await gh(`/repos/${e.repo}/issues`, e, { method: 'POST', body: JSON.stringify({ title, body }) });
  if (!r.ok) return send(res, r.status, { error: 'provider_error', message: `GitHub refused the issue: ${clean(r.j.message, 200)}. No issue was opened.` });
  const v = await gh(`/repos/${e.repo}/issues/${r.j.number}`, e); // independent read-back
  const match = v.ok && v.j.title === title && (v.j.body || '').replace(/\r/g, '') === body;
  return send(res, 200, { ok: true, number: r.j.number, url: r.j.html_url, request_id: b.request_id, record_line: recordLine, readback: { checked: v.ok, match } });
}

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') return req.query.number ? readBack(res, String(req.query.number)) : check(res);
    if (req.method === 'POST') return post(req, res);
    res.setHeader('Allow', 'GET, POST');
    return send(res, 405, { error: 'method_not_allowed' });
  } catch (err) {
    return send(res, 500, { error: 'server_error', message: `${err.message}. Check the repository's issues before retrying.` });
  }
}
