// supabase/functions/_shared/intel/equity.ts

export function scoreEquity({ prop }: { storm?: any; prop: any }) {
  const sqft = Number(prop.living_sqft ?? 0);
  const lastSaleAmt = Number(prop.last_sale_amount ?? 0);
  const lastSaleDate = prop.last_sale_date ? new Date(prop.last_sale_date) : null;

  const estPpsf = 220; // TODO: tenant/county config table
  const estValue = sqft > 0 ? sqft * estPpsf : (lastSaleAmt || 0);

  // Mortgage proxy
  let estMortgage = 0;
  if (lastSaleAmt && lastSaleDate) {
    const years = (Date.now() - lastSaleDate.getTime()) / (365.25 * 24 * 3600 * 1000);
    const ltv = years < 2 ? 0.9 : years < 5 ? 0.8 : years < 10 ? 0.7 : 0.6;
    estMortgage = lastSaleAmt * ltv;
  }

  const equity = Math.max(0, estValue - estMortgage);
  const equityPct = estValue > 0 ? equity / estValue : 0;

  // Score: 0% equity=0, 50%=~63, 80%+=100
  const score = Math.max(0, Math.min(100, Math.round((equityPct / 0.8) * 100)));

  return {
    score,
    factors: {
      est_value: estValue,
      est_mortgage: estMortgage,
      est_equity: equity,
      est_equity_pct: equityPct,
      model: "banded_ppsf_ltv",
    },
  };
}
