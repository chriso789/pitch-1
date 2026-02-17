// supabase/functions/_shared/public_data/sources/fl/registry.ts

import type { CountyLookupInput, CountyLookupResult } from "./types.ts";
import { hillsborough } from "./counties/hillsborough.ts";
import { orange } from "./counties/orange.ts";
import { pinellas } from "./counties/pinellas.ts";
import { pasco } from "./counties/pasco.ts";
import { sarasota } from "./counties/sarasota.ts";
import { manatee } from "./counties/manatee.ts";
import { polk } from "./counties/polk.ts";
import { brevard } from "./counties/brevard.ts";
import { lee } from "./counties/lee.ts";
import { collier } from "./counties/collier.ts";
import { broward } from "./counties/broward.ts";
import { palm_beach } from "./counties/palm_beach.ts";

type CountyAdapter = (input: CountyLookupInput) => Promise<CountyLookupResult>;

/**
 * Registry of FL county adapters.
 * Key = lowercase county name (as returned by Census TIGER / countyResolver).
 */
const REGISTRY: Record<string, CountyAdapter> = {
  hillsborough: hillsborough,
  orange: orange,
  pinellas: pinellas,
  pasco: pasco,
  sarasota: sarasota,
  manatee: manatee,
  polk: polk,
  brevard: brevard,
  lee: lee,
  collier: collier,
  broward: broward,
  "palm beach": palm_beach,
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
