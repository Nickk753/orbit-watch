"""
Orbit Watch data pipeline: real orbits + seeded synthetic close approaches.

Inputs  (REAL, public, CelesTrak GP data, snapshot in data/raw/):
  gp_iridium_next.json            our fleet (Iridium NEXT)
  gp_active.csv                   all active payloads
  gp_*-debris.csv                 debris clouds that cross the Iridium shell

Outputs (data/model/*.csv):
  dim_satellite, dim_object, dim_date, dim_risk_tier   (orbits are real)
  fact_conjunction, fact_maneuver                      (SYNTHETIC, seed below)

Run:  python3 pipeline/generate.py
The same seed and the same raw snapshot always give the same rows.
"""
import csv, json, math, random, glob, os
from datetime import date, datetime, timedelta, timezone

SEED = 20261110
AS_OF = date(2026, 11, 10)                      # "today" in the app
HISTORY_DAYS, FORECAST_DAYS = 90, 30            # 90 days of past events + 30 days ahead
START = AS_OF - timedelta(days=HISTORY_DAYS)     # 2026-08-12
END = AS_OF + timedelta(days=FORECAST_DAYS - 1)  # 2026-12-09

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "data", "raw")
OUT = os.path.join(ROOT, "data", "model")

MU, RE = 398600.4418, 6378.137
SCREEN_RADIUS_M = 2000          # screening volume: any pass closer than 2 km is a "close approach"
EVENTS_PER_OVERLAP_DAY = 0.0004 # tuned so a typical satellite sees ~3-4 close approaches per week
HIGH_PC, MED_PC = 1e-4, 1e-5    # risk tiers (1 in 10,000 is the common maneuver-review threshold)
SAT_RADIUS_M = 4.0              # Iridium NEXT hard-body radius (approx.)
SAT_MASS_KG, ISP_S, G0 = 860.0, 220.0, 9.80665
PLANE_CENTERS = [27.4, 229.4, 261.0, 292.6, 324.3, 355.8]  # RAAN (deg) of the 6 real orbital planes


def altitudes(n_rev_day, ecc):
    n = n_rev_day * 2 * math.pi / 86400
    a = (MU / n ** 2) ** (1 / 3)
    return a * (1 - ecc) - RE, a * (1 + ecc) - RE


def band(alt_km):
    lo = int(alt_km // 50) * 50
    return f"{lo}-{lo + 50} km"


def plane_of(raan):
    d = [min(abs(raan - c), 360 - abs(raan - c)) for c in PLANE_CENTERS]
    return d.index(min(d)) + 1


def object_type(name):
    if " DEB" in name or name.endswith("DEB"):
        return "Debris"
    if "R/B" in name:
        return "Rocket body"
    return "Payload"


def crossing_angle(i1, o1, i2, o2):
    """Angle between two orbit planes from inclination and RAAN (degrees)."""
    i1, o1, i2, o2 = map(math.radians, (i1, o1, i2, o2))
    n1 = (math.sin(i1) * math.sin(o1), -math.sin(i1) * math.cos(o1), math.cos(i1))
    n2 = (math.sin(i2) * math.sin(o2), -math.sin(i2) * math.cos(o2), math.cos(i2))
    c = max(-1, min(1, sum(a * b for a, b in zip(n1, n2))))
    return math.degrees(math.acos(c))


def read_gp_csv(path):
    with open(path, newline="") as f:
        return list(csv.DictReader(f))


def elements(r):
    return {
        "epoch": r["EPOCH"], "mean_motion": float(r["MEAN_MOTION"]), "eccentricity": float(r["ECCENTRICITY"]),
        "inclination_deg": float(r["INCLINATION"]), "raan_deg": float(r["RA_OF_ASC_NODE"]),
        "arg_perigee_deg": float(r["ARG_OF_PERICENTER"]), "mean_anomaly_deg": float(r["MEAN_ANOMALY"]),
        "bstar": float(r["BSTAR"]),
    }


def main():
    rng = random.Random(SEED)
    os.makedirs(OUT, exist_ok=True)

    # ---------- dim_satellite (REAL) ----------
    fleet = json.load(open(os.path.join(RAW, "gp_iridium_next.json")))
    sats = []
    for r in fleet:
        e = elements(r)
        per, apo = altitudes(e["mean_motion"], e["eccentricity"])
        mean_alt = (per + apo) / 2
        sats.append({
            "satellite_id": int(r["NORAD_CAT_ID"]), "name": r["OBJECT_NAME"].title(),
            "intl_designator": r["OBJECT_ID"], "launch_year": int(r["OBJECT_ID"][:4]),
            "plane": plane_of(e["raan_deg"]),
            "role": "Operational" if mean_alt > 770 else "Spare / drifting",
            "perigee_km": round(per, 1), "apogee_km": round(apo, 1), "mean_altitude_km": round(mean_alt, 1),
            "altitude_band": band(mean_alt), **e,
        })
    sats.sort(key=lambda s: s["satellite_id"])
    fleet_ids = {s["satellite_id"] for s in sats}

    # ---------- dim_object (REAL): every object whose orbit crosses 600-900 km ----------
    objs = {}
    sources = [("Active payloads", os.path.join(RAW, "gp_active.csv"))]
    for p in sorted(glob.glob(os.path.join(RAW, "gp_*-debris.csv"))):
        fam = os.path.basename(p)[3:-4].replace("-debris", "").upper().replace("-", " ") + " debris"
        sources.append((fam, p))
    for fam, p in sources:
        for r in read_gp_csv(p):
            oid = int(r["NORAD_CAT_ID"])
            if oid in fleet_ids or oid in objs:
                continue
            e = elements(r)
            per, apo = altitudes(e["mean_motion"], e["eccentricity"])
            if per > 900 or apo < 600:
                continue
            otype = "Debris" if fam != "Active payloads" else object_type(r["OBJECT_NAME"])
            objs[oid] = {
                "object_id": oid, "name": r["OBJECT_NAME"], "object_type": otype,
                "source_group": fam, "intl_designator": r["OBJECT_ID"],
                "perigee_km": round(per, 1), "apogee_km": round(apo, 1),
                "altitude_band": band((per + apo) / 2), **e,
            }
    obj_list = sorted(objs.values(), key=lambda o: o["object_id"])

    # ---------- dim_date / dim_risk_tier ----------
    dates = []
    d = date(2026, 8, 1)
    while d <= date(2026, 12, 31):
        dates.append({
            "date_key": d.isoformat(), "year": d.year, "month": d.month, "month_name": d.strftime("%b"),
            "iso_week": d.isocalendar()[1], "day_of_week": d.strftime("%a"),
            "period": "History" if d < AS_OF else "Forecast",
            "rolling_window": ("Last 30 days" if AS_OF - timedelta(days=30) <= d < AS_OF else
                               "Previous 30 days" if AS_OF - timedelta(days=60) <= d < AS_OF - timedelta(days=30) else
                               "Next 30 days" if AS_OF <= d <= END else "Other"),
        })
        d += timedelta(days=1)
    tiers = [
        {"risk_tier": "High", "min_pc": HIGH_PC, "max_pc": 1.0, "sort_order": 1,
         "meaning": "Pc >= 1e-4: maneuver review required"},
        {"risk_tier": "Medium", "min_pc": MED_PC, "max_pc": HIGH_PC, "sort_order": 2,
         "meaning": "1e-5 <= Pc < 1e-4: watch, refine with new tracking"},
        {"risk_tier": "Low", "min_pc": 0.0, "max_pc": MED_PC, "sort_order": 3,
         "meaning": "Pc < 1e-5: no action"},
    ]

    # ---------- fact_conjunction (SYNTHETIC, seeded) ----------
    # Rate per satellite-day = EVENTS_PER_OVERLAP_DAY x (number of real objects whose
    # perigee-apogee range covers the satellite's altitude +/- 10 km).
    conj = []
    cid = 0
    for s in sats:
        h = s["mean_altitude_km"]
        overlap = [o for o in obj_list if o["perigee_km"] - 10 <= h <= o["apogee_km"] + 10]
        lam = EVENTS_PER_OVERLAP_DAY * len(overlap)
        day = START
        while day <= END:
            # Poisson draw (Knuth) for this satellite-day
            k, p, L = 0, 1.0, math.exp(-lam)
            while True:
                p *= rng.random()
                if p <= L:
                    break
                k += 1
            for _ in range(k):
                o = rng.choice(overlap)
                cid += 1
                miss = SCREEN_RADIUS_M * math.sqrt(rng.random())  # uniform over the screening disk
                ang = crossing_angle(s["inclination_deg"], s["raan_deg"], o["inclination_deg"], o["raan_deg"])
                ang = max(ang, 1.0)
                vrel = 2 * 7.46 * math.sin(math.radians(ang) / 2)
                obj_r = {"Debris": 0.5, "Rocket body": 3.0, "Payload": 2.0}[o["object_type"]]
                hbr = SAT_RADIUS_M + obj_r
                base_sigma = {"Debris": 350, "Rocket body": 200, "Payload": 150}[o["object_type"]]
                sigma = base_sigma * math.exp(rng.gauss(0, 0.35))
                pc = (hbr ** 2 / (2 * sigma ** 2)) * math.exp(-miss ** 2 / (2 * sigma ** 2))
                tier = "High" if pc >= HIGH_PC else "Medium" if pc >= MED_PC else "Low"
                tca = datetime(day.year, day.month, day.day, tzinfo=timezone.utc) + timedelta(seconds=rng.randrange(86400))
                if day < AS_OF:
                    status = "Closed"
                else:
                    status = "Open"
                conj.append({
                    "conjunction_id": f"C{cid:06d}", "satellite_id": s["satellite_id"], "object_id": o["object_id"],
                    "tca_utc": tca.strftime("%Y-%m-%dT%H:%M:%SZ"), "tca_date": day.isoformat(),
                    "miss_distance_m": round(miss, 1), "relative_velocity_kms": round(vrel, 3),
                    "crossing_angle_deg": round(ang, 2), "combined_sigma_m": round(sigma, 1),
                    "hard_body_radius_m": hbr, "pc": float(f"{pc:.4e}"), "risk_tier": tier,
                    "status": status, "is_synthetic": True,
                })
            day += timedelta(days=1)

    # ---------- fact_maneuver (SYNTHETIC, seeded) ----------
    man = []
    mid = 0

    def burn(dv_cm_s):
        dv = dv_cm_s / 100.0
        return round(SAT_MASS_KG * (1 - math.exp(-dv / (ISP_S * G0))), 4)

    for c in conj:
        if c["risk_tier"] != "High":
            continue
        tca_day = date.fromisoformat(c["tca_date"])
        past = tca_day < AS_OF
        # Past high-risk events: 80 % were avoided by a maneuver, 20 % cleared by later tracking.
        # Future high-risk events: maneuver already planned for 40 %, the rest await the operator's decision.
        if rng.random() < (0.80 if past else 0.40):
            mid += 1
            dv = round(rng.uniform(1.0, 6.0), 2)
            man.append({
                "maneuver_id": f"M{mid:05d}", "satellite_id": c["satellite_id"],
                "maneuver_date": (tca_day - timedelta(days=1)).isoformat(),
                "maneuver_type": "Collision avoidance", "conjunction_id": c["conjunction_id"],
                "delta_v_cm_s": dv, "fuel_kg": burn(dv),
                "status": "Executed" if past else "Planned", "is_synthetic": True,
            })
            c["status"] = "Mitigated" if past else "Maneuver planned"
        else:
            c["status"] = "Cleared by tracking" if past else "Awaiting decision"
    for c in conj:
        if c["status"] == "Closed":
            c["status"] = "Closed - no action"
        elif c["status"] == "Open":
            c["status"] = "Monitoring"
    # routine station-keeping: about one burn per operational satellite every ~45 days
    for s in sats:
        if s["role"] != "Operational":
            continue
        day = START + timedelta(days=rng.randrange(45))
        while day <= END:
            mid += 1
            dv = round(rng.uniform(2.0, 10.0), 2)
            man.append({
                "maneuver_id": f"M{mid:05d}", "satellite_id": s["satellite_id"], "maneuver_date": day.isoformat(),
                "maneuver_type": "Station keeping", "conjunction_id": "", "delta_v_cm_s": dv, "fuel_kg": burn(dv),
                "status": "Executed" if day < AS_OF else "Planned", "is_synthetic": True,
            })
            day += timedelta(days=rng.randint(38, 52))
    man.sort(key=lambda m: (m["maneuver_date"], m["maneuver_id"]))
    for i, m in enumerate(man, 1):
        m["maneuver_id"] = f"M{i:05d}"

    def write(name, rows):
        with open(os.path.join(OUT, name + ".csv"), "w", newline="") as f:
            w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
            w.writeheader()
            w.writerows(rows)
        print(f"{name:18s} {len(rows):6d} rows")

    write("dim_satellite", sats)
    write("dim_object", obj_list)
    write("dim_date", dates)
    write("dim_risk_tier", tiers)
    write("fact_conjunction", conj)
    write("fact_maneuver", man)


if __name__ == "__main__":
    main()
