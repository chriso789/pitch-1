// supabase/functions/_shared/public_data/sources/fl/counties/orange.ts

import { ArcGISCountyConfig, CountyLookupInput, CountyLookupResult } from "../types.ts";
import { arcgisLookup } from "../adapters/arcgis.ts";

const config: ArcGISCountyConfig = {
  id: "fl_orange_arcgis",
  serviceUrl:
    "https://services2.arcgis.com/N4cKzJ9dzXmsPNRs/ArcGIS/rest/services/orange_county_parcels/FeatureServer/0",
  searchField: "SITEADDR",
  outFields: "PARCEL,NAME1,NAME2,SITEADDR,SITECITY,SITEZIP,HOMESTEAD,JUSTVAL,ASSDVAL,SALEPRC1,SALEDT1,YRBLT,LNDAREA,DORUC,ACTAREA,MAILADDR,MAILCITY,MAILSTATE,MAILZIP",
  fieldMap: {
    PARCEL: "parcel_id",
    NAME1: "owner_name",
    SITEADDR: "property_address",
    HOMESTEAD: "homestead",
    ASSDVAL: "assessed_value",
    SALEPRC1: "last_sale_amount",
    SALEDT1: "last_sale_date",
    YRBLT: "year_built",
    ACTAREA: "living_sqft",
    DORUC: "land_use",
    LNDAREA: "lot_size",
  },
  transforms: {
    homestead: (val) => val !== null && val !== undefined && val !== "" && val !== "0" && val !== 0,
    last_sale_amount: (val) => (typeof val === "number" && val > 0 ? val : undefined),
    year_built: (val) => (typeof val === "number" && val > 1800 ? val : undefined),
    living_sqft: (val) => (typeof val === "number" && val > 0 ? val : undefined),
    assessed_value: (val) => (typeof val === "number" && val > 0 ? val : undefined),
    lot_size: (val) => val ? String(val) : undefined,
  },
};

// Build mailing address from multi-field
const originalLookup = (input: CountyLookupInput) => arcgisLookup(config, input);

export async function orange(input: CountyLookupInput): Promise<CountyLookupResult> {
  const result = await originalLookup(input);

  // Compose mailing address from raw fields
  const raw = result.raw as Record<string, unknown>;
  const mailParts = [raw?.MAILADDR, raw?.MAILCITY, raw?.MAILSTATE, raw?.MAILZIP]
    .filter(Boolean)
    .map(String);
  if (mailParts.length >= 2) {
    result.mailing_address = mailParts.join(", ");
  }

  // Bump confidence if we got mailing + owner
  if (result.mailing_address && result.owner_name) {
    result.confidence_score = Math.max(result.confidence_score, 85);
  }

  return result;
}
