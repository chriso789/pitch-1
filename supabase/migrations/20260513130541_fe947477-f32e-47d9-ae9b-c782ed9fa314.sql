
-- Enable required extensions for cron
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- =========================================================
-- qxo_account_profile
-- =========================================================
create table if not exists public.qxo_account_profile (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null unique,
  account_id text,
  profile_id text,
  account_name text,
  default_branch_code text,
  default_branch_name text,
  raw_payload jsonb,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.qxo_account_profile enable row level security;

create policy "qxo_profile_tenant_select"
  on public.qxo_account_profile for select
  using (
    tenant_id in (
      select uca.tenant_id
      from public.user_company_access uca
      where uca.user_id = auth.uid()
    )
  );

-- =========================================================
-- qxo_balance_snapshots
-- =========================================================
create table if not exists public.qxo_balance_snapshots (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  snapshot_date date not null default current_date,
  balance numeric(14,2),
  available_credit numeric(14,2),
  credit_limit numeric(14,2),
  currency text default 'USD',
  raw_payload jsonb,
  created_at timestamptz not null default now(),
  unique (tenant_id, snapshot_date)
);

create index if not exists idx_qxo_balance_tenant_date
  on public.qxo_balance_snapshots (tenant_id, snapshot_date desc);

alter table public.qxo_balance_snapshots enable row level security;

create policy "qxo_balance_tenant_select"
  on public.qxo_balance_snapshots for select
  using (
    tenant_id in (
      select uca.tenant_id
      from public.user_company_access uca
      where uca.user_id = auth.uid()
    )
  );

-- =========================================================
-- qxo_invoices
-- =========================================================
create table if not exists public.qxo_invoices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  qxo_invoice_id text not null,
  invoice_number text,
  po_number text,
  branch_code text,
  branch_name text,
  status text not null default 'open',
  issued_date date,
  due_date date,
  amount numeric(14,2),
  balance numeric(14,2),
  currency text default 'USD',
  job_id uuid,
  raw_payload jsonb,
  last_synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, qxo_invoice_id)
);

create index if not exists idx_qxo_invoices_tenant_status
  on public.qxo_invoices (tenant_id, status);
create index if not exists idx_qxo_invoices_tenant_due
  on public.qxo_invoices (tenant_id, due_date);
create index if not exists idx_qxo_invoices_tenant_po
  on public.qxo_invoices (tenant_id, po_number);
create index if not exists idx_qxo_invoices_tenant_invnum
  on public.qxo_invoices (tenant_id, invoice_number);

alter table public.qxo_invoices enable row level security;

create policy "qxo_invoices_tenant_select"
  on public.qxo_invoices for select
  using (
    tenant_id in (
      select uca.tenant_id
      from public.user_company_access uca
      where uca.user_id = auth.uid()
    )
  );

-- =========================================================
-- qxo_sync_runs
-- =========================================================
create table if not exists public.qxo_sync_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  kind text not null, -- profile | balance | invoices | all
  status text not null default 'running', -- running | success | error
  records_upserted integer default 0,
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_qxo_sync_runs_tenant_started
  on public.qxo_sync_runs (tenant_id, started_at desc);

alter table public.qxo_sync_runs enable row level security;

create policy "qxo_sync_runs_tenant_select"
  on public.qxo_sync_runs for select
  using (
    tenant_id in (
      select uca.tenant_id
      from public.user_company_access uca
      where uca.user_id = auth.uid()
    )
  );

-- =========================================================
-- updated_at triggers
-- =========================================================
create or replace function public.qxo_set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists trg_qxo_profile_updated on public.qxo_account_profile;
create trigger trg_qxo_profile_updated before update on public.qxo_account_profile
for each row execute function public.qxo_set_updated_at();

drop trigger if exists trg_qxo_invoices_updated on public.qxo_invoices;
create trigger trg_qxo_invoices_updated before update on public.qxo_invoices
for each row execute function public.qxo_set_updated_at();

-- =========================================================
-- 15-min cron: invoke qxo-sync-orchestrator
-- =========================================================
do $$
begin
  if exists (select 1 from cron.job where jobname = 'qxo-sync-orchestrator-15min') then
    perform cron.unschedule('qxo-sync-orchestrator-15min');
  end if;
end $$;

select cron.schedule(
  'qxo-sync-orchestrator-15min',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := 'https://alxelfrbjzkmtnsulcei.supabase.co/functions/v1/qxo-sync-orchestrator',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFseGVsZnJianprbXRuc3VsY2VpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTgxNTYyNzcsImV4cCI6MjA3MzczMjI3N30.ouuzXBD8iercLbbxtueioRppHsywgpgxEdDqt6AaMtM'
    ),
    body := jsonb_build_object('source','cron')
  );
  $$
);
