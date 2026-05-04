do $$
declare
  target_lead_id uuid := '5b9ef2b6-59fa-496b-9da6-bd0ee2b182c3';
begin
  create temp table tmp_4063_ai_jobs on commit drop as
  select id
  from public.ai_measurement_jobs
  where lead_id = target_lead_id
     or source_record_id = target_lead_id;

  create temp table tmp_4063_roof_measurements on commit drop as
  select id
  from public.roof_measurements
  where customer_id = target_lead_id
     or lead_id = target_lead_id
     or source_record_id = target_lead_id
     or ai_measurement_job_id in (select id from tmp_4063_ai_jobs);

  update public.enhanced_estimates
  set measurement_report_id = null
  where measurement_report_id in (select id from tmp_4063_roof_measurements);

  update public.roof_measurement_validation_tests
  set measurement_id = null
  where measurement_id in (select id from tmp_4063_roof_measurements);

  delete from public.roof_line_overlays
  where measurement_id in (select id from tmp_4063_roof_measurements);

  delete from public.ai_measurement_diagrams
  where ai_measurement_job_id in (select id from tmp_4063_ai_jobs)
     or lead_id = target_lead_id
     or roof_measurement_id in (select id from tmp_4063_roof_measurements)
     or measurement_result_id in (
       select id from public.ai_measurement_results where job_id in (select id from tmp_4063_ai_jobs)
     );

  delete from public.ai_measurement_quality_checks
  where job_id in (select id from tmp_4063_ai_jobs);

  delete from public.ai_measurement_images
  where job_id in (select id from tmp_4063_ai_jobs);

  delete from public.ai_roof_edges
  where job_id in (select id from tmp_4063_ai_jobs);

  delete from public.ai_roof_planes
  where job_id in (select id from tmp_4063_ai_jobs);

  delete from public.ai_measurement_results
  where job_id in (select id from tmp_4063_ai_jobs);

  delete from public.measurement_approvals
  where pipeline_entry_id = target_lead_id
     or lead_id = target_lead_id
     or source_record_id = target_lead_id
     or ai_measurement_job_id in (select id from tmp_4063_ai_jobs)
     or measurement_id in (select id from tmp_4063_roof_measurements);

  delete from public.measurement_jobs
  where pipeline_entry_id = target_lead_id::text
     or lead_id = target_lead_id
     or source_record_id = target_lead_id
     or ai_measurement_job_id in (select id from tmp_4063_ai_jobs)
     or measurement_id in (select id from tmp_4063_roof_measurements);

  delete from public.roof_measurements
  where id in (select id from tmp_4063_roof_measurements);

  delete from public.ai_measurement_jobs
  where id in (select id from tmp_4063_ai_jobs);
end $$;