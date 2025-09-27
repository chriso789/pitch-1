-- ============================================================================
-- Core Automation System Migration (Fixed)
-- Creates tables for automations, dynamic tags, and smart document templates
-- ============================================================================

-- JSON helper function
CREATE OR REPLACE FUNCTION public.jsonb_get_path(obj jsonb, path text) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  keys text[];
  result jsonb := obj;
  key text;
BEGIN
  IF obj IS NULL OR path IS NULL THEN
    RETURN NULL;
  END IF;
  
  keys := string_to_array(path, '.');
  
  FOREACH key IN ARRAY keys LOOP
    IF result ? key THEN
      result := result -> key;
    ELSE
      RETURN NULL;
    END IF;
  END LOOP;
  
  RETURN CASE 
    WHEN jsonb_typeof(result) = 'string' THEN result #>> '{}'
    ELSE result::text
  END;
END;
$$;

-- Extract tokens helper
CREATE OR REPLACE FUNCTION public.extract_tokens(t text) RETURNS text[]
LANGUAGE plpgsql AS $$
BEGIN
  RETURN ARRAY(
    SELECT DISTINCT trim(match[1])
    FROM regexp_split_to_table(t, '\{\{([^}]+)\}\}', 'g') WITH ORDINALITY AS matches(match, ord)
    WHERE match[1] IS NOT NULL AND trim(match[1]) != ''
  );
END;
$$;

-- Automations table
CREATE TABLE IF NOT EXISTS public.automations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT get_user_tenant_id(),
  name text NOT NULL,
  description text,
  trigger_type text NOT NULL,
  trigger_conditions jsonb DEFAULT '{}',
  actions jsonb DEFAULT '[]',
  is_active boolean DEFAULT true,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Enable RLS on automations
ALTER TABLE public.automations ENABLE ROW LEVEL SECURITY;

-- RLS Policies for automations
CREATE POLICY "Users can view automations in their tenant"
  ON public.automations FOR SELECT
  USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Admins can manage automations in their tenant"
  ON public.automations FOR ALL
  USING (tenant_id = get_user_tenant_id() AND has_any_role(ARRAY['admin'::app_role, 'manager'::app_role, 'master'::app_role]));

-- Automation logs table
CREATE TABLE IF NOT EXISTS public.automation_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT get_user_tenant_id(),
  automation_id uuid NOT NULL REFERENCES public.automations(id) ON DELETE CASCADE,
  triggered_at timestamptz DEFAULT now(),
  trigger_data jsonb DEFAULT '{}',
  execution_result jsonb DEFAULT '{}',
  status text DEFAULT 'success',
  error_message text
);

-- Enable RLS on automation_logs
ALTER TABLE public.automation_logs ENABLE ROW LEVEL SECURITY;

-- RLS Policies for automation_logs
CREATE POLICY "Users can view automation logs in their tenant"
  ON public.automation_logs FOR SELECT
  USING (tenant_id = get_user_tenant_id());

CREATE POLICY "System can insert automation logs"
  ON public.automation_logs FOR INSERT
  WITH CHECK (tenant_id = get_user_tenant_id());

-- Dynamic tags table
CREATE TABLE IF NOT EXISTS public.dynamic_tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT get_user_tenant_id(),
  token text NOT NULL,
  label text NOT NULL,
  description text,
  json_path text NOT NULL,
  is_frequently_used boolean DEFAULT false,
  sample_value text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(tenant_id, token)
);

-- Enable RLS on dynamic_tags
ALTER TABLE public.dynamic_tags ENABLE ROW LEVEL SECURITY;

-- RLS Policies for dynamic_tags
CREATE POLICY "Users can view dynamic tags in their tenant"
  ON public.dynamic_tags FOR SELECT
  USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Admins can manage dynamic tags in their tenant"
  ON public.dynamic_tags FOR ALL
  USING (tenant_id = get_user_tenant_id() AND has_any_role(ARRAY['admin'::app_role, 'manager'::app_role, 'master'::app_role]));

-- Smart docs table
CREATE TABLE IF NOT EXISTS public.smart_docs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT get_user_tenant_id(),
  name text NOT NULL,
  description text,
  engine text DEFAULT 'liquid',
  body text NOT NULL,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Enable RLS on smart_docs
ALTER TABLE public.smart_docs ENABLE ROW LEVEL SECURITY;

-- RLS Policies for smart_docs
CREATE POLICY "Users can view smart docs in their tenant"
  ON public.smart_docs FOR SELECT
  USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Users can manage smart docs in their tenant"
  ON public.smart_docs FOR ALL
  USING (tenant_id = get_user_tenant_id());

-- Smart doc renders table
CREATE TABLE IF NOT EXISTS public.smart_doc_renders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT get_user_tenant_id(),
  smart_doc_id uuid NOT NULL REFERENCES public.smart_docs(id) ON DELETE CASCADE,
  context jsonb DEFAULT '{}',
  rendered_text text,
  unresolved_tokens text[] DEFAULT '{}',
  resolved_count integer DEFAULT 0,
  rendered_at timestamptz DEFAULT now()
);

-- Enable RLS on smart_doc_renders
ALTER TABLE public.smart_doc_renders ENABLE ROW LEVEL SECURITY;

-- RLS Policies for smart_doc_renders
CREATE POLICY "Users can view smart doc renders in their tenant"
  ON public.smart_doc_renders FOR SELECT
  USING (tenant_id = get_user_tenant_id());

CREATE POLICY "System can insert smart doc renders"
  ON public.smart_doc_renders FOR INSERT
  WITH CHECK (tenant_id = get_user_tenant_id());

-- RPC Functions
CREATE OR REPLACE FUNCTION public.api_automations_create(
  p_name text,
  p_description text DEFAULT NULL,
  p_trigger_type text DEFAULT 'manual',
  p_trigger_conditions jsonb DEFAULT '{}',
  p_actions jsonb DEFAULT '[]'
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO public.automations (name, description, trigger_type, trigger_conditions, actions)
  VALUES (p_name, p_description, p_trigger_type, p_trigger_conditions, p_actions)
  RETURNING id INTO v_id;
  
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.api_automations_update(
  p_id uuid,
  p_name text DEFAULT NULL,
  p_description text DEFAULT NULL,
  p_trigger_conditions jsonb DEFAULT NULL,
  p_actions jsonb DEFAULT NULL
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.automations 
  SET 
    name = COALESCE(p_name, name),
    description = COALESCE(p_description, description),
    trigger_conditions = COALESCE(p_trigger_conditions, trigger_conditions),
    actions = COALESCE(p_actions, actions),
    updated_at = now()
  WHERE id = p_id AND tenant_id = get_user_tenant_id();
  
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.api_dynamic_tags_frequently_used(p_limit integer DEFAULT 50)
RETURNS TABLE(
  id uuid,
  token text,
  label text,
  description text,
  json_path text,
  sample_value text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY
  SELECT dt.id, dt.token, dt.label, dt.description, dt.json_path, dt.sample_value
  FROM public.dynamic_tags dt
  WHERE dt.tenant_id = get_user_tenant_id()
    AND dt.is_frequently_used = true
  ORDER BY dt.label
  LIMIT p_limit;
END;
$$;