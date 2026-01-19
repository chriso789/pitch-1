import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as turf from "https://esm.sh/@turf/turf@7.1.0";

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

    const { permit_case_id, job_id } = await req.json();

    if (!permit_case_id || !job_id) {
      return new Response(
        JSON.stringify({ error: "permit_case_id and job_id are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get the permit case to find the tenant_id
    const { data: permitCase, error: permitCaseError } = await supabase
      .from("permit_cases")
      .select("tenant_id")
      .eq("id", permit_case_id)
      .single();

    if (permitCaseError || !permitCase) {
      console.error("Permit case not found:", permitCaseError);
      return new Response(
        JSON.stringify({ error: "Permit case not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get the job details to find the contact and coordinates
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
    if (!contact?.latitude || !contact?.longitude) {
      // Try to get coordinates from address using geocoding if available
      console.log("No coordinates found for contact, address:", contact?.address);
      return new Response(
        JSON.stringify({ 
          error: "No coordinates available for property",
          message: "Please geocode the address first"
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const longitude = parseFloat(contact.longitude);
    const latitude = parseFloat(contact.latitude);

    console.log(`Looking up jurisdiction for coordinates: ${latitude}, ${longitude}`);

    // Get all active permitting authorities for this tenant
    const { data: authorities, error: authError } = await supabase
      .from("permitting_authorities")
      .select("*")
      .eq("tenant_id", permitCase.tenant_id)
      .eq("is_active", true);

    if (authError) {
      console.error("Error fetching authorities:", authError);
      return new Response(
        JSON.stringify({ error: "Failed to fetch permitting authorities" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Found ${authorities?.length || 0} active permitting authorities`);

    // Create a point from the coordinates
    const point = turf.point([longitude, latitude]);

    let matchedAuthority = null;
    let jurisdictionType = "COUNTY"; // Default to county

    // First, try to match against city boundaries
    for (const auth of authorities || []) {
      if (auth.boundary_geojson && auth.jurisdiction_type === "CITY") {
        try {
          // Handle both Polygon and MultiPolygon geometries
          let polygon;
          if (auth.boundary_geojson.type === "MultiPolygon") {
            polygon = turf.multiPolygon(auth.boundary_geojson.coordinates);
          } else if (auth.boundary_geojson.type === "Polygon") {
            polygon = turf.polygon(auth.boundary_geojson.coordinates);
          } else if (auth.boundary_geojson.coordinates) {
            // Try as polygon if just coordinates
            polygon = turf.polygon(auth.boundary_geojson.coordinates);
          } else {
            console.log(`Skipping authority ${auth.name} - invalid boundary format`);
            continue;
          }

          if (turf.booleanPointInPolygon(point, polygon)) {
            matchedAuthority = auth;
            jurisdictionType = "CITY";
            console.log(`Matched city: ${auth.name}`);
            break;
          }
        } catch (e) {
          console.error(`Error checking boundary for ${auth.name}:`, e);
        }
      }
    }

    // If no city match, try to find county based on the address
    if (!matchedAuthority) {
      // Extract county from address if available or use state-level lookup
      const addressParts = (contact.address || "").split(",");
      const countyFromAddress = extractCountyFromAddress(contact.address, contact.city);
      
      console.log(`No city match, looking for county: ${countyFromAddress}`);

      // Find county authority
      matchedAuthority = authorities?.find(a => 
        a.jurisdiction_type === "COUNTY" && 
        a.county_name?.toLowerCase() === countyFromAddress?.toLowerCase()
      );

      if (matchedAuthority) {
        console.log(`Matched county: ${matchedAuthority.name}`);
      }
    }

    // Update the permit case with jurisdiction info
    const updateData: any = {
      jurisdiction_type: jurisdictionType,
    };

    if (matchedAuthority) {
      updateData.authority_id = matchedAuthority.id;
      updateData.county_name = matchedAuthority.county_name;
      updateData.city_name = matchedAuthority.city_name;
    }

    const { error: updateError } = await supabase
      .from("permit_cases")
      .update(updateData)
      .eq("id", permit_case_id);

    if (updateError) {
      console.error("Error updating permit case:", updateError);
      return new Response(
        JSON.stringify({ error: "Failed to update permit case" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Log the event
    await supabase.from("permit_case_events").insert({
      permit_case_id,
      event_type: "JURISDICTION_DETECTED",
      description: matchedAuthority 
        ? `Jurisdiction detected: ${matchedAuthority.name} (${jurisdictionType})`
        : `Jurisdiction type set to ${jurisdictionType} - no matching authority found`,
      metadata: {
        coordinates: { latitude, longitude },
        authority_id: matchedAuthority?.id,
        authority_name: matchedAuthority?.name,
        jurisdiction_type: jurisdictionType,
      },
    });

    return new Response(
      JSON.stringify({
        success: true,
        authority: matchedAuthority ? {
          id: matchedAuthority.id,
          name: matchedAuthority.name,
          type: jurisdictionType,
          portal_type: matchedAuthority.portal_type,
          portal_url: matchedAuthority.portal_url,
        } : null,
        jurisdiction_type: jurisdictionType,
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