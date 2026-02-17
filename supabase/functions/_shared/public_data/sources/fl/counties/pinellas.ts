// supabase/functions/_shared/public_data/sources/fl/counties/pinellas.ts

import { ArcGISCountyConfig, CountyLookupInput, CountyLookupResult } from "../types.ts";
import { arcgisLookup } from "../adapters/arcgis.ts";

const config: ArcGISCountyConfig = {
  id: "fl_pinellas_arcgis",
  serviceUrl:
    "https://gis.pcpao.org/arcgis/rest/services/Parcels/MapServer/0",
  searchField: "SITUSADDRESS",
  outFields: "PARCELID,OWNERNAME,SITUSADDRESS,HOMESTEAD,JUSTVALUE,SALEDATE,SALEAMOUNT",
  fieldMap: {
    PARCELID: "parcel_id",
    OWNERNAME: "owner_name",
    SITUSADDRESS: "property_address",
    HOMESTEAD: "homestead",
    JUSTVALUE: "assessed_value",
    SALEDATE: "last_sale_date",
    SALEAMOUNT: "last_sale_amount",
  },
  transforms: {
    homestead: (val) => String(val).toUpperCase() === "YES" || val === true || val === 1,
    last_sale_amount: (val) => (typeof val === "number" && val > 0 ? val : undefined),
    assessed_value: (val) => (typeof val === "number" && val > 0 ? val : undefined),
  },
};

export function pinellas(input: CountyLookupInput): Promise<CountyLookupResult> {
  return arcgisLookup(config, input);
}
