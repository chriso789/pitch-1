import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { permit_case_id, job_id, address } = await req.json();

    if (!permit_case_id || !job_id) {
      return new Response(
        JSON.stringify({ error: "permit_case_id and job_id are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get the permit case to find the tenant_id
    const { data: permitCase, error: permitCaseError } = await supabase
      .from("permit_cases")
      .select("tenant_id, county_name")
      .eq("id", permit_case_id)
      .single();

    if (permitCaseError || !permitCase) {
      console.error("Permit case not found:", permitCaseError);
      return new Response(
        JSON.stringify({ error: "Permit case not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get contact info for coordinates
    const { data: job, error: jobError } = await supabase
      .from("jobs")
      .select(`
        id,
        contact_id,
        contacts:contact_id (
          latitude,
          longitude,
          address,
          city,
          state,
          zip
        )
      `)
      .eq("id", job_id)
      .single();

    if (jobError || !job) {
      console.error("Job not found:", jobError);
      return new Response(
        JSON.stringify({ error: "Job not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const contact = job.contacts as any;
    const fullAddress = address || contact?.address || "";
    const county = permitCase.county_name || extractCountyFromAddress(fullAddress, contact?.city);

    console.log(`Fetching property data for address: ${fullAddress}, county: ${county}`);

    let parcelData = null;

    // Try to fetch from Regrid API if we have coordinates
    if (contact?.latitude && contact?.longitude) {
      const regridApiKey = Deno.env.get("REGRID_API_KEY");
      
      if (regridApiKey) {
        try {
          parcelData = await fetchFromRegrid(
            parseFloat(contact.latitude),
            parseFloat(contact.longitude),
            regridApiKey
          );
        } catch (e) {
          console.error("Regrid API error:", e);
        }
      } else {
        console.log("REGRID_API_KEY not configured - using fallback");
      }
    }

    // If no Regrid data, try to scrape from county PA
    if (!parcelData && county) {
      try {
        parcelData = await scrapeCountyPropertyAppraiser(county, fullAddress);
      } catch (e) {
        console.error("County PA scrape error:", e);
      }
    }

    // If still no data, create a placeholder
    if (!parcelData) {
      parcelData = {
        parcel_id: null,
        folio: null,
        owner_name: null,
        legal_description: null,
        subdivision: null,
        property_use: null,
        source: "manual_entry_required",
      };
    }

    // Upsert to property_parcel_cache if we have data
    if (parcelData.parcel_id) {
      const { error: cacheError } = await supabase
        .from("property_parcel_cache")
        .upsert({
          tenant_id: permitCase.tenant_id,
          job_id: job_id,
          county_name: county,
          parcel_id: parcelData.parcel_id,
          folio: parcelData.folio,
          owner_name: parcelData.owner_name,
          legal_description: parcelData.legal_description,
          subdivision: parcelData.subdivision,
          property_use: parcelData.property_use,
          source_name: parcelData.source,
          raw_json: parcelData.raw || {},
          fetched_at: new Date().toISOString(),
        }, {
          onConflict: "job_id",
        });

      if (cacheError) {
        console.error("Error caching parcel data:", cacheError);
      }
    }

    // Update permit case readiness flag
    const { error: updateError } = await supabase
      .from("permit_cases")
      .update({
        has_parcel_data: parcelData.parcel_id !== null,
      })
      .eq("id", permit_case_id);

    if (updateError) {
      console.error("Error updating permit case:", updateError);
    }

    // Log the event
    await supabase.from("permit_case_events").insert({
      permit_case_id,
      event_type: "PROPERTY_DATA_FETCHED",
      description: parcelData.parcel_id 
        ? `Property data fetched: Parcel ${parcelData.parcel_id}`
        : "Property data lookup completed - manual entry required",
      metadata: {
        county,
        parcel_id: parcelData.parcel_id,
        source: parcelData.source,
        has_data: parcelData.parcel_id !== null,
      },
    });

    return new Response(
      JSON.stringify({
        success: true,
        parcel: parcelData.parcel_id ? {
          parcel_id: parcelData.parcel_id,
          folio: parcelData.folio,
          owner_name: parcelData.owner_name,
          legal_description: parcelData.legal_description,
          subdivision: parcelData.subdivision,
        } : null,
        message: parcelData.parcel_id 
          ? "Property data fetched successfully"
          : "No property data found - manual entry required",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Unexpected error:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

// Fetch parcel data from Regrid API
async function fetchFromRegrid(lat: number, lng: number, apiKey: string) {
  const url = `https://app.regrid.com/api/v2/parcels/point?lat=${lat}&lon=${lng}&token=${apiKey}`;
  
  console.log(`Calling Regrid API for coordinates: ${lat}, ${lng}`);
  
  const response = await fetch(url);
  
  if (!response.ok) {
    throw new Error(`Regrid API error: ${response.status}`);
  }
  
  const data = await response.json();
  
  if (!data.results || data.results.length === 0) {
    return null;
  }
  
  const parcel = data.results[0].properties;
  
  return {
    parcel_id: parcel.parcelnumb || parcel.apn,
    folio: parcel.parcelnumb,
    owner_name: parcel.owner,
    legal_description: parcel.legaldesc,
    subdivision: parcel.subdivisio,
    property_use: parcel.usedesc,
    source: "regrid",
    raw: parcel,
  };
}

// Scrape property data from county property appraiser
async function scrapeCountyPropertyAppraiser(county: string, address: string) {
  // This is a placeholder for county-specific scrapers
  // Each county has a different website and scraping method
  
  const countyLower = county.toLowerCase();
  
  // For now, return null - individual county scrapers can be added later
  console.log(`County scraper not implemented for: ${county}`);
  
  // Future implementation examples:
  // if (countyLower === "sarasota") return scrapeSarasotaPA(address);
  // if (countyLower === "manatee") return scrapeManateePA(address);
  // if (countyLower === "charlotte") return scrapeCharlottePA(address);
  
  return null;
}

// Helper function to extract county from address
function extractCountyFromAddress(address: string | null, city: string | null): string | null {
  if (!address && !city) return null;
  
  // Common Florida county/city mappings
  const cityToCounty: Record<string, string> = {
    "sarasota": "Sarasota",
    "venice": "Sarasota",
    "north port": "Sarasota",
    "bradenton": "Manatee",
    "palmetto": "Manatee",
    "lakewood ranch": "Manatee",
    "punta gorda": "Charlotte",
    "port charlotte": "Charlotte",
    "englewood": "Charlotte",
    "cape coral": "Lee",
    "fort myers": "Lee",
    "naples": "Collier",
    "marco island": "Collier",
    "tampa": "Hillsborough",
    "clearwater": "Pinellas",
    "st. petersburg": "Pinellas",
    "orlando": "Orange",
    "miami": "Miami-Dade",
    "fort lauderdale": "Broward",
    "west palm beach": "Palm Beach",
  };

  const cityLower = (city || "").toLowerCase().trim();
  if (cityToCounty[cityLower]) {
    return cityToCounty[cityLower];
  }

  // Try to find county in address string
  const addressLower = (address || "").toLowerCase();
  for (const [c, county] of Object.entries(cityToCounty)) {
    if (addressLower.includes(c)) {
      return county;
    }
  }

  return null;
}