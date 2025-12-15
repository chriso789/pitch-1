-- STEP 1: Create all helper functions first
CREATE OR REPLACE FUNCTION public.get_user_location_ids()
RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT COALESCE(array_agg(location_id), ARRAY[]::uuid[]) FROM user_location_assignments WHERE user_id = auth.uid() AND is_active = true; $$;

CREATE OR REPLACE FUNCTION public.user_has_full_location_access()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('master', 'corporate', 'office_admin')); $$;

CREATE OR REPLACE FUNCTION public.get_user_active_location_id()
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT location_id FROM user_location_assignments WHERE user_id = auth.uid() AND is_active = true ORDER BY assigned_at ASC LIMIT 1; $$;

-- STEP 2: Add columns and indexes
ALTER TABLE public.estimates ADD COLUMN IF NOT EXISTS location_id uuid REFERENCES locations(id);
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS location_id uuid REFERENCES locations(id);
CREATE INDEX IF NOT EXISTS idx_estimates_location_id ON estimates(location_id);
CREATE INDEX IF NOT EXISTS idx_documents_location_id ON documents(location_id);

-- STEP 3: Contacts RLS
DROP POLICY IF EXISTS "Users can view contacts" ON contacts;
DROP POLICY IF EXISTS "contacts_location_select" ON contacts;
CREATE POLICY "contacts_location_select" ON contacts FOR SELECT USING (
  tenant_id = public.get_user_tenant_id() AND (public.user_has_full_location_access() OR location_id = ANY(public.get_user_location_ids()) OR (location_id IS NULL AND (created_by = auth.uid() OR assigned_to = auth.uid())))
);
DROP POLICY IF EXISTS "Users can insert contacts" ON contacts;
CREATE POLICY "contacts_location_insert" ON contacts FOR INSERT WITH CHECK (tenant_id = public.get_user_tenant_id());
DROP POLICY IF EXISTS "Users can update contacts" ON contacts;
CREATE POLICY "contacts_location_update" ON contacts FOR UPDATE USING (
  tenant_id = public.get_user_tenant_id() AND (public.user_has_full_location_access() OR location_id = ANY(public.get_user_location_ids()) OR (location_id IS NULL AND (created_by = auth.uid() OR assigned_to = auth.uid())))
);
DROP POLICY IF EXISTS "Users can delete contacts" ON contacts;
CREATE POLICY "contacts_location_delete" ON contacts FOR DELETE USING (
  tenant_id = public.get_user_tenant_id() AND (public.user_has_full_location_access() OR location_id = ANY(public.get_user_location_ids()) OR (location_id IS NULL AND created_by = auth.uid()))
);

-- STEP 4: Estimates RLS
DROP POLICY IF EXISTS "Users can view estimates" ON estimates;
CREATE POLICY "estimates_location_select" ON estimates FOR SELECT USING (
  tenant_id = public.get_user_tenant_id() AND (public.user_has_full_location_access() OR location_id = ANY(public.get_user_location_ids()) OR (location_id IS NULL AND created_by = auth.uid()))
);
DROP POLICY IF EXISTS "Users can insert estimates" ON estimates;
CREATE POLICY "estimates_location_insert" ON estimates FOR INSERT WITH CHECK (tenant_id = public.get_user_tenant_id());
DROP POLICY IF EXISTS "Users can update estimates" ON estimates;
CREATE POLICY "estimates_location_update" ON estimates FOR UPDATE USING (
  tenant_id = public.get_user_tenant_id() AND (public.user_has_full_location_access() OR location_id = ANY(public.get_user_location_ids()) OR (location_id IS NULL AND created_by = auth.uid()))
);
DROP POLICY IF EXISTS "Users can delete estimates" ON estimates;
CREATE POLICY "estimates_location_delete" ON estimates FOR DELETE USING (
  tenant_id = public.get_user_tenant_id() AND (public.user_has_full_location_access() OR location_id = ANY(public.get_user_location_ids()) OR (location_id IS NULL AND created_by = auth.uid()))
);

-- STEP 5: Documents RLS  
DROP POLICY IF EXISTS "Users can view documents" ON documents;
CREATE POLICY "documents_location_select" ON documents FOR SELECT USING (
  tenant_id = public.get_user_tenant_id() AND (public.user_has_full_location_access() OR location_id = ANY(public.get_user_location_ids()) OR (location_id IS NULL AND uploaded_by = auth.uid()))
);
DROP POLICY IF EXISTS "Users can insert documents" ON documents;
CREATE POLICY "documents_location_insert" ON documents FOR INSERT WITH CHECK (tenant_id = public.get_user_tenant_id());
DROP POLICY IF EXISTS "Users can update documents" ON documents;
CREATE POLICY "documents_location_update" ON documents FOR UPDATE USING (
  tenant_id = public.get_user_tenant_id() AND (public.user_has_full_location_access() OR location_id = ANY(public.get_user_location_ids()) OR (location_id IS NULL AND uploaded_by = auth.uid()))
);
DROP POLICY IF EXISTS "Users can delete documents" ON documents;
CREATE POLICY "documents_location_delete" ON documents FOR DELETE USING (
  tenant_id = public.get_user_tenant_id() AND (public.user_has_full_location_access() OR location_id = ANY(public.get_user_location_ids()) OR (location_id IS NULL AND uploaded_by = auth.uid()))
);

-- STEP 6: Auto-set location trigger
CREATE OR REPLACE FUNCTION public.auto_set_location_id() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN IF NEW.location_id IS NULL THEN NEW.location_id := public.get_user_active_location_id(); END IF; RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS auto_set_location_contacts ON contacts;
CREATE TRIGGER auto_set_location_contacts BEFORE INSERT ON contacts FOR EACH ROW EXECUTE FUNCTION public.auto_set_location_id();
DROP TRIGGER IF EXISTS auto_set_location_estimates ON estimates;
CREATE TRIGGER auto_set_location_estimates BEFORE INSERT ON estimates FOR EACH ROW EXECUTE FUNCTION public.auto_set_location_id();
DROP TRIGGER IF EXISTS auto_set_location_documents ON documents;
CREATE TRIGGER auto_set_location_documents BEFORE INSERT ON documents FOR EACH ROW EXECUTE FUNCTION public.auto_set_location_id();