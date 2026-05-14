
create extension if not exists pgcrypto;

-- =========================================
-- Core integration + tokens
-- =========================================
create table if not exists public.abc_integrations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  abc_mode text not null check (abc_mode in ('individual_business','third_party_aggregator')),
  environment text not null check (environment in ('sandbox','production')),
  token_strategy text not null check (token_strategy in ('auth_code_pkce','client_credentials')),
  client_id text not null,
  redirect_uri text not null,
  scopes text not null default 'location.read product.read account.read pricing.read order.read order.write notification.read notification.write offline_access',
  status text not null default 'disconnected' check (status in ('disconnected','connected','error','reauth_required')),
  last_error text,
  webhook_id text,
  webhook_secret text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, environment)
);

create table if not exists public.abc_tokens (
  integration_id uuid primary key references public.abc_integrations(id) on delete cascade,
  tenant_id uuid not null,
  access_token_enc bytea,
  refresh_token_enc bytea,
  token_type text,
  scope text,
  access_token_expires_at timestamptz,
  refresh_token_last_used_at timestamptz,
  raw_token_response jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.abc_oauth_states (
  state text primary key,
  tenant_id uuid not null,
  integration_id uuid references public.abc_integrations(id) on delete cascade,
  code_verifier text not null,
  redirect_uri text not null,
  created_by uuid references auth.users(id),
  expires_at timestamptz not null default (now() + interval '15 minutes'),
  created_at timestamptz not null default now()
);

-- =========================================
-- Reference data
-- =========================================
create table if not exists public.abc_accounts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  account_kind text not null check (account_kind in ('sold_to','bill_to','ship_to')),
  account_number text not null,
  name text,
  status text,
  is_sellable boolean,
  sold_to_number text,
  bill_to_number text,
  home_branch_number text,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, account_kind, account_number)
);

create table if not exists public.abc_branches (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  branch_number text not null,
  name text,
  storefront text,
  status text,
  city text,
  state text,
  postal text,
  country text,
  latitude numeric,
  longitude numeric,
  time_zone_code text,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, branch_number)
);

create table if not exists public.abc_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  item_number text not null,
  family_id text,
  family_name text,
  item_description text,
  status text,
  is_dimensional boolean,
  primary_asset_id text,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, item_number)
);

create table if not exists public.abc_item_availability (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  item_number text not null,
  branch_number text not null,
  is_dimensional boolean,
  is_california_display boolean,
  raw_payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  unique (tenant_id, item_number, branch_number)
);

create table if not exists public.abc_price_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  request_id text,
  ship_to_number text not null,
  branch_number text not null,
  purpose text not null,
  request_payload jsonb not null,
  response_payload jsonb,
  http_status int,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

-- =========================================
-- Orders + invoices
-- =========================================
create table if not exists public.abc_orders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  request_id text,
  confirmation_number text,
  order_number text,
  purchase_order text,
  order_status text,
  branch_number text,
  sold_to_number text,
  bill_to_number text,
  ship_to_number text,
  created_date date,
  ordered_on date,
  delivery_requested_for date,
  total_amount numeric,
  currency text,
  source text not null default 'api',
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists abc_orders_tenant_confirmation_idx
  on public.abc_orders (tenant_id, confirmation_number) where confirmation_number is not null;
create unique index if not exists abc_orders_tenant_order_number_idx
  on public.abc_orders (tenant_id, order_number) where order_number is not null;

create table if not exists public.abc_order_lines (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.abc_orders(id) on delete cascade,
  tenant_id uuid not null,
  line_id text,
  item_number text,
  item_description text,
  ordered_qty numeric,
  ordered_uom text,
  unit_price numeric,
  amount numeric,
  raw_payload jsonb not null default '{}'::jsonb
);

create table if not exists public.abc_order_job_links (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  order_id uuid not null references public.abc_orders(id) on delete cascade,
  job_id uuid,
  estimate_id uuid,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (order_id)
);

create table if not exists public.abc_invoices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  invoice_number text not null,
  order_number text,
  bill_to_number text,
  ship_to_number text,
  branch_number text,
  invoice_date timestamptz,
  order_date timestamptz,
  sales_type text,
  sub_total numeric,
  tax_amount numeric,
  total_amount numeric,
  is_credit_memo boolean,
  is_rebill boolean,
  original_invoice_reference text,
  payment_status text,
  pdf_storage_path text,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, invoice_number)
);

create table if not exists public.abc_invoice_lines (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.abc_invoices(id) on delete cascade,
  tenant_id uuid not null,
  line_id text,
  item_number text,
  item_description text,
  ordered_qty numeric,
  shipped_qty numeric,
  price_per_unit_amount numeric,
  extended_price_amount numeric,
  raw_payload jsonb not null default '{}'::jsonb
);

-- =========================================
-- Webhooks
-- =========================================
create table if not exists public.abc_webhooks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  integration_id uuid references public.abc_integrations(id) on delete cascade,
  webhook_id text not null,
  name text not null,
  webhook_type text not null,
  events text[] not null default '{}',
  url text not null,
  status text,
  secret text,
  active_since timestamptz,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, webhook_id)
);

create table if not exists public.abc_webhook_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid,
  webhook_id text,
  event_type text,
  authorization_header_present boolean default false,
  signature_match boolean default false,
  accepted boolean not null default false,
  order_number text,
  confirmation_number text,
  invoice_number text,
  payload jsonb not null,
  processing_error text,
  received_at timestamptz not null default now()
);

create index if not exists abc_webhook_events_tenant_received_idx
  on public.abc_webhook_events (tenant_id, received_at desc);

-- =========================================
-- updated_at triggers
-- =========================================
create or replace function public.abc_set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end; $$;

do $$
declare t text;
begin
  for t in select unnest(array[
    'abc_integrations','abc_tokens','abc_accounts','abc_branches',
    'abc_items','abc_item_availability','abc_orders','abc_invoices','abc_webhooks'
  ])
  loop
    execute format('drop trigger if exists trg_%1$s_updated_at on public.%1$s', t);
    execute format('create trigger trg_%1$s_updated_at before update on public.%1$s for each row execute function public.abc_set_updated_at()', t);
  end loop;
end $$;

-- =========================================
-- Admin helper (tenant-scoped admin role)
-- =========================================
create or replace function public.abc_is_tenant_admin(_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.user_can_access_tenant(_tenant_id) and (
    public.has_role(auth.uid(), 'master'::app_role)
    or public.has_role(auth.uid(), 'owner'::app_role)
    or public.has_role(auth.uid(), 'corporate'::app_role)
    or public.has_role(auth.uid(), 'office_admin'::app_role)
  );
$$;

-- =========================================
-- RLS
-- =========================================
alter table public.abc_integrations enable row level security;
alter table public.abc_tokens enable row level security;
alter table public.abc_oauth_states enable row level security;
alter table public.abc_accounts enable row level security;
alter table public.abc_branches enable row level security;
alter table public.abc_items enable row level security;
alter table public.abc_item_availability enable row level security;
alter table public.abc_price_requests enable row level security;
alter table public.abc_orders enable row level security;
alter table public.abc_order_lines enable row level security;
alter table public.abc_order_job_links enable row level security;
alter table public.abc_invoices enable row level security;
alter table public.abc_invoice_lines enable row level security;
alter table public.abc_webhooks enable row level security;
alter table public.abc_webhook_events enable row level security;

do $$
declare t text;
begin
  for t in select unnest(array[
    'abc_integrations','abc_accounts','abc_branches','abc_items','abc_item_availability',
    'abc_price_requests','abc_orders','abc_invoices','abc_webhooks','abc_webhook_events',
    'abc_order_job_links'
  ])
  loop
    execute format('drop policy if exists "tenant members can read %1$s" on public.%1$s', t);
    execute format($f$create policy "tenant members can read %1$s" on public.%1$s for select using (public.user_can_access_tenant(tenant_id))$f$, t);

    execute format('drop policy if exists "tenant admins can write %1$s" on public.%1$s', t);
    execute format($f$create policy "tenant admins can write %1$s" on public.%1$s for all using (public.abc_is_tenant_admin(tenant_id)) with check (public.abc_is_tenant_admin(tenant_id))$f$, t);
  end loop;
end $$;

create policy "tenant members can read abc_order_lines"
on public.abc_order_lines for select
using (exists (
  select 1 from public.abc_orders o
  where o.id = abc_order_lines.order_id
    and public.user_can_access_tenant(o.tenant_id)
));

create policy "tenant admins can write abc_order_lines"
on public.abc_order_lines for all
using (exists (
  select 1 from public.abc_orders o
  where o.id = abc_order_lines.order_id
    and public.abc_is_tenant_admin(o.tenant_id)
))
with check (exists (
  select 1 from public.abc_orders o
  where o.id = abc_order_lines.order_id
    and public.abc_is_tenant_admin(o.tenant_id)
));

create policy "tenant members can read abc_invoice_lines"
on public.abc_invoice_lines for select
using (exists (
  select 1 from public.abc_invoices inv
  where inv.id = abc_invoice_lines.invoice_id
    and public.user_can_access_tenant(inv.tenant_id)
));

create policy "tenant admins can write abc_invoice_lines"
on public.abc_invoice_lines for all
using (exists (
  select 1 from public.abc_invoices inv
  where inv.id = abc_invoice_lines.invoice_id
    and public.abc_is_tenant_admin(inv.tenant_id)
))
with check (exists (
  select 1 from public.abc_invoices inv
  where inv.id = abc_invoice_lines.invoice_id
    and public.abc_is_tenant_admin(inv.tenant_id)
));

-- abc_tokens + abc_oauth_states: NO policies = service-role only
-- (RLS enabled with no policies denies all client access)

-- =========================================
-- Storage buckets
-- =========================================
insert into storage.buckets (id, name, public)
values ('abc-invoices','abc-invoices', false)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('abc-item-images','abc-item-images', false)
on conflict (id) do nothing;

drop policy if exists "tenant members can read abc-invoices" on storage.objects;
create policy "tenant members can read abc-invoices"
on storage.objects for select
using (
  bucket_id = 'abc-invoices'
  and public.user_can_access_tenant(((storage.foldername(name))[1])::uuid)
);

drop policy if exists "tenant members can read abc-item-images" on storage.objects;
create policy "tenant members can read abc-item-images"
on storage.objects for select
using (
  bucket_id = 'abc-item-images'
  and public.user_can_access_tenant(((storage.foldername(name))[1])::uuid)
);
