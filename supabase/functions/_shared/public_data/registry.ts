// supabase/functions/_shared/public_data/registry.ts

import { AppraiserAdapter, TaxAdapter, ClerkAdapter, CountyContext } from "./types.ts";
import { universalAppraiser } from "./sources/universal/appraiser.ts";
import { universalTax } from "./sources/universal/tax.ts";
import { universalClerk } from "./sources/universal/clerk.ts";

// Universal adapters work for any US county via Firecrawl search+scrape
const APPRAISERS: AppraiserAdapter[] = [
  universalAppraiser,
];

const TAX: TaxAdapter[] = [
  universalTax,
];

const CLERK: ClerkAdapter[] = [
  universalClerk,
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
