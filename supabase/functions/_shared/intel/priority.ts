// supabase/functions/_shared/intel/priority.ts

export function computePriority({
  damage,
  equity,
  claim,
}: {
  damage: { score: number };
  equity: { score: number };
  claim: { score: number };
}) {
  // Weighted blend: claim first, then damage, then equity
  const p = Math.round(claim.score * 0.55 + damage.score * 0.30 + equity.score * 0.15);
  return Math.max(0, Math.min(100, p));
}
