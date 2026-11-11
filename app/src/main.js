import Globe from 'globe.gl';
import * as THREE from 'three';
import * as sat from 'satellite.js';

// ---------- config ----------
// Publishable key: read-only by row-level security (inserts are refused), safe in the browser.
const SB_URL = import.meta.env.VITE_SUPABASE_URL || 'https://xglluiuymeqzlykvauft.supabase.co';
const SB_KEY = import.meta.env.VITE_SUPABASE_KEY || 'sb_publishable_NHMHR3WqfGaFKCE1jzLSfw_2vfhDDHM';
const AS_OF = '2026-11-10';
const PERIODS = {
  next30: { start: '2026-11-10', end: '2026-12-09', label: 'Next 30 days', cmpStart: '2026-10-11', cmpEnd: '2026-11-09', cmpLabel: 'last 30 days' },
  last30: { start: '2026-10-11', end: '2026-11-09', label: 'Last 30 days', cmpStart: '2026-09-11', cmpEnd: '2026-10-10', cmpLabel: 'previous 30 days' },
};
const TIER = { High: { color: '#d03b3b', rank: 1 }, Medium: { color: '#fab219', rank: 2 }, Low: { color: '#9ec5f4', rank: 3 } };
const EARTH_R = 6371;
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

const state = { period: 'next30', plane: null, objType: null, selSat: null, selConj: null, speed: 10 };
let DATA = null;

// ---------- data ----------
const H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` };
async function getAll(path) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const r = await fetch(`${SB_URL}/rest/v1/${path}`, { headers: { ...H, Range: `${from}-${from + 999}` } });
    if (!r.ok) throw new Error(`${path.split('?')[0]}: HTTP ${r.status}`);
    const rows = await r.json();
    out.push(...rows);
    if (rows.length < 1000) return out;
  }
}
async function kpi(start, end, plane) {
  const r = await fetch(`${SB_URL}/rest/v1/rpc/kpi_summary`, {
    method: 'POST', headers: { ...H, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_start: start, p_end: end, p_plane: plane, p_object_type: state.objType }),
  });
  if (!r.ok) throw new Error(`kpi_summary: HTTP ${r.status}`);
  return (await r.json())[0];
}
const ELEM = 'epoch,mean_motion,eccentricity,inclination_deg,raan_deg,arg_perigee_deg,mean_anomaly_deg,bstar';
async function load() {
  const [sats, objs, conj] = await Promise.all([
    getAll(`dim_satellite?select=satellite_id,name,plane,role,mean_altitude_km,${ELEM}&order=satellite_id`),
    getAll(`dim_object?select=object_id,name,object_type,source_group,${ELEM}&order=object_id`),
    getAll('v_conjunction?select=conjunction_id,satellite_id,object_id,tca_utc,tca_date,miss_distance_m,relative_velocity_kms,pc,risk_tier,status,plane,source_group,object_name,object_type&order=conjunction_id'),
  ]);
  const satrec = (r, id) => sat.json2satrec({
    OBJECT_NAME: r.name, OBJECT_ID: String(id), EPOCH: r.epoch, MEAN_MOTION: r.mean_motion, ECCENTRICITY: r.eccentricity,
    INCLINATION: r.inclination_deg, RA_OF_ASC_NODE: r.raan_deg, ARG_OF_PERICENTER: r.arg_perigee_deg,
    MEAN_ANOMALY: r.mean_anomaly_deg, EPHEMERIS_TYPE: 0, CLASSIFICATION_TYPE: 'U', NORAD_CAT_ID: id,
    ELEMENT_SET_NO: 999, REV_AT_EPOCH: 0, BSTAR: r.bstar, MEAN_MOTION_DOT: 0, MEAN_MOTION_DDOT: 0,
  });
  sats.forEach((s) => { s.rec = satrec(s, s.satellite_id); });
  objs.forEach((o) => { o.rec = satrec(o, o.object_id); });
  return { sats, objs, conj, satById: new Map(sats.map((s) => [s.satellite_id, s])), objById: new Map(objs.map((o) => [o.object_id, o])) };
}

// ---------- orbit math ----------
function geo(rec, date) {
  const pv = sat.propagate(rec, date);
  if (!pv || !pv.position || isNaN(pv.position.x)) return null;
  const g = sat.eciToGeodetic(pv.position, sat.gstime(date));
  const v = pv.velocity;
  return { lat: sat.degreesLat(g.latitude), lng: sat.degreesLong(g.longitude), alt: g.height / EARTH_R,
    height: g.height, speed: Math.hypot(v.x, v.y, v.z) };
}
function orbitRing(rec, date) {
  // one full revolution drawn in the Earth frame of `date` (the orbit plane as seen now)
  const gmst = sat.gstime(date);
  const period = (2 * Math.PI / rec.no) * 60 * 1000; // rec.no = rad/min
  const pts = [];
  for (let i = 0; i <= 120; i++) {
    const pv = sat.propagate(rec, new Date(date.getTime() + (period * i) / 120));
    if (!pv || !pv.position) continue;
    const g = sat.eciToGeodetic(pv.position, gmst);
    pts.push([sat.degreesLat(g.latitude), sat.degreesLong(g.longitude), g.height / EARTH_R]);
  }
  return pts;
}
function subsolar(date) {
  const doy = (Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) - Date.UTC(date.getUTCFullYear(), 0, 0)) / 864e5;
  const decl = 23.44 * Math.sin((2 * Math.PI * (284 + doy)) / 365);
  const hours = date.getUTCHours() + date.getUTCMinutes() / 60;
  return { lat: decl, lng: -(hours - 12) * 15 };
}

// ---------- globe ----------
const dayNightMaterial = new THREE.ShaderMaterial({
  uniforms: {
    dayTexture: { value: new THREE.TextureLoader().load('/img/earth-blue-marble.jpg') },
    nightTexture: { value: new THREE.TextureLoader().load('/img/earth-night.jpg') },
    sunDirection: { value: new THREE.Vector3(1, 0, 0) },
  },
  vertexShader: `varying vec3 vNormal; varying vec2 vUv;
    void main(){ vUv = uv; vNormal = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `uniform sampler2D dayTexture; uniform sampler2D nightTexture; uniform vec3 sunDirection;
    varying vec3 vNormal; varying vec2 vUv;
    void main(){ float i = dot(normalize(vNormal), normalize(sunDirection));
      vec3 day = texture2D(dayTexture, vUv).rgb; vec3 night = texture2D(nightTexture, vUv).rgb * 1.4;
      float b = smoothstep(-0.12, 0.18, i); gl_FragColor = vec4(mix(night, day * (0.75 + 0.25 * b), b), 1.0); }`,
});

const meshes = new Map();
let world, simTime = Date.now(), lastTick = performance.now();
function initGlobe() {
  const el = document.getElementById('globe');
  world = new Globe(el, { rendererConfig: { antialias: true, alpha: false } })
    .backgroundImageUrl('/img/night-sky.png')
    .globeMaterial(dayNightMaterial)
    .showAtmosphere(true).atmosphereColor('#7fb4ff').atmosphereAltitude(0.16)
    // tracked objects (debris, rocket bodies, other payloads)
    .particlesList((d) => d).particleLat('lat').particleLng('lng').particleAltitude('alt')
    .particlesSize(1.6).particlesSizeAttenuation(false).particlesColor(() => 'rgba(190,190,190,0.55)')
    // our fleet
    .objectLat('lat').objectLng('lng').objectAltitude('alt').objectFacesSurface(false)
    .objectThreeObject((d) => {
      const m = new THREE.Mesh(new THREE.SphereGeometry(d.size, 16, 16), new THREE.MeshBasicMaterial({ color: d.color }));
      m.__sat = d.id;
      meshes.set(d.id, m);
      return m;
    })
    .objectLabel((d) => { const g = geo(DATA.satById.get(d.id).rec, new Date(simTime)); return `<b>${d.name}</b><br/>Plane ${d.plane} · ${d.role}<br/>Speed ${g ? g.speed.toFixed(2) : '–'} km/s · altitude ${g ? Math.round(g.height) : '–'} km<br/>${d.tierLabel}`; })
    .onObjectClick((d) => select({ sat: d.id }))
    // orbit rings
    .pathPoints((d) => d.pts).pathPointLat((p) => p[0]).pathPointLng((p) => p[1]).pathPointAlt((p) => p[2])
    .pathColor((d) => d.color).pathStroke((d) => d.stroke).pathTransitionDuration(0)
    .onGlobeClick(() => select({}));
  world.controls().autoRotate = true;
  world.controls().autoRotateSpeed = 0.25;
  el.addEventListener('pointerdown', () => { world.controls().autoRotate = false; }, { once: true });
  world.pointOfView({ lat: 25, lng: -40, altitude: 2.6 });
  const fit = () => { const w = document.getElementById('globe-wrap'); world.width(w.clientWidth).height(w.clientHeight); };
  window.addEventListener('resize', fit); fit();
}

function satTiers() {
  const p = PERIODS[state.period];
  const worst = new Map();
  for (const c of DATA.conj) {
    if (c.tca_date < p.start || c.tca_date > p.end || (state.objType && c.object_type !== state.objType)) continue;
    const cur = worst.get(c.satellite_id);
    if (!cur || TIER[c.risk_tier].rank < TIER[cur].rank) worst.set(c.satellite_id, c.risk_tier);
  }
  return worst;
}

function updatePositions() {
  // rebuild the fleet layer (on filter / selection change); motion happens in animate()
  const now = new Date(simTime);
  const worst = satTiers();
  const fleet = [];
  meshes.clear();
  const fp = state.view === 'where' ? state.focusPlane : null;
  for (const s of DATA.sats) {
    if (state.plane && s.plane !== state.plane) continue;
    if (fp && s.plane !== fp) continue;
    const g = geo(s.rec, now);
    if (!g) continue;
    const t = worst.get(s.satellite_id) || 'Low';
    const sel = state.selSat === s.satellite_id;
    fleet.push({ id: s.satellite_id, name: s.name, plane: s.plane, role: s.role, lat: g.lat, lng: g.lng, alt: g.alt,
      color: TIER[t].color, size: sel ? 2.4 : t === 'High' ? 1.7 : 1.15,
      tierLabel: t === 'Low' ? 'No elevated risk in period' : `${t} risk close approach in period` });
  }
  world.objectsData(fleet);
  updateSlowLayers();
}

function updateSlowLayers() {
  const now = new Date(simTime);
  updateParticles();
  const ss = subsolar(now);
  const c = world.getCoords(ss.lat, ss.lng, 0);
  dayNightMaterial.uniforms.sunDirection.value.set(c.x, c.y, c.z).normalize();
  document.getElementById('clock').textContent = now.toISOString().slice(0, 16).replace('T', ' ');
  if (state.selSat) {
    const g = geo(DATA.satById.get(state.selSat).rec, now);
    const el = document.getElementById('live-speed');
    if (g && el) el.textContent = `${g.speed.toFixed(2)} km/s (${Math.round(g.speed * 3600).toLocaleString('en-US')} km/h) · altitude ${Math.round(g.height)} km`;
  }
}

function updateParticles() {
  const now = new Date(simTime);
  const parts = [];
  for (const o of DATA.objs) { const g = geo(o.rec, now); if (g) parts.push(g); }
  world.particlesData([parts]);
}

function animate() {
  // every frame: advance simulated time and move each satellite smoothly
  const t = performance.now();
  simTime += (t - lastTick) * state.speed;
  lastTick = t;
  const now = new Date(simTime);
  for (const [id, m] of meshes) {
    const g = geo(DATA.satById.get(id).rec, now);
    if (!g) continue;
    const c = world.getCoords(g.lat, g.lng, g.alt);
    (m.parent || m).position.set(c.x, c.y, c.z); // the globe wraps each mesh in a positioned group
  }
  requestAnimationFrame(animate);
}

function updateOrbits() {
  const now = new Date(simTime);
  const worst = satTiers();
  const paths = [];
  const fp = state.view === 'where' ? state.focusPlane : null;
  for (const s of DATA.sats) {
    if (state.plane && s.plane !== state.plane) continue;
    if (fp && s.plane !== fp) continue;
    const sel = state.selSat === s.satellite_id;
    const t = worst.get(s.satellite_id) || 'Low';
    const base = t === 'High' ? 'rgba(208,59,59,0.55)' : t === 'Medium' ? 'rgba(250,178,25,0.30)' : 'rgba(158,197,244,0.16)';
    paths.push({ pts: orbitRing(s.rec, now), color: sel ? '#ffffff' : base, stroke: sel ? 1.6 : t === 'High' ? 0.9 : null });
  }
  if (state.selConj) {
    const c = DATA.conj.find((x) => x.conjunction_id === state.selConj);
    const o = c && DATA.objById.get(c.object_id);
    if (o) paths.push({ pts: orbitRing(o.rec, now), color: TIER[c.risk_tier].color, stroke: 1.4 });
  }
  world.pathsData(paths);
}


// ---------- panel ----------
const fmt = (n, d = 2) => (n == null ? '–' : Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }));
const oneIn = (pc) => (pc > 0 ? `1 in ${Math.round(1 / pc).toLocaleString('en-US')}` : '–');
const inScope = (c) => (!state.plane || c.plane === state.plane) && (!state.objType || c.object_type === state.objType);
const inPeriod = (c, p) => c.tca_date >= p.start && c.tca_date <= p.end && inScope(c);
const OBJ_LABEL = { Debris: 'debris', Payload: 'payloads', 'Rocket body': 'rocket bodies' };
const scopeText = () => [state.plane ? `plane ${state.plane}` : null, state.objType ? `${OBJ_LABEL[state.objType]} only` : null].filter(Boolean).join(', ') || 'whole fleet, all objects';

let kpiTicket = 0;
async function renderKpis() {
  const p = PERIODS[state.period];
  const box = document.getElementById('kpis');
  const ticket = ++kpiTicket;
  box.innerHTML = '<p class="hint">Loading KPIs…</p>';
  const [cur, cmp] = await Promise.all([kpi(p.start, p.end, state.plane), kpi(p.cmpStart, p.cmpEnd, state.plane)]);
  if (ticket !== kpiTicket) return; // a newer filter change is already loading; drop this stale answer
  if (!cur.conjunctions) {
    box.innerHTML = `<div class="empty-state"><b>No close approaches match these filters.</b><br/>${p.label}, ${scopeText()}: 0 events, so rates and shares are not shown (they would be misleading zeros). Try <b>Other object: All</b> or reset the filters.</div>`;
    return;
  }
  const tiles = [
    ['Close approaches per satellite', cur.conjunctions_per_sat_30d, cmp.conjunctions_per_sat_30d, 2, 'per 30 days', `${cur.conjunctions.toLocaleString()} close approaches, ${cur.satellites_in_scope} satellites`],
    ['High-risk share', cur.high_risk_share_pct, cmp.high_risk_share_pct, 2, '%', `${cur.high_risk} high-risk events (Pc ≥ 1 in 10,000)`],
    ['Avoidance maneuvers per satellite', cur.avoidance_maneuvers_per_sat, cmp.avoidance_maneuvers_per_sat, 3, 'burns', `${cur.avoidance_maneuvers} burns, ${fmt(cur.avoidance_fuel_kg, 3)} kg fuel`],
    ['Expected collisions', cur.expected_collisions, cmp.expected_collisions, 4, 'sum of Pc', `≈ 1 in ${Math.round(1 / Math.max(cur.expected_collisions, 1e-9)).toLocaleString()}`],
  ];
  box.innerHTML = tiles.map(([label, v, c, d, unit, foot]) => {
    const diff = v != null && c != null ? Number(v) - Number(c) : null;
    const arrow = diff == null ? '' : diff > 0 ? '▲' : diff < 0 ? '▼' : '■';
    return `<div class="kpi" title="${foot}"><div class="label">${label}</div>
      <div class="value">${fmt(v, d)} <span class="unit">${unit}</span></div>
      <div class="delta">${arrow} ${diff == null ? '–' : fmt(Math.abs(diff), d)} vs ${p.cmpLabel} (${fmt(c, d)})</div></div>`;
  }).join('');
}

function renderDecision() {
  const p = PERIODS[state.period];
  const el = document.getElementById('decision');
  const rows = DATA.conj.filter((c) => inPeriod(c, p) && c.risk_tier === 'High');
  if (state.period === 'next30') {
    const open = rows.filter((c) => c.status === 'Awaiting decision');
    const planned = rows.filter((c) => c.status === 'Maneuver planned');
    const sats = new Set(open.map((c) => c.satellite_id)).size;
    el.className = open.length ? 'decision' : 'decision calm';
    el.innerHTML = open.length
      ? `<b class="big">${open.length}</b> high-risk close approaches on <b>${sats}</b> satellites await a maneuver decision in the next 30 days. ${planned.length} already have a planned burn.`
      : `No high-risk close approaches await a decision (${scopeText()}). ${planned.length} have a planned burn.`;
  } else {
    const mit = rows.filter((c) => c.status === 'Mitigated').length;
    el.className = 'decision calm';
    el.innerHTML = `<b class="big">${rows.length}</b> high-risk close approaches in the last 30 days: ${mit} avoided with a maneuver, ${rows.length - mit} cleared by later tracking.`;
  }
}

function tipOn(e, html) { const t = document.getElementById('tip'); t.innerHTML = html; t.classList.remove('hidden'); t.style.left = `${Math.min(e.clientX + 12, innerWidth - 250)}px`; t.style.top = `${e.clientY + 12}px`; }
function tipOff() { document.getElementById('tip').classList.add('hidden'); }

function isoWeekStart(d) { const x = new Date(`${d}T00:00:00Z`); const day = (x.getUTCDay() + 6) % 7; x.setUTCDate(x.getUTCDate() - day); return x.toISOString().slice(0, 10); }

function renderWeekly() {
  const weeks = new Map();
  for (const c of DATA.conj) {
    if (!inScope(c)) continue;
    const w = isoWeekStart(c.tca_date);
    if (!weeks.has(w)) weeks.set(w, { w, high: 0, med: 0 });
    if (c.risk_tier === 'High') weeks.get(w).high++;
    else if (c.risk_tier === 'Medium') weeks.get(w).med++;
  }
  // drop partial first/last weeks (data starts 12 Aug, ends 9 Dec)
  const list = [...weeks.values()].sort((a, b) => a.w.localeCompare(b.w)).filter((x) => x.w >= '2026-08-17' && x.w <= '2026-11-30');
  const el0 = document.getElementById('weekly');
  const total = list.reduce((a, x) => a + x.high + x.med, 0);
  if (!total) {
    el0.innerHTML = '<p class="empty">No elevated-risk close approaches for this selection, so there is nothing to chart.</p>';
    document.getElementById('weekly-summary').textContent = '';
    document.getElementById('weekly-table').innerHTML = '';
    return;
  }
  const fcWeek = isoWeekStart(AS_OF);
  const past = list.filter((x) => x.w < fcWeek), fut = list.filter((x) => x.w >= fcWeek);
  const avg = (a) => (a.length ? a.reduce((t, x) => t + x.high + x.med, 0) / a.length : 0);
  const peak = list.reduce((m, x) => (x.high + x.med > m.high + m.med ? x : m), list[0]);
  const wk = (w) => new Date(`${w}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  document.getElementById('weekly-summary').textContent = `Summary (${scopeText()}): about ${avg(past).toFixed(0)} elevated-risk close approaches per week so far; the forecast weeks average ${avg(fut).toFixed(0)}. Busiest week: ${wk(peak.w)} with ${peak.high + peak.med} (${peak.high} high).`;
  document.getElementById('weekly-table').innerHTML = `<table><thead><tr><th>Week of</th><th class="n">High</th><th class="n">Medium</th><th class="n">Total</th><th>Type</th></tr></thead><tbody>${list.map((x) => `<tr><td>${wk(x.w)}</td><td class="n">${x.high}</td><td class="n">${x.med}</td><td class="n">${x.high + x.med}</td><td>${x.w >= fcWeek ? 'Forecast' : 'Actual'}</td></tr>`).join('')}</tbody></table>`;
  const W = 400, Hh = 150, L = 28, B = 22, T = 8, max = Math.max(...list.map((x) => x.high + x.med), 1);
  const bw = (W - L) / list.length;
  const y = (v) => T + (Hh - T - B) * (1 - v / max);
  const ticks = [0, Math.round(max / 2), max];
  let s = `<svg viewBox="0 0 ${W} ${Hh}" role="img" aria-label="Elevated-risk close approaches per week">`;
  ticks.forEach((t) => { s += `<line x1="${L}" x2="${W}" y1="${y(t)}" y2="${y(t)}" stroke="${css('--grid')}" stroke-width="1"/><text x="${L - 6}" y="${y(t) + 4}" text-anchor="end">${t}</text>`; });
  list.forEach((x, i) => {
    const v = x.high + x.med, fc = x.w >= isoWeekStart(AS_OF);
    const hgt = Math.max(Hh - B - y(v), 0);
    s += `<rect data-i="${i}" x="${L + i * bw + 1}" y="${y(v)}" width="${bw - 2}" height="${hgt}" rx="2" fill="${fc ? css('--forecast') : css('--accent')}" opacity="${fc ? 0.55 : 1}"/>`;
    s += `<rect class="hit" data-i="${i}" x="${L + i * bw}" y="${T}" width="${bw}" height="${Hh - T - B}" fill="transparent"/>`;
    if (i % 3 === 0) s += `<text x="${L + i * bw + bw / 2}" y="${Hh - 6}" text-anchor="middle">${new Date(`${x.w}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}</text>`;
  });
  const asx = L + list.findIndex((x) => x.w === isoWeekStart(AS_OF)) * bw;
  s += `<line x1="${asx}" x2="${asx}" y1="${T}" y2="${Hh - B}" stroke="${css('--ink-2')}" stroke-dasharray="3 3"/><text x="${asx + 4}" y="${T + 10}" class="val" text-anchor="start">today</text>`;
  s += `<line x1="${L}" x2="${W}" y1="${Hh - B}" y2="${Hh - B}" stroke="${css('--axis')}"/></svg>`;
  const el = document.getElementById('weekly');
  el.innerHTML = s;
  el.querySelectorAll('.hit').forEach((r) => {
    const x = list[+r.dataset.i];
    r.addEventListener('mousemove', (e) => tipOn(e, `<b>Week of ${x.w}</b>${x.w >= isoWeekStart(AS_OF) ? ' (forecast)' : ''}<br/>${x.high + x.med} elevated-risk<br/>${x.high} high · ${x.med} medium`));
    r.addEventListener('mouseleave', tipOff);
  });
}

function renderSources() {
  const p = PERIODS[state.period];
  const by = new Map();
  for (const c of DATA.conj) {
    if (!inPeriod(c, p) || c.risk_tier === 'Low') continue;
    const k = c.source_group;
    by.set(k, (by.get(k) || 0) + 1);
  }
  const total = [...by.values()].reduce((a, b) => a + b, 0);
  const rows = [...by.entries()].sort((a, b) => b[1] - a[1]);
  const el = document.getElementById('sources');
  const label = (k) => k.replace('FENGYUN 1C', 'Fengyun-1C').replace('COSMOS 2251', 'Cosmos 2251').replace('IRIDIUM 33', 'Iridium 33');
  if (!rows.length) {
    el.innerHTML = '<p class="empty">No elevated-risk close approaches in this selection.</p>';
    document.getElementById('sources-summary').textContent = '';
    document.getElementById('sources-table').innerHTML = '';
    return;
  }
  document.getElementById('sources-summary').textContent = `Summary (${p.label.toLowerCase()}, ${scopeText()}): ${label(rows[0][0])} causes ${Math.round((100 * rows[0][1]) / total)}% of the ${total} elevated-risk close approaches.`;
  document.getElementById('sources-table').innerHTML = `<table><thead><tr><th>Source</th><th class="n">Close approaches</th><th class="n">Share</th></tr></thead><tbody>${rows.map(([k, v]) => `<tr><td>${label(k)}</td><td class="n">${v}</td><td class="n">${Math.round((100 * v) / total)}%</td></tr>`).join('')}</tbody></table>`;
  const W = 400, rh = 26, L = 150, max = rows[0][1];
  let s = `<svg viewBox="0 0 ${W} ${rows.length * rh + 4}" role="img" aria-label="Elevated-risk close approaches by source">`;
  rows.forEach(([k, v], i) => {
    const w = ((W - L - 70) * v) / max, yy = i * rh + 4;
    s += `<text x="0" y="${yy + 15}" class="val">${label(k)}</text><rect x="${L}" y="${yy + 4}" width="${Math.max(w, 2)}" height="14" rx="2" fill="${css('--accent')}"/>`;
    s += `<text x="${L + w + 6}" y="${yy + 15}" class="val">${v} · ${Math.round((100 * v) / total)}%</text>`;
  });
  el.innerHTML = s + '</svg>';
}

function renderTop() {
  const p = PERIODS[state.period];
  const rows = DATA.conj.filter((c) => inPeriod(c, p)).sort((a, b) => b.pc - a.pc).slice(0, 10);
  const el = document.getElementById('top');
  if (!rows.length) { el.innerHTML = `<div class="empty-state"><b>No close approaches match these filters.</b><br/>${p.label}, ${scopeText()}. Try <b>Other object: All</b> or reset the filters.</div>`; return; }
  el.innerHTML = rows.map((c, i) => {
    const s = DATA.satById.get(c.satellite_id);
    const when = new Date(c.tca_utc).toISOString().slice(5, 16).replace('T', ' ');
    return `<button class="row ${state.selConj === c.conjunction_id ? 'sel' : ''}" data-c="${c.conjunction_id}">
      <span class="rank">${i + 1}</span>
      <span class="main">${s.name} × ${c.object_name}<small>${when} UTC · ${fmt(c.miss_distance_m, 0)} m · plane ${c.plane} · ${c.status}</small></span>
      <span class="pc"><span class="tier"><i style="background:${TIER[c.risk_tier].color}"></i>${c.risk_tier}</span><small>${oneIn(c.pc)}</small></span>
    </button>`;
  }).join('');
  el.querySelectorAll('.row').forEach((b) => b.addEventListener('click', () => {
    const c = DATA.conj.find((x) => x.conjunction_id === b.dataset.c);
    select({ sat: c.satellite_id, conj: c.conjunction_id });
  }));
}

function renderSelection() {
  const el = document.getElementById('selection');
  if (!state.selSat) { el.classList.add('hidden'); return; }
  const s = DATA.satById.get(state.selSat);
  const p = PERIODS[state.period];
  const evs = DATA.conj.filter((c) => c.satellite_id === s.satellite_id && inPeriod(c, p));
  const hi = evs.filter((c) => c.risk_tier === 'High').length, med = evs.filter((c) => c.risk_tier === 'Medium').length;
  const c = state.selConj && DATA.conj.find((x) => x.conjunction_id === state.selConj);
  el.innerHTML = `<div class="crumbs">Fleet › Plane ${s.plane} › ${s.name}${c ? ` › ${c.conjunction_id}` : ''}</div>
    <h3>${c ? `${s.name} × ${c.object_name}` : s.name}</h3>
    ${c ? `<dl><dt>Speed now</dt><dd id="live-speed">–</dd><dt>Closest approach</dt><dd>${c.tca_utc.replace('T', ' ').slice(0, 16)} UTC</dd>
      <dt>Miss distance</dt><dd>${fmt(c.miss_distance_m, 0)} m</dd><dt>Closing speed</dt><dd>${fmt(c.relative_velocity_kms, 1)} km/s</dd>
      <dt>Probability</dt><dd>${oneIn(c.pc)} (${c.risk_tier})</dd><dt>Other object</dt><dd>${c.object_type}, ${c.source_group}</dd>
      <dt>Status</dt><dd>${c.status}</dd></dl>`
      : `<dl><dt>Speed now</dt><dd id="live-speed">–</dd><dt>Role</dt><dd>${s.role}, ${fmt(s.mean_altitude_km, 0)} km</dd><dt>${p.label}</dt><dd>${evs.length} close approaches: ${hi} high, ${med} medium</dd></dl>`}
    <button class="link" id="sel-clear">Back to fleet</button>`;
  el.classList.remove('hidden');
  updateSlowLayers();
  document.getElementById('sel-clear').onclick = () => select({});
}

function showTab(t) {
  document.querySelectorAll('.tabs button').forEach((b) => { const on = b.dataset.t === t; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); });
  document.querySelectorAll('.tab').forEach((d) => d.classList.toggle('hidden', d.dataset.t !== t));
  if (t === 'charts') { renderWeekly(); renderSources(); }
}

function select({ sat: id = null, conj = null }) {
  state.selSat = id; state.selConj = conj;
  if (id) {
    world.controls().autoRotate = false;
    const g = geo(DATA.satById.get(id).rec, new Date(simTime));
    if (g) world.pointOfView({ lat: g.lat, lng: g.lng, altitude: 1.4 }, 1200);
  }
  renderSelection(); renderTop(); updateOrbits(); updatePositions();
  if (state.view === 'where') renderPlaneSats();
}

async function renderAll() {
  const p = PERIODS[state.period];
  const d = (x) => new Date(`${x}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  const chips = [[`${p.label} (${d(p.start)}–${d(p.end)})`, state.period === 'next30'], [state.plane ? `Plane ${state.plane}` : 'All planes', !state.plane], [state.objType ? `Other object: ${state.objType}` : 'All objects', !state.objType]];
  document.getElementById('active-chips').innerHTML = chips.map(([t, def]) => `<span class="chip ${def ? 'default' : ''}">${t}</span>`).join(' ');
  document.getElementById('reset').classList.toggle('hidden', state.period === 'next30' && !state.plane && !state.objType);
  document.getElementById('period-note').textContent = `Compared with ${p.cmpLabel} (${d(p.cmpStart)}–${d(p.cmpEnd)}), same filters. Data as of ${d(AS_OF)} 2026: real orbits (CelesTrak), synthetic close approaches.`;
  renderDecision(); renderWeekly(); renderSources(); renderTop(); renderSelection(); updateOrbits(); updatePositions();
  if (state.view === 'where') renderWhere();
  if (state.view === 'why') renderWhy();
  try { await renderKpis(); } catch (e) { document.getElementById('kpis').innerHTML = `<p class="empty">KPIs could not load (${e.message}).</p>`; }
}

function bindUi() {
  document.querySelectorAll('#period button').forEach((b) => b.addEventListener('click', () => {
    document.querySelectorAll('#period button').forEach((x) => x.classList.toggle('on', x === b));
    state.period = b.dataset.p; renderAll();
  }));
  document.getElementById('objtype').addEventListener('change', (e) => { state.objType = e.target.value || null; state.selSat = null; state.selConj = null; renderAll(); });
  document.getElementById('plane').addEventListener('change', (e) => { state.plane = e.target.value ? +e.target.value : null; state.focusPlane = state.plane; state.selSat = null; state.selConj = null; renderAll(); });
  document.getElementById('reset').addEventListener('click', () => {
    state.period = 'next30'; state.plane = null; state.objType = null; state.focusPlane = null; state.whySource = null; state.selSat = null; state.selConj = null;
    document.getElementById('plane').value = ''; document.getElementById('objtype').value = '';
    document.querySelectorAll('#period button').forEach((x) => x.classList.toggle('on', x.dataset.p === 'next30'));
    world.pointOfView({ lat: 25, lng: -40, altitude: 2.6 }, 1000);
    renderAll();
  });
  document.getElementById('speed').addEventListener('click', (e) => {
    state.speed = state.speed === 1 ? 10 : state.speed === 10 ? 60 : 1;
    e.target.textContent = state.speed === 1 ? 'real time' : `${state.speed}× speed`;
  });
  document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.t)));
  document.querySelector('.more').addEventListener('click', () => showTab('top'));
  document.querySelectorAll('[data-go-view]').forEach((b) => b.addEventListener('click', () => go(b.dataset.goView)));
  document.getElementById('sources').addEventListener('click', () => go('why'));
  document.getElementById('weekly').addEventListener('click', () => go('why'));
}

async function start() {
  document.getElementById('error').classList.add('hidden');
  document.getElementById('loading').classList.remove('hidden');
  try {
    DATA = await load();
    if (!world) { initGlobe(); bindUi(); requestAnimationFrame(animate); setInterval(updateSlowLayers, 1000); setInterval(updateParticles, 200); setInterval(updateOrbits, 30000); }
    await renderAll();
    if (location.hash.length > 1) go(location.hash.slice(1), false);
    document.getElementById('loading').classList.add('hidden');
  } catch (e) {
    console.error(e);
    document.getElementById('loading').classList.add('hidden');
    document.getElementById('error-msg').textContent = `Could not load data from the database (${e.message}).`;
    document.getElementById('error').classList.remove('hidden');
  }
}
// bound here, not in bindUi(): bindUi only runs after a first successful load, so a first-load failure left Retry dead
document.getElementById('retry').addEventListener('click', start);
start();

// ---------- Level 2 · diagnostic views ----------
const VIEWS = { overview: 'Overview', where: 'Where is the risk concentrated?', why: 'What might explain the change?' };
state.view = 'overview'; state.focusPlane = null; state.whySource = null;
const isEl = (c) => c.risk_tier !== 'Low';
const objOk = (c) => !state.objType || c.object_type === state.objType;
const inWin = (c, a, b) => c.tca_date >= a && c.tca_date <= b;
const pct = (a, b) => (b ? `${a >= b ? '+' : '−'}${Math.abs(Math.round((100 * (a - b)) / b))}%` : 'n/a');
const srcLabel = (k) => k.replace('FENGYUN 1C', 'Fengyun-1C').replace('COSMOS 2251', 'Cosmos 2251').replace('IRIDIUM 33', 'Iridium 33');
const dd = (x) => new Date(`${x}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

function go(view, push = true) {
  if (!VIEWS[view]) view = 'overview';
  const was = state.view;
  state.view = view;
  if (push && was !== view) history.pushState({ view }, '', view === 'overview' ? location.pathname : `#${view}`);
  ['overview', 'where', 'why'].forEach((v) => document.getElementById(`view-${v}`).classList.toggle('hidden', v !== view));
  document.getElementById('app').classList.toggle('wide', view !== 'overview');
  const cr = document.getElementById('crumbs');
  if (view === 'overview') { cr.classList.add('hidden'); cr.innerHTML = ''; }
  else {
    cr.classList.remove('hidden');
    cr.innerHTML = `<button class="link" id="crumb-home">Overview</button><span aria-hidden="true">›</span><span aria-current="page">${VIEWS[view]}</span>
      <button class="back" id="crumb-back">← Back to overview</button>`;
    document.getElementById('crumb-home').onclick = () => go('overview');
    document.getElementById('crumb-back').onclick = () => go('overview');
  }
  if (view === 'where') { if (state.plane) state.focusPlane = state.plane; renderWhere(); }
  if (view === 'why') renderWhy();
  updateOrbits(); updatePositions();
  window.dispatchEvent(new Event('resize'));
  document.getElementById('panel').scrollTop = 0;
  if (view !== 'overview') document.getElementById('crumb-back').focus({ preventScroll: true });
}
window.addEventListener('popstate', () => go(location.hash.slice(1) || 'overview', false));

function bar(v, max, cls = '') { return `<span class="hbar ${cls}" style="width:${max ? Math.max((100 * v) / max, v ? 1.5 : 0) : 0}%"></span>`; }

async function renderWhere() {
  const p = PERIODS[state.period];
  const el = document.getElementById('view-where');
  const rows = [1, 2, 3, 4, 5, 6].map((pl) => {
    const n = DATA.sats.filter((s) => s.plane === pl).length;
    const cur = DATA.conj.filter((c) => c.plane === pl && objOk(c) && inWin(c, p.start, p.end));
    const cmp = DATA.conj.filter((c) => c.plane === pl && objOk(c) && inWin(c, p.cmpStart, p.cmpEnd));
    return { pl, n, ca: cur.length, el: cur.filter(isEl).length, hi: cur.filter((c) => c.risk_tier === 'High').length,
      elCmp: cmp.filter(isEl).length, pc: cur.reduce((a, c) => a + c.pc, 0) };
  });
  const N = rows.reduce((a, r) => a + r.n, 0), EL = rows.reduce((a, r) => a + r.el, 0), CA = rows.reduce((a, r) => a + r.ca, 0);
  const ELC = rows.reduce((a, r) => a + r.elCmp, 0);
  rows.forEach((r) => { r.rate = r.el / r.n; r.rateCmp = r.elCmp / r.n; r.idx = EL ? (r.el / EL) / (r.n / N) : 0; });
  rows.sort((a, b) => b.rate - a.rate || a.pl - b.pl);
  const fleetRate = EL / N;
  const max = Math.max(...rows.map((r) => Math.max(r.rate, r.rateCmp)), 0.01);
  const fp = state.focusPlane;
  const top = rows[0];
  const scope = state.objType ? `${OBJ_LABEL[state.objType]} only` : 'all objects';

  if (!EL) {
    el.innerHTML = `<h2 class="view-title">${VIEWS.where}</h2><div class="empty-state"><b>Nothing to rank: no elevated-risk close approaches match these filters.</b><br/>${p.label}, ${scope}: ${CA} close approach${CA === 1 ? '' : 'es'} in total, none high or medium risk, so plane shares and rates are not shown (they would read 0% or NaN). <button class="link" data-reset>Reset filters</button> or choose <b>Other object: All</b>.</div>`;
    el.querySelector('[data-reset]').onclick = () => document.getElementById('reset').click();
    return;
  }
  el.innerHTML = `
    <h2 class="view-title">${VIEWS.where}</h2>
    <p class="hint">Elevated-risk close approaches (high + medium) <b>per satellite</b>, by orbital plane · ${p.label} (${dd(p.start)}–${dd(p.end)}) vs ${p.cmpLabel} · ${scope}. Click a plane to see its satellites.</p>
    <p class="chart-summary" id="where-summary">Plane ${top.pl} has the most per satellite: ${top.el} elevated-risk close approaches on ${top.n} satellites (${fmt(top.rate, 1)} each, fleet ${fmt(fleetRate, 1)}). That is ${Math.round((100 * top.el) / EL)}% of the fleet's ${EL} with ${Math.round((100 * top.n) / N)}% of its satellites (${fmt(top.idx, 2)}× its fair share). ${p.cmpLabel[0].toUpperCase() + p.cmpLabel.slice(1)}: ${top.elCmp} (${fmt(top.rateCmp, 1)} each).</p>
    <div class="planes" role="list">
      ${rows.map((r) => `<button class="plane-row ${fp === r.pl ? 'sel' : ''}" data-pl="${r.pl}" role="listitem" aria-pressed="${fp === r.pl}">
        <span class="pl-name">Plane ${r.pl}<small>${r.n} satellites</small></span>
        <span class="pl-bars"><span class="track">${bar(r.rate, max)}<span class="cmp-mark" style="left:${(100 * r.rateCmp) / max}%" title="${p.cmpLabel}"></span><span class="fleet-mark" style="left:${(100 * fleetRate) / max}%"></span></span></span>
        <span class="pl-val"><b>${fmt(r.rate, 1)}</b> / sat<small>${r.el} of ${r.ca} · was ${fmt(r.rateCmp, 1)}</small></span>
      </button>`).join('')}
    </div>
    <p class="legend-line"><span class="lg-bar"></span>${p.label} <span class="lg-cmp"></span>${p.cmpLabel} <span class="lg-fleet"></span>fleet average ${fmt(fleetRate, 1)}</p>
    <div class="check" id="where-check">
      <b>Reconciliation</b><br/>
      Planes add up to <b>${CA.toLocaleString()}</b> close approaches and <b>${EL}</b> elevated-risk ones, on <b>${N}</b> satellites.
      <span id="where-db">Checking against the database…</span><br/>
      Fleet rate = ${EL} ÷ ${N} = <b>${fmt(fleetRate, 2)}</b> per satellite, recomputed from the totals (never by averaging plane rates).
    </div>
    <p class="note">Small numbers: each plane has 13–14 satellites and about ${Math.round(EL / 6)} elevated events a month, so a gap of ±10 between planes can be normal month-to-month variation. Compare with ${p.cmpLabel} before acting.</p>
    <details class="table-alt"><summary>Show data table</summary><table><thead><tr><th>Plane</th><th class="n">Satellites</th><th class="n">Close approaches</th><th class="n">Per sat (30 d)</th><th class="n">Elevated</th><th class="n">High</th><th class="n">Elevated / sat</th><th class="n">Was</th><th class="n">Share of elevated</th><th class="n">Share of sats</th><th class="n">Exp. collisions</th></tr></thead>
      <tbody>${rows.map((r) => `<tr><td>${r.pl}</td><td class="n">${r.n}</td><td class="n">${r.ca}</td><td class="n">${fmt(r.ca / r.n, 2)}</td><td class="n">${r.el}</td><td class="n">${r.hi}</td><td class="n">${fmt(r.rate, 2)}</td><td class="n">${fmt(r.rateCmp, 2)}</td><td class="n">${Math.round((100 * r.el) / EL)}%</td><td class="n">${Math.round((100 * r.n) / N)}%</td><td class="n">${fmt(r.pc, 4)}</td></tr>`).join('')}
      <tr class="tot"><td>Fleet</td><td class="n">${N}</td><td class="n">${CA}</td><td class="n">${fmt(CA / N, 2)}</td><td class="n">${EL}</td><td class="n">${rows.reduce((a, r) => a + r.hi, 0)}</td><td class="n">${fmt(fleetRate, 2)}</td><td class="n">${fmt(ELC / N, 2)}</td><td class="n">100%</td><td class="n">100%</td><td class="n">${fmt(rows.reduce((a, r) => a + r.pc, 0), 4)}</td></tr></tbody></table></details>
    <section class="card sats-card" id="sats-card"></section>`;
  el.querySelectorAll('.plane-row').forEach((b) => b.addEventListener('click', () => {
    state.focusPlane = state.focusPlane === +b.dataset.pl ? null : +b.dataset.pl;
    renderWhere(); updateOrbits(); updatePositions();
    const t = document.querySelector(`.plane-row[data-pl="${b.dataset.pl}"]`); if (t) t.focus({ preventScroll: true });
  }));
  renderPlaneSats();
  try {
    const k = await kpi(p.start, p.end, null);
    const db = document.getElementById('where-db');
    if (db) db.innerHTML = Number(k.conjunctions) === CA ? `The overview's <code>kpi_summary()</code> returns <b>${Number(k.conjunctions).toLocaleString()}</b> ✓ match.` : `<b>Mismatch:</b> kpi_summary() returns ${k.conjunctions}.`;
  } catch (e) { const db = document.getElementById('where-db'); if (db) db.textContent = `Database check unavailable (${e.message}).`; }
}

function renderPlaneSats() {
  const box = document.getElementById('sats-card');
  if (!box) return;
  const pl = state.focusPlane;
  if (!pl) { box.innerHTML = '<p class="hint">Select a plane above to rank its satellites. You can then open a satellite\'s riskiest close approach (record detail).</p>'; return; }
  const p = PERIODS[state.period];
  const list = DATA.sats.filter((s) => s.plane === pl).map((s) => {
    const ev = DATA.conj.filter((c) => c.satellite_id === s.satellite_id && objOk(c) && inWin(c, p.start, p.end));
    const els = ev.filter(isEl).sort((a, b) => b.pc - a.pc);
    return { s, ca: ev.length, el: els.length, hi: els.filter((c) => c.risk_tier === 'High').length, pc: ev.reduce((a, c) => a + c.pc, 0), worst: els[0] };
  }).sort((a, b) => b.pc - a.pc);
  const tot = list.reduce((a, x) => a + x.el, 0);
  box.innerHTML = `<h2>Plane ${pl}: satellites ranked by expected collisions</h2>
    <p class="hint">${list.length} satellites · ${tot} elevated-risk close approaches · ${p.label}. Satellites with none are listed as 0, not hidden. Click a row to open its riskiest close approach.</p>
    <div class="toplist">${list.map((x, i) => `<button class="row sat-row ${state.selSat === x.s.satellite_id ? 'sel' : ''}" data-sat="${x.s.satellite_id}" data-c="${x.worst ? x.worst.conjunction_id : ''}">
      <span class="rank">${i + 1}</span>
      <span class="main">${x.s.name}<small>${x.s.role} · ${x.ca} close approaches · ${x.el} elevated (${x.hi} high)</small></span>
      <span class="pc">${fmt(x.pc, 4)}<small>${x.worst ? oneIn(x.worst.pc) + ' worst' : 'none elevated'}</small></span></button>`).join('')}</div>`;
  box.querySelectorAll('.sat-row').forEach((b) => b.addEventListener('click', () => select({ sat: +b.dataset.sat, conj: b.dataset.c || null })));
}

function renderWhy() {
  const el = document.getElementById('view-why');
  const W = [
    { k: 'prev', label: 'Previous 30 days', a: '2026-09-11', b: '2026-10-10' },
    { k: 'last', label: 'Last 30 days', a: '2026-10-11', b: '2026-11-09' },
    { k: 'next', label: 'Next 30 days (forecast)', a: '2026-11-10', b: '2026-12-09' },
  ];
  const scopeOk = (c) => objOk(c) && (!state.plane || c.plane === state.plane);
  W.forEach((w) => {
    const ev = DATA.conj.filter((c) => scopeOk(c) && inWin(c, w.a, w.b));
    w.ca = ev.length; w.el = ev.filter(isEl).length; w.per100 = w.ca ? (100 * w.el) / w.ca : 0;
    w.close = w.ca ? (100 * ev.filter((c) => c.miss_distance_m < 500).length) / w.ca : 0;
    w.src = new Map();
    ev.forEach((c) => { const s = w.src.get(c.source_group) || { ca: 0, el: 0 }; s.ca++; if (isEl(c)) s.el++; w.src.set(c.source_group, s); });
  });
  const [pv, ls, nx] = W;
  const scope = [state.plane ? `plane ${state.plane}` : 'whole fleet', state.objType ? `${OBJ_LABEL[state.objType]} only` : 'all objects'].join(', ');
  if (!W.some((w) => w.el)) {
    el.innerHTML = `<h2 class="view-title">${VIEWS.why}</h2><div class="empty-state"><b>Nothing to explain: no elevated-risk close approaches match these filters.</b><br/>${scope}: ${W.map((w) => `${w.label.toLowerCase()} ${w.ca}`).join(', ')} close approaches, none high or medium risk. <button class="link" data-reset>Reset filters</button> or choose <b>Other object: All</b>.</div>`;
    el.querySelector('[data-reset]').onclick = () => document.getElementById('reset').click();
    return;
  }
  const sources = [...new Set(W.flatMap((w) => [...w.src.keys()]))].sort((a, b) => (nx.src.get(b)?.el || 0) - (nx.src.get(a)?.el || 0));
  const per = (w, s) => { const x = w.src.get(s); return x && x.ca ? (100 * x.el) / x.ca : 0; };
  const max = Math.max(...sources.flatMap((s) => W.map((w) => per(w, s))), 1);
  const delta = sources.map((s) => ({ s, d: (nx.src.get(s)?.el || 0) - (ls.src.get(s)?.el || 0) })).sort((a, b) => b.d - a.d);
  const rising = sources.filter((s) => (ls.src.get(s)?.ca || 0) >= 20 && per(nx, s) > per(ls, s)).length;
  const big = sources.filter((s) => (ls.src.get(s)?.ca || 0) >= 20).length;
  const sel = state.whySource;
  el.innerHTML = `
    <h2 class="view-title">${VIEWS.why}</h2>
    <p class="hint">Three back-to-back 30-day windows (fixed in this view; the period toggle does not apply). Plane and Other object filters apply: ${scope}.</p>
    <div class="win-grid">
      <div></div>${W.map((w) => `<div class="win-h">${w.label}<small>${dd(w.a)}–${dd(w.b)}</small></div>`).join('')}
      <div class="win-l">Close approaches</div>${W.map((w) => `<div class="win-v">${w.ca.toLocaleString()}</div>`).join('')}
      <div class="win-l">Elevated-risk</div>${W.map((w) => `<div class="win-v"><b>${w.el}</b></div>`).join('')}
      <div class="win-l">Elevated per 100</div>${W.map((w) => `<div class="win-v">${fmt(w.per100, 1)}</div>`).join('')}
      <div class="win-l">Closer than 500 m</div>${W.map((w) => `<div class="win-v">${fmt(w.close, 1)}%</div>`).join('')}
    </div>
    <section class="card">
      <h2>Elevated-risk close approaches per 100, by source of the other object</h2>
      <p class="hint">Per 100 close approaches with that source, so big and small sources compare fairly. Click a source to see its riskiest events.</p>
      <div class="src-rows">${sources.map((s) => `<button class="src-row ${sel === s ? 'sel' : ''}" data-s="${s}" aria-pressed="${sel === s}">
        <span class="pl-name">${srcLabel(s)}<small>${nx.src.get(s)?.ca || 0} close approaches next 30 d</small></span>
        <span class="trio">${W.map((w) => `<span class="trio-row"><span class="track">${bar(per(w, s), max, w.k)}</span><span class="tv">${fmt(per(w, s), 1)} <small>(${w.src.get(s)?.el || 0}/${w.src.get(s)?.ca || 0})</small></span></span>`).join('')}</span>
      </button>`).join('')}</div>
      <p class="legend-line"><span class="lg-bar prev"></span>Previous 30 d <span class="lg-bar last"></span>Last 30 d <span class="lg-bar next"></span>Next 30 d (forecast)</p>
      <details class="table-alt"><summary>Show data table</summary><table><thead><tr><th>Source</th>${W.map((w) => `<th class="n">${w.label}: elevated / all</th>`).join('')}</tr></thead><tbody>
        ${sources.map((s) => `<tr><td>${srcLabel(s)}</td>${W.map((w) => `<td class="n">${w.src.get(s)?.el || 0} / ${w.src.get(s)?.ca || 0} (${fmt(per(w, s), 1)})</td>`).join('')}</tr>`).join('')}</tbody></table></details>
      <div id="src-events"></div>
    </section>
    <section class="annot" aria-label="Analysis note">
      <p><span class="tag obs">Observed</span>Elevated-risk close approaches go ${ls.el} → ${nx.el} (${pct(nx.el, ls.el)}) while all close approaches go ${ls.ca.toLocaleString()} → ${nx.ca.toLocaleString()} (${pct(nx.ca, ls.ca)}).</p>
      <p><span class="tag hyp">Possible explanation</span>The rise comes from <b>closer</b> approaches, not <b>more</b> of them: the share under 500 m moves ${fmt(ls.close, 1)}% → ${fmt(nx.close, 1)}%. ${delta[0] && delta[0].d > 0 ? `${srcLabel(delta[0].s)} adds the most (+${delta[0].d}).` : ''}</p>
      <p><span class="tag ag">Evidence against</span>The previous window already had ${pv.el} (${fmt(pv.per100, 1)} per 100), so against that the rise is only ${pct(nx.el, pv.el)}: the last 30 days may just have been quiet. The rate rose for ${rising} of ${big} large sources, so it is not specific to one debris cloud.</p>
      <p><span class="tag nxt">Limitation · next evidence</span>Three windows are too few to call a trend, and close approaches here are synthetic random draws. Forecast Pc also changes as new tracking shrinks the uncertainty. Next: re-run with fresh tracking and 6+ months of history. This is an association, not a cause.</p>
    </section>`;
  el.querySelectorAll('.src-row').forEach((b) => b.addEventListener('click', () => {
    state.whySource = state.whySource === b.dataset.s ? null : b.dataset.s; renderWhy();
    const t = document.querySelector(`.src-row[data-s="${CSS.escape(b.dataset.s)}"]`); if (t) t.focus({ preventScroll: true });
  }));
  if (sel) {
    const p = PERIODS.next30;
    const evs = DATA.conj.filter((c) => c.source_group === sel && scopeOk(c) && inWin(c, p.start, p.end) && isEl(c)).sort((a, b) => b.pc - a.pc).slice(0, 5);
    const box = document.getElementById('src-events');
    box.innerHTML = `<h3 class="sub-h">${srcLabel(sel)}: riskiest close approaches, next 30 days</h3>` + (evs.length ? `<div class="toplist">${evs.map((c, i) => `<button class="row" data-c="${c.conjunction_id}"><span class="rank">${i + 1}</span><span class="main">${DATA.satById.get(c.satellite_id).name} × ${c.object_name}<small>${c.tca_utc.slice(5, 16).replace('T', ' ')} UTC · ${fmt(c.miss_distance_m, 0)} m · plane ${c.plane}</small></span><span class="pc"><span class="tier"><i style="background:${TIER[c.risk_tier].color}"></i>${c.risk_tier}</span><small>${oneIn(c.pc)}</small></span></button>`).join('')}</div>` : '<p class="empty">No elevated-risk events from this source in scope.</p>');
    box.querySelectorAll('.row').forEach((b) => b.addEventListener('click', () => { const c = DATA.conj.find((x) => x.conjunction_id === b.dataset.c); select({ sat: c.satellite_id, conj: c.conjunction_id }); }));
  }
}
