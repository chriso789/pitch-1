-- Mark stuck documents as failed so users can see them and reprocess
UPDATE insurance_scope_documents 
SET parse_status = 'failed', 
    parse_error = 'Processing timeout - please reprocess',
    updated_at = NOW()
WHERE parse_status IN ('extracting', 'parsing') 
  AND parse_started_at < NOW() - INTERVAL '5 minutes';