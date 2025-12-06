/**
 * Smart Tag Registry for Roof Measurements
 * Complete catalog of 100+ smart tags with descriptions and examples
 */

export interface SmartTagDefinition {
  key: string;
  category: string;
  description: string;
  example: string;
  unit?: string;
  type: 'number' | 'string' | 'boolean';
}

export const SMART_TAG_CATEGORIES = {
  ROOF_BASIC: 'Roof Basic Measurements',
  ROOF_FACETS: 'Individual Roof Facets',
  ROOF_PITCH: 'Pitch-Specific Measurements',
  ROOF_WASTE: 'Waste-Adjusted Calculations',
  LINEAR: 'Linear Features',
  LINEAR_COMBINED: 'Combined Linear Measurements',
  PENETRATIONS: 'Roof Penetrations',
  MATERIALS_BASE: 'Base Material Quantities',
  MATERIALS_WASTE: 'Waste-Adjusted Materials',
  PROPERTY: 'Property Metadata',
  CALCULATIONS: 'Derived Calculations',
  // NEW EXTERIOR CATEGORIES
  EXTERIOR_SIDING: 'Siding Measurements',
  EXTERIOR_GUTTERS: 'Gutter Measurements',
  EXTERIOR_SOFFIT: 'Soffit & Fascia',
  EXTERIOR_WINDOWS: 'Window Measurements',
  EXTERIOR_MATERIALS: 'Exterior Material Quantities',
} as const;

export const SMART_TAGS: SmartTagDefinition[] = [
  // ============= ROOF BASIC MEASUREMENTS =============
  { key: 'roof.plan_sqft', category: 'ROOF_BASIC', description: 'Total plan view area (not pitch-adjusted)', example: '1850', unit: 'sq ft', type: 'number' },
  { key: 'roof.total_sqft', category: 'ROOF_BASIC', description: 'Total pitch-adjusted roof area', example: '2125', unit: 'sq ft', type: 'number' },
  { key: 'roof.squares', category: 'ROOF_BASIC', description: 'Total roof squares (area / 100)', example: '21.25', unit: 'squares', type: 'number' },
  { key: 'roof.faces_count', category: 'ROOF_BASIC', description: 'Number of roof facets/planes', example: '8', unit: 'count', type: 'number' },
  { key: 'roof.waste_pct', category: 'ROOF_BASIC', description: 'Recommended waste percentage', example: '10', unit: '%', type: 'number' },
  { key: 'roof.pitch_factor', category: 'ROOF_BASIC', description: 'Average pitch adjustment factor', example: '1.118', type: 'number' },
  { key: 'roof.complexity', category: 'ROOF_BASIC', description: 'Roof complexity score (1-5)', example: '3', type: 'number' },
  { key: 'roof.perimeter_ft', category: 'ROOF_BASIC', description: 'Total roof perimeter', example: '245', unit: 'ft', type: 'number' },

  // ============= INDIVIDUAL ROOF FACETS (1-20) =============
  ...Array.from({ length: 20 }, (_, i) => {
    const num = i + 1;
    return [
      { key: `facet.${num}.area_sqft`, category: 'ROOF_FACETS', description: `Facet ${num} pitch-adjusted area`, example: '265', unit: 'sq ft', type: 'number' as const },
      { key: `facet.${num}.plan_area_sqft`, category: 'ROOF_FACETS', description: `Facet ${num} plan view area`, example: '238', unit: 'sq ft', type: 'number' as const },
      { key: `facet.${num}.pitch`, category: 'ROOF_FACETS', description: `Facet ${num} pitch`, example: '6/12', type: 'string' as const },
      { key: `facet.${num}.pitch_degrees`, category: 'ROOF_FACETS', description: `Facet ${num} pitch in degrees`, example: '26.57', unit: '°', type: 'number' as const },
      { key: `facet.${num}.direction`, category: 'ROOF_FACETS', description: `Facet ${num} compass direction`, example: 'NW', type: 'string' as const },
      { key: `facet.${num}.squares`, category: 'ROOF_FACETS', description: `Facet ${num} squares`, example: '2.65', unit: 'squares', type: 'number' as const },
    ];
  }).flat(),

  // ============= PITCH-SPECIFIC MEASUREMENTS =============
  { key: 'pitch.2_12.sqft', category: 'ROOF_PITCH', description: 'Total area at 2/12 pitch', example: '120', unit: 'sq ft', type: 'number' },
  { key: 'pitch.3_12.sqft', category: 'ROOF_PITCH', description: 'Total area at 3/12 pitch', example: '0', unit: 'sq ft', type: 'number' },
  { key: 'pitch.4_12.sqft', category: 'ROOF_PITCH', description: 'Total area at 4/12 pitch', example: '450', unit: 'sq ft', type: 'number' },
  { key: 'pitch.5_12.sqft', category: 'ROOF_PITCH', description: 'Total area at 5/12 pitch', example: '675', unit: 'sq ft', type: 'number' },
  { key: 'pitch.6_12.sqft', category: 'ROOF_PITCH', description: 'Total area at 6/12 pitch', example: '850', unit: 'sq ft', type: 'number' },
  { key: 'pitch.7_12.sqft', category: 'ROOF_PITCH', description: 'Total area at 7/12 pitch', example: '0', unit: 'sq ft', type: 'number' },
  { key: 'pitch.8_12.sqft', category: 'ROOF_PITCH', description: 'Total area at 8/12 pitch', example: '230', unit: 'sq ft', type: 'number' },
  { key: 'pitch.9_12.sqft', category: 'ROOF_PITCH', description: 'Total area at 9/12 pitch', example: '0', unit: 'sq ft', type: 'number' },
  { key: 'pitch.10_12.sqft', category: 'ROOF_PITCH', description: 'Total area at 10/12 pitch', example: '0', unit: 'sq ft', type: 'number' },
  { key: 'pitch.12_12.sqft', category: 'ROOF_PITCH', description: 'Total area at 12/12 pitch', example: '0', unit: 'sq ft', type: 'number' },
  { key: 'pitch.flat.sqft', category: 'ROOF_PITCH', description: 'Total flat roof area', example: '0', unit: 'sq ft', type: 'number' },

  // ============= WASTE-ADJUSTED CALCULATIONS (0%, 8%, 10%, 12%, 15%, 17%, 20%) =============
  { key: 'waste.0pct.sqft', category: 'ROOF_WASTE', description: 'Area with 0% waste', example: '2125', unit: 'sq ft', type: 'number' },
  { key: 'waste.0pct.squares', category: 'ROOF_WASTE', description: 'Squares with 0% waste', example: '21.25', unit: 'squares', type: 'number' },
  { key: 'waste.8pct.sqft', category: 'ROOF_WASTE', description: 'Area with 8% waste', example: '2295', unit: 'sq ft', type: 'number' },
  { key: 'waste.8pct.squares', category: 'ROOF_WASTE', description: 'Squares with 8% waste', example: '22.95', unit: 'squares', type: 'number' },
  { key: 'waste.10pct.sqft', category: 'ROOF_WASTE', description: 'Area with 10% waste', example: '2338', unit: 'sq ft', type: 'number' },
  { key: 'waste.10pct.squares', category: 'ROOF_WASTE', description: 'Squares with 10% waste', example: '23.38', unit: 'squares', type: 'number' },
  { key: 'waste.12pct.sqft', category: 'ROOF_WASTE', description: 'Area with 12% waste', example: '2380', unit: 'sq ft', type: 'number' },
  { key: 'waste.12pct.squares', category: 'ROOF_WASTE', description: 'Squares with 12% waste', example: '23.80', unit: 'squares', type: 'number' },
  { key: 'waste.15pct.sqft', category: 'ROOF_WASTE', description: 'Area with 15% waste', example: '2444', unit: 'sq ft', type: 'number' },
  { key: 'waste.15pct.squares', category: 'ROOF_WASTE', description: 'Squares with 15% waste', example: '24.44', unit: 'squares', type: 'number' },
  { key: 'waste.17pct.sqft', category: 'ROOF_WASTE', description: 'Area with 17% waste', example: '2486', unit: 'sq ft', type: 'number' },
  { key: 'waste.17pct.squares', category: 'ROOF_WASTE', description: 'Squares with 17% waste', example: '24.86', unit: 'squares', type: 'number' },
  { key: 'waste.20pct.sqft', category: 'ROOF_WASTE', description: 'Area with 20% waste', example: '2550', unit: 'sq ft', type: 'number' },
  { key: 'waste.20pct.squares', category: 'ROOF_WASTE', description: 'Squares with 20% waste', example: '25.50', unit: 'squares', type: 'number' },

  // ============= LINEAR FEATURES =============
  { key: 'lf.ridge', category: 'LINEAR', description: 'Ridge line length', example: '48', unit: 'ft', type: 'number' },
  { key: 'lf.hip', category: 'LINEAR', description: 'Hip line length', example: '72', unit: 'ft', type: 'number' },
  { key: 'lf.valley', category: 'LINEAR', description: 'Valley line length', example: '35', unit: 'ft', type: 'number' },
  { key: 'lf.eave', category: 'LINEAR', description: 'Eave edge length', example: '125', unit: 'ft', type: 'number' },
  { key: 'lf.rake', category: 'LINEAR', description: 'Rake edge length', example: '85', unit: 'ft', type: 'number' },
  { key: 'lf.step', category: 'LINEAR', description: 'Step flashing length', example: '28', unit: 'ft', type: 'number' },
  { key: 'lf.perimeter', category: 'LINEAR', description: 'Total perimeter', example: '245', unit: 'ft', type: 'number' },

  // ============= COMBINED LINEAR MEASUREMENTS =============
  { key: 'lf.ridge_hip_total', category: 'LINEAR_COMBINED', description: 'Total ridge + hip length', example: '120', unit: 'ft', type: 'number' },
  { key: 'lf.eave_rake_total', category: 'LINEAR_COMBINED', description: 'Total eave + rake length', example: '210', unit: 'ft', type: 'number' },
  { key: 'lf.valley_step_total', category: 'LINEAR_COMBINED', description: 'Total valley + step length', example: '63', unit: 'ft', type: 'number' },

  // ============= PENETRATIONS =============
  { key: 'pen.total', category: 'PENETRATIONS', description: 'Total penetration count', example: '12', unit: 'count', type: 'number' },
  { key: 'pen.pipe_vent', category: 'PENETRATIONS', description: 'Pipe vent count', example: '6', unit: 'count', type: 'number' },
  { key: 'pen.skylight', category: 'PENETRATIONS', description: 'Skylight count', example: '2', unit: 'count', type: 'number' },
  { key: 'pen.chimney', category: 'PENETRATIONS', description: 'Chimney count', example: '1', unit: 'count', type: 'number' },
  { key: 'pen.hvac', category: 'PENETRATIONS', description: 'HVAC penetration count', example: '2', unit: 'count', type: 'number' },
  { key: 'pen.other', category: 'PENETRATIONS', description: 'Other penetrations', example: '1', unit: 'count', type: 'number' },

  // ============= BASE MATERIAL QUANTITIES =============
  { key: 'bundles.shingles', category: 'MATERIALS_BASE', description: 'Shingle bundles (3 per square)', example: '64', unit: 'bundles', type: 'number' },
  { key: 'bundles.ridge_cap', category: 'MATERIALS_BASE', description: 'Ridge cap bundles (33 LF per bundle)', example: '4', unit: 'bundles', type: 'number' },
  { key: 'rolls.valley', category: 'MATERIALS_BASE', description: 'Valley rolls (50 LF per roll)', example: '1', unit: 'rolls', type: 'number' },
  { key: 'rolls.ice_water', category: 'MATERIALS_BASE', description: 'Ice & water shield rolls', example: '3', unit: 'rolls', type: 'number' },
  { key: 'rolls.underlayment', category: 'MATERIALS_BASE', description: 'Underlayment rolls (squares)', example: '22', unit: 'rolls', type: 'number' },
  { key: 'sticks.drip_edge', category: 'MATERIALS_BASE', description: 'Drip edge sticks (10 LF per stick)', example: '21', unit: 'sticks', type: 'number' },
  { key: 'boots.pipe', category: 'MATERIALS_BASE', description: 'Pipe boot count', example: '6', unit: 'count', type: 'number' },
  { key: 'kits.skylight', category: 'MATERIALS_BASE', description: 'Skylight flashing kits', example: '2', unit: 'kits', type: 'number' },
  { key: 'kits.chimney', category: 'MATERIALS_BASE', description: 'Chimney flashing kits', example: '1', unit: 'kits', type: 'number' },

  // ============= WASTE-ADJUSTED MATERIALS =============
  { key: 'bundles.shingles.waste_8pct', category: 'MATERIALS_WASTE', description: 'Shingle bundles with 8% waste', example: '69', unit: 'bundles', type: 'number' },
  { key: 'bundles.shingles.waste_10pct', category: 'MATERIALS_WASTE', description: 'Shingle bundles with 10% waste', example: '71', unit: 'bundles', type: 'number' },
  { key: 'bundles.shingles.waste_12pct', category: 'MATERIALS_WASTE', description: 'Shingle bundles with 12% waste', example: '72', unit: 'bundles', type: 'number' },
  { key: 'bundles.shingles.waste_15pct', category: 'MATERIALS_WASTE', description: 'Shingle bundles with 15% waste', example: '74', unit: 'bundles', type: 'number' },
  { key: 'bundles.shingles.waste_20pct', category: 'MATERIALS_WASTE', description: 'Shingle bundles with 20% waste', example: '77', unit: 'bundles', type: 'number' },
  { key: 'rolls.underlayment.waste_10pct', category: 'MATERIALS_WASTE', description: 'Underlayment with 10% waste', example: '25', unit: 'rolls', type: 'number' },
  { key: 'rolls.underlayment.waste_15pct', category: 'MATERIALS_WASTE', description: 'Underlayment with 15% waste', example: '26', unit: 'rolls', type: 'number' },
  { key: 'sticks.drip_edge.waste_10pct', category: 'MATERIALS_WASTE', description: 'Drip edge with 10% waste', example: '24', unit: 'sticks', type: 'number' },
  { key: 'sticks.drip_edge.waste_15pct', category: 'MATERIALS_WASTE', description: 'Drip edge with 15% waste', example: '25', unit: 'sticks', type: 'number' },

  // ============= PROPERTY METADATA =============
  { key: 'age.years', category: 'PROPERTY', description: 'Current roof age in years', example: '12', unit: 'years', type: 'number' },
  { key: 'age.source', category: 'PROPERTY', description: 'Roof age data source', example: 'county_records', type: 'string' },
  { key: 'property.address', category: 'PROPERTY', description: 'Property address', example: '123 Main St', type: 'string' },
  { key: 'property.city', category: 'PROPERTY', description: 'Property city', example: 'Dallas', type: 'string' },
  { key: 'property.state', category: 'PROPERTY', description: 'Property state', example: 'TX', type: 'string' },
  { key: 'property.zip', category: 'PROPERTY', description: 'Property ZIP code', example: '75201', type: 'string' },
  { key: 'measure.date', category: 'PROPERTY', description: 'Measurement date', example: '2024-01-15', type: 'string' },
  { key: 'measure.source', category: 'PROPERTY', description: 'Measurement data source', example: 'google_solar', type: 'string' },
  { key: 'measure.confidence', category: 'PROPERTY', description: 'Measurement confidence score', example: '0.92', type: 'number' },

  // ============= DERIVED CALCULATIONS =============
  { key: 'calc.labor_hours', category: 'CALCULATIONS', description: 'Estimated labor hours', example: '32', unit: 'hours', type: 'number' },
  { key: 'calc.crew_days', category: 'CALCULATIONS', description: 'Estimated crew days (4-person)', example: '2', unit: 'days', type: 'number' },
  { key: 'calc.dump_runs', category: 'CALCULATIONS', description: 'Estimated dump runs needed', example: '2', unit: 'runs', type: 'number' },
  { key: 'calc.dumpster_size', category: 'CALCULATIONS', description: 'Recommended dumpster size', example: '20', unit: 'yards', type: 'number' },

  // ============= EXTERIOR: SIDING MEASUREMENTS =============
  { key: 'siding.total_sqft', category: 'EXTERIOR_SIDING', description: 'Total siding area', example: '1850', unit: 'sq ft', type: 'number' },
  { key: 'siding.squares', category: 'EXTERIOR_SIDING', description: 'Siding squares (area / 100)', example: '18.5', unit: 'squares', type: 'number' },
  { key: 'siding.waste_10pct_sqft', category: 'EXTERIOR_SIDING', description: 'Siding area with 10% waste', example: '2035', unit: 'sq ft', type: 'number' },
  { key: 'siding.corners_inside', category: 'EXTERIOR_SIDING', description: 'Inside corner count', example: '4', unit: 'count', type: 'number' },
  { key: 'siding.corners_outside', category: 'EXTERIOR_SIDING', description: 'Outside corner count', example: '8', unit: 'count', type: 'number' },
  { key: 'siding.j_channel_lf', category: 'EXTERIOR_SIDING', description: 'J-channel linear feet', example: '180', unit: 'ft', type: 'number' },
  { key: 'siding.starter_strip_lf', category: 'EXTERIOR_SIDING', description: 'Starter strip linear feet', example: '145', unit: 'ft', type: 'number' },
  { key: 'siding.wall_count', category: 'EXTERIOR_SIDING', description: 'Number of wall sections', example: '12', unit: 'count', type: 'number' },

  // ============= EXTERIOR: GUTTER MEASUREMENTS =============
  { key: 'gutter.total_lf', category: 'EXTERIOR_GUTTERS', description: 'Total gutter linear feet', example: '165', unit: 'ft', type: 'number' },
  { key: 'gutter.downspout_lf', category: 'EXTERIOR_GUTTERS', description: 'Downspout linear feet', example: '80', unit: 'ft', type: 'number' },
  { key: 'gutter.downspout_count', category: 'EXTERIOR_GUTTERS', description: 'Number of downspouts', example: '8', unit: 'count', type: 'number' },
  { key: 'gutter.inside_corners', category: 'EXTERIOR_GUTTERS', description: 'Inside corner miters', example: '4', unit: 'count', type: 'number' },
  { key: 'gutter.outside_corners', category: 'EXTERIOR_GUTTERS', description: 'Outside corner miters', example: '6', unit: 'count', type: 'number' },
  { key: 'gutter.end_caps', category: 'EXTERIOR_GUTTERS', description: 'End cap count', example: '8', unit: 'count', type: 'number' },
  { key: 'gutter.outlets', category: 'EXTERIOR_GUTTERS', description: 'Outlet/drop count', example: '8', unit: 'count', type: 'number' },
  { key: 'gutter.elbows', category: 'EXTERIOR_GUTTERS', description: 'Elbow count', example: '24', unit: 'count', type: 'number' },
  { key: 'gutter.leaf_guard_lf', category: 'EXTERIOR_GUTTERS', description: 'Leaf guard linear feet', example: '165', unit: 'ft', type: 'number' },

  // ============= EXTERIOR: SOFFIT & FASCIA =============
  { key: 'soffit.total_sqft', category: 'EXTERIOR_SOFFIT', description: 'Total soffit area', example: '320', unit: 'sq ft', type: 'number' },
  { key: 'soffit.lf', category: 'EXTERIOR_SOFFIT', description: 'Soffit linear feet', example: '210', unit: 'ft', type: 'number' },
  { key: 'fascia.lf', category: 'EXTERIOR_SOFFIT', description: 'Fascia linear feet', example: '210', unit: 'ft', type: 'number' },
  { key: 'fascia.4in_lf', category: 'EXTERIOR_SOFFIT', description: '4-inch fascia linear feet', example: '85', unit: 'ft', type: 'number' },
  { key: 'fascia.6in_lf', category: 'EXTERIOR_SOFFIT', description: '6-inch fascia linear feet', example: '125', unit: 'ft', type: 'number' },
  { key: 'fascia.8in_lf', category: 'EXTERIOR_SOFFIT', description: '8-inch fascia linear feet', example: '0', unit: 'ft', type: 'number' },

  // ============= EXTERIOR: WINDOW MEASUREMENTS =============
  { key: 'window.count', category: 'EXTERIOR_WINDOWS', description: 'Total window count', example: '14', unit: 'count', type: 'number' },
  { key: 'window.standard_count', category: 'EXTERIOR_WINDOWS', description: 'Standard window count', example: '10', unit: 'count', type: 'number' },
  { key: 'window.large_count', category: 'EXTERIOR_WINDOWS', description: 'Large window count', example: '3', unit: 'count', type: 'number' },
  { key: 'window.picture_count', category: 'EXTERIOR_WINDOWS', description: 'Picture window count', example: '1', unit: 'count', type: 'number' },
  { key: 'window.total_sqft', category: 'EXTERIOR_WINDOWS', description: 'Total window square feet', example: '185', unit: 'sq ft', type: 'number' },
  { key: 'window.trim_lf', category: 'EXTERIOR_WINDOWS', description: 'Window trim linear feet', example: '320', unit: 'ft', type: 'number' },
  { key: 'door.entry_count', category: 'EXTERIOR_WINDOWS', description: 'Entry door count', example: '2', unit: 'count', type: 'number' },
  { key: 'door.slider_count', category: 'EXTERIOR_WINDOWS', description: 'Sliding door count', example: '1', unit: 'count', type: 'number' },

  // ============= EXTERIOR: MATERIAL QUANTITIES =============
  { key: 'ext.siding_panels', category: 'EXTERIOR_MATERIALS', description: 'Siding panels needed', example: '185', unit: 'panels', type: 'number' },
  { key: 'ext.corner_posts', category: 'EXTERIOR_MATERIALS', description: 'Corner posts needed', example: '12', unit: 'posts', type: 'number' },
  { key: 'ext.j_channel_sticks', category: 'EXTERIOR_MATERIALS', description: 'J-channel sticks (12.5 LF ea)', example: '15', unit: 'sticks', type: 'number' },
  { key: 'ext.gutter_sections', category: 'EXTERIOR_MATERIALS', description: 'Gutter sections (10 LF ea)', example: '17', unit: 'sections', type: 'number' },
  { key: 'ext.downspout_sections', category: 'EXTERIOR_MATERIALS', description: 'Downspout sections (10 LF ea)', example: '8', unit: 'sections', type: 'number' },
  { key: 'ext.soffit_panels', category: 'EXTERIOR_MATERIALS', description: 'Soffit panels needed', example: '28', unit: 'panels', type: 'number' },
  { key: 'ext.fascia_pieces', category: 'EXTERIOR_MATERIALS', description: 'Fascia pieces (12 LF ea)', example: '18', unit: 'pieces', type: 'number' },
];

/**
 * Get tag definition by key
 */
export function getTagDefinition(key: string): SmartTagDefinition | undefined {
  return SMART_TAGS.find(tag => tag.key === key);
}

/**
 * Get all tags in a category
 */
export function getTagsByCategory(category: keyof typeof SMART_TAG_CATEGORIES): SmartTagDefinition[] {
  return SMART_TAGS.filter(tag => tag.category === category);
}

/**
 * Search tags by keyword
 */
export function searchTags(keyword: string): SmartTagDefinition[] {
  const lower = keyword.toLowerCase();
  return SMART_TAGS.filter(tag => 
    tag.key.toLowerCase().includes(lower) ||
    tag.description.toLowerCase().includes(lower) ||
    tag.category.toLowerCase().includes(lower)
  );
}

/**
 * Validate that a tag key exists
 */
export function isValidTag(key: string): boolean {
  return SMART_TAGS.some(tag => tag.key === key);
}

/**
 * Get all tag keys
 */
export function getAllTagKeys(): string[] {
  return SMART_TAGS.map(tag => tag.key);
}
