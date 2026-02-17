// supabase/functions/_shared/public_data/sources/fl/counties/sarasota.ts

import { ArcGISCountyConfig, CountyLookupInput, CountyLookupResult } from "../types.ts";
import { arcgisLookup } from "../adapters/arcgis.ts";

const config: ArcGISCountyConfig = {
  id: "fl_sarasota_arcgis",
  serviceUrl:
    "https://gis.sc-pa.com/arcgis/rest/services/Parcels/MapServer/0",
  searchField: "SITUS_ADDRESS",
  outFields: "PARCEL_ID,OWNER_NAME,SITUS_ADDRESS,HOMESTEAD,JUST_VALUE,SALE_DATE,SALE_AMOUNT",
  fieldMap: {
    PARCEL_ID: "parcel_id",
    OWNER_NAME: "owner_name",
    SITUS_ADDRESS: "property_address",
    HOMESTEAD: "homestead",
    JUST_VALUE: "assessed_value",
    SALE_DATE: "last_sale_date",
    SALE_AMOUNT: "last_sale_amount",
  },
  transforms: {
    homestead: (val) => String(val).toUpperCase() === "YES" || val === true || val === 1,
    last_sale_amount: (val) => (typeof val === "number" && val > 0 ? val : undefined),
    assessed_value: (val) => (typeof val === "number" && val > 0 ? val : undefined),
  },
};

export function sarasota(input: CountyLookupInput): Promise<CountyLookupResult> {
  return arcgisLookup(config, input);
}
