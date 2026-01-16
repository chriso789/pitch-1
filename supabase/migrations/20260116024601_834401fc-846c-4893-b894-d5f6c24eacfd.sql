-- Add file_hash column for PDF deduplication
ALTER TABLE public.roof_vendor_reports 
ADD COLUMN IF NOT EXISTS file_hash TEXT;

-- Create index for fast hash lookups
CREATE INDEX IF NOT EXISTS idx_roof_vendor_reports_file_hash 
ON public.roof_vendor_reports(file_hash) WHERE file_hash IS NOT NULL;

-- Add comment
COMMENT ON COLUMN public.roof_vendor_reports.file_hash IS 'SHA-256 hash of PDF bytes for deduplication';