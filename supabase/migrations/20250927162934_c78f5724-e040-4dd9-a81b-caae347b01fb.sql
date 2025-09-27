-- ============================================================================
-- Seed Dynamic Tags Migration (Schema Corrected)
-- Seeds starter dynamic tags and fixes smart_doc_renders tenant_id default
-- ============================================================================

-- Upsert helper: seeds common tokens for a specific tenant id
CREATE OR REPLACE FUNCTION public.seed_dynamic_tags(p_tenant_id uuid)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  -- CONTACT (using correct column names)
  INSERT INTO public.dynamic_tags (tenant_id, token, label, description, json_path, is_frequently_used, sample_value)
  VALUES
    (p_tenant_id,'contact.first_name','Contact First Name','Contact first name','contact.first_name', true, 'Chris'),
    (p_tenant_id,'contact.last_name','Contact Last Name','Contact last name','contact.last_name', true, 'O''Brien'),
    (p_tenant_id,'contact.email','Primary Email','Primary email on file','contact.email', true, 'name@example.com'),
    (p_tenant_id,'contact.phone','Primary Phone','Primary phone number','contact.phone', true, '+1-555-0100'),
    (p_tenant_id,'contact.company_name','Company Name','Business or company name','contact.company_name', true, 'ABC Roofing Co')
  ON CONFLICT (tenant_id, token) DO UPDATE
    SET label = EXCLUDED.label,
        description = EXCLUDED.description,
        json_path = EXCLUDED.json_path,
        is_frequently_used = EXCLUDED.is_frequently_used,
        sample_value = EXCLUDED.sample_value;

  -- PIPELINE ENTRIES (corrected from 'leads')
  INSERT INTO public.dynamic_tags (tenant_id, token, label, description, json_path, is_frequently_used, sample_value)
  VALUES
    (p_tenant_id,'lead.source','Lead Source','Marketing source or intake channel','pipeline_entries.lead_source', true, 'Referral'),
    (p_tenant_id,'lead.status','Lead Status','Current pipeline status','pipeline_entries.status', true, 'qualified'),
    (p_tenant_id,'lead.created_at','Lead Created','Lead creation timestamp','pipeline_entries.created_at', false, '2025-09-01T16:32:00Z')
  ON CONFLICT (tenant_id, token) DO UPDATE
    SET label = EXCLUDED.label,
        description = EXCLUDED.description,
        json_path = EXCLUDED.json_path,
        is_frequently_used = EXCLUDED.is_frequently_used,
        sample_value = EXCLUDED.sample_value;

  -- JOBS
  INSERT INTO public.dynamic_tags (tenant_id, token, label, description, json_path, is_frequently_used, sample_value)
  VALUES
    (p_tenant_id,'job.job_number','Job Number','Canonical job number','jobs.job_number', true, '1234-01'),
    (p_tenant_id,'job.status','Job Status','Current job status','jobs.status', true, 'active'),
    (p_tenant_id,'job.address','Job Address','Job site address','jobs.address_street', true, '123 Main St')
  ON CONFLICT (tenant_id, token) DO UPDATE
    SET label = EXCLUDED.label,
        description = EXCLUDED.description,
        json_path = EXCLUDED.json_path,
        is_frequently_used = EXCLUDED.is_frequently_used,
        sample_value = EXCLUDED.sample_value;

  -- ENHANCED ESTIMATES (corrected table name and columns)
  INSERT INTO public.dynamic_tags (tensor_id, token, label, description, json_path, is_frequently_used, sample_value)
  VALUES
    (p_tenant_id,'estimate.selling_price','Selling Price','Final estimate selling price','enhanced_estimates.selling_price', true, '18450.00'),
    (p_tenant_id,'estimate.material_cost','Materials Cost','Total materials cost','enhanced_estimates.material_cost', true, '9950.00'),
    (p_tenant_id,'estimate.labor_cost','Labor Cost','Total labor cost','enhanced_estimates.labor_cost', true, '4250.00'),
    (p_tenant_id,'estimate.status','Estimate Status','Current estimate status','enhanced_estimates.status', false, 'draft'),
    (p_tenant_id,'estimate.roof_area','Roof Area','Roof area in square feet','enhanced_estimates.roof_area_sq_ft', true, '2500')
  ON CONFLICT (tenant_id, token) DO UPDATE
    SET label = EXCLUDED.label,
        description = EXCLUDED.description,
        json_path = EXCLUDED.json_path,
        is_frequently_used = EXCLUDED.is_frequently_used,
        sample_value = EXCLUDED.sample_value;

  -- PROJECTS (Production)
  INSERT INTO public.dynamic_tags (tenant_id, token, label, description, json_path, is_frequently_used, sample_value)
  VALUES
    (p_tenant_id,'project.name','Project Name','Project display name','projects.name', true, 'Residential Roof Replacement'),
    (p_tenant_id,'project.status','Project Status','Current project status','projects.status', true, 'active'),
    (p_tenant_id,'project.created_at','Project Created','Project creation date','projects.created_at', false, '2025-09-15')
  ON CONFLICT (tenant_id, token) DO UPDATE
    SET label = EXCLUDED.label,
        description = EXCLUDED.description,
        json_path = EXCLUDED.json_path,
        is_frequently_used = EXCLUDED.is_frequently_used,
        sample_value = EXCLUDED.sample_value;

END $$;