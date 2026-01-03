import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface SchedulingRequest {
  contact_id: string;
  canvasser_id?: string;
  appointment_type: string;
  preferred_dates?: string[];
  homeowner_preferences?: {
    preferred_time?: 'morning' | 'afternoon' | 'evening';
    avoid_days?: string[];
    notes?: string;
  };
  canvasser_location?: { lat: number; lng: number };
}

interface TimeSlot {
  start: string;
  end: string;
  score: number;
  factors: {
    weather: number;
    travel: number;
    preference: number;
    availability: number;
  };
  weather_summary?: string;
  travel_time_minutes?: number;
}

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

    const request: SchedulingRequest = await req.json();
    const { contact_id, canvasser_id, appointment_type, preferred_dates, homeowner_preferences, canvasser_location } = request;

    // Get contact details
    const { data: contact } = await supabase
      .from("contacts")
      .select("*, addresses(*)")
      .eq("id", contact_id)
      .single();

    if (!contact) {
      return new Response(JSON.stringify({ error: "Contact not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get canvasser profile
    const assigneeId = canvasser_id || user.id;
    const { data: canvasser } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", assigneeId)
      .single();

    // Get tenant ID from profile
    const { data: userProfile } = await supabase
      .from("profiles")
      .select("tenant_id")
      .eq("id", user.id)
      .single();

    const tenantId = userProfile?.tenant_id;

    // Get existing appointments for the canvasser in the next 7 days
    const startDate = new Date();
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + 7);

    const { data: existingAppointments } = await supabase
      .from("appointments")
      .select("*")
      .eq("assigned_to", assigneeId)
      .gte("scheduled_start", startDate.toISOString())
      .lte("scheduled_start", endDate.toISOString())
      .neq("status", "cancelled");

    // Generate time slots for the next 7 days
    const suggestedSlots: TimeSlot[] = [];
    const datesToCheck = preferred_dates?.length ? preferred_dates : [];

    // If no preferred dates, generate for next 7 days
    if (!datesToCheck.length) {
      for (let i = 1; i <= 7; i++) {
        const date = new Date();
        date.setDate(date.getDate() + i);
        datesToCheck.push(date.toISOString().split('T')[0]);
      }
    }

    // Time slot definitions
    const timeSlots = [
      { label: 'morning', start: '09:00', end: '11:00', preference_score: 0.8 },
      { label: 'late_morning', start: '11:00', end: '13:00', preference_score: 0.7 },
      { label: 'afternoon', start: '14:00', end: '16:00', preference_score: 0.9 },
      { label: 'late_afternoon', start: '16:00', end: '18:00', preference_score: 0.7 },
    ];

    for (const dateStr of datesToCheck) {
      const dayOfWeek = new Date(dateStr).getDay();
      
      // Skip weekends unless preferred
      if (dayOfWeek === 0 || dayOfWeek === 6) {
        continue;
      }

      for (const slot of timeSlots) {
        const slotStart = new Date(`${dateStr}T${slot.start}:00`);
        const slotEnd = new Date(`${dateStr}T${slot.end}:00`);

        // Check for conflicts with existing appointments
        const hasConflict = existingAppointments?.some(apt => {
          const aptStart = new Date(apt.scheduled_start);
          const aptEnd = new Date(apt.scheduled_end);
          return (slotStart < aptEnd && slotEnd > aptStart);
        });

        if (hasConflict) continue;

        // Calculate scores
        let weatherScore = 0.8; // Default good weather
        let travelScore = 0.7; // Default moderate travel
        let preferenceScore = slot.preference_score;
        let availabilityScore = 1.0;

        // Adjust for homeowner preferences
        if (homeowner_preferences?.preferred_time) {
          if (slot.label.includes(homeowner_preferences.preferred_time)) {
            preferenceScore = 1.0;
          } else {
            preferenceScore *= 0.6;
          }
        }

        // Calculate travel time if locations available
        let travelTimeMinutes = 30; // Default
        if (canvasser_location && contact.addresses?.[0]) {
          const contactAddress = contact.addresses[0];
          if (contactAddress.latitude && contactAddress.longitude) {
            // Estimate travel time based on distance (simplified)
            const distance = calculateDistance(
              canvasser_location.lat,
              canvasser_location.lng,
              contactAddress.latitude,
              contactAddress.longitude
            );
            travelTimeMinutes = Math.round(distance * 2); // Rough estimate: 2 min per km
            travelScore = travelTimeMinutes < 20 ? 1.0 : travelTimeMinutes < 40 ? 0.7 : 0.4;
          }
        }

        // Overall score (weighted average)
        const overallScore = Math.round(
          (weatherScore * 0.25 + travelScore * 0.25 + preferenceScore * 0.3 + availabilityScore * 0.2) * 100
        );

        suggestedSlots.push({
          start: slotStart.toISOString(),
          end: slotEnd.toISOString(),
          score: overallScore,
          factors: {
            weather: Math.round(weatherScore * 100),
            travel: Math.round(travelScore * 100),
            preference: Math.round(preferenceScore * 100),
            availability: Math.round(availabilityScore * 100),
          },
          weather_summary: getWeatherSummary(weatherScore),
          travel_time_minutes: travelTimeMinutes,
        });
      }
    }

    // Sort by score and take top 5
    suggestedSlots.sort((a, b) => b.score - a.score);
    const topSlots = suggestedSlots.slice(0, 5);

    // Store suggestion in database
    if (tenantId) {
      await supabase.from("ai_scheduling_suggestions").insert({
        tenant_id: tenantId,
        contact_id,
        canvasser_id: assigneeId,
        appointment_type,
        suggested_slots: topSlots,
        canvasser_location,
        homeowner_preferences,
        status: "pending",
      });
    }

    return new Response(
      JSON.stringify({
        success: true,
        suggested_slots: topSlots,
        contact: {
          id: contact.id,
          name: `${contact.first_name} ${contact.last_name}`,
          address: contact.addresses?.[0]?.formatted_address,
        },
        canvasser: {
          id: canvasser?.id,
          name: canvasser?.first_name ? `${canvasser.first_name} ${canvasser.last_name}` : null,
        },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in ai-appointment-scheduler:", error);
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

function getWeatherSummary(score: number): string {
  if (score >= 0.9) return "Clear and ideal";
  if (score >= 0.7) return "Good conditions";
  if (score >= 0.5) return "Moderate conditions";
  return "Weather may affect scheduling";
}
