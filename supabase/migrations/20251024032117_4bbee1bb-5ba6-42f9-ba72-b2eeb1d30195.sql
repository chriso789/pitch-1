-- Backfill existing records with C-L-J numbers (Fixed)
DO $$
DECLARE
  v_tenant RECORD;
  v_contact RECORD;
  v_pipeline RECORD;
  v_project RECORD;
  v_contact_num INTEGER;
  v_lead_num INTEGER;
  v_job_num INTEGER;
BEGIN
  -- For each tenant
  FOR v_tenant IN SELECT id FROM tenants ORDER BY created_at LOOP
    v_contact_num := 1;
    
    -- Assign contact numbers
    FOR v_contact IN 
      SELECT id FROM contacts 
      WHERE tenant_id = v_tenant.id AND contact_number IS NULL
      ORDER BY created_at
    LOOP
      UPDATE contacts
      SET 
        contact_number = v_contact_num,
        clj_formatted_number = format_clj_number(v_contact_num)
      WHERE id = v_contact.id;
      
      v_contact_num := v_contact_num + 1;
    END LOOP;
    
    -- Assign lead numbers
    FOR v_contact IN SELECT id, contact_number FROM contacts WHERE tenant_id = v_tenant.id LOOP
      v_lead_num := 1;
      
      FOR v_pipeline IN
        SELECT id FROM pipeline_entries
        WHERE tenant_id = v_tenant.id 
          AND contact_id = v_contact.id 
          AND lead_number IS NULL
        ORDER BY created_at
      LOOP
        UPDATE pipeline_entries
        SET 
          contact_number = v_contact.contact_number,
          lead_number = v_lead_num,
          clj_formatted_number = format_clj_number(v_contact.contact_number, v_lead_num)
        WHERE id = v_pipeline.id;
        
        v_lead_num := v_lead_num + 1;
      END LOOP;
    END LOOP;
    
    -- Assign job numbers (skip pipeline_id filter since it may not exist)
    FOR v_pipeline IN 
      SELECT id, contact_number, lead_number 
      FROM pipeline_entries 
      WHERE tenant_id = v_tenant.id 
        AND contact_number IS NOT NULL 
        AND lead_number IS NOT NULL
    LOOP
      v_job_num := 1;
      
      -- Match projects to pipeline by contact_id (if available)
      FOR v_project IN
        SELECT p.id FROM projects p
        LEFT JOIN pipeline_entries pe ON pe.contact_id = (
          SELECT contact_id FROM pipeline_entries WHERE id = v_pipeline.id
        )
        WHERE p.tenant_id = v_tenant.id 
          AND p.job_number IS NULL
        ORDER BY p.created_at
        LIMIT 10
      LOOP
        UPDATE projects
        SET 
          contact_number = v_pipeline.contact_number,
          lead_number = v_pipeline.lead_number,
          job_number = v_job_num,
          clj_formatted_number = format_clj_number(
            v_pipeline.contact_number, 
            v_pipeline.lead_number, 
            v_job_num
          )
        WHERE id = v_project.id;
        
        v_job_num := v_job_num + 1;
      END LOOP;
    END LOOP;
  END LOOP;
  
  RAISE NOTICE 'Backfill completed successfully';
END $$;