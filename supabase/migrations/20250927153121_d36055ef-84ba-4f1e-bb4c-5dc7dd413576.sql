-- Create jobs for existing pipeline entries with 'project' status that don't have jobs yet
INSERT INTO jobs (
    tenant_id,
    pipeline_entry_id,
    contact_id,
    name,
    description,
    status,
    estimated_value,
    roof_type,
    created_by
) 
SELECT 
    pe.tenant_id,
    pe.id,
    pe.contact_id,
    COALESCE(
        c.first_name || ' ' || c.last_name || ' - ' || COALESCE(c.address_street, 'Roofing Project'),
        'Roofing Project'
    ),
    'Job created from approved pipeline entry',
    'pending',
    pe.estimated_value,
    pe.roof_type,
    pe.created_by
FROM pipeline_entries pe
LEFT JOIN contacts c ON c.id = pe.contact_id
WHERE pe.status = 'project' 
AND NOT EXISTS (
    SELECT 1 FROM jobs j WHERE j.pipeline_entry_id = pe.id
);

-- Verify the trigger exists and recreate if needed
DROP TRIGGER IF EXISTS trigger_create_job_from_pipeline ON pipeline_entries;
CREATE TRIGGER trigger_create_job_from_pipeline
    AFTER UPDATE ON pipeline_entries
    FOR EACH ROW
    EXECUTE FUNCTION create_job_from_pipeline();