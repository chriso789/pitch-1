-- Geometry-first AI Measurement pipeline tables
-- Created for the upgraded "AI Measurement" button pipeline (replaces legacy start-ai-measurement flow)

create table if not exists public.ai_measurement_jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid,
  company_id uuid,
  lead_id uuid,
  project_id uuid,
  user_id uuid,
  legacy_measurement_job_id uuid,
  legacy_roof_measurement_id uuid,
  property_address text not null,
  latitude double precision,
  longitude double precision,
  status text not null default 'queued',
  status_message text,
  failure_reason text,
  source_priority jsonb default '["google_solar","mapbox","ai_segmentation"]'::jsonb,
  waste_factor_percent numeric default 10,
  confidence_score numeric,
  geometry_quality_score numeric,
  measurement_quality_score numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists idx_ai_measurement_jobs_tenant on public.ai_measurement_jobs(tenant_id);
create index if not exists idx_ai_measurement_jobs_lead on public.ai_measurement_jobs(lead_id);
create index if not exists idx_ai_measurement_jobs_project on public.ai_measurement_jobs(project_id);
create index if not exists idx_ai_measurement_jobs_status on public.ai_measurement_jobs(status);

create table if not exists public.ai_measurement_images (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.ai_measurement_jobs(id) on delete cascade,
  source text not null,
  image_url text,
  storage_path text,
  width integer,
  height integer,
  zoom numeric,
  bearing numeric default 0,
  pitch numeric default 0,
  meters_per_pixel numeric,
  feet_per_pixel numeric,
  calibration jsonb,
  transform jsonb,
  is_primary boolean default false,
  created_at timestamptz not null default now()
);
create index if not exists idx_ai_measurement_images_job on public.ai_measurement_images(job_id);

create table if not exists public.ai_roof_planes (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.ai_measurement_jobs(id) on delete cascade,
  plane_index integer,
  source text not null,
  polygon_px jsonb,
  polygon_geojson jsonb,
  pitch numeric,
  pitch_degrees numeric,
  azimuth numeric,
  area_2d_sqft numeric,
  pitch_multiplier numeric,
  area_pitch_adjusted_sqft numeric,
  confidence numeric,
  created_at timestamptz not null default now()
);
create index if not exists idx_ai_roof_planes_job on public.ai_roof_planes(job_id);

create table if not exists public.ai_roof_edges (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.ai_measurement_jobs(id) on delete cascade,
  edge_type text not null,
  source text not null,
  line_px jsonb,
  line_geojson jsonb,
  length_px numeric,
  length_ft numeric,
  confidence numeric,
  adjacent_plane_ids jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_ai_roof_edges_job on public.ai_roof_edges(job_id);
create index if not exists idx_ai_roof_edges_type on public.ai_roof_edges(edge_type);

create table if not exists public.ai_measurement_results (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.ai_measurement_jobs(id) on delete cascade,
  total_area_2d_sqft numeric,
  total_area_pitch_adjusted_sqft numeric,
  roof_square_count numeric,
  waste_factor_percent numeric default 10,
  waste_adjusted_squares numeric,
  ridge_length_ft numeric default 0,
  hip_length_ft numeric default 0,
  valley_length_ft numeric default 0,
  eave_length_ft numeric default 0,
  rake_length_ft numeric default 0,
  perimeter_length_ft numeric default 0,
  dominant_pitch numeric,
  pitch_breakdown jsonb,
  line_breakdown jsonb,
  plane_breakdown jsonb,
  confidence_score numeric,
  report_json jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_ai_measurement_results_job on public.ai_measurement_results(job_id);

create table if not exists public.ai_measurement_quality_checks (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.ai_measurement_jobs(id) on delete cascade,
  check_name text not null,
  passed boolean not null,
  score numeric,
  details jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_ai_measurement_quality_checks_job on public.ai_measurement_quality_checks(job_id);

-- Enable RLS
alter table public.ai_measurement_jobs enable row level security;
alter table public.ai_measurement_images enable row level security;
alter table public.ai_roof_planes enable row level security;
alter table public.ai_roof_edges enable row level security;
alter table public.ai_measurement_results enable row level security;
alter table public.ai_measurement_quality_checks enable row level security;

-- Tenant-scoped read policies (uses existing get_user_tenant_ids() helper if present, else falls back to user-only)
create policy "ai_measurement_jobs tenant read"
  on public.ai_measurement_jobs for select
  using (
    tenant_id is null
    or tenant_id in (select public.get_user_tenant_id())
    or user_id = auth.uid()
  );

create policy "ai_measurement_jobs service write"
  on public.ai_measurement_jobs for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create policy "ai_measurement_jobs auth insert"
  on public.ai_measurement_jobs for insert
  to authenticated
  with check (user_id = auth.uid() or tenant_id in (select public.get_user_tenant_id()));

-- Child tables: read if parent job is readable
create policy "ai_measurement_images read via job"
  on public.ai_measurement_images for select
  using (exists (select 1 from public.ai_measurement_jobs j where j.id = job_id and (j.tenant_id is null or j.tenant_id in (select public.get_user_tenant_id()) or j.user_id = auth.uid())));
create policy "ai_measurement_images service write" on public.ai_measurement_images for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

create policy "ai_roof_planes read via job"
  on public.ai_roof_planes for select
  using (exists (select 1 from public.ai_measurement_jobs j where j.id = job_id and (j.tenant_id is null or j.tenant_id in (select public.get_user_tenant_id()) or j.user_id = auth.uid())));
create policy "ai_roof_planes service write" on public.ai_roof_planes for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

create policy "ai_roof_edges read via job"
  on public.ai_roof_edges for select
  using (exists (select 1 from public.ai_measurement_jobs j where j.id = job_id and (j.tenant_id is null or j.tenant_id in (select public.get_user_tenant_id()) or j.user_id = auth.uid())));
create policy "ai_roof_edges service write" on public.ai_roof_edges for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

create policy "ai_measurement_results read via job"
  on public.ai_measurement_results for select
  using (exists (select 1 from public.ai_measurement_jobs j where j.id = job_id and (j.tenant_id is null or j.tenant_id in (select public.get_user_tenant_id()) or j.user_id = auth.uid())));
create policy "ai_measurement_results service write" on public.ai_measurement_results for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

create policy "ai_measurement_quality_checks read via job"
  on public.ai_measurement_quality_checks for select
  using (exists (select 1 from public.ai_measurement_jobs j where j.id = job_id and (j.tenant_id is null or j.tenant_id in (select public.get_user_tenant_id()) or j.user_id = auth.uid())));
create policy "ai_measurement_quality_checks service write" on public.ai_measurement_quality_checks for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

-- updated_at trigger
create trigger trg_ai_measurement_jobs_updated_at
  before update on public.ai_measurement_jobs
  for each row execute function public.update_updated_at_column();