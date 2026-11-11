"""Block 02, Exercise 3: recompute the overview KPIs from the source CSVs for one filter
combination, independently of Supabase, so they can be compared with what the screen shows.

Filters (same as on screen): Next 30 days (2026-11-10 to 2026-12-09), plane 5, other object = Payload.
Comparison period: 2026-10-11 to 2026-11-09, same filters.
"""
import csv
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path

M = Path(__file__).resolve().parent.parent / "data" / "model"
rd = lambda f: list(csv.DictReader(open(M / f)))
r = lambda x, d: Decimal(str(x)).quantize(Decimal(1).scaleb(-d), rounding=ROUND_HALF_UP)

sats = {s["satellite_id"]: s for s in rd("dim_satellite.csv")}
objs = {o["object_id"]: o for o in rd("dim_object.csv")}
conj = rd("fact_conjunction.csv")
cmap = {c["conjunction_id"]: c for c in conj}
man = rd("fact_maneuver.csv")


def kpis(start, end, plane, otype):
    in_sats = {k for k, s in sats.items() if int(s["plane"]) == plane}
    c = [x for x in conj if x["satellite_id"] in in_sats and start <= x["tca_date"] <= end
         and objs[x["object_id"]]["object_type"] == otype]
    m = [x for x in man if x["satellite_id"] in in_sats and x["maneuver_type"] == "Collision avoidance"
         and start <= x["maneuver_date"] <= end and x["conjunction_id"]
         and objs[cmap[x["conjunction_id"]]["object_id"]]["object_type"] == otype]
    days = 30
    high = sum(1 for x in c if x["risk_tier"] == "High")
    return {
        "events": len(c), "satellites": len(in_sats), "high": high,
        "Close approaches per satellite (per 30 days)": r(Decimal(len(c)) / len(in_sats) / days * 30, 2),
        "High-risk share (%)": r(Decimal(100 * high) / len(c), 2) if c else None,
        "Avoidance maneuvers per satellite": r(Decimal(len(m)) / len(in_sats), 3),
        "Expected collisions (sum of Pc)": r(sum(Decimal(x["pc"]) for x in c), 4),
    }


cur = kpis("2026-11-10", "2026-12-09", 5, "Payload")
cmp = kpis("2026-10-11", "2026-11-09", 5, "Payload")
screen = {  # read from the app (Playwright, same filters) on 2026-11-11
    "Close approaches per satellite (per 30 days)": ("2.21", "1.93"),
    "High-risk share (%)": ("6.45", "0.00"),
    "Avoidance maneuvers per satellite": ("0.000", "0.000"),
    "Expected collisions (sum of Pc)": ("0.0006", "0.0001"),
}
lines = ["# Source vs screen KPI check (Block 02, Ex3)", "",
         "Filters: Next 30 days (10 Nov to 9 Dec 2026), plane 5, other object = Payload. Comparison: 11 Oct to 9 Nov, same filters.",
         f"Source: Python over `data/model/*.csv` (no database). Scope: {cur['events']} close approaches, {cur['satellites']} satellites, {cur['high']} high risk.", "",
         "| KPI | Source | Screen | Source (prev) | Screen (prev) | Match |", "|---|---|---|---|---|---|"]
ok_all = True
for k, (s_now, s_prev) in screen.items():
    a, b = cur[k], cmp[k]
    b_s = "0.00" if b is None else str(b)
    ok = str(a) == s_now and b_s == s_prev
    ok_all &= ok
    lines.append(f"| {k} | {a} | {s_now} | {b_s} | {s_prev} | {'yes' if ok else 'NO'} |")
lines += ["", f"Result: {'ALL MATCH' if ok_all else 'MISMATCH'}."]
Path(__file__).resolve().parent.parent.joinpath("docs", "block02-kpi-check.md").write_text("\n".join(lines) + "\n")
print("\n".join(lines))
