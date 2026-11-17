// Session 03 · Exercise 3 — inline numeric correction of a close-approach record (Pc), saved in Supabase.
//
// Path: browser → this server function (checks the lab phrase you type) → Supabase Edge Function
// "orbit-watch-corrections" (checks LAB_ACCESS_KEY again, holds the service role key) → SQL function
// apply_conjunction_correction() with a revision check. The browser itself stays read-only.
//
// Server settings: LAB_ACCESS_KEY (Vercel, already set for email) and the same value as an Edge Function
// secret in Supabase. Optional LAB_SUPABASE_URL (defaults to the orbit-watch project).
//
// GET  /api/correct-record  → redacted connection check
// POST /api/correct-record  → save one reviewed change

import { createHash, timingSafeEqual } from 'node:crypto';

const SB_URL = (process.env.LAB_SUPABASE_URL || 'https://xglluiuymeqzlykvauft.supabase.co').replace(/\/$/, '');
const SB_KEY = process.env.VITE_SUPABASE_KEY || 'sb_publishable_NHMHR3WqfGaFKCE1jzLSfw_2vfhDDHM'; // public
const FN = `${SB_URL}/functions/v1/orbit-watch-corrections`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const lab = () => process.env.LAB_ACCESS_KEY || '';
const labOk = () => lab().length >= 32 && lab().length <= 256;
const sha = (t) => createHash('sha256').update(String(t)).digest();
const send = (res, code, body) => { res.status(code).setHeader('Cache-Control', 'no-store'); res.json(body); };

async function check(res) {
  const out = { lab_phrase: labOk() ? 'set (value hidden)' : lab() ? 'too short or too long (needs 32–256 characters)' : 'missing', database: SB_URL.replace('https://', '') };
  try {
    const r = await fetch(FN, { headers: { apikey: SB_KEY } });
    const j = await r.json().catch(() => ({}));
    if (r.status === 404) out.function = 'not deployed (orbit-watch-corrections not found)';
    else if (!r.ok) out.function = `error (HTTP ${r.status})`;
    else out.function = j.lab_key_configured ? 'deployed, lab key secret set' : 'deployed, but LAB_ACCESS_KEY secret missing in Supabase';
    out.configured = labOk() && r.ok && !!j.lab_key_configured;
  } catch (e) { out.function = `unreachable (${e.message})`; out.configured = false; }
  out.missing = [!labOk() && 'LAB_ACCESS_KEY (Vercel)', !String(out.function).includes('secret set') && 'orbit-watch-corrections function with LAB_ACCESS_KEY secret (Supabase)'].filter(Boolean);
  return send(res, 200, out);
}

async function post(req, res) {
  const b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
  if (!labOk()) return send(res, 503, { status: 'not_configured', missing: ['LAB_ACCESS_KEY'], message: 'LAB_ACCESS_KEY is not set (32–256 characters) in Vercel. Nothing was saved.' });
  if (!b.confirm) return send(res, 400, { status: 'not_confirmed', message: 'Review and confirm the change first. Nothing was saved.' });
  if (typeof b.lab_phrase !== 'string' || !timingSafeEqual(sha(b.lab_phrase), sha(lab()))) return send(res, 401, { status: 'rejected', message: 'The lab phrase is not correct. Nothing was saved.' });
  if (!UUID.test(String(b.request_id || ''))) return send(res, 400, { status: 'invalid', message: 'Missing request ID. Nothing was saved.' });
  const payload = { conjunction_id: b.conjunction_id, field: b.field, expected_value: b.expected_value, expected_revision: b.expected_revision, new_value: b.new_value, reason: b.reason, request_id: b.request_id };
  let r, j;
  try {
    r = await fetch(FN, { method: 'POST', headers: { apikey: SB_KEY, Authorization: `Bearer ${lab()}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    j = await r.json().catch(() => ({ status: 'unknown' }));
  } catch (e) {
    return send(res, 502, { status: 'unknown', message: `Could not reach the database function (${e.message}). Read the record again before retrying.` });
  }
  if (r.status === 404 && !j.status) return send(res, 503, { status: 'not_configured', missing: ['orbit-watch-corrections (Supabase Edge Function)'], message: 'The database function is not deployed. Nothing was saved.' });
  return send(res, r.status, { ...j, request_id: b.request_id });
}

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') return check(res);
    if (req.method === 'POST') return post(req, res);
    res.setHeader('Allow', 'GET, POST');
    return send(res, 405, { status: 'method_not_allowed' });
  } catch (err) {
    return send(res, 500, { status: 'unknown', message: `${err.message}. Read the record again before retrying.` });
  }
}
