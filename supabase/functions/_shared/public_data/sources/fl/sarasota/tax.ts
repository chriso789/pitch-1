// supabase/functions/_shared/public_data/sources/fl/sarasota/tax.ts

import { TaxAdapter, CountyContext, NormalizedLocation, PublicPropertyResult } from "../../../types.ts";

export const flSarasotaTax: TaxAdapter = {
  id: "fl_sarasota_tax",

  supports(county: CountyContext) {
    return county.state === "FL" && county.county_name.toLowerCase() === "sarasota";
  },

  async lookup(input: { loc: NormalizedLocation; county: CountyContext; parcel_id?: string; timeoutMs: number }) {
    // TODO: implement Sarasota Tax Collector validation via public site scrape
    void input;
    return null;
  },
};
