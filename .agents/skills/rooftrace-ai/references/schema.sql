-- RoofTrace AI schema. Apply tenant-membership RLS pattern to all four tables.

create table if not exists roof_trace_sessions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  job_id uuid not null references jobs(id) on delete cascade,
  measurement_id uuid references roof_measurements(id) on delete set null,
  status text not null default 'draft' check (status in ('draft','processing','needs_review','approved','archived')),
  source_type text not null check (source_type in ('upload','licensed_imagery','county_gis','drone','report','plan_pdf')),
  source_url text,
  source_metadata jsonb not null default '{}'::jsonb,
  calibration jsonb not null default '{}'::jsonb,
  perimeter_status text not null default 'pending',
  perimeter_confidence numeric,
  topology_confidence numeric,
  pitch_confidence numeric,
  active_revision integer not null default 0,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists roof_trace_revisions (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references roof_trace_sessions(id) on delete cascade,
  revision integer not null,
  state text not null check (state in ('draft','approved','superseded')),
  geometry jsonb not null,
  measurements jsonb not null default '{}'::jsonb,
  warnings jsonb not null default '[]'::jsonb,
  ai_evidence jsonb not null default '{}'::jsonb,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  unique(session_id, revision)
);

create table if not exists roof_trace_jobs (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references roof_trace_sessions(id) on delete cascade,
  type text not null check (type in ('acquire','calibrate','perimeter','topology','pitch','report')),
  status text not null default 'queued' check (status in ('queued','running','complete','failed')),
  request jsonb not null default '{}'::jsonb,
  result jsonb,
  error text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists measurement_drafts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  job_id uuid not null references jobs(id) on delete cascade,
  trace_revision_id uuid not null references roof_trace_revisions(id),
  status text not null default 'ready' check (status in ('ready','applied','superseded')),
  totals jsonb not null,
  created_by uuid not null,
  created_at timestamptz not null default now()
);

create index if not exists roof_trace_sessions_job_idx on roof_trace_sessions(job_id, updated_at desc);
create index if not exists roof_trace_jobs_session_idx on roof_trace_jobs(session_id, created_at desc);

alter table roof_trace_sessions enable row level security;
alter table roof_trace_revisions enable row level security;
alter table roof_trace_jobs enable row level security;
alter table measurement_drafts enable row level security;
