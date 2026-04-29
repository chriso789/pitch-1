ALTER TABLE public.roof_measurements
  ADD COLUMN IF NOT EXISTS patent_model jsonb;

COMMENT ON COLUMN public.roof_measurements.patent_model IS
  'Patent-aligned two-layer roof model (US 9,329,749 / US 8,515,125 family). Built server-side by start-ai-measurement. Schema: { version: "patent-v1", image, layer1_perimeter[], layer2_structural[], planes[], totals, imagery_qc }. Source of truth for the report viewer and PDF.';