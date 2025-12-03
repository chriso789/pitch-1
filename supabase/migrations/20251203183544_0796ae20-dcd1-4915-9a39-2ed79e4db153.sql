-- Fix settings_tabs foreign key constraint to add ON DELETE CASCADE
ALTER TABLE public.settings_tabs 
DROP CONSTRAINT IF EXISTS settings_tabs_tenant_id_fkey;

-- Re-add with CASCADE
ALTER TABLE public.settings_tabs
ADD CONSTRAINT settings_tabs_tenant_id_fkey 
FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;