-- ============================================================================
-- Create 15 Estimate Templates for O'Brien Contracting
-- ============================================================================

INSERT INTO templates (tenant_id, name, template_description, template_type, labor, overhead, status, created_at, updated_at)
VALUES
  ('14de934e-7964-4afd-940a-620d2ace125d', '6" Gutters', 
   'Remove/dispose existing gutters, install new 6" aluminum seamless gutters',
   'Gutters',
   '{"rate_per_unit": 8, "unit": "LF", "complexity_factors": {"standard": 1.0, "two_story": 1.25}}',
   '{"percentage": 10}', 'active', now(), now()),

  ('14de934e-7964-4afd-940a-620d2ace125d', 'Eagle Capistrano S Tile',
   'Remove existing roof to deck, install Eagle Capistrano S concrete tile system',
   'Tile Roofing',
   '{"rate_per_unit": 450, "unit": "SQ", "complexity_factors": {"low_pitch": 1.0, "steep_pitch": 1.35, "two_story": 1.2}}',
   '{"percentage": 10}', 'active', now(), now()),

  ('14de934e-7964-4afd-940a-620d2ace125d', 'Flat Roof Polyglass SA - Nailable Base',
   'Remove existing flat roof to deck, install Polyglass self-adhered membrane system',
   'Flat Roof',
   '{"rate_per_unit": 185, "unit": "SQ", "complexity_factors": {"standard": 1.0, "complex": 1.25}}',
   '{"percentage": 10}', 'active', now(), now()),

  ('14de934e-7964-4afd-940a-620d2ace125d', 'Metal to 1" 24g Snap Lok - Painted',
   'Remove existing metal roof to deck, install 1" 24 gauge snap lok standing seam painted panels',
   'Metal Conversion',
   '{"rate_per_unit": 325, "unit": "SQ", "complexity_factors": {"low_pitch": 1.0, "steep_pitch": 1.3, "two_story": 1.2}}',
   '{"percentage": 10}', 'active', now(), now()),

  ('14de934e-7964-4afd-940a-620d2ace125d', 'Mule-Hide TPO (ABC)',
   'Remove existing roof, install Mule-Hide TPO single-ply membrane system',
   'Commercial TPO',
   '{"rate_per_unit": 165, "unit": "SQ", "complexity_factors": {"standard": 1.0, "complex": 1.2}}',
   '{"percentage": 10}', 'active', now(), now()),

  ('14de934e-7964-4afd-940a-620d2ace125d', 'Shingle to 1" 24g Snap Lok - Painted',
   'Remove shingle roof to deck, install 1" 24 gauge snap lok standing seam painted metal panels',
   'Shingle to Metal',
   '{"rate_per_unit": 325, "unit": "SQ", "complexity_factors": {"low_pitch": 1.0, "steep_pitch": 1.3, "two_story": 1.2}}',
   '{"percentage": 10}', 'active', now(), now()),

  ('14de934e-7964-4afd-940a-620d2ace125d', 'Shingle to 5v Galv MIL',
   'Remove shingle roof to deck, install 5v crimp galvanized metal panels',
   'Shingle to Metal',
   '{"rate_per_unit": 195, "unit": "SQ", "complexity_factors": {"low_pitch": 1.0, "steep_pitch": 1.25, "two_story": 1.15}}',
   '{"percentage": 10}', 'active', now(), now()),

  ('14de934e-7964-4afd-940a-620d2ace125d', 'Shingle to Certainteed Landmark',
   'Remove existing shingles to deck, install Certainteed Landmark architectural shingles',
   'Shingle Replacement',
   '{"rate_per_unit": 85, "unit": "SQ", "complexity_factors": {"low_pitch": 1.0, "steep_pitch": 1.35, "two_story": 1.2}}',
   '{"percentage": 10}', 'active', now(), now()),

  ('14de934e-7964-4afd-940a-620d2ace125d', 'Shingle to GAF Timberline HDZ',
   'Remove existing shingles to deck, install GAF Timberline HDZ architectural shingles',
   'Shingle Replacement',
   '{"rate_per_unit": 90, "unit": "SQ", "complexity_factors": {"low_pitch": 1.0, "steep_pitch": 1.35, "two_story": 1.2}}',
   '{"percentage": 10}', 'active', now(), now()),

  ('14de934e-7964-4afd-940a-620d2ace125d', 'Shingle to Owens Corning Duration',
   'Remove existing shingles to deck, install Owens Corning Duration architectural shingles with Ice & Water',
   'Shingle Replacement',
   '{"rate_per_unit": 88, "unit": "SQ", "complexity_factors": {"low_pitch": 1.0, "steep_pitch": 1.35, "two_story": 1.2}}',
   '{"percentage": 10}', 'active', now(), now()),

  ('14de934e-7964-4afd-940a-620d2ace125d', 'Tile to 1" Standing Seam Painted',
   'Remove tile roof to deck, install 1" standing seam painted metal panels',
   'Tile to Metal',
   '{"rate_per_unit": 350, "unit": "SQ", "complexity_factors": {"low_pitch": 1.0, "steep_pitch": 1.3, "two_story": 1.2}}',
   '{"percentage": 10}', 'active', now(), now()),

  ('14de934e-7964-4afd-940a-620d2ace125d', 'Tile to Eagle',
   'Remove existing tile roof to deck, install new Eagle concrete tile system',
   'Tile Replacement',
   '{"rate_per_unit": 425, "unit": "SQ", "complexity_factors": {"low_pitch": 1.0, "steep_pitch": 1.35, "two_story": 1.2}}',
   '{"percentage": 10}', 'active', now(), now()),

  ('14de934e-7964-4afd-940a-620d2ace125d', 'Tile to Novatik',
   'Remove tile roof to deck, install Novatik steel shingle system',
   'Tile to Metal',
   '{"rate_per_unit": 375, "unit": "SQ", "complexity_factors": {"low_pitch": 1.0, "steep_pitch": 1.25, "two_story": 1.15}}',
   '{"percentage": 10}', 'active', now(), now()),

  ('14de934e-7964-4afd-940a-620d2ace125d', 'Tile to Tile',
   'Remove existing tile roof, install new concrete or clay tile system',
   'Tile Replacement',
   '{"rate_per_unit": 400, "unit": "SQ", "complexity_factors": {"low_pitch": 1.0, "steep_pitch": 1.35, "two_story": 1.2}}',
   '{"percentage": 10}', 'active', now(), now()),

  ('14de934e-7964-4afd-940a-620d2ace125d', 'Tile to Unified Steel',
   'Remove shingle roof to deck, install Unified Steel stone-coated metal panels',
   'Tile to Metal',
   '{"rate_per_unit": 365, "unit": "SQ", "complexity_factors": {"low_pitch": 1.0, "steep_pitch": 1.25, "two_story": 1.15}}',
   '{"percentage": 10}', 'active', now(), now());