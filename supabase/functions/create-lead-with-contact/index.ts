import { createClient } from "npm:@supabase/supabase-js@2.49.1";
import {
  errorResponse,
  isPlaceholderPhone,
  mapLeadSource,
  mapRoofType,
  mapStatus,
  normalizeEmail,
  normalizePhone,
  type StructuredError,
} from "./_helpers.ts";


const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-idempotency-key",
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
  leadSource?: string;
  salesReps: string[];
  forceDuplicate?: boolean;
  selectedAddress?: {
    place_id: string;
    formatted_address: string;
    geometry: { location: { lat: number; lng: number } };
    address_components: any[];
  };
  existingContactId?: string;
  locationId?: string; // Location ID from the location switcher
  idempotencyKey?: string;
}

async function sha256Hex(input: string): Promise<string> {
  const buf = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
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

Deno.serve(async (req: Request) => {
  console.log("[create-lead-with-contact] Request received");
  
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return errorResponse(
        { code: "unauthorized", message: "Missing Authorization header." },
        401,
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Verify the user
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      console.error("[create-lead-with-contact] Auth error:", authError);
      return errorResponse(
        { code: "unauthorized", message: "Invalid or expired session. Please sign in again." },
        401,
      );
    }

    console.log("[create-lead-with-contact] User authenticated:", user.id);

    // Get user profile for tenant_id and active_location_id
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("tenant_id, active_tenant_id, active_location_id, first_name, last_name")
      .eq("id", user.id)
      .single();

    if (profileError || !profile) {
      console.error("[create-lead-with-contact] Profile error:", profileError);
      return errorResponse(
        { code: "profile_not_found", message: "Your user profile could not be loaded. Contact support." },
        404,
      );
    }

    const tenantId = profile.active_tenant_id || profile.tenant_id;
    console.log("[create-lead-with-contact] Tenant ID:", tenantId);

    const body: LeadRequest = await req.json();
    console.log("[create-lead-with-contact] Request body:", JSON.stringify(body, null, 2));

    // Server-side validation: require name
    if (!body.name?.trim() && !body.existingContactId) {
      return errorResponse({
        code: "validation_error",
        field: "name",
        message: "Name is required to create a lead.",
      });
    }

    // Server-side validation: require address
    if (!body.address?.trim() && !body.selectedAddress && !body.existingContactId) {
      return errorResponse({
        code: "validation_error",
        field: "address",
        message: "A verified address is required to create a lead.",
      });
    }

    // -------------- IDEMPOTENCY --------------
    // Accept idempotency key from header or body. If we've already processed this
    // exact request for this tenant, replay the prior response.
    const idempotencyKey =
      req.headers.get("x-idempotency-key") || body.idempotencyKey || null;
    const requestHash = await sha256Hex(
      JSON.stringify({
        tenant: tenantId,
        name: body.name?.trim().toLowerCase() || null,
        phone: normalizePhone(body.phone),
        email: normalizeEmail(body.email),
        address: (body.selectedAddress?.formatted_address || body.address || "")
          .trim()
          .toLowerCase(),
      }),
    );

    if (idempotencyKey) {
      const { data: existingKey } = await supabase
        .from("idempotency_keys")
        .select("response_data, status_code, request_hash, expires_at")
        .eq("tenant_id", tenantId)
        .eq("key", idempotencyKey)
        .maybeSingle();

      if (existingKey) {
        const expired = existingKey.expires_at
          ? new Date(existingKey.expires_at).getTime() < Date.now()
          : false;
        if (!expired) {
          if (existingKey.request_hash && existingKey.request_hash !== requestHash) {
            return errorResponse({
              code: "idempotency_key_conflict",
              message:
                "This idempotency key was already used with a different request body.",
            }, 409);
          }
          if (existingKey.response_data) {
            console.log("[create-lead-with-contact] Idempotency replay for key:", idempotencyKey);
            return new Response(JSON.stringify(existingKey.response_data), {
              status: existingKey.status_code || 200,
              headers: { ...corsHeaders, "Content-Type": "application/json", "x-idempotent-replay": "true" },
            });
          }
        }
      }
    }



    // PRIORITY: Use locationId from request (client's current location switcher selection)
    // Then fall back to profile's active_location_id, then find a default
    let locationId = body.locationId || profile.active_location_id;
    
    if (!locationId) {
      console.log("[create-lead-with-contact] No locationId provided, searching for fallback...");
      
      // Try to find the primary location for the tenant
      const { data: primaryLocation } = await supabase
        .from("locations")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("is_primary", true)
        .maybeSingle();
      
      if (primaryLocation) {
        locationId = primaryLocation.id;
        console.log("[create-lead-with-contact] Using primary location:", locationId);
      } else {
        // Check for any active location in the tenant
        const { data: anyLocation } = await supabase
          .from("locations")
          .select("id")
          .eq("tenant_id", tenantId)
          .eq("is_active", true)
          .limit(1)
          .maybeSingle();
        
        if (anyLocation) {
          locationId = anyLocation.id;
          console.log("[create-lead-with-contact] Using first active location:", locationId);
        } else {
          // Create a default location if none exists
          console.log("[create-lead-with-contact] No locations found, creating default...");
          const { data: newLocation, error: locationError } = await supabase
            .from("locations")
            .insert({
              tenant_id: tenantId,
              name: "Main Office",
              is_primary: true,
              is_active: true,
              created_by: user.id,
            })
            .select("id")
            .single();
          
          if (newLocation) {
            locationId = newLocation.id;
            console.log("[create-lead-with-contact] Created default location:", locationId);
          } else {
            console.error("[create-lead-with-contact] Failed to create location:", locationError);
          }
        }
      }
    } else {
      console.log("[create-lead-with-contact] Using provided locationId:", locationId);
    }

    let contactId = body.existingContactId;
    let addressComponents: { street: string; city: string; state: string; zip: string };
    let latitude: number | null = null;
    let longitude: number | null = null;

    // If using an existing contact, update its assigned_to and verified_address if available
    if (contactId) {
      const contactUpdate: any = {};
      if (body.salesReps?.[0]) {
        contactUpdate.assigned_to = body.salesReps[0];
      }
      if (body.selectedAddress) {
        contactUpdate.verified_address = {
          formatted_address: body.selectedAddress.formatted_address,
          place_id: body.selectedAddress.place_id,
          lat: body.selectedAddress.geometry?.location?.lat || null,
          lng: body.selectedAddress.geometry?.location?.lng || null,
          geometry: body.selectedAddress.geometry,
          address_components: body.selectedAddress.address_components
        };
      }
      if (Object.keys(contactUpdate).length > 0) {
        console.log("[create-lead-with-contact] Updating existing contact:", Object.keys(contactUpdate));
        const { error: updateError } = await supabase
          .from("contacts")
          .update(contactUpdate)
          .eq("id", contactId);
        if (updateError) {
          console.error("[create-lead-with-contact] Failed to update contact:", updateError);
        }
      }
    }

    // Parse address - prefer Google Maps data if available
    if (body.selectedAddress && (body.selectedAddress.address_components?.length ?? 0) > 0) {
      console.log("[create-lead-with-contact] Using Google Maps verified address");
      addressComponents = extractAddressComponents(body.selectedAddress.address_components!);
      latitude = body.selectedAddress.geometry?.location?.lat ?? null;
      longitude = body.selectedAddress.geometry?.location?.lng ?? null;
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
      console.log("[create-lead-with-contact] Checking for existing contact...");

      const normalizedPhone = isPlaceholderPhone(body.phone) ? null : normalizePhone(body.phone);
      const normalizedEmail = normalizeEmail(body.email);


      // --- DEDUP TIER 1: exact phone or email match within tenant ---
      if (normalizedPhone || normalizedEmail) {
        const filters: string[] = [];
        if (normalizedPhone) filters.push(`phone.ilike.%${normalizedPhone}`);
        if (normalizedEmail) filters.push(`email.eq.${normalizedEmail}`);

        const { data: contactMatch } = await supabase
          .from("contacts")
          .select("id, first_name, last_name, address_street, email, phone, location_id")
          .eq("tenant_id", tenantId)
          .eq("is_deleted", false)
          .or(filters.join(","))
          .limit(5);

        const duplicate = contactMatch?.find((c) => {
          const cPhone = normalizePhone(c.phone);
          const cEmail = normalizeEmail(c.email);
          return (
            (normalizedPhone && cPhone === normalizedPhone) ||
            (normalizedEmail && cEmail === normalizedEmail)
          );
        });

        if (duplicate && !body.forceDuplicate) {
          console.log("[create-lead-with-contact] Phone/email duplicate detected:", duplicate.id);
          const matchedOn = normalizedPhone && normalizePhone(duplicate.phone) === normalizedPhone
            ? "phone"
            : "email";
          return errorResponse({
            code: "duplicate_contact",
            field: matchedOn,
            message: `A contact with this ${matchedOn} already exists. Re-submit with forceDuplicate=true to attach a new lead to this contact.`,
            details: { existingContact: duplicate, matchedOn },
          }, 409);
        }
        if (duplicate && body.forceDuplicate) {
          contactId = duplicate.id;
          console.log("[create-lead-with-contact] Force duplicate (phone/email): reusing contact", contactId);
        }
      }

      // --- DEDUP TIER 2: name + street address ---
      if (!contactId && body.name) {
        const nameParts = body.name.split(" ");
        const firstName = nameParts[0] || "";
        const lastName = nameParts.slice(1).join(" ") || "";

        if (firstName && addressComponents.street) {
          const { data: nameAddrMatch } = await supabase
            .from("contacts")
            .select("id, first_name, last_name, address_street, location_id")
            .eq("tenant_id", tenantId)
            .eq("is_deleted", false)
            .ilike("first_name", firstName)
            .ilike("last_name", lastName)
            .limit(5);

          const normalizedStreet = addressComponents.street.toLowerCase().trim();
          const duplicate = nameAddrMatch?.find((c) =>
            c.address_street?.toLowerCase().trim() === normalizedStreet
          );

          if (duplicate && !body.forceDuplicate) {
            console.log("[create-lead-with-contact] Name+address duplicate detected:", duplicate.id);
            return errorResponse({
              code: "duplicate_contact",
              field: "address",
              message: `A contact named "${firstName} ${lastName}" already exists at this address.`,
              details: { existingContact: duplicate, matchedOn: "name_address" },
            }, 409);
          } else if (duplicate && body.forceDuplicate) {
            contactId = duplicate.id;
            console.log("[create-lead-with-contact] Force duplicate (name+addr): reusing contact", contactId);
          }
        }
      }


      if (!contactId) {
        // Parse name into first/last
        const nameParts = body.name.split(" ");
        const firstName = nameParts[0] || "Unknown";
        const lastName = nameParts.slice(1).join(" ") || "";

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
          lead_source: body.leadSource || null,
          created_by: user.id,
          assigned_to: body.salesReps?.[0] || null,
          location_id: locationId,
          notes: body.description || null,
          verified_address: body.selectedAddress ? {
            formatted_address: body.selectedAddress.formatted_address,
            place_id: body.selectedAddress.place_id,
            lat: body.selectedAddress.geometry?.location?.lat || latitude,
            lng: body.selectedAddress.geometry?.location?.lng || longitude,
            geometry: body.selectedAddress.geometry,
            address_components: body.selectedAddress.address_components
          } : null,
          metadata: {
            roof_age_years: parseInt(body.roofAge) || null,
            roof_type: body.roofType || null,
            created_via: "create-lead-with-contact",
          },
        };

        console.log("[create-lead-with-contact] Creating contact with data:", contactData);

        const { data: newContact, error: contactError } = await supabase
          .from("contacts")
          .insert(contactData)
          .select()
          .single();

        if (contactError) {
          console.error("[create-lead-with-contact] Contact creation error:", contactError);
          return errorResponse({
            code: "contact_insert_failed",
            field: "contact",
            message: "Could not save contact. Check name, phone, and address fields.",
            details: { db_message: contactError.message, db_code: (contactError as any).code },
          }, 422);
        }

        contactId = newContact.id;
        console.log("[create-lead-with-contact] Contact created:", contactId);
      }
    }



    // Create pipeline entry (lead)
    const pipelineData: any = {
      tenant_id: tenantId,
      contact_id: contactId,
      location_id: locationId,
      lead_name: body.name || null,
      status: mapStatus(body.status),
      priority: body.priority || "medium",
      estimated_value: body.estimatedValue ? parseFloat(body.estimatedValue) : null,
      roof_type: mapRoofType(body.roofType),
      source: mapLeadSource(body.leadSource),
      assigned_to: body.salesReps?.[0] || user.id,
      notes: body.description || null,
      created_by: user.id,
      metadata: {
        verified_address: body.selectedAddress ? {
          ...body.selectedAddress,
          lat: body.selectedAddress.geometry?.location?.lat || latitude,
          lng: body.selectedAddress.geometry?.location?.lng || longitude,
        } : null,
        secondary_reps: body.salesReps?.slice(1) || [],
        roof_age_years: parseInt(body.roofAge) || null,
        roof_type_raw: body.roofType || null,
        lead_source_id: body.leadSource || null,
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
      return errorResponse({
        code: "pipeline_insert_failed",
        field: "lead",
        message: "Could not save lead. Check status, roof type, and source values.",
        details: {
          db_message: pipelineError.message,
          db_code: (pipelineError as any).code,
          attempted: {
            status: pipelineData.status,
            roof_type: pipelineData.roof_type,
            source: pipelineData.source,
          },
        },
      }, 422);
    }

    console.log("[create-lead-with-contact] Lead created successfully:", pipelineEntry.id);

    // Fire Meta CAPI "Lead" event (fire-and-forget)
    try {
      const metaCapiUrl = `${supabaseUrl}/functions/v1/meta-capi`;
      fetch(metaCapiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${supabaseKey}`,
        },
        body: JSON.stringify({
          event_name: 'Lead',
          tenant_id: tenantId,
          contact_id: contactId,
          event_time: Math.floor(Date.now() / 1000),
          email: body.email,
          phone: body.phone,
          custom_data: {
            event_source: 'crm',
            lead_event_source: 'PITCH CRM',
            value: body.estimatedValue ? parseFloat(body.estimatedValue) : 0,
            currency: 'USD',
            pipeline_entry_id: pipelineEntry.id,
          },
        }),
      }).catch(e => console.warn('[create-lead-with-contact] CAPI fire-and-forget error:', e));
    } catch (capiErr) {
      console.warn('[create-lead-with-contact] CAPI error (non-fatal):', capiErr);
    }

    const successPayload = {
      success: true,
      lead: pipelineEntry,
      contactId: contactId,
      message: "Lead created successfully",
    };

    // Persist idempotency record (24h TTL) so retries replay this response
    if (idempotencyKey) {
      try {
        await supabase
          .from("idempotency_keys")
          .upsert({
            tenant_id: tenantId,
            key: idempotencyKey,
            request_hash: requestHash,
            response_data: successPayload,
            status_code: 200,
            expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          }, { onConflict: "tenant_id,key" });
      } catch (idemErr) {
        console.warn("[create-lead-with-contact] Failed to store idempotency record:", idemErr);
      }
    }

    return new Response(JSON.stringify(successPayload), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    console.error("[create-lead-with-contact] Unhandled error:", error);
    const message = error instanceof Error ? error.message : String(error);
    const structured: StructuredError = {
      code: "internal_error",
      message: message || "An unexpected error occurred.",
    };
    return errorResponse(structured, 500);
  }
});

