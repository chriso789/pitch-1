ALTER TABLE public.roof_measurements
DROP CONSTRAINT IF EXISTS roof_measurements_diagram_render_intent_check;

ALTER TABLE public.roof_measurements
ADD CONSTRAINT roof_measurements_diagram_render_intent_check
CHECK (
  diagram_render_intent IS NULL OR diagram_render_intent IN (
    'full_topology',
    'perimeter_only',
    'rejected_only',
    'diagnostic_only',
    'registration_blocked',
    'perimeter_debug_only'
  )
);

NOTIFY pgrst, 'reload schema';