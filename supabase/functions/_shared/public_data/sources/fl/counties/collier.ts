// supabase/functions/_shared/public_data/sources/fl/counties/collier.ts

import { ArcGISCountyConfig, CountyLookupInput, CountyLookupResult } from "../types.ts";
import { arcgisLookup } from "../adapters/arcgis.ts";

const config: ArcGISCountyConfig = {
  id: "fl_collier_arcgis",
  serviceUrl:
    "https://gis.collierappraiser.com/arcgis/rest/services/Parcels/MapServer/0",
  searchField: "SITUS_ADDRESS",
  outFields: "PARCEL_ID,OWNER_NAME,SITUS_ADDRESS",
  fieldMap: {
    PARCEL_ID: "parcel_id",
    OWNER_NAME: "owner_name",
    SITUS_ADDRESS: "property_address",
  },
};

export function collier(input: CountyLookupInput): Promise<CountyLookupResult> {
  return arcgisLookup(config, input);
}
