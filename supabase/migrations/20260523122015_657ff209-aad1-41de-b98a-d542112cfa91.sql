
-- =========================================================
-- PITCH IMPORT / MIGRATION SYSTEM — Phase 1 (staging only)
-- Master-only access. No writes to production tables yet.
-- =========================================================

create table if not exists public.import_batches (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  created_by uuid not null,
  source_system text not null,
  source_label text,
  status text not null default 'uploaded',
  import_mode text not null default 'dry_run',
  total_files integer default 0,
  total_rows integer default 0,
  processed_rows integer default 0,
  valid_rows integer default 0,
  invalid_rows integer default 0,
  duplicate_rows integer default 0,
  imported_rows integer default 0,
  failed_rows integer default 0,
  rollback_available boolean default false,
  rollback_status text default 'not_started',
  started_at timestamptz,
  completed_at timestamptz,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.import_files (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  batch_id uuid not null references public.import_batches(id) on delete cascade,
  storage_bucket text not null default 'imports',
  storage_path text not null,
  original_filename text not null,
  mime_type text,
  file_size_bytes bigint,
  file_kind text,
  status text not null default 'uploaded',
  detected_schema jsonb default '{}'::jsonb,
  row_count integer default 0,
  processed_count integer default 0,
  error_count integer default 0,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.import_field_maps (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  batch_id uuid references public.import_batches(id) on delete cascade,
  source_system text not null,
  entity_type text not null,
  source_field text not null,
  pitch_field text not null,
  transform_rule text,
  default_value text,
  required boolean default false,
  confidence numeric default 0,
  created_at timestamptz default now()
);

create table if not exists public.import_staging_records (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  batch_id uuid not null references public.import_batches(id) on delete cascade,
  file_id uuid references public.import_files(id) on delete set null,
  row_number integer,
  entity_type text not null,
  source_record_id text,
  raw_data jsonb not null default '{}'::jsonb,
  normalized_data jsonb not null default '{}'::jsonb,
  validation_status text not null default 'pending',
  duplicate_status text not null default 'unchecked',
  import_status text not null default 'pending',
  target_table text,
  target_record_id uuid,
  validation_errors jsonb default '[]'::jsonb,
  warnings jsonb default '[]'::jsonb,
  duplicate_candidates jsonb default '[]'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.import_validation_errors (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  batch_id uuid not null references public.import_batches(id) on delete cascade,
  staging_record_id uuid references public.import_staging_records(id) on delete cascade,
  severity text not null default 'error',
  entity_type text,
  field_name text,
  error_code text not null,
  message text not null,
  suggested_fix text,
  raw_value text,
  created_at timestamptz default now()
);

create table if not exists public.import_duplicate_reviews (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  batch_id uuid not null references public.import_batches(id) on delete cascade,
  staging_record_id uuid not null references public.import_staging_records(id) on delete cascade,
  entity_type text not null,
  candidate_table text not null,
  candidate_record_id uuid not null,
  confidence numeric not null default 0,
  match_reasons jsonb default '[]'::jsonb,
  decision text not null default 'pending',
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz default now()
);

create table if not exists public.import_file_queue (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  batch_id uuid not null references public.import_batches(id) on delete cascade,
  import_file_id uuid references public.import_files(id) on delete cascade,
  staging_record_id uuid references public.import_staging_records(id) on delete set null,
  source_path text not null,
  target_bucket text not null default 'documents',
  target_path text,
  linked_entity_type text,
  linked_entity_id uuid,
  file_category text,
  status text not null default 'queued',
  attempts integer default 0,
  last_error text,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.import_audit_log (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  batch_id uuid not null references public.import_batches(id) on delete cascade,
  actor_id uuid,
  action text not null,
  entity_type text,
  staging_record_id uuid,
  target_table text,
  target_record_id uuid,
  before_data jsonb,
  after_data jsonb,
  message text,
  created_at timestamptz default now()
);

create table if not exists public.import_rollback_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  batch_id uuid not null references public.import_batches(id) on delete cascade,
  target_table text not null,
  target_record_id uuid not null,
  rollback_action text not null default 'delete',
  restore_data jsonb,
  status text not null default 'pending',
  error text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.import_templates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid,
  source_system text not null,
  template_name text not null,
  entity_type text not null,
  field_map jsonb not null default '{}'::jsonb,
  transform_rules jsonb default '{}'::jsonb,
  is_global boolean default false,
  created_by uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_import_batches_tenant_status on public.import_batches(tenant_id, status);
create index if not exists idx_import_files_batch on public.import_files(batch_id);
create index if not exists idx_import_staging_batch_entity on public.import_staging_records(batch_id, entity_type);
create index if not exists idx_import_staging_status on public.import_staging_records(batch_id, validation_status, import_status);
create index if not exists idx_import_duplicate_reviews_batch on public.import_duplicate_reviews(batch_id, decision);
create index if not exists idx_import_file_queue_status on public.import_file_queue(tenant_id, status);
create index if not exists idx_import_rollback_batch on public.import_rollback_items(batch_id, status);
create index if not exists idx_import_validation_errors_batch on public.import_validation_errors(batch_id, severity);
create index if not exists idx_import_audit_log_batch on public.import_audit_log(batch_id, created_at desc);

-- Enable RLS on all import_* tables. Phase 1: master role only.
do $$
declare t text;
begin
  for t in select unnest(array[
    'import_batches','import_files','import_field_maps','import_staging_records',
    'import_validation_errors','import_duplicate_reviews','import_file_queue',
    'import_audit_log','import_rollback_items','import_templates'
  ]) loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "import_master_all" on public.%I', t);
    execute format($p$create policy "import_master_all" on public.%I for all to authenticated
      using (public.has_role(auth.uid(), 'master'::public.app_role))
      with check (public.has_role(auth.uid(), 'master'::public.app_role))$p$, t);
  end loop;
end $$;

-- Storage buckets: imports + import-quarantine (private)
insert into storage.buckets (id, name, public) values ('imports', 'imports', false)
  on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('import-quarantine', 'import-quarantine', false)
  on conflict (id) do nothing;

-- Storage RLS: master-only, tenant_id must be first path segment.
drop policy if exists "imports_master_select" on storage.objects;
drop policy if exists "imports_master_write" on storage.objects;
drop policy if exists "imports_master_update" on storage.objects;
drop policy if exists "imports_master_delete" on storage.objects;

create policy "imports_master_select" on storage.objects for select to authenticated
  using (
    bucket_id in ('imports','import-quarantine')
    and public.has_role(auth.uid(), 'master'::public.app_role)
  );
create policy "imports_master_write" on storage.objects for insert to authenticated
  with check (
    bucket_id in ('imports','import-quarantine')
    and public.has_role(auth.uid(), 'master'::public.app_role)
    and (storage.foldername(name))[1] is not null
  );
create policy "imports_master_update" on storage.objects for update to authenticated
  using (
    bucket_id in ('imports','import-quarantine')
    and public.has_role(auth.uid(), 'master'::public.app_role)
  );
create policy "imports_master_delete" on storage.objects for delete to authenticated
  using (
    bucket_id in ('imports','import-quarantine')
    and public.has_role(auth.uid(), 'master'::public.app_role)
  );

notify pgrst, 'reload schema';
