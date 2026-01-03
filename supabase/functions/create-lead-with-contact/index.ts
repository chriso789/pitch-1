import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface LeadRequest {
  name: string;
  phone: string;
  email?: string;
  address: string;
  description?: string;
  roofAge: string;
  roofType: string;
  status: string;
  priority: string;
  estimatedValue?: string;
  salesReps: string[];
  selectedAddress?: {
    place_id: string;
    formatted_address: string;
    geometry: { location: { lat: number; lng: number } };
    address_components: any[];
  };
  existingContactId?: string;
}

// Parse address string into components
function parseAddressString(address: string): {
  street: string;
  city: string;
  state: string;
  zip: string;
} {
  console.log("[parseAddressString] Parsing:", address);
  
  // Common US address patterns
  // "123 Main St, City, ST 12345"
  // "123 Main Street, City, State 12345"
  // "123 Main St, City, ST"
  
  const result = { street: "", city: "", state: "", zip: "" };
  
  if (!address) return result;

  // Try to extract zip code first (5 digits or 5-4 format)
  const zipMatch = address.match(/\b(\d{5}(-\d{4})?)\b/);
  if (zipMatch) {
    result.zip = zipMatch[1];
    address = address.replace(zipMatch[0], "").trim();
  }

  // Split by comma
  const parts = address.split(",").map(p => p.trim()).filter(Boolean);
  
  if (parts.length >= 3) {
    // Format: "Street, City, State"
    result.street = parts[0];
    result.city = parts[1];
    // State might have zip attached
    const stateStr = parts[2].replace(/\d+/g, "").trim();
    result.state = stateStr.split(" ")[0]; // Get first word (state abbrev)
  } else if (parts.length === 2) {
    // Format: "Street, City State Zip" or "Street, City"
    result.street = parts[0];
    const cityStatePart = parts[1];
    
    // Try to find state abbreviation (2 uppercase letters)
    const stateMatch = cityStatePart.match(/\b([A-Z]{2})\b/);
    if (stateMatch) {
      result.state = stateMatch[1];
      result.city = cityStatePart.substring(0, cityStatePart.indexOf(stateMatch[1])).trim();
    } else {
      result.city = cityStatePart.replace(/\d+/g, "").trim();
    }
  } else if (parts.length === 1) {
    // Just one part - assume it's the street
    result.street = parts[0];
  }

  console.log("[parseAddressString] Result:", result);
  return result;
}

// Extract address components from Google Maps response
function extractAddressComponents(components: any[]): {
  street: string;
  city: string;
  state: string;
  zip: string;
} {
  const streetNumber = components?.find((c: any) => c.types?.includes("street_number"))?.long_name || "";
  const route = components?.find((c: any) => c.types?.includes("route"))?.long_name || "";
  const city = components?.find((c: any) => c.types?.includes("locality"))?.long_name || "";
  const state = components?.find((c: any) => c.types?.includes("administrative_area_level_1"))?.short_name || "";
  const zip = components?.find((c: any) => c.types?.includes("postal_code"))?.long_name || "";

  return {
    street: `${streetNumber} ${route}`.trim(),
    city,
    state,
    zip,
  };
}

serve(async (req: Request) => {
  console.log("[create-lead-with-contact] Request received");
  
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      throw new Error("No authorization header");
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Verify the user
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      console.error("[create-lead-with-contact] Auth error:", authError);
      throw new Error("Unauthorized");
    }

    console.log("[create-lead-with-contact] User authenticated:", user.id);

    // Get user profile for tenant_id
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("tenant_id, active_tenant_id, first_name, last_name")
      .eq("id", user.id)
      .single();

    if (profileError || !profile) {
      console.error("[create-lead-with-contact] Profile error:", profileError);
      throw new Error("User profile not found");
    }

    const tenantId = profile.active_tenant_id || profile.tenant_id;
    console.log("[create-lead-with-contact] Tenant ID:", tenantId);

    const body: LeadRequest = await req.json();
    console.log("[create-lead-with-contact] Request body:", JSON.stringify(body, null, 2));

    let contactId = body.existingContactId;
    let addressComponents: { street: string; city: string; state: string; zip: string };
    let latitude: number | null = null;
    let longitude: number | null = null;

    // Parse address - prefer Google Maps data if available
    if (body.selectedAddress?.address_components?.length > 0) {
      console.log("[create-lead-with-contact] Using Google Maps verified address");
      addressComponents = extractAddressComponents(body.selectedAddress.address_components);
      latitude = body.selectedAddress.geometry?.location?.lat || null;
      longitude = body.selectedAddress.geometry?.location?.lng || null;
    } else {
      console.log("[create-lead-with-contact] Parsing manual address");
      addressComponents = parseAddressString(body.address);
      
      // Try to geocode the address if we have Google Maps API
      const googleMapsKey = Deno.env.get("GOOGLE_MAPS_API_KEY");
      if (googleMapsKey && body.address) {
        try {
          console.log("[create-lead-with-contact] Attempting geocoding...");
          const geocodeUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(body.address)}&key=${googleMapsKey}`;
          const geocodeResponse = await fetch(geocodeUrl);
          const geocodeData = await geocodeResponse.json();
          
          if (geocodeData.status === "OK" && geocodeData.results?.[0]) {
            const result = geocodeData.results[0];
            latitude = result.geometry?.location?.lat || null;
            longitude = result.geometry?.location?.lng || null;
            
            // Update address components from geocode result
            if (result.address_components?.length > 0) {
              addressComponents = extractAddressComponents(result.address_components);
            }
            console.log("[create-lead-with-contact] Geocoding successful:", { latitude, longitude });
          } else {
            console.log("[create-lead-with-contact] Geocoding returned no results");
          }
        } catch (geocodeError) {
          console.error("[create-lead-with-contact] Geocoding failed:", geocodeError);
          // Continue without geocoding - address text will still be saved
        }
      }
    }

    console.log("[create-lead-with-contact] Address components:", addressComponents);

    // Create contact if not provided
    if (!contactId) {
      console.log("[create-lead-with-contact] Creating new contact...");
      
      // Check for existing contact at same address to prevent duplicates
      if (addressComponents.street) {
        const { data: existingContact } = await supabase
          .from("contacts")
          .select("id, first_name, last_name")
          .eq("tenant_id", tenantId)
          .eq("address_street", addressComponents.street)
          .maybeSingle();

        if (existingContact) {
          console.log("[create-lead-with-contact] Found existing contact:", existingContact.id);
          contactId = existingContact.id;
        }
      }

      if (!contactId) {
        // Parse name into first/last
        const nameParts = body.name.split(" ");
        const firstName = nameParts[0] || "Unknown";
        const lastName = nameParts.slice(1).join(" ") || "Contact";

        const contactData: any = {
          tenant_id: tenantId,
          first_name: firstName,
          last_name: lastName,
          phone: body.phone || null,
          email: body.email || null,
          address_street: addressComponents.street || body.address,
          address_city: addressComponents.city || null,
          address_state: addressComponents.state || null,
          address_zip: addressComponents.zip || null,
          latitude: latitude,
          longitude: longitude,
          type: "homeowner",
          created_by: user.id,
        };

        console.log("[create-lead-with-contact] Creating contact with data:", contactData);

        const { data: newContact, error: contactError } = await supabase
          .from("contacts")
          .insert(contactData)
          .select()
          .single();

        if (contactError) {
          console.error("[create-lead-with-contact] Contact creation error:", contactError);
          throw new Error(`Failed to create contact: ${contactError.message}`);
        }

        contactId = newContact.id;
        console.log("[create-lead-with-contact] Contact created:", contactId);
      }
    }

    // Create pipeline entry (lead)
    const pipelineData: any = {
      tenant_id: tenantId,
      contact_id: contactId,
      status: body.status || "lead",
      priority: body.priority || "medium",
      estimated_value: body.estimatedValue ? parseFloat(body.estimatedValue) : null,
      roof_type: body.roofType || null,
      assigned_to: body.salesReps?.[0] || user.id,
      notes: body.description || null,
      created_by: user.id,
      metadata: {
        verified_address: body.selectedAddress || null,
        secondary_reps: body.salesReps?.slice(1) || [],
        roof_age_years: parseInt(body.roofAge) || null,
        roof_type: body.roofType,
        created_via: "create-lead-with-contact",
      },
    };

    console.log("[create-lead-with-contact] Creating pipeline entry...");

    const { data: pipelineEntry, error: pipelineError } = await supabase
      .from("pipeline_entries")
      .insert([pipelineData])
      .select(`
        *,
        contacts (*)
      `)
      .single();

    if (pipelineError) {
      console.error("[create-lead-with-contact] Pipeline creation error:", pipelineError);
      throw new Error(`Failed to create lead: ${pipelineError.message}`);
    }

    console.log("[create-lead-with-contact] Lead created successfully:", pipelineEntry.id);

    return new Response(
      JSON.stringify({
        success: true,
        lead: pipelineEntry,
        contactId: contactId,
        message: "Lead created successfully",
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error) {
    console.error("[create-lead-with-contact] Error:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || "An unexpected error occurred",
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      }
    );
  }
});
