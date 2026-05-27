CREATE TABLE IF NOT EXISTS public.canvass_pin_mutations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  user_id uuid NOT NULL,
  client_mutation_id text NOT NULL,
  contact_id uuid,
  result_code text NOT NULL,
  result_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  client_created_at timestamptz,
  server_created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, client_mutation_id)
);

GRANT SELECT ON public.canvass_pin_mutations TO authenticated;
GRANT ALL ON public.canvass_pin_mutations TO service_role;

ALTER TABLE public.canvass_pin_mutations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant members read own pin mutations" ON public.canvass_pin_mutations;
CREATE POLICY "tenant members read own pin mutations"
  ON public.canvass_pin_mutations FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));

CREATE INDEX IF NOT EXISTS idx_canvass_pin_mutations_tenant_created
  ON public.canvass_pin_mutations (tenant_id, server_created_at DESC);

NOTIFY pgrst, 'reload schema';