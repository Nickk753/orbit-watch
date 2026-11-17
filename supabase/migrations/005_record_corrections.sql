-- Session 03 · Exercise 3: persisted numeric corrections on a close-approach record.
-- The browser stays read-only. Writes go: app server (Vercel) → Edge Function orbit-watch-corrections
-- (checks LAB_ACCESS_KEY, holds the service role key) → apply_conjunction_correction() below.

alter table fact_conjunction add column if not exists revision integer not null default 0;

-- expose revision to the app (appended column, so existing readers are unaffected)
create or replace view v_conjunction as
 select c.conjunction_id, c.satellite_id, c.object_id, c.tca_utc, c.tca_date, c.miss_distance_m,
    c.relative_velocity_kms, c.crossing_angle_deg, c.combined_sigma_m, c.hard_body_radius_m, c.pc,
    c.risk_tier, c.status, c.is_synthetic, s.name as satellite_name, s.plane, s.role,
    s.altitude_band as satellite_altitude_band, o.name as object_name, o.object_type, o.source_group,
    d.month, d.iso_week, d.period, d.rolling_window, t.sort_order as risk_sort, c.revision
   from fact_conjunction c
     join dim_satellite s on s.satellite_id = c.satellite_id
     join dim_object o on o.object_id = c.object_id
     join dim_date d on d.date_key = c.tca_date
     join dim_risk_tier t on t.risk_tier = c.risk_tier;

-- Correction log: one row per saved change, readable by the app for evidence.
create table if not exists conjunction_correction (
  correction_id bigserial primary key,
  conjunction_id text not null references fact_conjunction(conjunction_id),
  field text not null check (field in ('pc')),
  old_value double precision not null,
  new_value double precision not null,
  old_risk_tier text not null,
  new_risk_tier text not null,
  reason text not null check (length(reason) between 5 and 1000),
  revision_after integer not null,
  request_id uuid not null unique,
  created_at timestamptz not null default now()
);
alter table conjunction_correction enable row level security;
drop policy if exists "public read" on conjunction_correction;
create policy "public read" on conjunction_correction for select using (true);
grant select on conjunction_correction to anon, authenticated;

-- Fictional audit notes (the classroom "evidence" for a correction). Synthetic, labelled as such.
create table if not exists conjunction_audit_note (
  conjunction_id text primary key references fact_conjunction(conjunction_id),
  field text not null,
  recorded_value double precision not null,
  supported_value double precision not null,
  note text not null,
  is_synthetic boolean not null default true
);
alter table conjunction_audit_note enable row level security;
drop policy if exists "public read" on conjunction_audit_note;
create policy "public read" on conjunction_audit_note for select using (true);
grant select on conjunction_audit_note to anon, authenticated;

insert into conjunction_audit_note (conjunction_id, field, recorded_value, supported_value, note) values
 ('C003807', 'pc', 0.00010964, 0.00005482,
  'Synthetic audit (course exercise): two tracking messages (CDMs) for the same pass of Iridium 158 and CBERS 4 were both ingested and their probabilities added, so Pc was counted twice. The single valid CDM gives Pc 5.482e-5 (1 in 18,242). Supported correction: Pc 0.00010964 → 0.00005482.')
on conflict (conjunction_id) do nothing;

-- The only write path. Checks the revision AND the value the person reviewed; a stale read gets a conflict.
create or replace function apply_conjunction_correction(
  p_conjunction_id text, p_field text, p_expected_value double precision, p_expected_revision integer,
  p_new_value double precision, p_reason text, p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r fact_conjunction; prior conjunction_correction; t text;
begin
  select * into prior from conjunction_correction where request_id = p_request_id;
  if found then return jsonb_build_object('status', 'duplicate', 'correction', to_jsonb(prior)); end if;
  if p_field <> 'pc' then return jsonb_build_object('status', 'invalid', 'message', 'Only pc can be corrected.'); end if;
  if p_new_value is null or p_new_value < 0 or p_new_value > 1 then return jsonb_build_object('status', 'invalid', 'message', 'Pc must be between 0 and 1.'); end if;
  if p_reason is null or length(trim(p_reason)) < 5 then return jsonb_build_object('status', 'invalid', 'message', 'Give a reason (at least 5 characters).'); end if;
  select * into r from fact_conjunction where conjunction_id = p_conjunction_id for update;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  if r.revision <> p_expected_revision or r.pc <> p_expected_value then
    return jsonb_build_object('status', 'conflict', 'current', jsonb_build_object('pc', r.pc, 'risk_tier', r.risk_tier, 'revision', r.revision));
  end if;
  if p_new_value = r.pc then return jsonb_build_object('status', 'invalid', 'message', 'The new value equals the current value.'); end if;
  select risk_tier into t from dim_risk_tier where p_new_value >= min_pc order by min_pc desc limit 1;
  update fact_conjunction set pc = p_new_value, risk_tier = t, revision = r.revision + 1 where conjunction_id = p_conjunction_id;
  insert into conjunction_correction (conjunction_id, field, old_value, new_value, old_risk_tier, new_risk_tier, reason, revision_after, request_id)
    values (p_conjunction_id, 'pc', r.pc, p_new_value, r.risk_tier, t, trim(p_reason), r.revision + 1, p_request_id)
    returning * into prior;
  return jsonb_build_object('status', 'saved', 'correction', to_jsonb(prior));
end $$;
revoke all on function apply_conjunction_correction(text, text, double precision, integer, double precision, text, uuid) from public, anon, authenticated;
grant execute on function apply_conjunction_correction(text, text, double precision, integer, double precision, text, uuid) to service_role;
