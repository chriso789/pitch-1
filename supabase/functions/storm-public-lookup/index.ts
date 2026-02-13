/**
 * storm-public-lookup - Multi-source public data property lookup engine
 * 
 * Sources (all FREE):
 * 1. Nominatim reverse geocode (backup geo resolution)
 * 2. Census TIGER county FIPS detection
 * 3. Esri ArcGIS Living Atlas parcel query (owner, APN, sqft, year)
 * 4. OpenStreetMap Overpass building metadata
 * 5. Firecrawl county appraiser scrape (validation layer)
 * 
 * NO REGRID. NO PAID PARCEL APIs.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface PublicLookupRequest {
  lat: number;
  lng: number;
  address?: string;
  tenant_id: string;
  property_id?: string;
}

interface PropertyResult {
  owner_name: string | null;
  owner_mailing_address: string | null;
  property_address: string | null;
  parcel_id: string | null;
  land_use: string | null;
  living_sqft: number | null;
  year_built: number | null;
  lot_size: string | null;
  last_sale_date: string | null;
  last_sale_amount: number | null;
  homestead: boolean;
  mortgage_lender: string | null;
  assessed_value: number | null;
  county: string | null;
  county_fips: string | null;
  state: string | null;
  confidence_score: number;
  source_esri: boolean;
  source_osm: boolean;
  source_appraiser: string | null;
  source_tax: string | null;
  source_clerk: string | null;
  raw_data: Record<string, any>;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const firecrawlApiKey = Deno.env.get('FIRECRAWL_API_KEY');
    const supabase = createClient(supabaseUrl, supabaseKey);

    const body: PublicLookupRequest = await req.json();
    const { lat, lng, address, tenant_id, property_id } = body;

    if (!lat || !lng || !tenant_id) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: lat, lng, tenant_id' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[storm-public-lookup] Starting lookup for ${lat},${lng} tenant=${tenant_id}`);

    // Check cache first
    const { data: cached } = await supabase
      .from('storm_properties_public')
      .select('*')
      .eq('tenant_id', tenant_id)
      .gte('lat', lat - 0.0001)
      .lte('lat', lat + 0.0001)
      .gte('lng', lng - 0.0001)
      .lte('lng', lng + 0.0001)
      .maybeSingle();

    if (cached && cached.confidence_score >= 40) {
      const cacheAge = Date.now() - new Date(cached.updated_at).getTime();
      const thirtyDays = 30 * 24 * 60 * 60 * 1000;
      if (cacheAge < thirtyDays) {
        console.log(`[storm-public-lookup] Returning cached result (confidence=${cached.confidence_score})`);
        return new Response(
          JSON.stringify({ success: true, result: cached, cached: true }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    const result: PropertyResult = {
      owner_name: null,
      owner_mailing_address: null,
      property_address: address || null,
      parcel_id: null,
      land_use: null,
      living_sqft: null,
      year_built: null,
      lot_size: null,
      last_sale_date: null,
      last_sale_amount: null,
      homestead: false,
      mortgage_lender: null,
      assessed_value: null,
      county: null,
      county_fips: null,
      state: null,
      confidence_score: 0,
      source_esri: false,
      source_osm: false,
      source_appraiser: null,
      source_tax: null,
      source_clerk: null,
      raw_data: {},
    };

    // ===============================================================
    // STEP 1 & 2: Nominatim + Census TIGER (parallel)
    // ===============================================================
    const [nominatimResult, tigerResult] = await Promise.allSettled([
      fetchNominatim(lat, lng),
      fetchCensusTiger(lat, lng),
    ]);

    if (nominatimResult.status === 'fulfilled' && nominatimResult.value) {
      const nom = nominatimResult.value;
      if (!result.property_address) {
        result.property_address = nom.display_name;
      }
      result.state = result.state || nom.state;
      result.county = result.county || nom.county;
      result.raw_data.nominatim = nom;
      console.log(`[storm-public-lookup] Nominatim: ${nom.display_name}`);
    }

    if (tigerResult.status === 'fulfilled' && tigerResult.value) {
      const tiger = tigerResult.value;
      result.county = tiger.county_name;
      result.county_fips = tiger.county_fips;
      result.state = tiger.state;
      result.raw_data.tiger = tiger;
      console.log(`[storm-public-lookup] TIGER: ${tiger.county_name} (${tiger.county_fips}), ${tiger.state}`);
    }

    // ===============================================================
    // STEP 3 & 4: Esri ArcGIS + OSM (parallel)
    // ===============================================================
    const [esriResult, osmResult] = await Promise.allSettled([
      fetchEsriParcel(lat, lng),
      fetchOSMBuilding(lat, lng),
    ]);

    if (esriResult.status === 'fulfilled' && esriResult.value) {
      const esri = esriResult.value;
      result.source_esri = true;
      result.parcel_id = esri.apn || result.parcel_id;
      result.owner_name = esri.owner || result.owner_name;
      result.year_built = esri.yearBuilt || result.year_built;
      result.living_sqft = esri.sqft || result.living_sqft;
      result.lot_size = esri.lotSize || result.lot_size;
      result.land_use = esri.landUse || result.land_use;
      result.assessed_value = esri.assessedValue || result.assessed_value;
      if (esri.address) result.property_address = esri.address;
      result.raw_data.esri = esri;

      // +40 confidence for Esri owner
      if (esri.owner) {
        result.confidence_score += 40;
        console.log(`[storm-public-lookup] Esri owner: "${esri.owner}" (+40 confidence)`);
      } else {
        result.confidence_score += 15; // Esri data without owner
        console.log(`[storm-public-lookup] Esri data found but no owner (+15 confidence)`);
      }
    }

    if (osmResult.status === 'fulfilled' && osmResult.value) {
      const osm = osmResult.value;
      result.source_osm = true;
      if (!result.year_built && osm.yearBuilt) result.year_built = osm.yearBuilt;
      if (!result.land_use && osm.buildingType) result.land_use = osm.buildingType;
      result.raw_data.osm = osm;

      // +10 confidence for OSM data
      result.confidence_score += 10;
      console.log(`[storm-public-lookup] OSM building data found (+10 confidence)`);
    }

    // +15 confidence for exact address validation
    if (result.property_address && address) {
      const normalizedResult = result.property_address.toLowerCase().replace(/[^a-z0-9]/g, '');
      const normalizedInput = address.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (normalizedResult.includes(normalizedInput.slice(0, 20)) || normalizedInput.includes(normalizedResult.slice(0, 20))) {
        result.confidence_score += 15;
        console.log(`[storm-public-lookup] Address validated (+15 confidence)`);
      }
    }

    // ===============================================================
    // STEP 5: Firecrawl County Appraiser Scrape (validation layer)
    // ===============================================================
    if (firecrawlApiKey && result.county && result.state) {
      try {
        const appraiserData = await fetchCountyAppraiser(
          result.property_address || address || '',
          result.county,
          result.state,
          firecrawlApiKey
        );

        if (appraiserData) {
          result.source_appraiser = `${result.county} County Property Appraiser`;
          result.raw_data.appraiser = appraiserData;

          // Cross-validate owner name
          if (appraiserData.owner_name) {
            if (result.owner_name) {
              // Compare names - fuzzy match
              const esriOwner = result.owner_name.toLowerCase().replace(/[^a-z]/g, '');
              const appOwner = appraiserData.owner_name.toLowerCase().replace(/[^a-z]/g, '');
              
              if (esriOwner.includes(appOwner.slice(0, 5)) || appOwner.includes(esriOwner.slice(0, 5))) {
                result.confidence_score += 20; // Matching owner across sources
                console.log(`[storm-public-lookup] Owner cross-validated: "${result.owner_name}" ≈ "${appraiserData.owner_name}" (+20 confidence)`);
              } else {
                result.confidence_score -= 10; // Mismatch - reduce confidence
                result.owner_name = appraiserData.owner_name; // Prefer appraiser
                console.log(`[storm-public-lookup] Owner MISMATCH: esri="${result.owner_name}" vs appraiser="${appraiserData.owner_name}" (-10 confidence)`);
              }
            } else {
              result.owner_name = appraiserData.owner_name;
              result.confidence_score += 20;
              console.log(`[storm-public-lookup] Appraiser owner: "${appraiserData.owner_name}" (+20 confidence)`);
            }
          }

          // Merge additional appraiser data
          if (appraiserData.mailing_address) result.owner_mailing_address = appraiserData.mailing_address;
          if (appraiserData.assessed_value) result.assessed_value = appraiserData.assessed_value;
          if (appraiserData.homestead !== undefined) {
            result.homestead = appraiserData.homestead;
            if (appraiserData.homestead) {
              result.confidence_score += 10;
              console.log(`[storm-public-lookup] Homestead verified (+10 confidence)`);
            }
          }
          if (appraiserData.year_built) result.year_built = appraiserData.year_built;
          if (appraiserData.living_sqft) result.living_sqft = appraiserData.living_sqft;
          if (appraiserData.last_sale_date) result.last_sale_date = appraiserData.last_sale_date;
          if (appraiserData.last_sale_amount) result.last_sale_amount = appraiserData.last_sale_amount;
        }
      } catch (err) {
        console.error('[storm-public-lookup] County appraiser scrape error:', err);
      }
    }

    // Cap confidence at 100
    result.confidence_score = Math.min(100, Math.max(0, result.confidence_score));

    console.log(`[storm-public-lookup] Final result: owner="${result.owner_name}", confidence=${result.confidence_score}`);

    // ===============================================================
    // STEP 6: Persist to storm_properties_public
    // ===============================================================
    const { error: upsertError } = await supabase
      .from('storm_properties_public')
      .upsert({
        property_address: result.property_address,
        county: result.county,
        county_fips: result.county_fips,
        state: result.state,
        parcel_id: result.parcel_id,
        owner_name: result.owner_name,
        owner_mailing_address: result.owner_mailing_address,
        living_sqft: result.living_sqft,
        year_built: result.year_built,
        lot_size: result.lot_size,
        land_use: result.land_use,
        last_sale_date: result.last_sale_date,
        last_sale_amount: result.last_sale_amount,
        homestead: result.homestead,
        mortgage_lender: result.mortgage_lender,
        assessed_value: result.assessed_value,
        confidence_score: result.confidence_score,
        source_appraiser: result.source_appraiser,
        source_tax: result.source_tax,
        source_clerk: result.source_clerk,
        source_esri: result.source_esri,
        source_osm: result.source_osm,
        lat,
        lng,
        tenant_id,
        canvassiq_property_id: property_id || null,
        raw_data: result.raw_data,
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'tenant_id,property_address',
        ignoreDuplicates: false,
      });

    if (upsertError) {
      console.error('[storm-public-lookup] Upsert error:', upsertError);
    }

    // Update canvassiq_properties if property_id provided
    if (property_id && result.owner_name) {
      await supabase.from('canvassiq_properties').update({
        owner_name: result.owner_name,
        property_data: {
          source: 'public_data_engine',
          confidence_score: result.confidence_score,
          parcel_id: result.parcel_id,
          year_built: result.year_built,
          living_sqft: result.living_sqft,
          lot_size: result.lot_size,
          land_use: result.land_use,
          assessed_value: result.assessed_value,
          homestead: result.homestead,
          last_sale_date: result.last_sale_date,
          last_sale_amount: result.last_sale_amount,
          county: result.county,
          sources: [
            result.source_esri ? 'esri' : null,
            result.source_osm ? 'osm' : null,
            result.source_appraiser ? 'appraiser' : null,
          ].filter(Boolean),
          enriched_at: new Date().toISOString(),
        },
        updated_at: new Date().toISOString(),
      }).eq('id', property_id);
    }

    return new Response(
      JSON.stringify({ success: true, result, cached: false }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[storm-public-lookup] Error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

// ===============================================================
// DATA SOURCE FUNCTIONS
// ===============================================================

/**
 * Nominatim reverse geocode (FREE, no API key)
 */
async function fetchNominatim(lat: number, lng: number): Promise<{
  display_name: string;
  county: string | null;
  state: string | null;
  city: string | null;
} | null> {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&addressdetails=1`;
    const response = await fetch(url, {
      headers: { 'User-Agent': 'PitchCRM/1.0 (construction-crm)' }
    });
    
    if (!response.ok) return null;
    const data = await response.json();
    
    return {
      display_name: data.display_name || '',
      county: data.address?.county?.replace(' County', '') || null,
      state: data.address?.state || null,
      city: data.address?.city || data.address?.town || data.address?.village || null,
    };
  } catch (err) {
    console.error('[fetchNominatim] Error:', err);
    return null;
  }
}

/**
 * Census TIGER county FIPS detection (FREE, no API key)
 */
async function fetchCensusTiger(lat: number, lng: number): Promise<{
  county_name: string;
  county_fips: string;
  state: string;
  state_fips: string;
} | null> {
  try {
    const url = `https://geocoding.geo.census.gov/geocoder/geographies/coordinates?x=${lng}&y=${lat}&benchmark=Public_AR_Current&vintage=Current_Current&format=json`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);
    
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    
    if (!response.ok) return null;
    const data = await response.json();
    
    const geographies = data?.result?.geographies;
    const county = geographies?.Counties?.[0] || geographies?.['County Subdivisions']?.[0];
    const state = geographies?.States?.[0];
    
    if (!county) return null;
    
    return {
      county_name: county.NAME || county.BASENAME || '',
      county_fips: county.GEOID || `${county.STATE}${county.COUNTY}`,
      state: state?.STUSAB || state?.NAME || '',
      state_fips: county.STATE || '',
    };
  } catch (err) {
    console.error('[fetchCensusTiger] Error:', err);
    return null;
  }
}

/**
 * Esri ArcGIS Living Atlas - US Parcels (FREE)
 */
async function fetchEsriParcel(lat: number, lng: number): Promise<{
  apn: string | null;
  owner: string | null;
  yearBuilt: number | null;
  sqft: number | null;
  lotSize: string | null;
  landUse: string | null;
  address: string | null;
  assessedValue: number | null;
} | null> {
  try {
    const url = new URL('https://services.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services/USA_Parcels_v2/FeatureServer/0/query');
    url.searchParams.set('where', '1=1');
    url.searchParams.set('geometry', `${lng},${lat}`);
    url.searchParams.set('geometryType', 'esriGeometryPoint');
    url.searchParams.set('spatialRel', 'esriSpatialRelContains');
    url.searchParams.set('inSR', '4326');
    url.searchParams.set('outSR', '4326');
    url.searchParams.set('outFields', '*');
    url.searchParams.set('returnGeometry', 'false');
    url.searchParams.set('f', 'json');

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    
    const response = await fetch(url.toString(), { signal: controller.signal });
    clearTimeout(timeoutId);
    
    if (!response.ok) return null;
    const data = await response.json();
    
    if (!data.features?.length) return null;
    
    const attrs = data.features[0].attributes || {};
    
    const owner = attrs.OWNER || attrs.OWNER_NAME || attrs.OWN_NAME || attrs.OWNERNAME || null;
    const apn = attrs.APN || attrs.PARCEL_ID || attrs.ParcelID || attrs.PARCEL_NO || attrs.PIN || null;
    const yearBuilt = attrs.YEAR_BUILT || attrs.YR_BUILT || attrs.YEARBUILT || attrs.YR_BLT || null;
    const sqft = attrs.SQFT || attrs.BLDG_SQFT || attrs.LIVABLE_SQFT || attrs.FINISHED_SQFT || null;
    const acres = attrs.ACRES || attrs.LOT_ACRES || null;
    const lotSqft = attrs.LOT_SQFT || attrs.LAND_SQFT || (acres ? Math.round(acres * 43560) : null);
    const landUse = mapLandUse(attrs.USE_CODE || attrs.PROP_TYPE || attrs.LAND_USE || null);
    const assessedValue = attrs.ASSESSED_VALUE || attrs.TOTAL_VALUE || attrs.MKT_VALUE || null;
    
    // Build address from attrs
    const addrParts = [
      attrs.SITUS_ADDR || attrs.SITE_ADDR || attrs.ADDRESS,
      attrs.SITUS_CITY || attrs.CITY,
      attrs.SITUS_STATE || attrs.STATE,
      attrs.SITUS_ZIP || attrs.ZIP,
    ].filter(Boolean);
    
    return {
      apn,
      owner,
      yearBuilt: yearBuilt ? Number(yearBuilt) : null,
      sqft: sqft ? Number(sqft) : null,
      lotSize: lotSqft ? `${lotSqft} sqft` : (acres ? `${acres} acres` : null),
      landUse,
      address: addrParts.length >= 2 ? addrParts.join(', ') : null,
      assessedValue: assessedValue ? Number(assessedValue) : null,
    };
  } catch (err) {
    console.error('[fetchEsriParcel] Error:', err);
    return null;
  }
}

/**
 * OpenStreetMap Overpass - Building metadata (FREE)
 */
async function fetchOSMBuilding(lat: number, lng: number): Promise<{
  buildingType: string | null;
  yearBuilt: number | null;
  address: string | null;
} | null> {
  try {
    const query = `[out:json][timeout:10];(way["building"](around:30,${lat},${lng});relation["building"](around:30,${lat},${lng}););out tags;`;
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    
    const response = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      body: `data=${encodeURIComponent(query)}`,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    
    if (!response.ok) return null;
    const data = await response.json();
    
    if (!data.elements?.length) return null;
    
    // Pick the element with the most tags
    const element = data.elements.reduce((best: any, curr: any) =>
      Object.keys(curr.tags || {}).length > Object.keys(best.tags || {}).length ? curr : best
    , data.elements[0]);
    
    const tags = element.tags || {};
    
    const typeMap: Record<string, string> = {
      'house': 'single_family', 'detached': 'single_family', 'residential': 'residential',
      'apartments': 'multi_family', 'commercial': 'commercial', 'retail': 'commercial',
      'industrial': 'industrial', 'warehouse': 'industrial',
    };
    
    const addrParts = [tags['addr:housenumber'], tags['addr:street'], tags['addr:city'], tags['addr:state'], tags['addr:postcode']].filter(Boolean);
    
    return {
      buildingType: typeMap[tags.building?.toLowerCase()] || 'residential',
      yearBuilt: tags.start_date ? parseInt(tags.start_date) : null,
      address: addrParts.length >= 2 ? addrParts.join(' ') : null,
    };
  } catch (err) {
    console.error('[fetchOSMBuilding] Error:', err);
    return null;
  }
}

/**
 * County Property Appraiser scrape via Firecrawl
 * Dynamically detects county appraiser URL and scrapes property data
 */
async function fetchCountyAppraiser(
  address: string,
  county: string,
  state: string,
  firecrawlApiKey: string
): Promise<{
  owner_name: string | null;
  mailing_address: string | null;
  assessed_value: number | null;
  homestead: boolean;
  year_built: number | null;
  living_sqft: number | null;
  last_sale_date: string | null;
  last_sale_amount: number | null;
} | null> {
  if (!address || !county) return null;

  // County appraiser URL map - expandable
  const countyAppraisers: Record<string, string> = {
    // Florida
    'hillsborough_fl': 'https://www.hcpafl.org',
    'pinellas_fl': 'https://www.pcpao.org',
    'orange_fl': 'https://www.ocpafl.org',
    'miami-dade_fl': 'https://www.miamidade.gov/pa',
    'broward_fl': 'https://web.bcpa.net',
    'palm beach_fl': 'https://www.pbcgov.com/papa',
    'duval_fl': 'https://www.coj.net/departments/property-appraiser',
    'lee_fl': 'https://www.leepa.org',
    'brevard_fl': 'https://www.bcpao.us',
    'volusia_fl': 'https://www.volusia.org/services/growth-and-resource-management/property-appraiser',
    'sarasota_fl': 'https://www.sc-pa.com',
    'manatee_fl': 'https://www.manateepao.com',
    'polk_fl': 'https://www.polkpa.org',
    'osceola_fl': 'https://www.property-appraiser.org',
    'seminole_fl': 'https://www.scpafl.org',
    'pasco_fl': 'https://www.pascopa.com',
    'lake_fl': 'https://www.lakecopropappr.com',
    'collier_fl': 'https://www.collierappraiser.com',
    'charlotte_fl': 'https://www.ccappraiser.com',
    // Texas
    'harris_tx': 'https://www.hcad.org',
    'dallas_tx': 'https://www.dallascad.org',
    'tarrant_tx': 'https://www.tad.org',
    'bexar_tx': 'https://www.bcad.org',
    'travis_tx': 'https://www.traviscad.org',
    'collin_tx': 'https://www.collincad.org',
    'denton_tx': 'https://www.dentoncad.com',
    'fort bend_tx': 'https://www.fbcad.org',
    'williamson_tx': 'https://www.wcad.org',
    // Georgia
    'fulton_ga': 'https://www.fultoncountyga.gov/property',
    'gwinnett_ga': 'https://www.gwinnettcounty.com/taxcommissioner',
    'cobb_ga': 'https://www.cobbassessor.org',
    'dekalb_ga': 'https://www.dekalbcountyga.gov/tax-assessor',
    // North Carolina
    'mecklenburg_nc': 'https://meckcama.co.mecklenburg.nc.us',
    'wake_nc': 'https://services.wakegov.com/realestate',
    'guilford_nc': 'https://www.guilfordcountync.gov/tax',
    // Colorado
    'denver_co': 'https://www.denvergov.org/property',
    'el paso_co': 'https://assessor.elpasoco.com',
    'arapahoe_co': 'https://www.arapahoegov.com/assessor',
    // Arizona
    'maricopa_az': 'https://mcassessor.maricopa.gov',
    'pima_az': 'https://www.asr.pima.gov',
    // Others
    'los angeles_ca': 'https://assessor.lacounty.gov',
    'san diego_ca': 'https://www.sdcounty.ca.gov/assessor',
    'clark_nv': 'https://www.clarkcountynv.gov/assessor',
    'king_wa': 'https://blue.kingcounty.com/Assessor',
    'cook_il': 'https://www.cookcountyassessor.com',
  };

  const normalizedCounty = county.toLowerCase().replace(' county', '').trim();
  const normalizedState = state.toLowerCase().trim();
  const key = `${normalizedCounty}_${normalizedState}`;
  
  const appraiserUrl = countyAppraisers[key];
  
  if (!appraiserUrl) {
    console.log(`[fetchCountyAppraiser] No URL mapped for ${county}, ${state}`);
    return null;
  }

  try {
    const searchUrl = `${appraiserUrl}/search?address=${encodeURIComponent(address)}`;
    console.log(`[fetchCountyAppraiser] Scraping: ${searchUrl}`);

    const response = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${firecrawlApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url: searchUrl,
        formats: [{
          type: 'json',
          schema: {
            owner_name: 'string',
            mailing_address: 'string',
            assessed_value: 'number',
            year_built: 'number',
            living_sqft: 'number',
            homestead: 'boolean',
            last_sale_date: 'string',
            last_sale_amount: 'number',
          }
        }],
        waitFor: 5000,
      }),
    });

    if (!response.ok) {
      console.error(`[fetchCountyAppraiser] Firecrawl error: ${response.status}`);
      return null;
    }

    const data = await response.json();
    const jsonData = data?.data?.json || data?.json;
    
    if (!jsonData) return null;

    return {
      owner_name: jsonData.owner_name || null,
      mailing_address: jsonData.mailing_address || null,
      assessed_value: jsonData.assessed_value ? Number(jsonData.assessed_value) : null,
      homestead: !!jsonData.homestead,
      year_built: jsonData.year_built ? Number(jsonData.year_built) : null,
      living_sqft: jsonData.living_sqft ? Number(jsonData.living_sqft) : null,
      last_sale_date: jsonData.last_sale_date || null,
      last_sale_amount: jsonData.last_sale_amount ? Number(jsonData.last_sale_amount) : null,
    };
  } catch (err) {
    console.error('[fetchCountyAppraiser] Error:', err);
    return null;
  }
}

function mapLandUse(code: string | null): string | null {
  if (!code) return null;
  const normalized = String(code).toLowerCase();
  if (normalized.includes('single') || normalized.includes('sfr') || normalized === 'r1') return 'single_family';
  if (normalized.includes('multi') || normalized.includes('apartment') || normalized.includes('mfr')) return 'multi_family';
  if (normalized.includes('condo') || normalized.includes('townhouse')) return 'condo';
  if (normalized.includes('commercial') || normalized.includes('com')) return 'commercial';
  if (normalized.includes('industrial') || normalized.includes('ind')) return 'industrial';
  if (normalized.includes('vacant') || normalized.includes('land')) return 'vacant_land';
  return 'residential';
}
