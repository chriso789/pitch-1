// supabase/functions/_shared/intel/claim.ts

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
}: {
  storm?: any;
  prop: any;
  damage: { score: number };
  equity: { score: number };
}) {
  let score = 0;
  const f: Record<string, any> = {};

  // Damage drives intent (55%)
  score += Math.round(damage.score * 0.55);
  f.damage = { score: damage.score, weight: 0.55 };

  // Equity helps close / deductible decisions (20%)
  score += Math.round(equity.score * 0.20);
  f.equity = { score: equity.score, weight: 0.20 };

  // Absentee owners respond well to mailing + investor behavior
  const absentee = isAbsentee(prop);
  if (absentee) score += 10;
  f.absentee = { value: absentee, points: absentee ? 10 : 0 };

  // Homestead adjustments
  const homestead = prop.homestead === true;
  if (homestead && damage.score < 40) score -= 8;
  if (homestead && damage.score >= 70) score += 6;
  f.homestead = {
    value: homestead,
    adj: homestead && damage.score < 40 ? -8 : homestead && damage.score >= 70 ? 6 : 0,
  };

  score = Math.max(0, Math.min(100, score));
  return { score, factors: f };
}
