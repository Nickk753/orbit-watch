// Session 03 · Exercise 2 — "Assign investigation" Trello card from a segment (plane or debris source).
//
// Server settings (Vercel project orbit-watch → Settings → Environment Variables → Production, then Redeploy):
//   TRELLO_API_KEY   API key from your Trello Power-Up admin page (API key tab)
//   TRELLO_TOKEN     token you generated with "Allow" for that key
//   TRELLO_LIST_ID   idList of your practice list (open a card in it, add .json to the URL)
//   LAB_ACCESS_KEY   shared lab password (32–256 characters), same as for email
//
// GET  /api/assign-investigation          → redacted connection check (list + board names, never key values)
// GET  /api/assign-investigation?id=<id>  → independent read-back of the created card
// POST /api/assign-investigation          → create one card after explicit confirmation

import { createHash, timingSafeEqual } from 'node:crypto';

const TRELLO = 'https://api.trello.com/1';
const SB_URL = process.env.VITE_SUPABASE_URL || 'https://xglluiuymeqzlykvauft.supabase.co';
const SB_KEY = process.env.VITE_SUPABASE_KEY || 'sb_publishable_NHMHR3WqfGaFKCE1jzLSfw_2vfhDDHM'; // public, read-only
const PERIODS = {
  next30: { start: '2026-11-10', end: '2026-12-09', label: 'Next 30 days (10 Nov – 9 Dec 2026)' },
  last30: { start: '2026-10-11', end: '2026-11-09', label: 'Last 30 days (11 Oct – 9 Nov 2026)' },
};
const OBJ = ['Debris', 'Payload', 'Rocket body'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const env = () => ({ key: process.env.TRELLO_API_KEY || '', token: process.env.TRELLO_TOKEN || '', list: process.env.TRELLO_LIST_ID || '', lab: process.env.LAB_ACCESS_KEY || '' });
const labOk = (e) => e.lab.length >= 32 && e.lab.length <= 256;
const missing = (e) => [!e.key && 'TRELLO_API_KEY', !e.token && 'TRELLO_TOKEN', !e.list && 'TRELLO_LIST_ID', !labOk(e) && 'LAB_ACCESS_KEY'].filter(Boolean);
const sha = (t) => createHash('sha256').update(String(t)).digest();
const phraseOk = (e, given) => labOk(e) && typeof given === 'string' && timingSafeEqual(sha(given), sha(e.lab));
const auth = (e) => `key=${encodeURIComponent(e.key)}&token=${encodeURIComponent(e.token)}`;
const send = (res, code, body) => { res.status(code).setHeader('Cache-Control', 'no-store'); res.json(body); };
const clean = (s, n) => String(s || '').replace(/\r/g, '').trim().slice(0, n);

async function trello(path, e, init = {}) {
  const r = await fetch(`${TRELLO}${path}${path.includes('?') ? '&' : '?'}${auth(e)}`, init);
  const text = await r.text();
  let j; try { j = JSON.parse(text); } catch { j = { message: text.slice(0, 200) }; }
  return { ok: r.ok, status: r.status, j };
}

async function check(res) {
  const e = env();
  const miss = missing(e);
  const out = { configured: miss.length === 0, missing: miss, api_key: e.key ? 'set (value hidden)' : 'missing', token: e.token ? 'set (value hidden)' : 'missing', lab_phrase: labOk(e) ? 'set (value hidden)' : e.lab ? 'too short or too long (needs 32–256 characters)' : 'missing' };
  if (!e.key || !e.token || !e.list) return send(res, 200, { ...out, provider: 'not checked: settings missing' });
  const r = await trello(`/lists/${encodeURIComponent(e.list)}?fields=name,closed,idBoard&board=true&board_fields=name,url`, e);
  if (r.ok) Object.assign(out, { provider: 'connected: list found', list: r.j.name, board: r.j.board?.name, board_url: r.j.board?.url, list_closed: r.j.closed });
  else out.provider = `Trello refused (HTTP ${r.status}: ${clean(r.j.message || r.j, 120)}). Check the key, token and list ID.`;
  return send(res, 200, out);
}

async function readBack(res, id) {
  const e = env();
  if (!e.key || !e.token) return send(res, 503, { error: 'not_configured' });
  if (!/^[0-9a-f]{24}$/i.test(id)) return send(res, 400, { error: 'bad_id' });
  const r = await trello(`/cards/${id}?fields=name,desc,idList,shortUrl,dateLastActivity&list=true&list_fields=name&board=true&board_fields=name`, e);
  if (!r.ok) return send(res, r.status, { error: 'provider_error', message: clean(r.j.message || r.j, 200) });
  return send(res, 200, { id: r.j.id, url: r.j.shortUrl, name: r.j.name, desc: r.j.desc, list: r.j.list?.name, idList: r.j.idList, board: r.j.board?.name, last_activity: r.j.dateLastActivity });
}

// Re-read the segment from the database so the card's numbers and record IDs are the server's, not the browser's.
async function segmentFacts(seg) {
  const p = PERIODS[seg.period];
  const q = new URLSearchParams({ select: 'conjunction_id,satellite_name,object_name,tca_utc,miss_distance_m,pc,risk_tier,status,plane,source_group', order: 'pc.desc' });
  q.append('tca_date', `gte.${p.start}`); q.append('tca_date', `lte.${p.end}`);
  if (seg.kind === 'plane') q.append('plane', `eq.${seg.value}`); else q.append('source_group', `eq.${seg.value}`);
  if (seg.plane) q.append('plane', `eq.${seg.plane}`);
  if (seg.objType) q.append('object_type', `eq.${seg.objType}`);
  const r = await fetch(`${SB_URL}/rest/v1/v_conjunction?${q}`, { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, Range: '0-4999' } });
  if (!r.ok) throw new Error(`v_conjunction HTTP ${r.status}`);
  const rows = await r.json();
  const el = rows.filter((c) => c.risk_tier !== 'Low');
  return { total: rows.length, elevated: el.length, high: el.filter((c) => c.risk_tier === 'High').length, awaiting: el.filter((c) => c.risk_tier === 'High' && c.status === 'Awaiting decision').length, expected: rows.reduce((a, c) => a + c.pc, 0), top: el.slice(0, 5) };
}

async function post(req, res) {
  const e = env();
  const miss = missing(e);
  if (miss.length) return send(res, 503, { error: 'not_configured', missing: miss, message: `Trello is not connected yet. Add ${miss.join(', ')} in Vercel (project orbit-watch → Settings → Environment Variables), then redeploy. No card was created.` });
  const b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
  if (!b.confirm) return send(res, 400, { error: 'not_confirmed', message: 'Review and confirm the card first. No card was created.' });
  if (!UUID.test(String(b.request_id || ''))) return send(res, 400, { error: 'bad_request_id', message: 'Missing request ID. No card was created.' });
  if (!phraseOk(e, b.lab_phrase)) return send(res, 401, { error: 'bad_lab_phrase', message: 'The lab phrase is not correct. No card was created.' });
  const title = clean(b.title, 200), desc = clean(b.description, 6000);
  if (!title || !desc) return send(res, 400, { error: 'empty', message: 'Title and description are required. No card was created.' });
  const s = b.segment || {};
  const seg = { kind: s.kind === 'source' ? 'source' : 'plane', period: PERIODS[s.period] ? s.period : 'next30', objType: OBJ.includes(s.objType) ? s.objType : null, plane: null };
  if (seg.kind === 'plane') { seg.value = Number(s.value); if (!(seg.value >= 1 && seg.value <= 6)) return send(res, 400, { error: 'bad_segment', message: 'Unknown plane. No card was created.' }); }
  else { seg.value = clean(s.value, 80); if (!seg.value) return send(res, 400, { error: 'bad_segment', message: 'Unknown source. No card was created.' }); seg.plane = Number(s.plane) >= 1 && Number(s.plane) <= 6 ? Number(s.plane) : null; }

  let f;
  try { f = await segmentFacts(seg); } catch (err) { return send(res, 502, { error: 'segment_failed', message: `Could not re-read the segment (${err.message}). No card was created.` }); }
  const segLine = `${seg.kind === 'plane' ? `Plane ${seg.value}` : `Source: ${seg.value}${seg.plane ? `, plane ${seg.plane}` : ''}`} · ${PERIODS[seg.period].label} · ${seg.objType ? `other object: ${seg.objType}` : 'all objects'}`;
  const footer = [
    '', '---', '**Segment snapshot (read by the server at creation time)**',
    `Segment: ${segLine}`,
    `Close approaches: ${f.total} · elevated-risk (high + medium): ${f.elevated} · high: ${f.high} (${f.awaiting} awaiting a maneuver decision) · expected collisions (sum of Pc): ${f.expected.toFixed(5)}`,
    'Riskiest records:',
    ...f.top.map((c) => `- ${c.conjunction_id}: ${c.satellite_name} × ${c.object_name}, ${c.tca_utc.slice(0, 16).replace('T', ' ')} UTC, ${Math.round(c.miss_distance_m)} m, Pc 1 in ${Math.round(1 / c.pc).toLocaleString('en-US')} (${c.risk_tier}, ${c.status})`),
    b.link ? `Open this segment: ${clean(b.link, 300)}` : '',
    `Action request: ${b.request_id}`,
    'Orbits: CelesTrak (real). Close approaches: synthetic (seed 20261110), course project.',
  ].filter((x) => x !== '').join('\n');
  const fullDesc = `${desc}\n${footer}`;

  const form = new URLSearchParams({ idList: e.list, name: title, desc: fullDesc, pos: 'top' });
  const r = await trello('/cards', e, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form });
  if (!r.ok) return send(res, r.status, { error: 'provider_error', message: `Trello refused the card: ${clean(r.j.message || r.j, 200)}. No card was created.` });
  // independent read-back: fetch the card again and compare it with what was approved
  const v = await trello(`/cards/${r.j.id}?fields=name,desc,idList,shortUrl&list=true&list_fields=name`, e);
  const match = v.ok && v.j.name === title && v.j.desc === fullDesc && v.j.idList === e.list;
  return send(res, 200, { ok: true, id: r.j.id, url: r.j.shortUrl, request_id: b.request_id, list: v.j?.list?.name, segment: segLine, snapshot: { ...f, top: f.top.map((c) => c.conjunction_id) }, readback: { checked: v.ok, match, name: v.j?.name }, created_at: new Date().toISOString() });
}

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') return req.query.id ? readBack(res, String(req.query.id)) : check(res);
    if (req.method === 'POST') return post(req, res);
    res.setHeader('Allow', 'GET, POST');
    return send(res, 405, { error: 'method_not_allowed' });
  } catch (err) {
    return send(res, 500, { error: 'server_error', message: `${err.message}. If unsure whether a card was created, check your Trello list before retrying.` });
  }
}
