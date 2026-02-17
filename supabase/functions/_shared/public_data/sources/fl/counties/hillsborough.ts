// supabase/functions/_shared/public_data/sources/fl/counties/hillsborough.ts

import { ArcGISCountyConfig, CountyLookupInput, CountyLookupResult } from "../types.ts";
import { arcgisLookup } from "../adapters/arcgis.ts";

const config: ArcGISCountyConfig = {
  id: "fl_hillsborough_arcgis",
  serviceUrl:
    "https://gis.hcpafl.org/arcgis/rest/services/Webmaps/HillsboroughFL_WebParcels/MapServer/0",
  searchField: "FullAddress",
  outFields: "folio,Owner1,Owner2,FullAddress,StreetLabel,SiteCity,SiteZip,Homestead,TopSaleDate,TopSalePrice,ShapeArea",
  fieldMap: {
    folio: "parcel_id",
    Owner1: "owner_name",
    FullAddress: "property_address",
    Homestead: "homestead",
    TopSaleDate: "last_sale_date",
    TopSalePrice: "last_sale_amount",
  },
  transforms: {
    homestead: (val) => String(val).toUpperCase() === "YES",
    last_sale_amount: (val) => (typeof val === "number" && val > 0 ? val : undefined),
  },
};

export function hillsborough(input: CountyLookupInput): Promise<CountyLookupResult> {
  return arcgisLookup(config, input);
}
