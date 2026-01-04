-- Harden user_roles table

-- 1. Set role column to NOT NULL (all existing rows already have role values)
ALTER TABLE public.user_roles 
ALTER COLUMN role SET NOT NULL;

-- 2. Add unique constraint on (user_id, tenant_id) to prevent duplicate roles
-- First check if constraint exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'user_roles_user_tenant_unique'
  ) THEN
    ALTER TABLE public.user_roles
    ADD CONSTRAINT user_roles_user_tenant_unique UNIQUE (user_id, tenant_id);
  END IF;
END $$;

-- 3. Add index for faster role lookups
CREATE INDEX IF NOT EXISTS idx_user_roles_user_tenant 
ON public.user_roles(user_id, tenant_id);

-- 4. Add index for role-based queries
CREATE INDEX IF NOT EXISTS idx_user_roles_tenant_role 
ON public.user_roles(tenant_id, role);