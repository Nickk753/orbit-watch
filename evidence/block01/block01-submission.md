# Block 01 submission text (copy into each exercise)

App repo: https://github.com/Nickk753/orbit-watch

## Exercise 01: Choose a topic and a decision
**Screenshot:** ex1_brief.png
**Reasoning & evidence:**
Topic: satellite collision risk. User: the operations lead of an 80-satellite LEO communications fleet (real Iridium NEXT orbits: 67 operational + 13 spares, 6 planes). Decision: which satellites need an avoidance maneuver in the next 30 days, and where to spend the fuel budget.
Three questions: (1) Is collision risk rising and how many maneuvers will we need this month? (2) Which orbital planes, altitude bands and debris clouds drive it? (3) Which specific close approaches need action now, and what is the evidence?
Prompt excerpt: "Act as my analytics product partner. My topic is satellite collision risk, my user is a satellite operations lead and their decision is which satellites need avoidance maneuvers this month. Help me sharpen three questions spanning overview, diagnosis and record detail. Ask up to three clarifying questions, propose two approaches and the minimum data each needs. Do not build the app yet."
Approaches: A = compute real close approaches with SGP4 (needs covariance that is not public, hours of compute, hard to verify). B = real orbits + seeded synthetic events (chosen: reproducible, every KPI reconciles).
Scope choice I made: the 3D globe is the hero of the overview with a side panel of KPIs and the most probable close approaches; I removed an operator/country view because it does not change the maneuver decision.

## Exercise 02: Prepare data that supports the journey
**Screenshots:** ex2_data_dictionary_and_checks.png
**Evidence link:** https://github.com/Nickk753/orbit-watch/blob/main/pipeline/generate.py
**Reasoning & evidence:**
Source declaration: orbits are REAL (CelesTrak GP snapshot 2026-11-10: 80 Iridium NEXT satellites, 3,687 tracked objects crossing 600-900 km, including Fengyun-1C, Cosmos 2251 and Iridium 33 debris). Close approaches and maneuvers are SYNTHETIC from a generator with fixed seed 20261110, labelled is_synthetic in every row.
Date range: 2026-08-12 to 2026-12-09 (90 days history + 30 days forecast). Rows: 5,092 close approaches, 195 maneuvers, 80 satellites, 3,687 objects, 153 dates, 3 risk tiers.
Supports: time comparison (last vs previous 30 days, forecast), segments (orbital plane, altitude band, object type, debris family, risk tier), record-level investigation (each close approach with time, miss distance, speed, Pc, status).
Checks: duplicate keys, missing values, orphan foreign keys and value ranges all PASS. Treatment: maneuver.conjunction_id is intentionally empty for 179 station-keeping burns.
Assumptions: event rate proportional to the real number of objects around each satellite; no trend injected, so any change between periods comes from the real population and random variation.

## Exercise 03: Define the semantic model and KPI contract
**Screenshots:** ex3_semantic_model.png, ex3_kpi_dictionary.png (+ your own screenshot of the Supabase Table Editor)
**Evidence link:** https://github.com/Nickk753/orbit-watch/blob/main/supabase/migrations/001_semantic_model.sql
**Reasoning & evidence:**
Implemented in Supabase Postgres as a star schema. Facts: fact_conjunction (grain: one close approach) and fact_maneuver (grain: one burn). Dimensions: dim_satellite, dim_object, dim_date, dim_risk_tier. All relationships 1-to-many, filters flow from dimensions to facts, enforced with primary and foreign keys.
KPIs: close approaches per satellite (per 30 days), high-risk share (%), avoidance maneuvers per satellite, expected collisions (sum of Pc), avoidance fuel (kg). The three ratios cannot be summed; they are recomputed from numerators and denominators. Only expected collisions and fuel are additive.
Main modeling choice verified: maneuver links to its triggering close approach with a unique, nullable key (0..1). KPIs never join the two facts, so no double counting. The satellite denominator comes from dim_satellite, so satellites with zero events still count.

## Exercise 04: Validate and freeze your data foundation
**Screenshot:** ex4_validation.png
**Evidence link:** https://github.com/Nickk753/orbit-watch/blob/main/docs/validation.md
**Reasoning & evidence:**
I calculated each KPI directly from the source CSVs and through the Supabase model (kpi_summary over the joined view) for 4 cases: last 30 days, previous 30 days, last 30 days for plane 3 debris only, and the 30-day forecast. Row counts before and after the 4 joins are equal (5,092 = 5,092).
Example: last 30 days, whole fleet: 1,258 close approaches, 5 high risk, high-risk share 0.40 % in both, difference 0.
Discrepancy found and resolved: the first run differed by 0.01 on "close approaches per satellite" (15.72 vs 15.73). Numerator and denominator matched exactly. The cause was rounding (Python rounds half to even, Postgres half away from zero). I fixed the source calculation, not the KPI definition. Final result: all differences 0.
Frozen contract: docs/data-dictionary.md, docs/semantic-model.png, docs/kpi-contract.md (v1.0), docs/validation.md.

## App URL (use in every exercise's evidence links)
https://orbit-watch-rosy.vercel.app
