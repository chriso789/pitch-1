-- ============================================================
-- Add source_document_id column to link with documents table
-- ============================================================

ALTER TABLE insurance_scope_documents
ADD COLUMN IF NOT EXISTS source_document_id UUID REFERENCES documents(id) ON DELETE SET NULL;

-- Create index for lookups
CREATE INDEX IF NOT EXISTS idx_insurance_scope_documents_source_document_id 
ON insurance_scope_documents(source_document_id);

-- ============================================================
-- Create function to auto-trigger scope ingestion
-- ============================================================

CREATE OR REPLACE FUNCTION public.trigger_scope_ingestion()
RETURNS TRIGGER AS $$
DECLARE
  webhook_url TEXT;
BEGIN
  -- Only process insurance documents
  IF NEW.document_type = 'insurance' THEN
    -- Build the webhook URL
    webhook_url := 'https://alxelfrbjzkmtnsulcei.supabase.co/functions/v1/scope-document-ingest';
    
    -- Use pg_net to make async HTTP request
    PERFORM net.http_post(
      url := webhook_url,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('request.jwt.claims', true)::jsonb->>'raw'
      ),
      body := jsonb_build_object(
        'storage_path', NEW.file_path,
        'document_type', 'estimate',
        'file_name', NEW.filename,
        'source_document_id', NEW.id
      )
    );
    
    RAISE LOG 'Triggered scope ingestion for document %', NEW.id;
  END IF;
  
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Log error but don't fail the insert
  RAISE LOG 'Failed to trigger scope ingestion for document %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ============================================================
-- Create trigger on documents table
-- ============================================================

DROP TRIGGER IF EXISTS auto_ingest_insurance_docs ON documents;

CREATE TRIGGER auto_ingest_insurance_docs
AFTER INSERT ON documents
FOR EACH ROW
WHEN (NEW.document_type = 'insurance')
EXECUTE FUNCTION public.trigger_scope_ingestion();

-- Add comment explaining the trigger
COMMENT ON TRIGGER auto_ingest_insurance_docs ON documents IS 
'Automatically triggers scope-document-ingest edge function when insurance documents are uploaded';