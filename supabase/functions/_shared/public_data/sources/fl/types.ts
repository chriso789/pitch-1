// supabase/functions/_shared/public_data/sources/fl/types.ts

export interface CountyLookupInput {
  address: string;
  city?: string;
  state: string;
  zip?: string;
  lat: number;
  lng: number;
}

export interface CountyLookupResult {
  parcel_id?: string;
  owner_name?: string;
  mailing_address?: string;
  homestead?: boolean;
  assessed_value?: number;
  last_sale_date?: string;
  last_sale_amount?: number;
  year_built?: number;
  living_sqft?: number;
  lot_size?: string;
  land_use?: string;
  source: string;
  confidence_score: number;
  raw: Record<string, unknown>;
}

export interface ArcGISCountyConfig {
  id: string;           // e.g. "fl_hillsborough_arcgis"
  serviceUrl: string;   // full ArcGIS query endpoint
  searchField: string;  // field to LIKE-search (e.g. "FullAddress")
  outFields: string;    // comma-separated fields to request
  fieldMap: Record<string, string>; // ArcGIS field -> our field name
  /** Optional: transform raw attribute values before mapping */
  transforms?: Record<string, (val: unknown) => unknown>;
}
