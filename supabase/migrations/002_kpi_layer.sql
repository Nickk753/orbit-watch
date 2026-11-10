-- Orbit Watch KPI layer (semantic measures) — Block 01, Exercise 3/4
-- Enriched view: fact joined only to dimensions (many-to-one), so row count = fact row count.
create view v_conjunction with (security_invoker = true) as
select c.*, s.name as satellite_name, s.plane, s.role, s.altitude_band as satellite_altitude_band,
       o.name as object_name, o.object_type, o.source_group,
       d.month, d.iso_week, d.period, d.rolling_window, t.sort_order as risk_sort
from fact_conjunction c
join dim_satellite s on s.satellite_id = c.satellite_id
join dim_object    o on o.object_id    = c.object_id
join dim_date      d on d.date_key     = c.tca_date
join dim_risk_tier t on t.risk_tier    = c.risk_tier;

-- KPI contract: one function, same filters for every KPI.
-- Satellite denominator comes from dim_satellite (satellites with zero events still count).
create or replace function kpi_summary(p_start date, p_end date, p_plane smallint default null, p_object_type text default null)
returns table (
  satellites_in_scope int, days_in_period int, conjunctions bigint, high_risk bigint,
  conjunctions_per_sat_30d numeric, high_risk_share_pct numeric,
  avoidance_maneuvers bigint, avoidance_maneuvers_per_sat numeric,
  expected_collisions numeric, avoidance_fuel_kg numeric)
language sql stable security invoker as $$
  with sats as (select satellite_id from dim_satellite where p_plane is null or plane = p_plane),
  c as (select v.* from v_conjunction v join sats using (satellite_id)
        where v.tca_date between p_start and p_end and (p_object_type is null or v.object_type = p_object_type)),
  m as (select f.* from fact_maneuver f join sats using (satellite_id)
        where f.maneuver_type = 'Collision avoidance' and f.maneuver_date between p_start and p_end)
  select (select count(*) from sats)::int,
         (p_end - p_start + 1)::int,
         (select count(*) from c),
         (select count(*) from c where risk_tier = 'High'),
         round((select count(*) from c)::numeric / nullif((select count(*) from sats),0) / (p_end - p_start + 1) * 30, 2),
         round(100.0 * (select count(*) from c where risk_tier = 'High') / nullif((select count(*) from c),0), 2),
         (select count(*) from m),
         round((select count(*) from m)::numeric / nullif((select count(*) from sats),0), 3),
         round((select coalesce(sum(pc),0) from c)::numeric, 6),
         round((select coalesce(sum(fuel_kg),0) from m)::numeric, 3)
$$;
grant select on v_conjunction to anon, authenticated;
grant execute on function kpi_summary to anon, authenticated;
