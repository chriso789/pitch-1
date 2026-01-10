-- Add default assignee column to company_api_keys for auto-assignment of leads
ALTER TABLE public.company_api_keys
ADD COLUMN IF NOT EXISTS default_assignee_id UUID REFERENCES auth.users(id);

-- Add comment explaining the column
COMMENT ON COLUMN public.company_api_keys.default_assignee_id IS 'User ID to auto-assign all leads from this API key to';