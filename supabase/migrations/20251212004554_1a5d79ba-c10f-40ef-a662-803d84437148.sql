-- Creates tables to store vendor PDFs + normalized measurement truths for model training/calibration.

create table if not exists public.roof_vendor_reports (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),

  lead_id uuid null,

  provider text not null,
  report_number text null,
  address text null,

  file_bucket text null,
  file_path text null,
  file_url text null,

  extracted_text text null,
  parsed jsonb not null default '{}'::jsonb
);

create index if not exists roof_vendor_reports_provider_idx
  on public.roof_vendor_reports(provider);

create index if not exists roof_vendor_reports_report_number_idx
  on public.roof_vendor_reports(report_number);

create table if not exists public.roof_measurements_truth (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),

  report_id uuid not null references public.roof_vendor_reports(id) on delete cascade,

  provider text not null,
  report_number text null,
  address text null,

  total_area_sqft numeric null,
  pitched_area_sqft numeric null,
  flat_area_sqft numeric null,
  facet_count integer null,
  predominant_pitch text null,

  ridges_ft numeric null,
  hips_ft numeric null,
  valleys_ft numeric null,
  rakes_ft numeric null,
  eaves_ft numeric null,
  drip_edge_ft numeric null,

  parapet_walls_ft numeric null,
  flashing_ft numeric null,
  step_flashing_ft numeric null,

  wall_flashing_ft numeric null,
  transitions_ft numeric null,
  unspecified_ft numeric null,

  latitude numeric null,
  longitude numeric null,

  pitches jsonb null,
  waste_table jsonb null
);

create index if not exists roof_measurements_truth_report_id_idx
  on public.roof_measurements_truth(report_id);

create index if not exists roof_measurements_truth_provider_idx
  on public.roof_measurements_truth(provider);

-- Enable RLS
alter table public.roof_vendor_reports enable row level security;
alter table public.roof_measurements_truth enable row level security;

-- Allow service role full access (for edge functions)
create policy "Service role full access on roof_vendor_reports"
  on public.roof_vendor_reports for all
  using (true)
  with check (true);

create policy "Service role full access on roof_measurements_truth"
  on public.roof_measurements_truth for all
  using (true)
  with check (true);