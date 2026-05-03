do $$
declare
  v_lead_id uuid := '5b9ef2b6-59fa-496b-9da6-bd0ee2b182c3';
  v_correct_tenant uuid;
begin
  select tenant_id into v_correct_tenant
  from public.pipeline_entries
  where id = v_lead_id;

  if v_correct_tenant is null then
    raise exception 'Lead % not found or has no tenant_id', v_lead_id;
  end if;

  update public.measurement_jobs
  set tenant_id = v_correct_tenant::text,
      updated_at = now()
  where pipeline_entry_id = v_lead_id::text
    and tenant_id is distinct from v_correct_tenant::text;

  update public.ai_measurement_jobs
  set tenant_id = v_correct_tenant,
      updated_at = now()
  where (lead_id = v_lead_id or source_record_id = v_lead_id)
    and tenant_id is distinct from v_correct_tenant;

  update public.roof_measurements
  set tenant_id = v_correct_tenant,
      updated_at = now()
  where (lead_id = v_lead_id or customer_id = v_lead_id)
    and tenant_id is distinct from v_correct_tenant;

  update public.measurement_approvals
  set tenant_id = v_correct_tenant
  where (lead_id = v_lead_id or pipeline_entry_id = v_lead_id or source_record_id = v_lead_id)
    and tenant_id is distinct from v_correct_tenant;

  update public.ai_measurement_diagrams
  set tenant_id = v_correct_tenant
  where lead_id = v_lead_id
    and tenant_id is distinct from v_correct_tenant;
end $$;