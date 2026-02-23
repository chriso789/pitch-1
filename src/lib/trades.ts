export const ALL_TRADES = [
  { value: 'roofing', label: 'Roofing', icon: '🏠', locked: true },
  { value: 'gutters', label: 'Gutters', icon: '🔧', locked: false },
  { value: 'siding', label: 'Siding', icon: '🧱', locked: false },
  { value: 'interior', label: 'Interior Trades', icon: '🏗️', locked: false },
  { value: 'exterior', label: 'Exterior Trades', icon: '🔨', locked: false },
] as const;

export type TradeValue = typeof ALL_TRADES[number]['value'];

/**
 * Returns true if the template_category matches a given trade value.
 * Treats 'standard' as equivalent to 'roofing' for backward compatibility.
 */
export function matchesTradeCategory(templateCategory: string | null | undefined, tradeValue: string): boolean {
  const cat = (templateCategory || 'standard').toLowerCase();
  // 'universal' matches all trades (used by Blank Template)
  if (cat === 'universal') return true;
  if (tradeValue === 'roofing') {
    return cat === 'roofing' || cat === 'standard' || cat === 'premium';
  }
  return cat === tradeValue;
}
