
-- ============================================================
-- Vendor Migration Adapter Layer (Phase 1, staging-only)
-- ============================================================

-- 1) vendor_import_adapters --------------------------------------------------
create table if not exists public.vendor_import_adapters (
  id uuid primary key default gen_random_uuid(),
  source_system text not null unique,
  display_name text not null,
  supported_entity_types text[] not null default '{}',
  supported_file_types text[] not null default '{}',
  adapter_version text not null default '1.0.0',
  is_active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.vendor_import_adapters enable row level security;

create policy "adapters_select_authenticated"
  on public.vendor_import_adapters for select
  to authenticated using (true);

create policy "adapters_master_write"
  on public.vendor_import_adapters for all
  to authenticated
  using (public.has_role(auth.uid(), 'master'::public.app_role))
  with check (public.has_role(auth.uid(), 'master'::public.app_role));

-- seed adapters
insert into public.vendor_import_adapters (source_system, display_name, supported_entity_types, supported_file_types, notes) values
  ('jobnimbus',    'JobNimbus',     array['contact','job','note','document','image','estimate','activity'], array['csv','zip','json'], 'CRM export'),
  ('acculynx',     'AccuLynx',      array['contact','job','document','image','payment','activity'],         array['csv','zip'],         'CRM export'),
  ('roofr',        'Roofr',         array['estimate','document','image'],                                   array['csv','pdf','zip'],   'Measurements + proposals'),
  ('quickbooks',   'QuickBooks',    array['contact','invoice','payment','budget','budget_line_item'],       array['csv','xlsx','iif'],  'Accounting export'),
  ('companycam',   'CompanyCam',    array['image','document'],                                              array['zip','json'],        'Photo project export'),
  ('jobber',       'Jobber',        array['contact','property','job','estimate','invoice'],                 array['csv','zip'],         'CRM export'),
  ('housecallpro', 'Housecall Pro', array['contact','job','estimate','invoice'],                            array['csv','zip'],         'CRM export'),
  ('generic_csv',  'Generic CSV',   array['contact','job','invoice','payment','note'],                      array['csv','xlsx'],        'Fallback with manual entity selection'),
  ('generic_zip',  'Generic ZIP',   array['document','image'],                                              array['zip'],               'Fallback ZIP analyzer')
on conflict (source_system) do nothing;

-- 2) import_source_manifests -------------------------------------------------
create table if not exists public.import_source_manifests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  batch_id uuid not null references public.import_batches(id) on delete cascade,
  source_system text not null,
  detected_confidence numeric not null default 0,
  files jsonb not null default '[]'::jsonb,
  detected_entities jsonb not null default '{}'::jsonb,
  folder_structure jsonb not null default '{}'::jsonb,
  warnings jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_import_source_manifests_batch on public.import_source_manifests(batch_id);
alter table public.import_source_manifests enable row level security;
create policy "src_manifests_master"
  on public.import_source_manifests for all
  to authenticated
  using (public.has_role(auth.uid(), 'master'::public.app_role))
  with check (public.has_role(auth.uid(), 'master'::public.app_role));

-- 3) import_migration_plans --------------------------------------------------
create table if not exists public.import_migration_plans (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  batch_id uuid not null references public.import_batches(id) on delete cascade,
  source_system text not null,
  plan_status text not null default 'draft',
  entity_order text[] not null default '{}',
  estimated_counts jsonb not null default '{}'::jsonb,
  required_mappings jsonb not null default '{}'::jsonb,
  optional_mappings jsonb not null default '{}'::jsonb,
  unresolved_requirements jsonb not null default '[]'::jsonb,
  risk_flags jsonb not null default '[]'::jsonb,
  recommended_actions jsonb not null default '[]'::jsonb,
  confidence_score numeric not null default 0,
  confidence_band text not null default 'unknown',
  created_by uuid,
  approved_by uuid,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_import_migration_plans_batch on public.import_migration_plans(batch_id);
alter table public.import_migration_plans enable row level security;
create policy "mig_plans_master"
  on public.import_migration_plans for all
  to authenticated
  using (public.has_role(auth.uid(), 'master'::public.app_role))
  with check (public.has_role(auth.uid(), 'master'::public.app_role));

-- 4) import_vendor_record_links ---------------------------------------------
create table if not exists public.import_vendor_record_links (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  batch_id uuid not null references public.import_batches(id) on delete cascade,
  source_system text not null,
  source_entity_type text not null,
  source_record_id text not null,
  pitch_entity_type text not null,
  pitch_table text not null,
  pitch_record_id uuid not null,
  source_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(tenant_id, source_system, source_entity_type, source_record_id)
);
create index if not exists idx_import_vendor_record_links_lookup
  on public.import_vendor_record_links(tenant_id, source_system, source_entity_type, source_record_id);
alter table public.import_vendor_record_links enable row level security;
create policy "vendor_links_master"
  on public.import_vendor_record_links for all
  to authenticated
  using (public.has_role(auth.uid(), 'master'::public.app_role))
  with check (public.has_role(auth.uid(), 'master'::public.app_role));

-- 5) import_status_maps ------------------------------------------------------
create table if not exists public.import_status_maps (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  batch_id uuid references public.import_batches(id) on delete cascade,
  source_system text not null,
  entity_type text not null,
  source_status text not null,
  pitch_status text not null,
  created_at timestamptz not null default now()
);
alter table public.import_status_maps enable row level security;
create policy "status_maps_master"
  on public.import_status_maps for all
  to authenticated
  using (public.has_role(auth.uid(), 'master'::public.app_role))
  with check (public.has_role(auth.uid(), 'master'::public.app_role));

-- 6) import_user_maps --------------------------------------------------------
create table if not exists public.import_user_maps (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  batch_id uuid references public.import_batches(id) on delete cascade,
  source_system text not null,
  source_user_name text,
  source_user_email text,
  pitch_user_id uuid,
  fallback_behavior text not null default 'leave_unassigned',
  created_at timestamptz not null default now()
);
alter table public.import_user_maps enable row level security;
create policy "user_maps_master"
  on public.import_user_maps for all
  to authenticated
  using (public.has_role(auth.uid(), 'master'::public.app_role))
  with check (public.has_role(auth.uid(), 'master'::public.app_role));

-- 7) import_budget_category_maps --------------------------------------------
create table if not exists public.import_budget_category_maps (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  batch_id uuid references public.import_batches(id) on delete cascade,
  source_system text not null,
  source_category text not null,
  pitch_category text not null,
  created_at timestamptz not null default now()
);
alter table public.import_budget_category_maps enable row level security;
create policy "budget_maps_master"
  on public.import_budget_category_maps for all
  to authenticated
  using (public.has_role(auth.uid(), 'master'::public.app_role))
  with check (public.has_role(auth.uid(), 'master'::public.app_role));

-- 8) import_document_category_maps ------------------------------------------
create table if not exists public.import_document_category_maps (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  batch_id uuid references public.import_batches(id) on delete cascade,
  source_system text not null,
  source_folder_or_type text not null,
  pitch_document_category text not null,
  created_at timestamptz not null default now()
);
alter table public.import_document_category_maps enable row level security;
create policy "doc_maps_master"
  on public.import_document_category_maps for all
  to authenticated
  using (public.has_role(auth.uid(), 'master'::public.app_role))
  with check (public.has_role(auth.uid(), 'master'::public.app_role));

-- Reload PostgREST schema cache
notify pgrst, 'reload schema';
