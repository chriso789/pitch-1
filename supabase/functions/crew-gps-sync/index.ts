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
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "No authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { crew_id, latitude, longitude, accuracy, heading, speed } = await req.json();

    // Get user's tenant
    const { data: userProfile } = await supabase
      .from("profiles")
      .select("tenant_id")
      .eq("id", user.id)
      .single();

    const tenantId = userProfile?.tenant_id;
    if (!tenantId) {
      return new Response(JSON.stringify({ error: "Tenant not found" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Mark previous locations as inactive
    await supabase
      .from("crew_locations")
      .update({ is_active: false })
      .eq("crew_id", crew_id)
      .eq("is_active", true);

    // Insert new location
    const { data: location, error: insertError } = await supabase
      .from("crew_locations")
      .insert({
        tenant_id: tenantId,
        crew_id,
        user_id: user.id,
        latitude,
        longitude,
        accuracy,
        heading,
        speed,
        is_active: true,
      })
      .select()
      .single();

    if (insertError) {
      throw insertError;
    }

    // Check for geofence arrivals - find assignments within 100m
    const today = new Date().toISOString().split('T')[0];
    const { data: assignments } = await supabase
      .from("crew_assignments")
      .select("*")
      .eq("crew_id", crew_id)
      .eq("assignment_date", today)
      .in("status", ["assigned", "en_route"]);

    let arrivedAt = null;
    if (assignments) {
      for (const assignment of assignments) {
        if (assignment.latitude && assignment.longitude) {
          const distance = calculateDistance(
            latitude,
            longitude,
            assignment.latitude,
            assignment.longitude
          );

          // Within 100 meters = arrived
          if (distance <= 0.1) { // 0.1 km = 100m
            await supabase
              .from("crew_assignments")
              .update({
                status: "on_site",
                arrival_time: new Date().toISOString(),
              })
              .eq("id", assignment.id);

            arrivedAt = {
              assignment_id: assignment.id,
              job_id: assignment.job_id,
              arrival_time: new Date().toISOString(),
            };
            break;
          }
        }
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        location,
        arrived_at: arrivedAt,
        message: arrivedAt 
          ? `Arrived at job site (Assignment: ${arrivedAt.assignment_id})`
          : "Location updated",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in crew-gps-sync:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Earth's radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}
