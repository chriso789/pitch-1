-- ============================================
-- FIX: Expand roof_type check constraint and add missing column
-- ============================================

-- Step 1: Drop and recreate roof_type check constraint with additional AI-detected types
ALTER TABLE public.roof_measurements 
DROP CONSTRAINT IF EXISTS roof_measurements_roof_type_check;

ALTER TABLE public.roof_measurements 
ADD CONSTRAINT roof_measurements_roof_type_check 
CHECK (roof_type = ANY (ARRAY[
  'gable', 'hip', 'flat', 'gambrel', 'mansard', 'complex',
  'hip-with-dormers', 'cross-gable', 'dutch-gable', 'cross-hip',
  'shed', 'butterfly', 'sawtooth', 'dome', 'pyramid'
]));

-- Step 2: Add missing calculation_template_id column to pipeline_entries
ALTER TABLE public.pipeline_entries 
ADD COLUMN IF NOT EXISTS calculation_template_id UUID REFERENCES public.estimate_calculation_templates(id) ON DELETE SET NULL;