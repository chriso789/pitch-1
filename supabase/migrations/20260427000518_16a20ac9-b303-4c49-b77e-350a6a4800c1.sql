-- ai_roof_edges: identifiers + label placement
alter table public.ai_roof_edges
  add column if not exists edge_id text,
  add column if not exists edge_label text,
  add column if not exists label_x numeric,
  add column if not exists label_y numeric,
  add column if not exists orientation_degrees numeric,
  add column if not exists is_perimeter boolean default false,
  add column if not exists annotation_point jsonb;

-- ai_roof_planes: labels, evidence, placeholder flag
alter table public.ai_roof_planes
  add column if not exists plane_label text,
  add column if not exists label_x numeric,
  add column if not exists label_y numeric,
  add column if not exists source_evidence jsonb default '{}'::jsonb,
  add column if not exists is_placeholder boolean default false;

-- ai_measurement_diagrams: storage tracking
alter table public.ai_measurement_diagrams
  add column if not exists storage_path text,
  add column if not exists render_version text,
  add column if not exists checksum text;

-- ai_measurement_jobs: report path
alter table public.ai_measurement_jobs
  add column if not exists report_pdf_path text;

-- roof_measurements: report manifest + breakdowns
alter table public.roof_measurements
  add column if not exists report_pdf_path text,
  add column if not exists diagram_manifest jsonb default '[]'::jsonb,
  add column if not exists edge_breakdown jsonb default '{}'::jsonb,
  add column if not exists plane_breakdown jsonb default '[]'::jsonb;
-- geometry_quality_score and measurement_quality_score already exist on roof_measurements

-- Storage bucket for generated PDF reports (private; access via signed URLs)
insert into storage.buckets (id, name, public)
values ('ai-measurement-reports', 'ai-measurement-reports', false)
on conflict (id) do nothing;

-- RLS: allow authenticated users to read report files in their tenant scope.
-- Files are uploaded by the service role from the edge function; clients only need read.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'AI measurement reports - authenticated read'
  ) then
    create policy "AI measurement reports - authenticated read"
      on storage.objects for select
      to authenticated
      using (bucket_id = 'ai-measurement-reports');
  end if;
end $$;