// supabase/functions/_shared/public_data/registry.ts

import { AppraiserAdapter, TaxAdapter, ClerkAdapter, CountyContext } from "./types.ts";
import { flSarasotaAppraiser } from "./sources/fl/sarasota/appraiser.ts";
import { flSarasotaTax } from "./sources/fl/sarasota/tax.ts";
import { flSarasotaClerk } from "./sources/fl/sarasota/clerk.ts";

// Register adapters here. Add new counties by importing and appending.
const APPRAISERS: AppraiserAdapter[] = [
  flSarasotaAppraiser,
];

const TAX: TaxAdapter[] = [
  flSarasotaTax,
];

const CLERK: ClerkAdapter[] = [
  flSarasotaClerk,
];

export function pickAppraiser(county: CountyContext): AppraiserAdapter | null {
  return APPRAISERS.find(a => a.supports(county)) ?? null;
}

export function pickTax(county: CountyContext): TaxAdapter | null {
  return TAX.find(a => a.supports(county)) ?? null;
}

export function pickClerk(county: CountyContext): ClerkAdapter | null {
  return CLERK.find(a => a.supports(county)) ?? null;
}
