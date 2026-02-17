// supabase/functions/_shared/scoring/equity.ts
// Equity scoring heuristic for canvass intelligence layer

export interface EquityScoreInput {
  assessedValue?: number | null;
  lastSaleAmount?: number | null;
  lastSaleDate?: string | null; // ISO date
  homestead?: boolean | null;
}

export interface ScoreResult {
  score: number;
  reasons: string[];
}

export function equityScore(input: EquityScoreInput): ScoreResult {
  let score = 0;
  const reasons: string[] = [];

  const assessed = input.assessedValue ?? 0;
  if (assessed >= 500_000) {
    score += 25;
    reasons.push("assessed_value_500k_plus");
  } else if (assessed >= 300_000) {
    score += 15;
    reasons.push("assessed_value_300k_plus");
  } else if (assessed >= 200_000) {
    score += 8;
    reasons.push("assessed_value_200k_plus");
  }

  if (input.homestead === true) {
    score += 10;
    reasons.push("homestead_true");
  }

  if (input.lastSaleDate) {
    const years =
      (Date.now() - new Date(input.lastSaleDate).getTime()) /
      (365.25 * 24 * 3600 * 1000);
    if (years >= 15) {
      score += 30;
      reasons.push("last_sale_15y_plus");
    } else if (years >= 10) {
      score += 22;
      reasons.push("last_sale_10y_plus");
    } else if (years >= 5) {
      score += 12;
      reasons.push("last_sale_5y_plus");
    }
  } else {
    score += 8;
    reasons.push("last_sale_unknown");
  }

  return { score: Math.max(0, Math.min(100, score)), reasons };
}
