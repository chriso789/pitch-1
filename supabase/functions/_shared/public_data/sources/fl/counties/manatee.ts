// supabase/functions/_shared/public_data/sources/fl/counties/manatee.ts

import { ArcGISCountyConfig, CountyLookupInput, CountyLookupResult } from "../types.ts";
import { arcgisLookup } from "../adapters/arcgis.ts";

const config: ArcGISCountyConfig = {
  id: "fl_manatee_arcgis",
  serviceUrl:
    "https://gis.mymanatee.org/arcgis/rest/services/Parcels/MapServer/0",
  searchField: "SITUS_ADDRESS",
  outFields: "PARCEL_ID,OWNER_NAME,SITUS_ADDRESS",
  fieldMap: {
    PARCEL_ID: "parcel_id",
    OWNER_NAME: "owner_name",
    SITUS_ADDRESS: "property_address",
  },
};

export function manatee(input: CountyLookupInput): Promise<CountyLookupResult> {
  return arcgisLookup(config, input);
}
