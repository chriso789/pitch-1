-- Create internal_notes table for team communication with @mentions
CREATE TABLE public.internal_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  pipeline_entry_id UUID NOT NULL REFERENCES public.pipeline_entries(id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  mentioned_user_ids UUID[] DEFAULT '{}',
  is_pinned BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes for fast lookups
CREATE INDEX idx_internal_notes_pipeline ON public.internal_notes(pipeline_entry_id, created_at DESC);
CREATE INDEX idx_internal_notes_mentions ON public.internal_notes USING GIN(mentioned_user_ids);
CREATE INDEX idx_internal_notes_tenant ON public.internal_notes(tenant_id);

-- Enable RLS
ALTER TABLE public.internal_notes ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view notes in their tenant"
  ON public.internal_notes FOR SELECT
  USING (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()));

CREATE POLICY "Users can create notes in their tenant"
  ON public.internal_notes FOR INSERT
  WITH CHECK (
    author_id = auth.uid() AND
    tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid())
  );

CREATE POLICY "Authors can update their notes"
  ON public.internal_notes FOR UPDATE
  USING (author_id = auth.uid());

CREATE POLICY "Authors and managers can delete notes"
  ON public.internal_notes FOR DELETE
  USING (
    author_id = auth.uid() OR 
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('master', 'owner', 'corporate', 'office_admin'))
  );

-- Trigger for updated_at
CREATE TRIGGER update_internal_notes_updated_at
  BEFORE UPDATE ON public.internal_notes
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();