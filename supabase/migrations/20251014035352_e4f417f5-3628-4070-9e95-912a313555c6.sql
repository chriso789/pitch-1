-- Smart Docs Pack Integration
-- Product catalog for roofing materials with GOOD/BETTER/BEST tiers

CREATE TABLE IF NOT EXISTS public.product_catalog (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  category text NOT NULL CHECK (category IN ('asphalt_shingle', 'stone_coated_steel', 'concrete_tile', 'metal_exposed', 'metal_hidden')),
  tier text NOT NULL CHECK (tier IN ('GOOD', 'BETTER', 'BEST')),
  brand text NOT NULL,
  model text NOT NULL,
  description text,
  warranty_years int,
  price_per_square numeric(10,2),
  metadata jsonb DEFAULT '{}',
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (tenant_id, category, brand, model)
);

ALTER TABLE public.product_catalog ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view products in their tenant"
  ON public.product_catalog FOR SELECT
  USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Admins can manage products in their tenant"
  ON public.product_catalog FOR ALL
  USING ((tenant_id = get_user_tenant_id()) AND has_any_role(ARRAY['admin'::app_role, 'manager'::app_role, 'master'::app_role]));

-- Smart doc templates (pre-built + user-created)
CREATE TABLE IF NOT EXISTS public.smart_doc_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  slug text NOT NULL,
  title text NOT NULL,
  category text NOT NULL,
  description text,
  content text NOT NULL,
  status text DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  is_system boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (tenant_id, slug)
);

ALTER TABLE public.smart_doc_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view templates in their tenant"
  ON public.smart_doc_templates FOR SELECT
  USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Admins can manage templates in their tenant"
  ON public.smart_doc_templates FOR ALL
  USING ((tenant_id = get_user_tenant_id()) AND has_any_role(ARRAY['admin'::app_role, 'manager'::app_role, 'master'::app_role]));

-- Rendered instances (saved outputs)
CREATE TABLE IF NOT EXISTS public.smart_doc_instances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  template_id uuid REFERENCES smart_doc_templates(id),
  title text NOT NULL,
  rendered_html text NOT NULL,
  pdf_url text,
  storage_path text,
  lead_id uuid,
  job_id uuid,
  created_by uuid,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.smart_doc_instances ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view instances in their tenant"
  ON public.smart_doc_instances FOR SELECT
  USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Users can create instances in their tenant"
  ON public.smart_doc_instances FOR INSERT
  WITH CHECK (tenant_id = get_user_tenant_id());

CREATE POLICY "Users can update instances in their tenant"
  ON public.smart_doc_instances FOR UPDATE
  USING (tenant_id = get_user_tenant_id());

-- RPC: Build context for rendering
CREATE OR REPLACE FUNCTION public.api_smartdoc_build_context(
  p_lead_id uuid DEFAULT NULL,
  p_job_id uuid DEFAULT NULL,
  p_extra jsonb DEFAULT '{}'
) RETURNS jsonb 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid;
  v_context jsonb := '{}';
  v_contact jsonb;
  v_lead jsonb;
  v_job jsonb;
  v_photos jsonb[];
  v_products jsonb[];
  v_roof_type text;
  v_project_id uuid;
BEGIN
  v_tenant_id := get_user_tenant_id();
  
  -- Get contact from lead or job
  IF p_lead_id IS NOT NULL THEN
    SELECT to_jsonb(pe) INTO v_lead 
    FROM pipeline_entries pe 
    WHERE id = p_lead_id AND tenant_id = v_tenant_id;
    
    v_context := v_context || jsonb_build_object('lead', v_lead);
    
    IF v_lead->>'contact_id' IS NOT NULL THEN
      SELECT to_jsonb(c) INTO v_contact 
      FROM contacts c 
      WHERE id = (v_lead->>'contact_id')::uuid AND tenant_id = v_tenant_id;
    END IF;
    
    v_project_id := (v_lead->>'project_id')::uuid;
  ELSIF p_job_id IS NOT NULL THEN
    SELECT to_jsonb(j) INTO v_job 
    FROM jobs j 
    WHERE id = p_job_id AND tenant_id = v_tenant_id;
    
    v_context := v_context || jsonb_build_object('job', v_job);
    
    IF v_job->>'contact_id' IS NOT NULL THEN
      SELECT to_jsonb(c) INTO v_contact 
      FROM contacts c 
      WHERE id = (v_job->>'contact_id')::uuid AND tenant_id = v_tenant_id;
    END IF;
    
    v_project_id := (v_job->>'project_id')::uuid;
  END IF;
  
  v_context := v_context || jsonb_build_object('contact', v_contact);
  
  -- Get photos
  IF v_project_id IS NOT NULL THEN
    SELECT array_agg(to_jsonb(pp)) INTO v_photos 
    FROM project_photos pp 
    WHERE pp.project_id = v_project_id AND pp.tenant_id = v_tenant_id;
  END IF;
  
  v_context := v_context || jsonb_build_object('photos', COALESCE(v_photos, '[]'::jsonb));
  
  -- Get recommended products based on roof type
  v_roof_type := COALESCE(
    p_extra->>'roof_type', 
    v_job->>'roof_type', 
    'asphalt_shingle'
  );
  
  SELECT array_agg(to_jsonb(pc) ORDER BY 
    CASE pc.tier 
      WHEN 'GOOD' THEN 1 
      WHEN 'BETTER' THEN 2 
      WHEN 'BEST' THEN 3 
    END
  ) INTO v_products
  FROM product_catalog pc
  WHERE pc.category = v_roof_type 
    AND pc.tenant_id = v_tenant_id 
    AND pc.is_active = true
  LIMIT 3;
  
  v_context := v_context || jsonb_build_object(
    'recommended_products', COALESCE(v_products, '[]'::jsonb),
    'extra', p_extra,
    'today', CURRENT_DATE::text
  );
  
  RETURN v_context;
END;
$$;

-- RPC: List templates
CREATE OR REPLACE FUNCTION public.api_smartdoc_templates_list()
RETURNS SETOF smart_doc_templates 
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * FROM smart_doc_templates 
  WHERE tenant_id = get_user_tenant_id() 
  AND status = 'active'
  ORDER BY is_system DESC, title;
$$;

-- RPC: Get single template
CREATE OR REPLACE FUNCTION public.api_smartdoc_templates_get(p_id uuid)
RETURNS smart_doc_templates 
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * FROM smart_doc_templates 
  WHERE id = p_id AND tenant_id = get_user_tenant_id()
  LIMIT 1;
$$;

-- Create smart-docs storage bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('smart-docs', 'smart-docs', false)
ON CONFLICT (id) DO NOTHING;

-- RLS policies for smart-docs bucket
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'storage' 
    AND tablename = 'objects' 
    AND policyname = 'Users can upload PDFs to smart-docs'
  ) THEN
    CREATE POLICY "Users can upload PDFs to smart-docs"
    ON storage.objects FOR INSERT
    TO authenticated
    WITH CHECK (bucket_id = 'smart-docs' AND auth.uid() IS NOT NULL);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'storage' 
    AND tablename = 'objects' 
    AND policyname = 'Users can view their tenant PDFs in smart-docs'
  ) THEN
    CREATE POLICY "Users can view their tenant PDFs in smart-docs"
    ON storage.objects FOR SELECT
    TO authenticated
    USING (bucket_id = 'smart-docs' AND 
      (storage.foldername(name))[1] IN (
        SELECT tenant_id::text FROM profiles WHERE id = auth.uid()
      ));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'storage' 
    AND tablename = 'objects' 
    AND policyname = 'Users can delete their tenant PDFs in smart-docs'
  ) THEN
    CREATE POLICY "Users can delete their tenant PDFs in smart-docs"
    ON storage.objects FOR DELETE
    TO authenticated
    USING (bucket_id = 'smart-docs' AND 
      (storage.foldername(name))[1] IN (
        SELECT tenant_id::text FROM profiles WHERE id = auth.uid()
      ));
  END IF;
END $$;