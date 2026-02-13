// supabase/functions/_shared/public_data/types.ts

export type NormalizedLocation = {
  lat: number;
  lng: number;
  state: string;        // "FL"
  county_hint?: string;
  normalized_address: string;
  street?: string;
  city?: string;
  zip?: string;
  normalized_address_key: string; // e.g. "4063_fonsica_ave"
};

export type CountyContext = {
  state: string;       // "FL"
  county_name: string; // "Sarasota"
  county_fips?: string;
};

export type PublicPropertyResult = {
  normalized_address_key: string;
  property_address: string;

  parcel_id?: string;
  owner_name?: string;
  owner_mailing_address?: string;

  living_sqft?: number;
  year_built?: number;
  lot_size?: string;
  land_use?: string;

  last_sale_date?: string;
  last_sale_amount?: number;
  homestead?: boolean;
  mortgage_lender?: string;
  assessed_value?: number;

  confidence_score: number;
  sources: Record<string, any>;
  raw: Record<string, any>;
};

export interface AppraiserAdapter {
  id: string;
  supports(county: CountyContext): boolean;
  lookupByAddress(input: {
    loc: NormalizedLocation;
    county: CountyContext;
    timeoutMs: number;
  }): Promise<Partial<PublicPropertyResult> | null>;
}

export interface TaxAdapter {
  id: string;
  supports(county: CountyContext): boolean;
  lookup(input: {
    loc: NormalizedLocation;
    county: CountyContext;
    parcel_id?: string;
    timeoutMs: number;
  }): Promise<Partial<PublicPropertyResult> | null>;
}

export interface ClerkAdapter {
  id: string;
  supports(county: CountyContext): boolean;
  lookup(input: {
    loc: NormalizedLocation;
    county: CountyContext;
    owner_name?: string;
    parcel_id?: string;
    timeoutMs: number;
  }): Promise<Partial<PublicPropertyResult> | null>;
}
