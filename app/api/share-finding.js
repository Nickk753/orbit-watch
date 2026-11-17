// Session 03 · Exercise 1 — "Share finding" email from an overview KPI.
//
// Runs on Vercel as a server function, so secrets stay on the server and never reach the browser.
// Server settings (enter them yourself in Vercel → Project → Settings → Environment Variables):
//   RESEND_API_KEY            your Resend API key (Full access lets the app also read the email back)
//   LAB_ACCESS_KEY            a lab phrase you choose; the dialog asks for it before any send
//   EMAIL_ALLOWED_RECIPIENTS  comma-separated permitted test recipients (with onboarding@resend.dev:
//                             only the address your Resend account was created with)
//   EMAIL_FROM                optional, defaults to "Orbit Watch <onboarding@resend.dev>"
//
// GET  /api/share-finding           → redacted connection check (never returns key values)
// GET  /api/share-finding?id=<id>   → read the sent email back from Resend (status, to, subject)
// POST /api/share-finding           → send one email after explicit confirmation

const RESEND = 'https://api.resend.com';
const SB_URL = process.env.VITE_SUPABASE_URL || 'https://xglluiuymeqzlykvauft.supabase.co';
const SB_KEY = process.env.VITE_SUPABASE_KEY || 'sb_publishable_NHMHR3WqfGaFKCE1jzLSfw_2vfhDDHM'; // public, read-only
const PERIODS = {
  next30: { start: '2026-11-10', end: '2026-12-09', label: 'Next 30 days (10 Nov – 9 Dec 2026)' },
  last30: { start: '2026-10-11', end: '2026-11-09', label: 'Last 30 days (11 Oct – 9 Nov 2026)' },
};
const OBJ = ['Debris', 'Payload', 'Rocket body'];

const env = () => ({
  key: process.env.RESEND_API_KEY || '',
  lab: process.env.LAB_ACCESS_KEY || '',
  allowed: (process.env.EMAIL_ALLOWED_RECIPIENTS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
  from: process.env.EMAIL_FROM || 'Orbit Watch <onboarding@resend.dev>',
});
const missing = (e) => [!e.key && 'RESEND_API_KEY', !e.lab && 'LAB_ACCESS_KEY', !e.allowed.length && 'EMAIL_ALLOWED_RECIPIENTS'].filter(Boolean);
const resend = (path, e, init = {}) => fetch(`${RESEND}${path}`, { ...init, headers: { Authorization: `Bearer ${e.key}`, 'Content-Type': 'application/json', ...(init.headers || {}) } });
const send = (res, code, body) => { res.status(code).setHeader('Cache-Control', 'no-store'); res.json(body); };

async function check(res) {
  const e = env();
  const miss = missing(e);
  const out = { configured: miss.length === 0, missing: miss, sender: e.from, permitted_recipients: e.allowed, key: e.key ? 'set (value hidden)' : 'missing', lab_phrase: e.lab ? 'set (value hidden)' : 'missing' };
  if (!e.key) return send(res, 200, { ...out, provider: 'not checked: no key' });
  // Ask Resend whether the key works and what it may do. Listing emails needs a Full-access key;
  // a Sending-access key is refused with "restricted_api_key" (it can still send, but not read back).
  const r = await resend('/emails?limit=1', e);
  const j = await r.json().catch(() => ({}));
  if (r.ok) out.provider = 'connected: key accepted, full access (send + read back)';
  else if (j.name === 'restricted_api_key') out.provider = 'connected: sending-only key (send works, read-back not allowed)';
  else out.provider = `key rejected by Resend (HTTP ${r.status}${j.name ? `, ${j.name}` : ''})`;
  return send(res, 200, out);
}

async function readBack(res, id) {
  const e = env();
  if (!e.key) return send(res, 503, { error: 'not_configured', missing: ['RESEND_API_KEY'] });
  if (!/^[0-9a-f-]{36}$/i.test(id)) return send(res, 400, { error: 'bad_id' });
  const r = await resend(`/emails/${id}`, e);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) return send(res, r.status, { error: j.name || 'provider_error', message: j.message || `Resend HTTP ${r.status}` });
  return send(res, 200, { id: j.id, to: j.to, from: j.from, subject: j.subject, created_at: j.created_at, last_event: j.last_event });
}

// Re-read the KPIs from the database at send time so the email's figures are the server's, not the browser's.
async function snapshot(scope) {
  const p = PERIODS[scope.period];
  const r = await fetch(`${SB_URL}/rest/v1/rpc/kpi_summary`, {
    method: 'POST', headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_start: p.start, p_end: p.end, p_plane: scope.plane, p_object_type: scope.objType }),
  });
  if (!r.ok) throw new Error(`kpi_summary HTTP ${r.status}`);
  return (await r.json())[0];
}

async function post(req, res) {
  const e = env();
  const miss = missing(e);
  if (miss.length) return send(res, 503, { error: 'not_configured', missing: miss, message: `Email is not connected yet. Add ${miss.join(', ')} in Vercel (Settings → Environment Variables), then redeploy. Nothing was sent.` });
  const b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
  if (!b.confirm) return send(res, 400, { error: 'not_confirmed', message: 'Review and confirm the email first. Nothing was sent.' });
  if (b.lab_phrase !== e.lab) return send(res, 401, { error: 'bad_lab_phrase', message: 'The lab phrase is not correct. Nothing was sent.' });
  const to = String(b.to || '').trim().toLowerCase();
  if (!e.allowed.includes(to)) return send(res, 403, { error: 'recipient_not_permitted', message: `“${to || '(empty)'}” is not a permitted test recipient. The test sender can only deliver to addresses in EMAIL_ALLOWED_RECIPIENTS. Nothing was sent.` });
  const subject = String(b.subject || '').trim().slice(0, 200);
  const text = String(b.message || '').trim().slice(0, 5000);
  if (!subject || !text) return send(res, 400, { error: 'empty', message: 'Subject and message are required. Nothing was sent.' });
  const s = b.scope || {};
  const scope = { period: PERIODS[s.period] ? s.period : 'next30', plane: Number.isInteger(s.plane) && s.plane >= 1 && s.plane <= 6 ? s.plane : null, objType: OBJ.includes(s.objType) ? s.objType : null };

  let k;
  try { k = await snapshot(scope); } catch (err) { return send(res, 502, { error: 'snapshot_failed', message: `Could not re-read the KPIs (${err.message}). Nothing was sent.` }); }
  const scopeLine = `${PERIODS[scope.period].label} · ${scope.plane ? `plane ${scope.plane}` : 'all planes'} · ${scope.objType ? `other object: ${scope.objType}` : 'all objects'}`;
  const footer = [
    '',
    '— Data snapshot read by the server at send time —',
    `Scope: ${scopeLine}`,
    `Close approaches: ${k.conjunctions} on ${k.satellites_in_scope} satellites (${k.conjunctions_per_sat_30d} per satellite per 30 days)`,
    `High-risk share: ${k.high_risk_share_pct}% (${k.high_risk} events, Pc ≥ 1 in 10,000)`,
    `Avoidance maneuvers per satellite: ${k.avoidance_maneuvers_per_sat} (${k.avoidance_maneuvers} burns)`,
    `Expected collisions (sum of Pc): ${k.expected_collisions}`,
    'Orbits: CelesTrak GP snapshot 10 Nov 2026 (real). Close approaches and maneuvers: synthetic (seed 20261110), course project.',
    b.link ? `Open this view: ${String(b.link).slice(0, 300)}` : '',
  ].filter((x) => x !== '').join('\n');

  const r = await resend('/emails', e, { method: 'POST', body: JSON.stringify({ from: e.from, to: [to], subject, text: `${text}\n${footer}` }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) return send(res, r.status, { error: j.name || 'provider_error', message: `Resend refused the email: ${j.message || `HTTP ${r.status}`}. Nothing was sent.` });
  return send(res, 200, { ok: true, id: j.id, to, from: e.from, subject, scope: scopeLine, snapshot: k, sent_at: new Date().toISOString() });
}

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') return req.query.id ? readBack(res, String(req.query.id)) : check(res);
    if (req.method === 'POST') return post(req, res);
    res.setHeader('Allow', 'GET, POST');
    return send(res, 405, { error: 'method_not_allowed' });
  } catch (err) {
    return send(res, 500, { error: 'server_error', message: `${err.message}. Nothing was sent.` });
  }
}
