// supabase/functions/_shared/intel/claim.ts

export interface ClaimConfig {
  claim_w_damage?: number;
  claim_w_equity?: number;
  claim_absentee_bonus?: number;
  claim_homestead_low_damage_penalty?: number;
  claim_homestead_high_damage_bonus?: number;
}

function normalize(s: string) {
  return (s || "").toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
}

function isAbsentee(prop: any) {
  if (!prop.owner_mailing_address || !prop.property_address) return false;
  return normalize(prop.owner_mailing_address) !== normalize(prop.property_address);
}

export function scoreClaimLikelihood({
  prop,
  damage,
  equity,
  config,
}: {
  storm?: any;
  prop: any;
  damage: { score: number };
  equity: { score: number };
  config?: ClaimConfig;
}) {
  const wDamage = config?.claim_w_damage ?? 0.55;
  const wEquity = config?.claim_w_equity ?? 0.20;
  const absenteeBonus = config?.claim_absentee_bonus ?? 10;
  const homesteadLowPenalty = config?.claim_homestead_low_damage_penalty ?? 8;
  const homesteadHighBonus = config?.claim_homestead_high_damage_bonus ?? 6;

  let score = 0;
  const f: Record<string, any> = {};

  // Damage drives intent
  score += Math.round(damage.score * wDamage);
  f.damage = { score: damage.score, weight: wDamage };

  // Equity helps close / deductible decisions
  score += Math.round(equity.score * wEquity);
  f.equity = { score: equity.score, weight: wEquity };

  // Absentee owners respond well to mailing + investor behavior
  const absentee = isAbsentee(prop);
  if (absentee) score += absenteeBonus;
  f.absentee = { value: absentee, points: absentee ? absenteeBonus : 0 };

  // Homestead adjustments
  const homestead = prop.homestead === true;
  if (homestead && damage.score < 40) score -= homesteadLowPenalty;
  if (homestead && damage.score >= 70) score += homesteadHighBonus;
  f.homestead = {
    value: homestead,
    adj: homestead && damage.score < 40 ? -homesteadLowPenalty : homestead && damage.score >= 70 ? homesteadHighBonus : 0,
  };

  score = Math.max(0, Math.min(100, score));
  return { score, factors: f };
}
