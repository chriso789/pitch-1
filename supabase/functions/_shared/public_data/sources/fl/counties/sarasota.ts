// supabase/functions/_shared/public_data/sources/fl/counties/sarasota.ts

import { ArcGISCountyConfig, CountyLookupInput, CountyLookupResult } from "../types.ts";
import { arcgisLookup } from "../adapters/arcgis.ts";

const config: ArcGISCountyConfig = {
  id: "fl_sarasota_arcgis",
  serviceUrl:
    "https://services3.arcgis.com/icrWMv7eBkctFu1f/arcgis/rest/services/ParcelHosted/FeatureServer/0",
  searchField: "FULLADDRESS",
  outFields: "ACCOUNT,NAME1,FULLADDRESS,HOMESTEAD,JUST,SALE_DATE,SALE_AMT,YRBL,LIVING,LSQFT",
  fieldMap: {
    ACCOUNT: "parcel_id",
    NAME1: "owner_name",
    FULLADDRESS: "property_address",
    HOMESTEAD: "homestead",
    JUST: "assessed_value",
    SALE_DATE: "last_sale_date",
    SALE_AMT: "last_sale_amount",
    YRBL: "year_built",
    LIVING: "living_sqft",
    LSQFT: "lot_size",
  },
  transforms: {
    homestead: (val) => String(val).toUpperCase() === "YES" || val === true || val === 1,
    last_sale_amount: (val) => (typeof val === "number" && val > 0 ? val : undefined),
    assessed_value: (val) => (typeof val === "number" && val > 0 ? val : undefined),
    year_built: (val) => (typeof val === "number" && val > 1800 ? val : undefined),
    living_sqft: (val) => (typeof val === "number" && val > 0 ? val : undefined),
  },
};

export function sarasota(input: CountyLookupInput): Promise<CountyLookupResult> {
  return arcgisLookup(config, input);
}
