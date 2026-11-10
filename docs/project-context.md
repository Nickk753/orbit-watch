# Approved project context v1.0 (frozen 2026-11-10)

**Brief:** Ops lead of the Iridium NEXT fleet (80 satellites: 67 operational + 13 spares, 6 planes) decides which satellites need a collision-avoidance maneuver in the next 30 days.

| Item | Contract |
| --- | --- |
| Data | Real orbits (CelesTrak, 10 Nov 2026) + synthetic close approaches and maneuvers (seed 20261110), 12 Aug to 9 Dec 2026 |
| Facts | fact_conjunction: 1 row = 1 close approach (5,092) · fact_maneuver: 1 row = 1 burn (195) |
| Dimensions | dim_satellite (80) · dim_object (3,687) · dim_date (153) · dim_risk_tier (3) |
| Relationships | all dimension 1 → many fact, filters flow dimension → fact; maneuver → close approach is 0..1 and never joined for KPIs |
| KPIs | close approaches per satellite per 30 days · high-risk share % · avoidance burns per satellite · expected collisions (sum Pc) · avoidance fuel kg |
| Risk tiers | High Pc ≥ 1e-4 · Medium 1e-5 to 1e-4 · Low < 1e-5 |
| Implementation | Supabase Postgres, view v_conjunction, function kpi_summary(); read-only public access |
| Validation | checks ALL PASS; source vs model difference 0 on 4 periods/filters |
| App | https://orbit-watch-rosy.vercel.app · code github.com/Nickk753/orbit-watch |
