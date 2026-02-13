// supabase/functions/_shared/public_data/sources/fl/sarasota/clerk.ts

import { ClerkAdapter, CountyContext, NormalizedLocation, PublicPropertyResult } from "../../../types.ts";

export const flSarasotaClerk: ClerkAdapter = {
  id: "fl_sarasota_clerk",

  supports(county: CountyContext) {
    return county.state === "FL" && county.county_name.toLowerCase() === "sarasota";
  },

  async lookup(input: { loc: NormalizedLocation; county: CountyContext; owner_name?: string; parcel_id?: string; timeoutMs: number }) {
    // TODO: implement Sarasota Clerk of Court search (deeds/mortgages)
    void input;
    return null;
  },
};
