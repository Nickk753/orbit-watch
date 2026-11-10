# Block 01: paste text (short)

## Ex 01: Choose a topic and a decision
**Screenshot:** ex1_brief.png
**Links:** https://orbit-watch-rosy.vercel.app

User: ops lead of the Iridium NEXT fleet (80 satellites). Decision: which satellites need a collision-avoidance maneuver in the next 30 days.
Questions: (1) Is risk rising? (2) Which planes and debris clouds drive it? (3) Which close approaches need action now?
Approaches: A = compute real conjunctions (no public covariance, hard to verify). B = real orbits + seeded synthetic events (chosen: reproducible, verifiable).
Scope choice: dropped an operator/country view because it does not change the maneuver decision. Prompt excerpt is in the screenshot.

## Ex 02: Prepare data
**Screenshots:** ex2_data_dictionary_and_checks.png, ex2_pipeline.png, ex2_ex3_database_tables.png
**Links:** https://github.com/Nickk753/orbit-watch/blob/main/pipeline/generate.py

Real: CelesTrak orbits (80 satellites, 3,687 objects). Synthetic: 5,092 close approaches and 195 maneuvers, seed 20261110, labelled is_synthetic.
Dates: 12 Aug to 9 Dec 2026 (90 days history + 30 forecast). Segments: plane, object type, debris source, risk tier.
Checks: duplicate keys, nulls, orphan keys, ranges: all PASS. Treatment: empty conjunction_id on 179 station-keeping burns (by design).

## Ex 03: Semantic model and KPI contract
**Screenshots:** ex3_semantic_model.png, ex3_kpi_dictionary.png, ex2_ex3_database_tables.png
**Links:** https://github.com/Nickk753/orbit-watch/blob/main/supabase/migrations/001_semantic_model.sql

Star schema in Supabase: 2 facts (close approach, burn), 4 dimensions; all 1-to-many, filters flow dimension to fact.
5 KPIs: close approaches per satellite, high-risk share, avoidance burns per satellite (ratios, not summable), expected collisions and fuel (summable).
Verified choice: the two facts are never joined for KPIs (0..1 link only), so no double counting.

## Ex 04: Validate and freeze
**Screenshots:** ex4_validation.png, ex4_approved_context.png
**Links:** https://github.com/Nickk753/orbit-watch/blob/main/docs/validation.md

KPIs from raw files vs Supabase model, 4 periods/filters: difference 0. Join row counts equal (5,092 = 5,092).
Example, last 30 days: 5 high-risk / 1,258 close approaches = 0.40% in both.
Mismatch found and fixed: 15.72 vs 15.73 was a rounding rule, not data. Fixed the check, not the KPI.
