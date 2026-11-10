-- Applied by hand in the SQL Editor on 2026-11-10 (removes the temporary load access)
drop policy if exists "temp load" on dim_satellite;
drop policy if exists "temp load" on dim_object;
drop policy if exists "temp load" on dim_date;
drop policy if exists "temp load" on dim_risk_tier;
drop policy if exists "temp load" on fact_conjunction;
drop policy if exists "temp load" on fact_maneuver;
revoke insert, update, delete, truncate on dim_satellite, dim_object, dim_date, dim_risk_tier, fact_conjunction, fact_maneuver from anon, authenticated;
