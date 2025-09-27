-- Add pipeline_entry_id to documents table for lead tracking
ALTER TABLE public.documents 
ADD COLUMN IF NOT EXISTS pipeline_entry_id UUID REFERENCES public.pipeline_entries(id);

-- Add contract status tracking to pipeline entries metadata
UPDATE public.pipeline_entries 
SET metadata = COALESCE(metadata, '{}') || '{"approval_requirements": {"contract": false, "estimate": false, "materials": false, "labor": false}}'
WHERE metadata IS NULL OR NOT (metadata ? 'approval_requirements');

-- Create index for better performance on document lookups
CREATE INDEX IF NOT EXISTS idx_documents_pipeline_entry_id ON public.documents(pipeline_entry_id);
CREATE INDEX IF NOT EXISTS idx_documents_type ON public.documents(document_type);

-- Create trigger to update approval requirements when documents are added
CREATE OR REPLACE FUNCTION update_lead_approval_requirements()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- Update pipeline entry approval requirements when relevant documents are added
    IF NEW.pipeline_entry_id IS NOT NULL AND NEW.document_type = 'contract' THEN
        UPDATE public.pipeline_entries 
        SET metadata = COALESCE(metadata, '{}') || '{"approval_requirements": {"contract": true}}'
        WHERE id = NEW.pipeline_entry_id;
    END IF;
    
    RETURN NEW;
END;
$$;

-- Create trigger for document updates
DROP TRIGGER IF EXISTS trigger_update_lead_approval_requirements ON public.documents;
CREATE TRIGGER trigger_update_lead_approval_requirements
    AFTER INSERT OR UPDATE ON public.documents
    FOR EACH ROW
    EXECUTE FUNCTION update_lead_approval_requirements();