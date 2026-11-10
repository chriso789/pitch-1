// The enhanced_estimates.trg_validate_profit_percent trigger only accepts
// actual_profit_percent in [-100, 85]. Draft estimates with a fixed selling
// price and few costs entered can exceed that, so the stored percent is capped
// (matching the estimate editor's own save path) instead of failing the save.
export const PROFIT_PERCENT_MIN = -100;
export const PROFIT_PERCENT_MAX = 85;

export function clampStoredProfitPercent(percent: number): number {
  if (!Number.isFinite(percent)) return 0;
  const clamped = Math.max(PROFIT_PERCENT_MIN, Math.min(PROFIT_PERCENT_MAX, percent));
  return Math.round(clamped * 100) / 100;
}
