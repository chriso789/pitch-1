// Shared material type labels for estimate/calc templates.
// Covers both roofing roof_type values and siding material values
// stored on the same `roof_type` enum column.

export const ROOFING_TYPES = [
  { value: 'shingle', label: 'Shingle' },
  { value: 'metal', label: 'Metal' },
  { value: 'tile', label: 'Tile' },
  { value: 'flat', label: 'Flat / Low Slope' },
  { value: 'slate', label: 'Slate' },
  { value: 'cedar', label: 'Cedar Shake' },
  { value: 'stone_coated', label: 'Stone Coated' },
] as const;

export const SIDING_TYPES = [
  { value: 'vinyl_siding', label: 'Vinyl' },
  { value: 'insulated_vinyl_siding', label: 'Insulated Vinyl' },
  { value: 'fiber_cement_siding', label: 'Fiber Cement (Hardie)' },
  { value: 'aluminum_siding', label: 'Aluminum' },
  { value: 'wood_siding', label: 'Wood' },
  { value: 'engineered_wood_siding', label: 'Engineered Wood (LP SmartSide)' },
  { value: 'stucco', label: 'Stucco' },
  { value: 'stone_veneer', label: 'Stone Veneer' },
  { value: 'brick_veneer', label: 'Brick Veneer' },
] as const;

export const SIDING_VALUES = new Set(SIDING_TYPES.map((t) => t.value));
export const ROOFING_VALUES = new Set(ROOFING_TYPES.map((t) => t.value));

export const MATERIAL_TYPE_LABELS: Record<string, string> = {
  ...Object.fromEntries(ROOFING_TYPES.map((t) => [t.value, t.label])),
  ...Object.fromEntries(SIDING_TYPES.map((t) => [t.value, t.label])),
  other: 'Other',
};

export function getMaterialTypeLabel(value?: string | null): string {
  if (!value) return 'Unknown';
  return MATERIAL_TYPE_LABELS[value] ?? value.replace(/_/g, ' ');
}

export function isSidingType(value?: string | null): boolean {
  return !!value && SIDING_VALUES.has(value as any);
}

export function isSidingTemplate(template: { name?: string | null; roof_type?: string | null }): boolean {
  if (isSidingType(template.roof_type)) return true;
  const name = (template.name || '').toLowerCase();
  return /(siding|vinyl|hardie|fiber\s*cement|alside|stucco|lp\s*smartside|james\s*hardie)/.test(name);
}

// Ordering for grouped UIs (roofing first, then siding, then other)
export const MATERIAL_TYPE_GROUP_ORDER: string[] = [
  ...ROOFING_TYPES.map((t) => t.value),
  ...SIDING_TYPES.map((t) => t.value),
  'other',
];
