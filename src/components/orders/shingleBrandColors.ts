// Brand-aware color presets for asphalt shingles. Used by Push-to-Supplier
// dialog so that the color sent to the supplier order payload always matches
// a real manufacturer SKU color instead of a free-text note.

export interface BrandColorGroup {
  brand: string;
  // matchers run against the line-item name (case-insensitive substrings).
  match: string[];
  colors: string[];
}

export const BRAND_COLOR_GROUPS: BrandColorGroup[] = [
  {
    brand: 'GAF',
    match: ['gaf', 'timberline', 'hdz', 'grand sequoia', 'camelot'],
    colors: [
      'Charcoal',
      'Pewter Gray',
      'Weathered Wood',
      'Barkwood',
      'Slate',
      'Hickory',
      'Shakewood',
      'Mission Brown',
      'Williamsburg Slate',
      'Hunter Green',
      'Patriot Red',
      'Birchwood',
      'Fox Hollow Gray',
      'Golden Harvest',
      'Appalachian Sky',
    ],
  },
  {
    brand: 'Owens Corning',
    match: ['owens corning', 'oc ', 'duration', 'oakridge', 'trudefinition', 'berkshire'],
    colors: [
      'Onyx Black',
      'Estate Gray',
      'Driftwood',
      'Brownwood',
      'Teak',
      'Desert Tan',
      'Sand Castle',
      'Aged Copper',
      'Quarry Gray',
      'Sierra Gray',
      'Williamsburg Gray',
      'Terra Cotta',
      'Summer Harvest',
      'Amber',
      'Forest Brown',
    ],
  },
  {
    brand: 'CertainTeed',
    match: ['certainteed', 'ct ', 'landmark', 'presidential', 'belmont'],
    colors: [
      'Moire Black',
      'Max Def Moire Black',
      'Weathered Wood',
      'Driftwood',
      'Max Def Charcoal Black',
      'Cobblestone Gray',
      'Heather Blend',
      'Burnt Sienna',
      'Resawn Shake',
      'Georgetown Gray',
      'Colonial Slate',
      'Hunter Green',
      'Silver Birch',
      'Pewter',
    ],
  },
  {
    brand: 'TAMKO',
    match: ['tamko', 'heritage'],
    colors: [
      'Black Walnut',
      'Weathered Wood',
      'Rustic Black',
      'Rustic Slate',
      'Thunderstorm Grey',
      'Oxford Grey',
      'Natural Timber',
      'Painted Desert',
      'Glacier White',
    ],
  },
  {
    brand: 'Atlas',
    match: ['atlas', 'pinnacle', 'pristine', 'storm master'],
    colors: [
      'Pristine Black',
      'Pristine White',
      'Weathered Shadow',
      'Pewter',
      'Heather Blend',
      'Majestic Oak',
      'Summer Storm',
      'Hearthstone Gray',
    ],
  },
  {
    brand: 'Malarkey',
    match: ['malarkey', 'legacy', 'vista', 'highlander'],
    colors: [
      'Antique Brown',
      'Midnight Black',
      'Natural Wood',
      'Storm Grey',
      'Weathered Wood',
      'Driftwood',
      'Sienna Blend',
      'Silverwood',
    ],
  },
  {
    brand: 'IKO',
    match: ['iko', 'cambridge', 'dynasty', 'nordic'],
    colors: [
      'Dual Black',
      'Dual Brown',
      'Dual Grey',
      'Driftwood',
      'Earthtone Cedar',
      'Frostone Grey',
      'Harvard Slate',
      'Weatherwood',
    ],
  },
];

const FALLBACK_COLORS = [
  'Black',
  'Charcoal',
  'Dark Gray',
  'Gray',
  'Light Gray',
  'Brown',
  'Tan',
  'Weathered Wood',
  'Driftwood',
  'Slate',
  'Green',
  'Red',
  'White',
];

export function detectBrand(itemName?: string | null): BrandColorGroup | null {
  if (!itemName) return null;
  const lower = itemName.toLowerCase();
  for (const g of BRAND_COLOR_GROUPS) {
    if (g.match.some((m) => lower.includes(m))) return g;
  }
  return null;
}

export function colorsForItem(itemName?: string | null): { brand: string | null; colors: string[] } {
  const g = detectBrand(itemName);
  return { brand: g?.brand ?? null, colors: g?.colors ?? FALLBACK_COLORS };
}
