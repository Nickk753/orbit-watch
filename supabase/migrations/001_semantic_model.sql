-- Orbit Watch semantic model (star schema) — Block 01, Exercise 3
-- Dimensions hold REAL CelesTrak orbits; facts are SYNTHETIC (seeded generator, pipeline/generate.py).

create table dim_satellite (
  satellite_id      integer primary key,          -- NORAD catalog number
  name              text not null,
  intl_designator   text not null,
  launch_year       integer not null,
  plane             smallint not null check (plane between 1 and 6),
  role              text not null,
  perigee_km        numeric not null,
  apogee_km         numeric not null,
  mean_altitude_km  numeric not null,
  altitude_band     text not null,
  epoch             timestamp not null,
  mean_motion       double precision not null,
  eccentricity      double precision not null,
  inclination_deg   double precision not null,
  raan_deg          double precision not null,
  arg_perigee_deg   double precision not null,
  mean_anomaly_deg  double precision not null,
  bstar             double precision not null
);
comment on table dim_satellite is 'REAL. One row per Iridium NEXT satellite (our fleet). Source: CelesTrak GP, snapshot 2026-11-10.';

create table dim_object (
  object_id         integer primary key,          -- NORAD catalog number
  name              text not null,
  object_type       text not null check (object_type in ('Debris','Rocket body','Payload')),
  source_group      text not null,
  intl_designator   text not null,
  perigee_km        numeric not null,
  apogee_km         numeric not null,
  altitude_band     text not null,
  epoch             timestamp not null,
  mean_motion       double precision not null,
  eccentricity      double precision not null,
  inclination_deg   double precision not null,
  raan_deg          double precision not null,
  arg_perigee_deg   double precision not null,
  mean_anomaly_deg  double precision not null,
  bstar             double precision not null
);
comment on table dim_object is 'REAL. One row per tracked object whose orbit crosses 600-900 km. Source: CelesTrak GP active + debris groups.';

create table dim_date (
  date_key        date primary key,
  year            smallint not null,
  month           smallint not null,
  month_name      text not null,
  iso_week        smallint not null,
  day_of_week     text not null,
  period          text not null,           -- History / Forecast relative to as-of 2026-11-10
  rolling_window  text not null            -- Last 30 days / Previous 30 days / Next 30 days / Other
);

create table dim_risk_tier (
  risk_tier   text primary key,
  min_pc      double precision not null,
  max_pc      double precision not null,
  sort_order  smallint not null,
  meaning     text not null
);

create table fact_conjunction (
  conjunction_id         text primary key,
  satellite_id           integer not null references dim_satellite(satellite_id),
  object_id              integer not null references dim_object(object_id),
  tca_utc                timestamptz not null,
  tca_date               date not null references dim_date(date_key),
  miss_distance_m        numeric not null check (miss_distance_m >= 0),
  relative_velocity_kms  numeric not null,
  crossing_angle_deg     numeric not null,
  combined_sigma_m       numeric not null,
  hard_body_radius_m     numeric not null,
  pc                     double precision not null check (pc between 0 and 1),
  risk_tier              text not null references dim_risk_tier(risk_tier),
  status                 text not null,
  is_synthetic           boolean not null default true
);
comment on table fact_conjunction is 'SYNTHETIC. Grain: one predicted close approach (< 2 km) between one fleet satellite and one tracked object at one time of closest approach.';

create table fact_maneuver (
  maneuver_id     text primary key,
  satellite_id    integer not null references dim_satellite(satellite_id),
  maneuver_date   date not null references dim_date(date_key),
  maneuver_type   text not null check (maneuver_type in ('Collision avoidance','Station keeping')),
  conjunction_id  text unique references fact_conjunction(conjunction_id),  -- 0..1 trigger event
  delta_v_cm_s    numeric not null,
  fuel_kg         numeric not null,
  status          text not null,
  is_synthetic    boolean not null default true
);
comment on table fact_maneuver is 'SYNTHETIC. Grain: one planned or executed burn by one satellite on one day.';

create index on fact_conjunction (satellite_id);
create index on fact_conjunction (object_id);
create index on fact_conjunction (tca_date);
create index on fact_conjunction (risk_tier);
create index on fact_maneuver (satellite_id);
create index on fact_maneuver (maneuver_date);

-- Read-only public access for the app (data is public orbits + synthetic events).
alter table dim_satellite    enable row level security;
alter table dim_object       enable row level security;
alter table dim_date         enable row level security;
alter table dim_risk_tier    enable row level security;
alter table fact_conjunction enable row level security;
alter table fact_maneuver    enable row level security;
create policy "public read" on dim_satellite    for select to anon, authenticated using (true);
create policy "public read" on dim_object       for select to anon, authenticated using (true);
create policy "public read" on dim_date         for select to anon, authenticated using (true);
create policy "public read" on dim_risk_tier    for select to anon, authenticated using (true);
create policy "public read" on fact_conjunction for select to anon, authenticated using (true);
create policy "public read" on fact_maneuver    for select to anon, authenticated using (true);
