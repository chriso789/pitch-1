-- =========================================
-- PITCH CREW PORTAL (Isolated Module)
-- Schema: crew
-- Requires: pgcrypto extension for gen_random_uuid()
-- =========================================

create extension if not exists pgcrypto;

create schema if not exists crew;

-- ---------- ENUMS ----------
do $$ begin
  create type crew.user_role as enum ('admin','manager','subcontractor');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type crew.doc_type as enum ('license','insurance_gl','insurance_wc','certification','other');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type crew.job_status as enum (
    'assigned',
    'en_route',
    'on_site',
    'work_started',
    'waiting',
    'completed'
  );
exception when duplicate_object then null;
end $$;

-- ---------- COMPANY USERS (isolated role map) ----------
create table if not exists crew.company_users (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  user_id uuid not null unique,
  role crew.user_role not null default 'subcontractor',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists idx_company_users_company on crew.company_users(company_id);
create index if not exists idx_company_users_user on crew.company_users(user_id);

-- ---------- SUBCONTRACTOR PROFILE ----------
create table if not exists crew.subcontractor_profiles (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  user_id uuid not null unique,
  legal_business_name text,
  dba text,
  primary_contact_name text,
  phone text,
  email text,
  address_line1 text,
  address_line2 text,
  city text,
  state text,
  postal_code text,
  emergency_contact_name text,
  emergency_contact_relationship text,
  emergency_contact_phone text,
  emergency_contact_alt_phone text,
  primary_trade text not null default 'Unknown',
  trade_tags text[] not null default '{}',
  notes_internal text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_sub_profiles_company on crew.subcontractor_profiles(company_id);
create index if not exists idx_sub_profiles_user on crew.subcontractor_profiles(user_id);

create or replace function crew.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_sub_profiles_updated_at on crew.subcontractor_profiles;
create trigger trg_sub_profiles_updated_at
before update on crew.subcontractor_profiles
for each row execute function crew.set_updated_at();

-- ---------- DOCUMENT TYPES (configurable) ----------
create table if not exists crew.document_types (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  key text not null,
  label text not null,
  doc_kind crew.doc_type not null,
  is_required boolean not null default false,
  blocks_assignment_if_expired boolean not null default true,
  created_at timestamptz not null default now(),
  unique(company_id, key)
);

create index if not exists idx_doc_types_company on crew.document_types(company_id);

-- ---------- SUBCONTRACTOR DOCUMENTS ----------
create table if not exists crew.subcontractor_documents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  subcontractor_user_id uuid not null,
  document_type_id uuid not null references crew.document_types(id) on delete cascade,
  issuing_authority text,
  number text,
  effective_date date,
  expiration_date date not null,
  file_url text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_sub_docs_company on crew.subcontractor_documents(company_id);
create index if not exists idx_sub_docs_user on crew.subcontractor_documents(subcontractor_user_id);
create index if not exists idx_sub_docs_exp on crew.subcontractor_documents(expiration_date);

drop trigger if exists trg_sub_docs_updated_at on crew.subcontractor_documents;
create trigger trg_sub_docs_updated_at
before update on crew.subcontractor_documents
for each row execute function crew.set_updated_at();

-- ---------- JOB ASSIGNMENTS ----------
create table if not exists crew.job_assignments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  job_id uuid not null,
  subcontractor_user_id uuid not null,
  scheduled_date date,
  arrival_window_start time,
  arrival_window_end time,
  scope_summary text,
  special_instructions text,
  status crew.job_status not null default 'assigned',
  status_updated_at timestamptz not null default now(),
  is_locked boolean not null default false,
  lock_reason text,
  created_at timestamptz not null default now(),
  unique(company_id, job_id, subcontractor_user_id)
);

create index if not exists idx_job_assign_company on crew.job_assignments(company_id);
create index if not exists idx_job_assign_job on crew.job_assignments(job_id);
create index if not exists idx_job_assign_user on crew.job_assignments(subcontractor_user_id);

-- ---------- PHOTO BUCKETS / REQUIREMENTS ----------
create table if not exists crew.photo_buckets (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  key text not null,
  label text not null,
  description text,
  created_at timestamptz not null default now(),
  unique(company_id, key)
);

create table if not exists crew.job_photo_requirements (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  job_id uuid not null,
  bucket_id uuid not null references crew.photo_buckets(id) on delete cascade,
  required_count int not null default 1,
  is_required boolean not null default true,
  created_at timestamptz not null default now(),
  unique(company_id, job_id, bucket_id)
);

create index if not exists idx_photo_req_job on crew.job_photo_requirements(job_id);

-- ---------- PHOTO UPLOADS ----------
create table if not exists crew.job_photos (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  job_id uuid not null,
  subcontractor_user_id uuid not null,
  bucket_id uuid not null references crew.photo_buckets(id),
  file_url text not null,
  taken_at timestamptz not null default now(),
  gps_lat numeric,
  gps_lng numeric,
  created_at timestamptz not null default now()
);

create index if not exists idx_job_photos_job on crew.job_photos(job_id);
create index if not exists idx_job_photos_user on crew.job_photos(subcontractor_user_id);
create index if not exists idx_job_photos_bucket on crew.job_photos(bucket_id);

-- ---------- CHECKLIST TEMPLATES ----------
create table if not exists crew.checklist_templates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  key text not null,
  label text not null,
  created_at timestamptz not null default now(),
  unique(company_id, key)
);

create table if not exists crew.checklist_items (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references crew.checklist_templates(id) on delete cascade,
  sort_order int not null default 0,
  label text not null,
  help_text text,
  requires_photo boolean not null default false,
  is_required boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists idx_checklist_items_template on crew.checklist_items(template_id);

-- ---------- JOB CHECKLIST INSTANCES ----------
create table if not exists crew.job_checklists (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  job_id uuid not null,
  template_id uuid not null references crew.checklist_templates(id),
  created_at timestamptz not null default now(),
  unique(company_id, job_id, template_id)
);

create table if not exists crew.job_checklist_responses (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  job_checklist_id uuid not null references crew.job_checklists(id) on delete cascade,
  item_id uuid not null references crew.checklist_items(id) on delete cascade,
  subcontractor_user_id uuid not null,
  is_checked boolean not null default false,
  note text,
  proof_photo_id uuid references crew.job_photos(id),
  checked_at timestamptz,
  created_at timestamptz not null default now(),
  unique(company_id, job_checklist_id, item_id, subcontractor_user_id)
);

create index if not exists idx_checklist_resp_job on crew.job_checklist_responses(job_checklist_id);

-- ---------- STATUS EVENT LOG ----------
create table if not exists crew.job_status_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  job_id uuid not null,
  subcontractor_user_id uuid,
  old_status crew.job_status,
  new_status crew.job_status not null,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists idx_job_status_events_job on crew.job_status_events(job_id);

-- =========================================
-- HELPERS: ROLE CHECKS
-- =========================================

create or replace function crew.my_company_id()
returns uuid
language sql stable
as $$
  select company_id from crew.company_users where user_id = auth.uid() and is_active = true limit 1
$$;

create or replace function crew.is_admin(_company_id uuid)
returns boolean
language sql stable
as $$
  select exists (
    select 1 from crew.company_users
    where user_id = auth.uid()
      and company_id = _company_id
      and role in ('admin','manager')
      and is_active = true
  )
$$;

create or replace function crew.is_subcontractor(_company_id uuid)
returns boolean
language sql stable
as $$
  select exists (
    select 1 from crew.company_users
    where user_id = auth.uid()
      and company_id = _company_id
      and role = 'subcontractor'
      and is_active = true
  )
$$;

create or replace function crew.is_assigned_to_job(_company_id uuid, _job_id uuid)
returns boolean
language sql stable
as $$
  select exists (
    select 1 from crew.job_assignments
    where company_id = _company_id
      and job_id = _job_id
      and subcontractor_user_id = auth.uid()
  )
$$;

-- =========================================
-- DOC VALIDITY + LOCKING
-- =========================================

create or replace function crew.sub_docs_valid(_company_id uuid, _sub_user uuid)
returns boolean
language sql stable
as $$
  with required_types as (
    select id
    from crew.document_types
    where company_id = _company_id
      and is_required = true
      and blocks_assignment_if_expired = true
  ),
  latest_docs as (
    select distinct on (document_type_id)
      document_type_id,
      expiration_date
    from crew.subcontractor_documents
    where company_id = _company_id
      and subcontractor_user_id = _sub_user
    order by document_type_id, expiration_date desc
  )
  select not exists (
    select 1
    from required_types rt
    left join latest_docs ld on ld.document_type_id = rt.id
    where ld.document_type_id is null
       or ld.expiration_date < current_date
  )
$$;

-- =========================================
-- PHOTO + CHECKLIST COMPLETION GATES
-- =========================================

create or replace function crew.photo_requirements_met(_company_id uuid, _job_id uuid, _sub_user uuid)
returns boolean
language sql stable
as $$
  with req as (
    select r.bucket_id, r.required_count
    from crew.job_photo_requirements r
    where r.company_id = _company_id
      and r.job_id = _job_id
      and r.is_required = true
  ),
  counts as (
    select bucket_id, count(*)::int as cnt
    from crew.job_photos
    where company_id = _company_id
      and job_id = _job_id
      and subcontractor_user_id = _sub_user
    group by bucket_id
  )
  select not exists (
    select 1
    from req
    left join counts on counts.bucket_id = req.bucket_id
    where coalesce(counts.cnt, 0) < req.required_count
  )
$$;

create or replace function crew.checklist_met(_company_id uuid, _job_id uuid, _sub_user uuid)
returns boolean
language sql stable
as $$
  with jc as (
    select id, template_id
    from crew.job_checklists
    where company_id = _company_id
      and job_id = _job_id
    limit 1
  ),
  required_items as (
    select ci.id, ci.requires_photo
    from jc
    join crew.checklist_items ci on ci.template_id = jc.template_id
    where ci.is_required = true
  ),
  responses as (
    select r.item_id, r.is_checked, r.proof_photo_id
    from jc
    join crew.job_checklist_responses r on r.job_checklist_id = jc.id
    where r.company_id = _company_id
      and r.subcontractor_user_id = _sub_user
  )
  select not exists (
    select 1
    from required_items ri
    left join responses r on r.item_id = ri.id
    where r.item_id is null
       or r.is_checked = false
       or (ri.requires_photo = true and r.proof_photo_id is null)
  )
$$;

create or replace function crew.can_complete_job(_company_id uuid, _job_id uuid, _sub_user uuid)
returns boolean
language sql stable
as $$
  select
    crew.sub_docs_valid(_company_id, _sub_user)
    and crew.photo_requirements_met(_company_id, _job_id, _sub_user)
    and crew.checklist_met(_company_id, _job_id, _sub_user)
$$;

-- =========================================
-- ENFORCE "COMPLETED" STATUS (HARD GATE)
-- =========================================

create or replace function crew.enforce_completion_gate()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'completed' and old.status is distinct from 'completed' then
    -- Allow admin override with logged reason
    if crew.is_admin(new.company_id) and new.lock_reason is not null then
      insert into crew.job_status_events(company_id, job_id, subcontractor_user_id, old_status, new_status, note)
      values (new.company_id, new.job_id, new.subcontractor_user_id, old.status, new.status, 'ADMIN OVERRIDE: ' || new.lock_reason);
      new.status_updated_at := now();
      return new;
    end if;
    
    -- Normal subcontractor must pass all gates
    if new.subcontractor_user_id is not null then
      if not crew.can_complete_job(new.company_id, new.job_id, new.subcontractor_user_id) then
        raise exception 'Cannot complete job: missing docs, required photos, or checklist items.';
      end if;
    end if;
  end if;
  
  new.status_updated_at := now();
  insert into crew.job_status_events(company_id, job_id, subcontractor_user_id, old_status, new_status, note)
  values (new.company_id, new.job_id, new.subcontractor_user_id, old.status, new.status, null);
  return new;
end $$;

drop trigger if exists trg_job_assign_completion_gate on crew.job_assignments;
create trigger trg_job_assign_completion_gate
before update of status on crew.job_assignments
for each row execute function crew.enforce_completion_gate();

-- =========================================
-- RLS ENABLE
-- =========================================

alter table crew.company_users enable row level security;
alter table crew.subcontractor_profiles enable row level security;
alter table crew.document_types enable row level security;
alter table crew.subcontractor_documents enable row level security;
alter table crew.job_assignments enable row level security;
alter table crew.photo_buckets enable row level security;
alter table crew.job_photo_requirements enable row level security;
alter table crew.job_photos enable row level security;
alter table crew.checklist_templates enable row level security;
alter table crew.checklist_items enable row level security;
alter table crew.job_checklists enable row level security;
alter table crew.job_checklist_responses enable row level security;
alter table crew.job_status_events enable row level security;

-- =========================================
-- RLS POLICIES
-- =========================================

-- 1) company_users
drop policy if exists "cu_admin_select_company_users" on crew.company_users;
create policy "cu_admin_select_company_users"
on crew.company_users for select
using (crew.is_admin(company_id));

drop policy if exists "cu_self_select_company_users" on crew.company_users;
create policy "cu_self_select_company_users"
on crew.company_users for select
using (user_id = auth.uid());

drop policy if exists "cu_admin_manage_company_users" on crew.company_users;
create policy "cu_admin_manage_company_users"
on crew.company_users for all
using (crew.is_admin(company_id))
with check (crew.is_admin(company_id));

-- 2) subcontractor_profiles
drop policy if exists "sp_admin_select" on crew.subcontractor_profiles;
create policy "sp_admin_select"
on crew.subcontractor_profiles for select
using (crew.is_admin(company_id));

drop policy if exists "sp_self_select" on crew.subcontractor_profiles;
create policy "sp_self_select"
on crew.subcontractor_profiles for select
using (user_id = auth.uid());

drop policy if exists "sp_self_update_non_sensitive" on crew.subcontractor_profiles;
create policy "sp_self_update_non_sensitive"
on crew.subcontractor_profiles for update
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "sp_admin_manage" on crew.subcontractor_profiles;
create policy "sp_admin_manage"
on crew.subcontractor_profiles for all
using (crew.is_admin(company_id))
with check (crew.is_admin(company_id));

-- 3) document_types
drop policy if exists "dt_admin_manage" on crew.document_types;
create policy "dt_admin_manage"
on crew.document_types for all
using (crew.is_admin(company_id))
with check (crew.is_admin(company_id));

drop policy if exists "dt_sub_read" on crew.document_types;
create policy "dt_sub_read"
on crew.document_types for select
using (company_id = crew.my_company_id());

-- 4) subcontractor_documents
drop policy if exists "sd_admin_read" on crew.subcontractor_documents;
create policy "sd_admin_read"
on crew.subcontractor_documents for select
using (crew.is_admin(company_id));

drop policy if exists "sd_self_read" on crew.subcontractor_documents;
create policy "sd_self_read"
on crew.subcontractor_documents for select
using (subcontractor_user_id = auth.uid());

drop policy if exists "sd_self_insert" on crew.subcontractor_documents;
create policy "sd_self_insert"
on crew.subcontractor_documents for insert
with check (
  subcontractor_user_id = auth.uid()
  and company_id = crew.my_company_id()
);

drop policy if exists "sd_self_update" on crew.subcontractor_documents;
create policy "sd_self_update"
on crew.subcontractor_documents for update
using (subcontractor_user_id = auth.uid())
with check (subcontractor_user_id = auth.uid());

drop policy if exists "sd_admin_manage" on crew.subcontractor_documents;
create policy "sd_admin_manage"
on crew.subcontractor_documents for all
using (crew.is_admin(company_id))
with check (crew.is_admin(company_id));

-- 5) job_assignments
drop policy if exists "ja_admin_read" on crew.job_assignments;
create policy "ja_admin_read"
on crew.job_assignments for select
using (crew.is_admin(company_id));

drop policy if exists "ja_sub_read_assigned" on crew.job_assignments;
create policy "ja_sub_read_assigned"
on crew.job_assignments for select
using (
  subcontractor_user_id = auth.uid()
  and company_id = crew.my_company_id()
);

drop policy if exists "ja_sub_update_status_only" on crew.job_assignments;
create policy "ja_sub_update_status_only"
on crew.job_assignments for update
using (
  subcontractor_user_id = auth.uid()
  and company_id = crew.my_company_id()
)
with check (
  subcontractor_user_id = auth.uid()
  and company_id = crew.my_company_id()
);

drop policy if exists "ja_admin_manage" on crew.job_assignments;
create policy "ja_admin_manage"
on crew.job_assignments for all
using (crew.is_admin(company_id))
with check (crew.is_admin(company_id));

-- 6) photo_buckets
drop policy if exists "pb_admin_manage" on crew.photo_buckets;
create policy "pb_admin_manage"
on crew.photo_buckets for all
using (crew.is_admin(company_id))
with check (crew.is_admin(company_id));

drop policy if exists "pb_sub_read" on crew.photo_buckets;
create policy "pb_sub_read"
on crew.photo_buckets for select
using (company_id = crew.my_company_id());

-- 7) job_photo_requirements
drop policy if exists "pr_admin_manage" on crew.job_photo_requirements;
create policy "pr_admin_manage"
on crew.job_photo_requirements for all
using (crew.is_admin(company_id))
with check (crew.is_admin(company_id));

drop policy if exists "pr_sub_read_assigned" on crew.job_photo_requirements;
create policy "pr_sub_read_assigned"
on crew.job_photo_requirements for select
using (
  company_id = crew.my_company_id()
  and crew.is_assigned_to_job(company_id, job_id)
);

-- 8) job_photos
drop policy if exists "jp_admin_read" on crew.job_photos;
create policy "jp_admin_read"
on crew.job_photos for select
using (crew.is_admin(company_id));

drop policy if exists "jp_sub_read_assigned" on crew.job_photos;
create policy "jp_sub_read_assigned"
on crew.job_photos for select
using (
  company_id = crew.my_company_id()
  and crew.is_assigned_to_job(company_id, job_id)
);

drop policy if exists "jp_sub_insert_assigned" on crew.job_photos;
create policy "jp_sub_insert_assigned"
on crew.job_photos for insert
with check (
  subcontractor_user_id = auth.uid()
  and company_id = crew.my_company_id()
  and crew.is_assigned_to_job(company_id, job_id)
);

-- 9) checklist_templates + items
drop policy if exists "ct_admin_manage" on crew.checklist_templates;
create policy "ct_admin_manage"
on crew.checklist_templates for all
using (crew.is_admin(company_id))
with check (crew.is_admin(company_id));

drop policy if exists "ct_sub_read" on crew.checklist_templates;
create policy "ct_sub_read"
on crew.checklist_templates for select
using (company_id = crew.my_company_id());

drop policy if exists "ci_admin_manage" on crew.checklist_items;
create policy "ci_admin_manage"
on crew.checklist_items for all
using (
  exists (
    select 1
    from crew.checklist_templates t
    where t.id = crew.checklist_items.template_id
      and crew.is_admin(t.company_id)
  )
)
with check (
  exists (
    select 1
    from crew.checklist_templates t
    where t.id = crew.checklist_items.template_id
      and crew.is_admin(t.company_id)
  )
);

drop policy if exists "ci_sub_read" on crew.checklist_items;
create policy "ci_sub_read"
on crew.checklist_items for select
using (
  exists (
    select 1
    from crew.checklist_templates t
    where t.id = crew.checklist_items.template_id
      and t.company_id = crew.my_company_id()
  )
);

-- 10) job_checklists
drop policy if exists "jc_admin_manage" on crew.job_checklists;
create policy "jc_admin_manage"
on crew.job_checklists for all
using (crew.is_admin(company_id))
with check (crew.is_admin(company_id));

drop policy if exists "jc_sub_read_assigned" on crew.job_checklists;
create policy "jc_sub_read_assigned"
on crew.job_checklists for select
using (
  company_id = crew.my_company_id()
  and crew.is_assigned_to_job(company_id, job_id)
);

-- 11) job_checklist_responses
drop policy if exists "jcr_admin_read" on crew.job_checklist_responses;
create policy "jcr_admin_read"
on crew.job_checklist_responses for select
using (crew.is_admin(company_id));

drop policy if exists "jcr_sub_read_assigned" on crew.job_checklist_responses;
create policy "jcr_sub_read_assigned"
on crew.job_checklist_responses for select
using (
  company_id = crew.my_company_id()
  and subcontractor_user_id = auth.uid()
);

drop policy if exists "jcr_sub_write_assigned" on crew.job_checklist_responses;
create policy "jcr_sub_write_assigned"
on crew.job_checklist_responses for insert
with check (
  company_id = crew.my_company_id()
  and subcontractor_user_id = auth.uid()
);

drop policy if exists "jcr_sub_update_assigned" on crew.job_checklist_responses;
create policy "jcr_sub_update_assigned"
on crew.job_checklist_responses for update
using (
  company_id = crew.my_company_id()
  and subcontractor_user_id = auth.uid()
)
with check (
  company_id = crew.my_company_id()
  and subcontractor_user_id = auth.uid()
);

-- 12) job_status_events
drop policy if exists "jse_admin_read" on crew.job_status_events;
create policy "jse_admin_read"
on crew.job_status_events for select
using (crew.is_admin(company_id));

drop policy if exists "jse_sub_read_assigned" on crew.job_status_events;
create policy "jse_sub_read_assigned"
on crew.job_status_events for select
using (
  company_id = crew.my_company_id()
  and crew.is_assigned_to_job(company_id, job_id)
);

-- =========================================
-- STORAGE BUCKETS FOR CREW PORTAL
-- =========================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES 
  ('crew-documents', 'crew-documents', false, 10485760, ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp']),
  ('crew-photos', 'crew-photos', false, 10485760, ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic'])
ON CONFLICT (id) DO NOTHING;

-- Storage policies for crew-documents
DROP POLICY IF EXISTS "crew_docs_sub_upload" ON storage.objects;
CREATE POLICY "crew_docs_sub_upload" ON storage.objects
FOR INSERT WITH CHECK (
  bucket_id = 'crew-documents'
  AND (storage.foldername(name))[1] = crew.my_company_id()::text
  AND (storage.foldername(name))[2] = auth.uid()::text
);

DROP POLICY IF EXISTS "crew_docs_sub_read" ON storage.objects;
CREATE POLICY "crew_docs_sub_read" ON storage.objects
FOR SELECT USING (
  bucket_id = 'crew-documents'
  AND (storage.foldername(name))[2] = auth.uid()::text
);

DROP POLICY IF EXISTS "crew_docs_admin_read" ON storage.objects;
CREATE POLICY "crew_docs_admin_read" ON storage.objects
FOR SELECT USING (
  bucket_id = 'crew-documents'
  AND crew.is_admin((storage.foldername(name))[1]::uuid)
);

-- Storage policies for crew-photos
DROP POLICY IF EXISTS "crew_photos_sub_upload" ON storage.objects;
CREATE POLICY "crew_photos_sub_upload" ON storage.objects
FOR INSERT WITH CHECK (
  bucket_id = 'crew-photos'
  AND (storage.foldername(name))[1] = crew.my_company_id()::text
  AND crew.is_assigned_to_job(
    (storage.foldername(name))[1]::uuid,
    (storage.foldername(name))[2]::uuid
  )
);

DROP POLICY IF EXISTS "crew_photos_sub_read" ON storage.objects;
CREATE POLICY "crew_photos_sub_read" ON storage.objects
FOR SELECT USING (
  bucket_id = 'crew-photos'
  AND crew.is_assigned_to_job(
    (storage.foldername(name))[1]::uuid,
    (storage.foldername(name))[2]::uuid
  )
);

DROP POLICY IF EXISTS "crew_photos_admin_read" ON storage.objects;
CREATE POLICY "crew_photos_admin_read" ON storage.objects
FOR SELECT USING (
  bucket_id = 'crew-photos'
  AND crew.is_admin((storage.foldername(name))[1]::uuid)
);