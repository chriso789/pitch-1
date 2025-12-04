-- Add deleted_at column to tenants table for soft delete tracking
ALTER TABLE public.tenants 
ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;

-- Add index for efficient filtering of active companies
CREATE INDEX IF NOT EXISTS idx_tenants_is_active ON public.tenants(is_active);

-- Add comment for documentation
COMMENT ON COLUMN public.tenants.deleted_at IS 'Timestamp when company was soft-deleted. NULL means active.';