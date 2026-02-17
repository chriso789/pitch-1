// supabase/functions/_shared/scoring/index.ts
// Barrel — compute all scores from a flat property record

import { equityScore } from "./equity.ts";
import { absenteeScore } from "./absentee.ts";
import { roofAgeLikelihood } from "./roofAge.ts";

export function computeScores(input: {
  assessed_value?: number | null;
  last_sale_date?: string | null;
  last_sale_amount?: number | null;
  homestead?: boolean | null;
  owner_name?: string | null;
  mailing_address?: string | null;
  property_address?: string | null;
  year_built?: number | null;
}) {
  const equity = equityScore({
    assessedValue: input.assessed_value,
    lastSaleAmount: input.last_sale_amount,
    lastSaleDate: input.last_sale_date,
    homestead: input.homestead,
  });

  const absentee = absenteeScore({
    propertyAddress: input.property_address,
    mailingAddress: input.mailing_address,
    homestead: input.homestead,
    ownerName: input.owner_name,
  });

  const roof_age = roofAgeLikelihood({
    yearBuilt: input.year_built,
    lastSaleDate: input.last_sale_date,
    homestead: input.homestead,
  });

  return { equity, absentee, roof_age };
}
