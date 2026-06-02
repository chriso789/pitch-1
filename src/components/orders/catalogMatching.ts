// Shared catalog-matching helpers used by Push-to-Supplier and the
// estimate's inline supplier match. Kept dependency-free so it can be
// imported from any UI surface that needs to score "free-form line item
// name" against a vendor catalog (SRS productId list, ABC item list, etc.).

const SKU_STOP_WORDS = new Set([
  'and', 'the', 'for', 'with', 'of', 'a', 'an', 'to', 'by', 'roof', 'roofing',
  'material', 'materials', 'item', 'product', 'standard', 'premium', 'generic',
]);

const SKU_SYNONYMS: Record<string, string[]> = {
  bdl: ['bd', 'bundle'],
  bd: ['bdl', 'bundle'],
  pc: ['piece', 'ea', 'each'],
  ea: ['pc', 'piece', 'each'],
  shingle: ['shingles', 'laminate', 'architectural'],
  shingles: ['shingle', 'laminate', 'architectural'],
  ridge: ['cap', 'hip', 'ridgecap'],
  hip: ['ridge', 'cap', 'ridgecap'],
  cap: ['ridge', 'hip', 'ridgecap'],
  starter: ['start', 'starterstrip'],
  strip: ['starterstrip'],
  underlayment: ['underlay', 'felt', 'synthetic'],
  underlay: ['underlayment', 'felt', 'synthetic'],
  ice: ['water', 'barrier', 'leak'],
  water: ['ice', 'barrier', 'leak'],
  leak: ['ice', 'water', 'barrier'],
  drip: ['edge', 'dedge'],
  edge: ['drip', 'dedge'],
  nail: ['nails', 'coil'],
  nails: ['nail', 'coil'],
  coil: ['nail', 'nails'],
  vent: ['ventilation', 'ridgevent'],
  ventilation: ['vent'],
  pipe: ['boot', 'flashing'],
  boot: ['pipe', 'flashing'],
  flashing: ['pipe', 'boot', 'step'],
};

export const normalizeSkuText = (value: string | null | undefined) =>
  (value || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();

const singularSkuToken = (token: string) => {
  if (token.endsWith('ies') && token.length > 4) return `${token.slice(0, -3)}y`;
  if (token.endsWith('es') && token.length > 4) return token.slice(0, -2);
  if (token.endsWith('s') && token.length > 4) return token.slice(0, -1);
  return token;
};

export const skuTokens = (value: string | null | undefined) =>
  normalizeSkuText(value)
    .split(/\s+/)
    .map(singularSkuToken)
    .filter((token) => token && !SKU_STOP_WORDS.has(token));

const tokenMatches = (needle: string, haystack: Set<string>) => {
  if (haystack.has(needle)) return true;
  const aliases = SKU_SYNONYMS[needle] || [];
  return aliases.some((alias) => haystack.has(singularSkuToken(alias)));
};

const IMPORTANT_TOKENS = new Set([
  'shingle', 'ridge', 'hip', 'cap', 'starter', 'underlayment',
  'ice', 'water', 'drip', 'edge', 'nail', 'coil', 'vent', 'boot', 'flashing',
]);

export interface LineLike {
  item_name: string;
  description?: string | null;
  color_specs?: string | null;
  unit?: string | null;
}

/**
 * Score a single product against a line item. Returns 0-1.
 * `getText` returns the searchable text for the product (id/name/description/color/uom concatenated).
 */
export function scoreProductMatch(
  item: LineLike,
  product: unknown,
  getText: (p: unknown) => string,
): number {
  const itemText = `${item.item_name} ${item.description || ''} ${item.color_specs || ''}`;
  const itemTokens = skuTokens(itemText).filter((token) => !/^\d+$/.test(token));
  const productTokens = skuTokens(getText(product));
  if (!itemTokens.length || !productTokens.length) return 0;

  const productSet = new Set(productTokens);
  let totalWeight = 0;
  let matchedWeight = 0;

  for (const token of itemTokens) {
    const important = IMPORTANT_TOKENS.has(token);
    const weight = important ? 1.35 : token.length <= 2 ? 0.35 : 1;
    totalWeight += weight;
    if (tokenMatches(token, productSet)) {
      matchedWeight += weight;
    } else if (token.length > 3 && productTokens.some((p) => p.startsWith(token) || token.startsWith(p))) {
      matchedWeight += weight * 0.65;
    }
  }

  let score = matchedWeight / Math.max(totalWeight, 1);
  const normalizedProduct = normalizeSkuText(getText(product));
  const normalizedItem = normalizeSkuText(itemText);
  if (normalizedItem.length > 8 && normalizedProduct.includes(normalizedItem)) score += 0.2;
  if (item.unit && normalizedProduct.split(' ').includes(normalizeSkuText(item.unit))) score += 0.06;
  return Math.min(score, 1);
}

export interface RankedMatch<P> {
  product: P;
  score: number;
  ambiguous: boolean;
}

export function bestCatalogMatch<P>(
  item: LineLike,
  catalog: P[],
  getText: (p: P) => string,
  getId: (p: P) => string | null | undefined,
): RankedMatch<P> | null {
  const ranked = catalog
    .map((product) => ({ product, score: scoreProductMatch(item, product, (p) => getText(p as P)) }))
    .filter((entry) => Boolean(getId(entry.product)))
    .sort((a, b) => b.score - a.score);
  const best = ranked[0];
  const runnerUp = ranked[1];
  if (!best) return null;
  const ambiguous = Boolean(runnerUp && best.score < 0.88 && best.score - runnerUp.score < 0.08);
  return { ...best, ambiguous };
}

// SRS product accessors -----------------------------------------------------

export const srsProductText = (p: any) =>
  `${p.productId ?? p.productNumber ?? ''} ${p.productName ?? p.description ?? ''} ${p.option ?? ''} ${p.uom ?? ''}`;

export const srsProductId = (p: any) =>
  p?.productId ?? p?.productNumber ?? null;

// ABC product accessors -----------------------------------------------------

export const abcProductText = (p: any) =>
  `${p.itemNumber ?? ''} ${p.itemDescription ?? p.description ?? ''} ${p.color ?? p.colorOption ?? ''} ${p.uom ?? ''}`;

export const abcProductId = (p: any) => p?.itemNumber ?? null;
