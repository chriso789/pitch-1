-- Add vendor truth source tracking
ALTER TABLE public.measurement_benchmark_cases 
ADD COLUMN IF NOT EXISTS vendor_truth_source text,
ADD COLUMN IF NOT EXISTS vendor_truth_data jsonb;

-- Insert benchmark cases with known Roofr/EagleView ground truth
INSERT INTO public.measurement_benchmark_cases 
  (address, lat, lng, building_shape, roof_style, expected_area_sqft, expected_ridge_ft, expected_hip_ft, expected_valley_ft, expected_eave_ft, expected_rake_ft, expected_pitch, difficulty_level, test_category, is_active, vendor_truth_source, vendor_truth_data)
VALUES
  -- Palm Harbor Drive — from Roofr report
  ('9 Palm Harbor Drive, Holmes Beach, FL 34217', 27.4943, -82.7137, 'L-shape', 'hip', 2722, 55, 75, 73, 124, 0, '5/12', 'medium', 'residential_hip', true, 'roofr', '{"facets": 8, "wall_flashing_ft": 0, "step_flashing_ft": 0, "rakes_ft": 0, "transitions_ft": 0}'),
  
  -- Simple gable test case
  ('123 Main St, Tampa, FL 33601', 27.9506, -82.4572, 'rectangle', 'gable', 1800, 40, 0, 0, 100, 60, '6/12', 'easy', 'residential_gable', true, 'manual', '{"facets": 2}'),
  
  -- Complex multi-hip
  ('456 Oak Ave, Sarasota, FL 34236', 27.3364, -82.5307, 'complex', 'cross-hip', 3200, 65, 120, 45, 180, 20, '4/12', 'hard', 'residential_complex', true, 'eagleview', '{"facets": 12}')
ON CONFLICT DO NOTHING;