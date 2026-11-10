# Data dictionary

Coverage: events 2026-08-12 to 2026-12-09 (90 days history + 30 days forecast from as-of 2026-11-10). Orbits: CelesTrak GP snapshot 2026-11-10.

| Table | Grain | Rows | Source | Key |
| --- | --- | --- | --- | --- |
| fact_conjunction | one close approach (< 2 km) between one fleet satellite and one tracked object | 5,092 | SYNTHETIC (seed 20261110) | conjunction_id |
| fact_maneuver | one planned or executed burn by one satellite on one day | 195 | SYNTHETIC (seed 20261110) | maneuver_id |
| dim_satellite | one Iridium NEXT satellite | 80 | REAL (CelesTrak) | satellite_id = NORAD id |
| dim_object | one tracked object crossing 600-900 km | 3,687 | REAL (CelesTrak active + Fengyun-1C, Cosmos 2251, Iridium 33 debris) | object_id = NORAD id |
| dim_date | one UTC calendar day, 2026-08-01 to 2026-12-31 | 153 | generated | date_key |
| dim_risk_tier | one risk tier | 3 | defined | risk_tier |

## Key columns

| Column | Type | Meaning |
| --- | --- | --- |
| fact_conjunction.tca_utc | timestamptz | time of closest approach |
| fact_conjunction.miss_distance_m | numeric | predicted miss distance, metres |
| fact_conjunction.relative_velocity_kms | numeric | closing speed, km/s, from the real crossing angle of the two orbit planes |
| fact_conjunction.pc | float | probability of collision (2D Gaussian approximation) |
| fact_conjunction.status | text | Closed - no action, Mitigated, Cleared by tracking, Monitoring, Maneuver planned, Awaiting decision |
| fact_maneuver.conjunction_id | text, nullable | the close approach that triggered an avoidance burn; empty for station keeping |
| fact_maneuver.delta_v_cm_s / fuel_kg | numeric | burn size and propellant (860 kg satellite, Isp 220 s) |
| dim_satellite.plane | smallint | orbital plane 1-6, from the real RAAN |
| dim_satellite.role | text | Operational (~777 km) or Spare / drifting (lower) |
| dim_object.object_type | text | Debris, Rocket body, Payload |

## Generator assumptions (synthetic facts)
1. Close approaches per satellite-day = 0.0004 x number of real objects whose perigee-apogee range covers the satellite's altitude (+/- 10 km), Poisson-distributed.
2. The other object is drawn uniformly from those overlapping objects, so crowded debris clouds produce more events.
3. Miss distance is uniform over a 2 km screening disk. Position uncertainty (sigma) is larger for debris (350 m) than for payloads (150 m), with random variation.
4. Past high-risk events: 80 % mitigated by a burn the day before, 20 % cleared by later tracking. Future high-risk events: 40 % already have a planned burn, 60 % await the operator's decision.
5. Operational satellites do a station-keeping burn every 38-52 days.
6. No trend was injected. Any change between periods comes from random variation and the real object population.
