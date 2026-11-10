"""Load data/model/*.csv into Supabase through the REST API.
Needs SUPABASE_URL and SUPABASE_KEY in the environment and a temporary insert policy
(added before loading and removed right after; see docs/semantic-model.md)."""
import csv, json, os, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
URL, KEY = os.environ["SUPABASE_URL"].rstrip("/"), os.environ["SUPABASE_KEY"]
ORDER = ["dim_satellite", "dim_object", "dim_date", "dim_risk_tier", "fact_conjunction", "fact_maneuver"]
INTS = {"satellite_id", "object_id", "launch_year", "plane", "year", "month", "iso_week", "sort_order"}
BOOLS = {"is_synthetic"}


def convert(row):
    out = {}
    for k, v in row.items():
        if v == "":
            out[k] = None
        elif k in INTS:
            out[k] = int(v)
        elif k in BOOLS:
            out[k] = v == "True"
        else:
            try:
                out[k] = float(v) if any(c.isdigit() for c in v) and k not in ("date_key", "tca_date", "maneuver_date", "tca_utc", "epoch", "intl_designator", "name", "conjunction_id", "maneuver_id", "altitude_band") else v
            except ValueError:
                out[k] = v
    return out


for t in ORDER:
    rows = [convert(r) for r in csv.DictReader(open(os.path.join(ROOT, "data", "model", t + ".csv")))]
    for i in range(0, len(rows), 1000):
        req = urllib.request.Request(f"{URL}/rest/v1/{t}", data=json.dumps(rows[i:i + 1000]).encode(), method="POST",
                                     headers={"apikey": KEY, "Authorization": f"Bearer {KEY}",
                                              "Content-Type": "application/json", "Prefer": "return=minimal"})
        urllib.request.urlopen(req).read()
    print(f"{t:18s} loaded {len(rows):6d}")
