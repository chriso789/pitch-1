-- ============================================================================
-- 2025-09-27_seed_dynamic_tags.sql
-- Seeds a starter set of dynamic tags and makes smart_doc_renders.tenant_id default
-- to get_user_tenant_id() so Edge Functions can INSERT with RLS safely.
-- ============================================================================

-- Ensure helper exists (from previous migration). Adjust if your schema differs.
create or replace function public.get_user_tenant_id() returns uuid
language sql stable as $$
  select nullif(auth.jwt() ->> 'tenant_id','')::uuid
$$;

-- Make tenant_id default on renders so we can insert without leaking tenant
alter table if exists public.smart_doc_renders
  alter column tenant_id set default public.get_user_tenant_id();

-- Upsert helper: seeds common tokens for a specific tenant id
create or replace function public.seed_dynamic_tags(p_tenant_id uuid)
returns void language plpgsql as $$
begin
  -- CONTACT
  insert into public.dynamic_tags (tenant_id, token, label, description, json_path, is_frequently_used, sample_value)
  values
    (p_tenant_id,'contact.first_name','Contact First Name','Lead/contact first name','contact.name_first', true, 'Chris'),
    (p_tenant_id,'contact.last_name','Contact Last Name','Lead/contact last name','contact.name_last', true, 'O''Brien'),
    (p_tenant_id,'contact.email','Primary Email','Primary email on file','contact.email_primary', true, 'name@example.com'),
    (p_tenant_id,'contact.phone','Primary Phone','Primary phone on file','contact.phone_primary', true, '+1-555-0100')
  on conflict (tenant_id, token) do update
    set label = excluded.label,
        description = excluded.description,
        json_path = excluded.json_path,
        is_frequently_used = excluded.is_frequently_used,
        sample_value = excluded.sample_value;

  -- LEAD
  insert into public.dynamic_tags (tenant_id, token, label, description, json_path, is_frequently_used, sample_value)
  values
    (p_tenant_id,'lead.source','Lead Source','Marketing source or intake channel','lead.source', true, 'Referral'),
    (p_tenant_id,'lead.created_at','Lead Created','Lead creation timestamp (ISO)','lead.created_at', false, '2025-09-01T16:32:00Z')
  on conflict (tenant_id, token) do update
    set label = excluded.label,
        description = excluded.description,
        json_path = excluded.json_path,
        is_frequently_used = excluded.is_frequently_used,
        sample_value = excluded.sample_value;

  -- JOB
  insert into public.dynamic_tags (tenant_id, token, label, description, json_path, is_frequently_used, sample_value)
  values
    (p_tenant_id,'job.job_number','Job Number','Canonical C-L-J job number','job.job_number', true, '1-2-4'),
    (p_tenant_id,'job.address_line','Job Address','Formatted street, city, state','job.address_line', true, '123 Main St, Tampa, FL')
  on conflict (tenant_id, token) do update
    set label = excluded.label,
        description = excluded.description,
        json_path = excluded.json_path,
        is_frequently_used = excluded.is_frequently_used,
        sample_value = excluded.sample_value;

  -- ESTIMATE
  insert into public.dynamic_tags (tenant_id, token, label, description, json_path, is_frequently_used, sample_value)
  values
    (p_tenant_id,'estimate.sell_price','Sell Price','Estimate sale price (post-margin)','estimate.sale_price', true, '18450.00'),
    (p_tenant_id,'estimate.materials_cost','Materials Cost','Computed materials cost','estimate.materials_cost', true, '9950.00'),
    (p_tenant_id,'estimate.labor_cost','Labor Cost','Computed labor cost','estimate.labor_cost', true, '4250.00'),
    (p_tenant_id,'estimate.overhead_pct','Overhead %','Overhead percentage applied','estimate.overhead_pct', false, '0.15'),
    (p_tenant_id,'estimate.margin_pct','Margin %','Profit margin percentage','estimate.margin_pct', false, '0.30')
  on conflict (tenant_id, token) do update
    set label = excluded.label,
        description = excluded.description,
        json_path = excluded.json_path,
        is_frequently_used = excluded.is_frequently_used,
        sample_value = excluded.sample_value;

  -- PROJECT (Production)
  insert into public.dynamic_tags (tenant_id, token, label, description, json_path, is_frequently_used, sample_value)
  values
    (p_tenant_id,'project.permit_number','Permit Number','City permit number','project.permit_number', true, 'PERM-24-123456'),
    (p_tenant_id,'project.noc_received','NOC Received','Whether NOC recorded','project.noc_received', false, 'true'),
    (p_tenant_id,'project.scheduled_date','Scheduled Date','Next production milestone date','project.scheduled_date', true, '2025-10-03')
  on conflict (tenant_id, token) do update
    set label = excluded.label,
        description = excluded.description,
        json_path = excluded.json_path,
        is_frequently_used = excluded.is_frequently_used,
        sample_value = excluded.sample_value;

end $$;

-- Usage examples (run one of these interactively):
-- select public.seed_dynamic_tags('<YOUR_TENANT_UUID>'::uuid);
-- or, if running with a user JWT that contains tenant_id:
-- select public.seed_dynamic_tags(public.get_user_tenant_id());
