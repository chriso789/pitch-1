// supabase/functions/_shared/scoring/roofAge.ts
// Roof age likelihood scoring based on home age and tenure

export interface RoofAgeScoreInput {
  yearBuilt?: number | null;
  lastSaleDate?: string | null;
  homestead?: boolean | null;
}

export interface ScoreResult {
  score: number;
  reasons: string[];
}

export function roofAgeLikelihood(input: RoofAgeScoreInput): ScoreResult {
  let score = 0;
  const reasons: string[] = [];

  const yb = input.yearBuilt ?? null;
  if (yb) {
    const age = new Date().getFullYear() - yb;
    if (age >= 25) {
      score += 45;
      reasons.push("home_25y_plus");
    } else if (age >= 15) {
      score += 30;
      reasons.push("home_15y_plus");
    } else if (age >= 10) {
      score += 15;
      reasons.push("home_10y_plus");
    }
  } else {
    score += 10;
    reasons.push("year_built_unknown");
  }

  if (input.lastSaleDate) {
    const years =
      (Date.now() - new Date(input.lastSaleDate).getTime()) /
      (365.25 * 24 * 3600 * 1000);
    if (years >= 12) {
      score += 20;
      reasons.push("long_tenure");
    }
  }

  if (input.homestead === true) {
    score += 5;
    reasons.push("stable_owner");
  }

  return { score: Math.max(0, Math.min(100, score)), reasons };
}
