-- ============================================================================
-- 2025-10-14_template_versioning_pack.sql
-- PITCH Roofing CRM — Template Versioning RPCs + Pre‑Cap / Cap‑Out budgets
-- Snapshots estimate lines at job approval (Pre‑Cap locked); Cap‑Out updates
-- as material/labor cost events and invoices land.
-- ============================================================================

create extension if not exists pgcrypto;

-- =============
-- Budget tables
-- =============
create table if not exists public.job_budget_versions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  job_id uuid not null,
  kind text not null check (kind in ('PRECAP','CAPOUT')),
  estimate_ref uuid,
  lines jsonb not null,
  summary jsonb not null,
  locked boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists job_budget_versions_job_idx on public.job_budget_versions(job_id, kind);

alter table public.job_budget_versions enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='job_budget_versions' and policyname='jbv_rls') then
    create policy jbv_rls on public.job_budget_versions
      using (tenant_id = public.get_user_tenant_id())
      with check (tenant_id = public.get_user_tenant_id());
  end if;
end $$;

create table if not exists public.job_cost_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  job_id uuid not null,
  kind text not null check (kind in ('MATERIAL','LABOR','OTHER')),
  amount numeric(14,2) not null check (amount >= 0),
  vendor_name text,
  external_ref text,
  doc_url text,
  note text,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists job_cost_events_job_idx on public.job_cost_events(job_id, kind, occurred_at);

alter table public.job_cost_events enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='job_cost_events' and policyname='jce_rls') then
    create policy jce_rls on public.job_cost_events
      using (tenant_id = public.get_user_tenant_id())
      with check (tenant_id = public.get_user_tenant_id());
  end if;
end $$;

-- =============
-- Helpers
-- =============
create or replace function public._jsonb_num(v jsonb, key text, default_val numeric)
returns numeric language sql immutable as $$
  select coalesce( nullif((v->>key),'')::numeric, default_val )
$$;

create or replace function public._compute_budget_rollup(p_lines jsonb, p_overhead numeric, p_commission numeric, p_misc numeric, p_sell_override numeric default null)
returns jsonb
language plpgsql
as $$
declare
  l jsonb;
  qty numeric;
  unit_price numeric;
  unit_cost numeric;
  markup_pct numeric;
  markup_fixed numeric;
  kind text;
  planned_mat numeric := 0;
  planned_lab numeric := 0;
  sell numeric := 0;
  ext numeric := 0;
  cost_ext numeric := 0;
begin
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    raise exception 'p_lines must be a JSON array';
  end if;

  for l in select * from jsonb_array_elements(p_lines)
  loop
    kind := upper(coalesce(l->>'kind', l->>'type'));
    qty  := public._jsonb_num(l, 'qty',  public._jsonb_num(l, 'quantity', 0));
    unit_price   := public._jsonb_num(l, 'unit_price', public._jsonb_num(l, 'price', 0));
    markup_pct   := public._jsonb_num(l, 'markup_pct', 0);
    markup_fixed := public._jsonb_num(l, 'markup_fixed', 0);
    unit_cost := coalesce(nullif(l->>'unit_cost','')::numeric, nullif(l->>'cost','')::numeric,
                  case when unit_price is null then 0
                       else (unit_price - coalesce(markup_fixed,0)) / nullif(1 + coalesce(markup_pct,0), 0)
                  end);

    ext := coalesce(unit_price,0) * coalesce(qty,0);
    cost_ext := coalesce(unit_cost,0) * coalesce(qty,0);

    sell := sell + ext;
    if kind = 'MATERIAL' then
      planned_mat := planned_mat + cost_ext;
    elsif kind = 'LABOR' then
      planned_lab := planned_lab + cost_ext;
    end if;
  end loop;

  if p_sell_override is not null then
    sell := p_sell_override;
  end if;

  return jsonb_build_object(
    'sell_price', round(sell,2),
    'planned', jsonb_build_object(
      'materials', round(planned_mat,2),
      'labor', round(planned_lab,2),
      'overhead', round(coalesce(p_overhead,0),2),
      'commission', round(coalesce(p_commission,0),2),
      'misc', round(coalesce(p_misc,0),2),
      'subtotal', round(planned_mat + planned_lab + coalesce(p_overhead,0) + coalesce(p_commission,0) + coalesce(p_misc,0),2)
    ),
    'actual', jsonb_build_object(
      'materials', 0, 'labor', 0, 'misc', 0
    ),
    'profit', round(sell - (planned_mat + planned_lab + coalesce(p_overhead,0) + coalesce(p_commission,0) + coalesce(p_misc,0)), 2),
    'margin_pct', case when sell > 0 then round( (sell - (planned_mat + planned_lab + coalesce(p_overhead,0) + coalesce(p_commission,0) + coalesce(p_misc,0))) / sell * 100, 2) else null end
  );
end $$;

-- =============
-- RPC: snapshot Pre‑Cap (locked) + initial Cap‑Out
-- =============
create or replace function public.api_snapshot_precap_and_capout(
  p_job_id uuid,
  p_lines jsonb,
  p_overhead_amount numeric default 0,
  p_commission_amount numeric default 0,
  p_misc_amount numeric default 0,
  p_estimate_ref uuid default null
)
returns table(precap_id uuid, capout_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  t uuid := public.get_user_tenant_id();
  roll jsonb;
  sell_override numeric := null;
begin
  if t is null then
    raise exception 'No tenant context';
  end if;

  if exists (select 1 from information_schema.tables where table_schema='public' and table_name='invoice_ar_mirror') then
    select im.total_amount into sell_override
    from public.invoice_ar_mirror im
    join public.qbo_entity_mapping qem on qem.qbo_entity_id = im.qbo_invoice_id and qem.qbo_entity_type = 'Invoice'
    where qem.entity_id = p_job_id and qem.entity_type = 'job'
    order by im.last_pulled_at desc
    limit 1;
  end if;

  roll := public._compute_budget_rollup(p_lines, p_overhead_amount, p_commission_amount, p_misc_amount, sell_override);

  insert into public.job_budget_versions(tenant_id, job_id, kind, estimate_ref, lines, summary, locked)
  values (t, p_job_id, 'PRECAP', p_estimate_ref, p_lines, roll, true)
  returning id into precap_id;

  insert into public.job_budget_versions(tenant_id, job_id, kind, estimate_ref, lines, summary, locked)
  values (t, p_job_id, 'CAPOUT', p_estimate_ref, p_lines, roll, false)
  returning id into capout_id;

  return;
end $$;

revoke all on function public.api_snapshot_precap_and_capout(uuid, jsonb, numeric, numeric, numeric, uuid) from public;
grant execute on function public.api_snapshot_precap_and_capout(uuid, jsonb, numeric, numeric, numeric, uuid) to authenticated;

-- =============
-- RPC: refresh Cap‑Out
-- =============
create or replace function public.api_capout_refresh(p_job_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  t uuid := public.get_user_tenant_id();
  cap jsonb;
  prec jsonb;
  cap_id uuid;
  sell_override numeric := null;
  act_mat numeric := 0;
  act_lab numeric := 0;
  act_misc numeric := 0;
  sell numeric;
  planned jsonb;
  profit numeric;
  margin numeric;
begin
  if t is null then raise exception 'No tenant context'; end if;

  select id, summary into cap_id, cap from public.job_budget_versions
   where tenant_id=t and job_id=p_job_id and kind='CAPOUT'
   order by created_at desc limit 1;
  if cap_id is null then
    raise exception 'No CAPOUT budget exists for job %', p_job_id;
  end if;

  select summary into prec from public.job_budget_versions
   where tenant_id=t and job_id=p_job_id and kind='PRECAP'
   order by created_at desc limit 1;

  select coalesce(sum(case when kind='MATERIAL' then amount else 0 end),0),
         coalesce(sum(case when kind='LABOR' then amount else 0 end),0),
         coalesce(sum(case when kind='OTHER' then amount else 0 end),0)
    into act_mat, act_lab, act_misc
  from public.job_cost_events
  where tenant_id=t and job_id=p_job_id;

  if exists (select 1 from information_schema.tables where table_schema='public' and table_name='invoice_ar_mirror') then
    select im.total_amount into sell_override
    from public.invoice_ar_mirror im
    join public.qbo_entity_mapping qem on qem.qbo_entity_id = im.qbo_invoice_id and qem.qbo_entity_type = 'Invoice'
    where qem.entity_id = p_job_id and qem.entity_type = 'job'
    order by im.last_pulled_at desc
    limit 1;
  end if;

  sell := coalesce((cap->>'sell_price')::numeric, 0);
  if sell_override is not null then sell := sell_override; end if;

  planned := cap->'planned';
  profit := sell - ( act_mat + act_lab + act_misc
           + coalesce((prec->'planned'->>'overhead')::numeric,0)
           + coalesce((prec->'planned'->>'commission')::numeric,0) );
  margin := case when sell > 0 then round(profit / sell * 100, 2) else null end;

  cap := jsonb_build_object(
    'sell_price', round(sell,2),
    'planned', planned,
    'actual', jsonb_build_object('materials', round(act_mat,2), 'labor', round(act_lab,2), 'misc', round(act_misc,2)),
    'profit', round(profit,2),
    'margin_pct', margin
  );

  update public.job_budget_versions
     set summary = cap, updated_at = now()
   where id = cap_id;

  return cap;
end $$;

revoke all on function public.api_capout_refresh(uuid) from public;
grant execute on function public.api_capout_refresh(uuid) to authenticated;

-- =============
-- Trigger auto-refresh
-- =============
create or replace function public.tg_capout_refresh() returns trigger
language plpgsql as $$
begin
  perform public.api_capout_refresh( coalesce(new.job_id, old.job_id) );
  return coalesce(new, old);
end $$;

do $$ begin
  if exists (select 1 from information_schema.tables where table_schema='public' and table_name='job_cost_events') then
    drop trigger if exists trg_jce_capout_refresh on public.job_cost_events;
    create trigger trg_jce_capout_refresh after insert or update or delete on public.job_cost_events
    for each row execute function public.tg_capout_refresh();
  end if;
  if exists (select 1 from information_schema.tables where table_schema='public' and table_name='invoice_ar_mirror') then
    drop trigger if exists trg_inv_capout_refresh on public.invoice_ar_mirror;
    create trigger trg_inv_capout_refresh after insert or update on public.invoice_ar_mirror
    for each row execute function public.tg_capout_refresh();
  end if;
end $$;

-- =============
-- RPC: read budgets
-- =============
create or replace function public.api_job_budgets_get(p_job_id uuid)
returns setof public.job_budget_versions
language sql stable security definer set search_path = public as $$
  select * from public.job_budget_versions
   where tenant_id=public.get_user_tenant_id() and job_id=p_job_id
   order by kind, created_at desc;
$$;
grant execute on function public.api_job_budgets_get(uuid) to authenticated;