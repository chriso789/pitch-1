-- Create contact_documents table to link merged smart docs to contacts/leads
CREATE TABLE IF NOT EXISTS public.contact_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  original_document_id UUID REFERENCES public.documents(id) ON DELETE SET NULL,
  filename TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_size INTEGER,
  mime_type TEXT,
  merged_tags JSONB DEFAULT '{}',
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.contact_documents ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view contact documents in their tenant"
  ON public.contact_documents FOR SELECT
  USING (tenant_id IN (
    SELECT COALESCE(active_tenant_id, tenant_id) FROM public.profiles WHERE id = auth.uid()
  ));

CREATE POLICY "Users can create contact documents in their tenant"
  ON public.contact_documents FOR INSERT
  WITH CHECK (tenant_id IN (
    SELECT COALESCE(active_tenant_id, tenant_id) FROM public.profiles WHERE id = auth.uid()
  ));

CREATE POLICY "Users can update contact documents in their tenant"
  ON public.contact_documents FOR UPDATE
  USING (tenant_id IN (
    SELECT COALESCE(active_tenant_id, tenant_id) FROM public.profiles WHERE id = auth.uid()
  ));

CREATE POLICY "Users can delete contact documents in their tenant"
  ON public.contact_documents FOR DELETE
  USING (tenant_id IN (
    SELECT COALESCE(active_tenant_id, tenant_id) FROM public.profiles WHERE id = auth.uid()
  ));

-- Create updated_at trigger
CREATE TRIGGER update_contact_documents_updated_at
  BEFORE UPDATE ON public.contact_documents
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Create index for faster lookups
CREATE INDEX idx_contact_documents_contact_id ON public.contact_documents(contact_id);
CREATE INDEX idx_contact_documents_tenant_id ON public.contact_documents(tenant_id);