-- Fix corrupted status fields in pipeline_entries table
-- Reset any pipeline entries with UUID status values to a valid default status

-- First, let's see what the corrupted entries look like and reset them to 'new_lead'
UPDATE public.pipeline_entries
SET status = 'new_lead',
    updated_at = now()
WHERE status ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

-- Log this data corruption fix in communication_history for audit trail
INSERT INTO public.communication_history (
    tenant_id,
    contact_id,
    communication_type,
    direction,
    content,
    metadata
)
SELECT 
    pe.tenant_id,
    pe.contact_id,
    'system',
    'internal',
    'Pipeline entry status was corrupted (UUID instead of status string) and has been reset to new_lead',
    jsonb_build_object(
        'action', 'data_corruption_fix',
        'pipeline_entry_id', pe.id,
        'previous_status', pe.status,
        'new_status', 'new_lead',
        'fixed_at', now()
    )
FROM public.pipeline_entries pe
WHERE pe.status ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';