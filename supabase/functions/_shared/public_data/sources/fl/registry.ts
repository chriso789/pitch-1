// supabase/functions/_shared/public_data/sources/fl/registry.ts

import type { CountyLookupInput, CountyLookupResult } from "./types.ts";
import { hillsborough } from "./counties/hillsborough.ts";
import { orange } from "./counties/orange.ts";

type CountyAdapter = (input: CountyLookupInput) => Promise<CountyLookupResult>;

/**
 * Registry of FL county adapters.
 * Key = lowercase county name (as returned by Census TIGER / countyResolver).
 */
const REGISTRY: Record<string, CountyAdapter> = {
  hillsborough: hillsborough,
  orange: orange,
  // Phase 2: add remaining counties as adapters are built
  // pinellas, sarasota, manatee, pasco, hernando, polk,
  // seminole, osceola, lake, brevard, indian river, st. lucie,
  // martin, palm beach, broward, miami-dade, monroe,
  // charlotte, lee, collier
};

/**
 * Look up property data via a direct county API adapter.
 * Returns null if no adapter exists for the county (caller should fall back to Firecrawl).
 */
export async function lookupFlCountyProperty(
  input: CountyLookupInput & { county: string },
): Promise<CountyLookupResult | null> {
  const key = input.county.toLowerCase().replace(" county", "").replace("saint ", "st. ").trim();
  const adapter = REGISTRY[key];

  if (!adapter) {
    console.log(`[fl_registry] no adapter for county: "${key}"`);
    return null;
  }

  console.log(`[fl_registry] using adapter for: "${key}"`);
  return adapter(input);
}

/** List of supported county names (for debugging/logging) */
export const SUPPORTED_FL_COUNTIES = Object.keys(REGISTRY);
