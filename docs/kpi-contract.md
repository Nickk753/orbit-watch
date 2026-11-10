# KPI contract v1.0 (frozen 2026-11-10)

All KPIs come from `kpi_summary(p_start, p_end, p_plane, p_object_type)` in Supabase, so every screen uses one definition.
Time basis: UTC date of closest approach (`tca_date`) for conjunctions, `maneuver_date` for burns. As-of date: 2026-11-10.
Satellite denominator: satellites in `dim_satellite` matching the filter, including satellites with zero events.

| KPI | Meaning | Formula | Unit | Aggregation | Missing / zero rule | Summable? |
| --- | --- | --- | --- | --- | --- | --- |
| Close approaches per satellite | How busy the sky is around our fleet | count(conjunctions) x 30 / (satellites x days in period) | events per satellite per 30 days | ratio, recomputed per filter | 0 satellites -> null | No (ratio) |
| High-risk share | How many close approaches need a maneuver review | count(Pc >= 1e-4) / count(conjunctions) x 100 | % | ratio of counts | 0 conjunctions -> null | No (ratio) |
| Avoidance maneuvers per satellite | Operational load and fuel pressure | count(burns where type = Collision avoidance) / satellites | burns per satellite | ratio | 0 satellites -> null | No (ratio) |
| Expected collisions | Total collision risk carried in the period | sum(Pc) over conjunctions | expected collisions (probability) | sum | no events -> 0 | Yes, across satellites and days |
| Avoidance fuel | Cost of avoiding risk | sum(fuel_kg) over collision-avoidance burns | kg of propellant | sum | no burns -> 0 | Yes |

Eligibility: every row of `fact_conjunction` is a screened close approach under 2 km; station-keeping burns are excluded from the avoidance KPIs.
Risk tiers (`dim_risk_tier`): High Pc >= 1e-4, Medium 1e-5 to 1e-4, Low < 1e-5. The 1e-4 threshold is an assumption based on common operator practice.
Ratios are never averaged across groups: they are recomputed from summed numerators and denominators.
Rounding: half away from zero (Postgres `round()`), 2 decimals for rates and %, 3 for per-satellite burns.
