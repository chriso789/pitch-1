// supabase/functions/_shared/intel/priority.ts

export interface PriorityConfig {
  w_damage?: number;
  w_equity?: number;
  w_claim?: number;
}

export function computePriority({
  damage,
  equity,
  claim,
  config,
}: {
  damage: { score: number };
  equity: { score: number };
  claim: { score: number };
  config?: PriorityConfig;
}) {
  const wClaim = config?.w_claim ?? 0.55;
  const wDamage = config?.w_damage ?? 0.30;
  const wEquity = config?.w_equity ?? 0.15;

  const p = Math.round(claim.score * wClaim + damage.score * wDamage + equity.score * wEquity);
  return Math.max(0, Math.min(100, p));
}
