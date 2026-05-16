// ============================================================
// Scope Normalizer
// Deterministic normalization + canonical keys for scope lines
// ============================================================

export type ActionPrefix = 'remove' | 'replace' | 'rr' | 'clean' | 'paint' | 'unknown';

export function normalizeMoney(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const cleaned = String(value).replace(/[$,\s]/g, '').replace(/^\(([\d.]+)\)$/, '-$1');
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

export function normalizeQuantity(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const cleaned = String(value).replace(/[, \s]/g, '');
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

const UNIT_MAP: Record<string, string> = {
  sq: 'SQ', square: 'SQ', squares: 'SQ',
  sf: 'SF', sqft: 'SF', 'sq.ft': 'SF', 'sq ft': 'SF',
  lf: 'LF', 'lin.ft': 'LF', 'linear ft': 'LF', 'lineal ft': 'LF',
  ea: 'EA', each: 'EA',
  hr: 'HR', hour: 'HR',
  bdl: 'BDL', bundle: 'BDL',
  rl: 'RL', roll: 'RL',
  cy: 'CY', day: 'DA', da: 'DA',
  ls: 'LS',
};

export function normalizeUnit(unit: string | null | undefined): string | null {
  if (!unit) return null;
  const k = String(unit).toLowerCase().trim().replace(/\.$/, '');
  return UNIT_MAP[k] || String(unit).toUpperCase().trim();
}

export function normalizeDescription(description: string): string {
  if (!description) return '';
  return description
    .toLowerCase()
    .replace(/w\/out/g, 'without')
    .replace(/w\//g, 'with ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const ACTION_PATTERNS: Array<{ re: RegExp; action: ActionPrefix }> = [
  { re: /^\s*r\s*&\s*r\b/i, action: 'rr' },
  { re: /^\s*r\s+and\s+r\b/i, action: 'rr' },
  { re: /^\s*r\s*\/\s*r\b/i, action: 'rr' },
  { re: /^\s*remove\b/i, action: 'remove' },
  { re: /^\s*detach\s*(&|and)\s*reset\b/i, action: 'rr' },
  { re: /^\s*replace\b/i, action: 'replace' },
  { re: /^\s*clean\b/i, action: 'clean' },
  { re: /^\s*paint\b/i, action: 'paint' },
  { re: /^\s*seal\s*(&|and)\s*paint\b/i, action: 'paint' },
];

export function stripActionPrefix(description: string): { action: ActionPrefix; cleaned: string } {
  if (!description) return { action: 'unknown', cleaned: '' };
  for (const { re, action } of ACTION_PATTERNS) {
    const m = description.match(re);
    if (m) {
      return { action, cleaned: description.slice(m[0].length).trim() };
    }
  }
  return { action: 'unknown', cleaned: description.trim() };
}

// Canonical mapping table — high-signal roofing/exterior items
const CANONICAL_MAP: Array<{ keys: RegExp[]; canonical: string; group: string }> = [
  { keys: [/laminated.*comp.*shingle.*rfg.*without\s*felt/i, /laminated.*comp.*shingle.*rfg.*w\/?out\s*felt/i, /laminated.*comp.*shingle/i], canonical: 'laminated_comp_shingle_without_felt', group: 'roofing' },
  { keys: [/tear\s*off.*haul.*dispose.*comp.*shingles?.*laminated/i, /tear\s*off.*comp.*shingles?.*laminated/i, /tear\s*off.*comp\.?\s*shingles?/i], canonical: 'tearoff_comp_shingles_laminated', group: 'demolition' },
  { keys: [/roofing\s*felt\s*30/i, /felt\s*30\s*lb/i], canonical: 'roofing_felt_30lb', group: 'moisture_protection' },
  { keys: [/roofing\s*felt\s*15/i, /felt\s*15\s*lb/i], canonical: 'roofing_felt_15lb', group: 'moisture_protection' },
  { keys: [/synthetic\s*underlayment/i], canonical: 'synthetic_underlayment', group: 'moisture_protection' },
  { keys: [/ice\s*(&|and)\s*water/i, /ice\s*water\s*shield/i], canonical: 'ice_and_water_shield', group: 'moisture_protection' },
  { keys: [/drip\s*edge/i], canonical: 'drip_edge', group: 'flashing' },
  { keys: [/asphalt\s*starter/i, /starter\s*course/i, /starter\s*strip/i], canonical: 'asphalt_starter', group: 'roofing' },
  { keys: [/hip\s*\/?\s*ridge\s*cap.*composition\s*shingles?/i, /ridge\s*cap.*composition/i, /hip\s*\/?\s*ridge\s*cap/i], canonical: 'hip_ridge_cap_composition', group: 'roofing' },
  { keys: [/flashing.*pipe\s*jack.*lead/i, /pipe\s*jack.*lead/i], canonical: 'pipe_jack_lead', group: 'flashing' },
  { keys: [/flashing.*pipe\s*jack/i, /pipe\s*jack/i], canonical: 'pipe_jack', group: 'flashing' },
  { keys: [/valley\s*metal/i, /valley\s*flashing/i], canonical: 'valley_metal', group: 'flashing' },
  { keys: [/dumpster.*20\s*yard/i, /dumpster\s*load.*20/i, /dumpster/i], canonical: 'dumpster_20yd', group: 'demolition' },
  { keys: [/water\s*barrier.*joint\s*taping/i, /mod.*bitumen.*seam\s*tape/i, /seam\s*tape/i], canonical: 'water_barrier_joint_taping', group: 'moisture_protection' },
  { keys: [/re[-\s]?nail.*sheathing/i, /re[-\s]?nail.*roof\s*sheathing/i], canonical: 're_nail_roof_sheathing', group: 'roofing' },
  { keys: [/caulk(ing)?.*butyl\s*rubber/i, /butyl\s*rubber.*caulk/i], canonical: 'caulking_butyl_rubber', group: 'flashing' },
  { keys: [/gutter\s*\/?\s*downspout.*aluminum.*6/i, /downspout.*aluminum.*6/i, /gutter.*aluminum.*6/i, /gutter\s*\/?\s*downspout/i], canonical: 'gutter_downspout_aluminum_6', group: 'gutter' },
  { keys: [/tarp.*all[-\s]?purpose.*poly/i, /tarp.*poly/i, /tarp\b/i], canonical: 'tarp_all_purpose_poly', group: 'temporary_repair' },
  { keys: [/clean.*pressure.*chemical\s*spray/i, /pressure\s*\/?\s*chemical\s*spray/i, /pressure\s*wash/i], canonical: 'clean_pressure_chemical_spray', group: 'cleaning' },
  { keys: [/seal\s*(&|and)\s*paint\s*stucco/i, /paint\s*stucco/i], canonical: 'paint_stucco', group: 'exterior_painting' },
  { keys: [/stucco\s*patch.*small\s*repair/i, /stucco\s*patch/i], canonical: 'stucco_patch_small_repair', group: 'stucco' },
  { keys: [/final\s*cleaning.*construction.*residential/i, /final\s*cleaning/i], canonical: 'final_cleaning_residential', group: 'cleaning' },
  { keys: [/flat\s*roof\s*exhaust\s*vent.*gooseneck/i, /gooseneck/i, /exhaust\s*vent.*cap/i], canonical: 'gooseneck_vent', group: 'ventilation' },
  { keys: [/turbine\s*vent/i], canonical: 'turbine_vent', group: 'ventilation' },
  { keys: [/ridge\s*vent/i], canonical: 'ridge_vent', group: 'ventilation' },
  { keys: [/skylight/i], canonical: 'skylight', group: 'roofing' },
  { keys: [/chimney\s*flashing/i, /flashing.*chimney/i], canonical: 'chimney_flashing', group: 'flashing' },
  { keys: [/step\s*flashing/i], canonical: 'step_flashing', group: 'flashing' },
];

export function canonicalScopeKey(description: string, unit?: string | null): string {
  if (!description) return 'unknown';
  const { cleaned } = stripActionPrefix(description);
  for (const entry of CANONICAL_MAP) {
    for (const re of entry.keys) {
      if (re.test(cleaned) || re.test(description)) {
        return entry.canonical;
      }
    }
  }
  // Fallback: normalized description + unit
  const norm = normalizeDescription(cleaned);
  const u = normalizeUnit(unit) || '';
  // Keep first 6 tokens to avoid noise
  const tokens = norm.split(' ').filter(Boolean).slice(0, 6).join('_');
  return `desc:${tokens}${u ? '|' + u : ''}`;
}

export function classifyScopeGroup(description: string): string {
  if (!description) return 'other';
  const { cleaned } = stripActionPrefix(description);
  for (const entry of CANONICAL_MAP) {
    for (const re of entry.keys) {
      if (re.test(cleaned) || re.test(description)) return entry.group;
    }
  }
  const d = description.toLowerCase();
  if (/tear\s*off|dumpster|haul|dispose|debris/.test(d)) return 'demolition';
  if (/gutter|downspout/.test(d)) return 'gutter';
  if (/tarp/.test(d)) return 'temporary_repair';
  if (/clean|final\s*cleaning/.test(d)) return 'cleaning';
  if (/paint|stain|seal/.test(d)) return 'exterior_painting';
  if (/stucco/.test(d)) return 'stucco';
  if (/flashing|drip\s*edge|valley/.test(d)) return 'flashing';
  if (/vent|gooseneck|turbine/.test(d)) return 'ventilation';
  if (/felt|underlayment|ice.*water|barrier/.test(d)) return 'moisture_protection';
  if (/shingle|ridge|hip|roof/.test(d)) return 'roofing';
  return 'other';
}

export function classifyTrade(description: string): string {
  const g = classifyScopeGroup(description);
  if (['roofing', 'flashing', 'ventilation', 'moisture_protection', 'demolition', 'temporary_repair'].includes(g)) return 'roof';
  if (g === 'gutter') return 'gutter';
  if (g === 'stucco' || g === 'exterior_painting') return 'exterior';
  if (g === 'cleaning') return 'cleaning';
  return 'general';
}

export function calculateLineTotal(
  quantity: number | null | undefined,
  removePrice: number | null | undefined,
  replacePrice: number | null | undefined,
  unitPrice: number | null | undefined,
  _tax: number | null | undefined,
  total: number | null | undefined
): number {
  if (total != null && Number.isFinite(total)) return total;
  const q = quantity ?? 0;
  const rp = removePrice ?? 0;
  const rep = replacePrice ?? 0;
  const up = unitPrice ?? (rp + rep);
  return +(q * up).toFixed(2);
}

export function nearlyEqual(a: number | null | undefined, b: number | null | undefined, tolerance = 0.02): boolean {
  if (a == null || b == null) return false;
  const denom = Math.max(Math.abs(a), Math.abs(b), 1);
  return Math.abs(a - b) / denom <= tolerance;
}

export function tokenSimilarity(a: string, b: string): number {
  const ta = new Set(normalizeDescription(a).split(' ').filter(Boolean));
  const tb = new Set(normalizeDescription(b).split(' ').filter(Boolean));
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / Math.max(ta.size, tb.size);
}
