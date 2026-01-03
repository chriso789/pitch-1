import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface RouteStop {
  assignment_id: string;
  job_id: string;
  address: string;
  lat: number;
  lng: number;
  scheduled_start?: string;
  scheduled_end?: string;
  estimated_duration_minutes: number;
  priority: number;
}

interface OptimizedStop extends RouteStop {
  order: number;
  arrival_time: string;
  departure_time: string;
  travel_time_from_previous: number;
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

    const { crew_id, date, start_location } = await req.json();

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

    // Get crew assignments for the date
    const { data: assignments, error: assignmentsError } = await supabase
      .from("crew_assignments")
      .select(`
        *,
        jobs(*, projects(*, contacts(*)))
      `)
      .eq("crew_id", crew_id)
      .eq("assignment_date", date)
      .neq("status", "cancelled")
      .order("priority", { ascending: true });

    if (assignmentsError) {
      throw assignmentsError;
    }

    if (!assignments || assignments.length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: "No assignments found for this date", stops: [] }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Build stops array
    const stops: RouteStop[] = assignments.map(assignment => {
      const job = assignment.jobs;
      const project = job?.projects;
      const contact = project?.contacts;
      
      return {
        assignment_id: assignment.id,
        job_id: assignment.job_id,
        address: assignment.address || project?.address || contact?.address || "Unknown",
        lat: assignment.latitude || project?.latitude || 0,
        lng: assignment.longitude || project?.longitude || 0,
        scheduled_start: assignment.scheduled_start,
        scheduled_end: assignment.scheduled_end,
        estimated_duration_minutes: assignment.estimated_duration_minutes || 120,
        priority: assignment.priority || 5,
      };
    });

    // Optimize route using nearest neighbor algorithm (simplified TSP)
    const optimizedStops = optimizeRoute(stops, start_location);

    // Calculate total distance and duration
    let totalDistanceMiles = 0;
    let totalDurationMinutes = 0;

    for (let i = 0; i < optimizedStops.length; i++) {
      if (i > 0) {
        const dist = calculateDistance(
          optimizedStops[i - 1].lat,
          optimizedStops[i - 1].lng,
          optimizedStops[i].lat,
          optimizedStops[i].lng
        );
        totalDistanceMiles += dist * 0.621371; // Convert km to miles
        totalDurationMinutes += optimizedStops[i].travel_time_from_previous;
      }
      totalDurationMinutes += optimizedStops[i].estimated_duration_minutes;
    }

    // Calculate optimization score
    const optimizationScore = calculateOptimizationScore(optimizedStops, totalDistanceMiles);

    // Check for existing route or create new
    const { data: existingRoute } = await supabase
      .from("dispatch_routes")
      .select("id")
      .eq("crew_id", crew_id)
      .eq("route_date", date)
      .single();

    const routeData = {
      tenant_id: tenantId,
      crew_id,
      route_date: date,
      start_location,
      end_location: start_location, // Return to start
      stops: optimizedStops,
      total_distance_miles: Math.round(totalDistanceMiles * 10) / 10,
      total_duration_minutes: Math.round(totalDurationMinutes),
      optimization_score: optimizationScore,
      status: "planned",
    };

    let route;
    if (existingRoute) {
      const { data, error } = await supabase
        .from("dispatch_routes")
        .update(routeData)
        .eq("id", existingRoute.id)
        .select()
        .single();
      if (error) throw error;
      route = data;
    } else {
      const { data, error } = await supabase
        .from("dispatch_routes")
        .insert(routeData)
        .select()
        .single();
      if (error) throw error;
      route = data;
    }

    // Update crew assignments with route order
    for (const stop of optimizedStops) {
      await supabase
        .from("crew_assignments")
        .update({ route_order: stop.order })
        .eq("id", stop.assignment_id);
    }

    return new Response(
      JSON.stringify({
        success: true,
        route,
        summary: {
          total_stops: optimizedStops.length,
          total_distance_miles: Math.round(totalDistanceMiles * 10) / 10,
          total_duration_minutes: Math.round(totalDurationMinutes),
          optimization_score: optimizationScore,
          estimated_end_time: optimizedStops.length > 0 
            ? optimizedStops[optimizedStops.length - 1].departure_time 
            : null,
        },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in optimize-crew-route:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

function optimizeRoute(stops: RouteStop[], startLocation?: { lat: number; lng: number }): OptimizedStop[] {
  if (stops.length === 0) return [];

  const optimized: OptimizedStop[] = [];
  const remaining = [...stops];
  let currentLat = startLocation?.lat || stops[0].lat;
  let currentLng = startLocation?.lng || stops[0].lng;
  
  // Start time: 8 AM
  let currentTime = new Date();
  currentTime.setHours(8, 0, 0, 0);

  let order = 1;

  // Sort high-priority stops first, then use nearest neighbor
  remaining.sort((a, b) => {
    if (a.priority !== b.priority) {
      return a.priority - b.priority; // Lower priority number = higher priority
    }
    // If same priority, use distance as tiebreaker
    const distA = calculateDistance(currentLat, currentLng, a.lat, a.lng);
    const distB = calculateDistance(currentLat, currentLng, b.lat, b.lng);
    return distA - distB;
  });

  while (remaining.length > 0) {
    // Find nearest unvisited stop (considering priority)
    let nearestIdx = 0;
    let nearestDist = Infinity;

    for (let i = 0; i < remaining.length; i++) {
      const stop = remaining[i];
      const dist = calculateDistance(currentLat, currentLng, stop.lat, stop.lng);
      
      // Weight distance by priority (high priority = smaller distance equivalent)
      const weightedDist = dist * (1 + (stop.priority - 1) * 0.1);
      
      if (weightedDist < nearestDist) {
        nearestDist = weightedDist;
        nearestIdx = i;
      }
    }

    const nextStop = remaining.splice(nearestIdx, 1)[0];
    const actualDist = calculateDistance(currentLat, currentLng, nextStop.lat, nextStop.lng);
    const travelTimeMinutes = Math.round(actualDist * 2); // Rough estimate: 2 min per km

    // Update current time
    currentTime = new Date(currentTime.getTime() + travelTimeMinutes * 60 * 1000);
    const arrivalTime = currentTime.toISOString();

    currentTime = new Date(currentTime.getTime() + nextStop.estimated_duration_minutes * 60 * 1000);
    const departureTime = currentTime.toISOString();

    optimized.push({
      ...nextStop,
      order,
      arrival_time: arrivalTime,
      departure_time: departureTime,
      travel_time_from_previous: travelTimeMinutes,
    });

    currentLat = nextStop.lat;
    currentLng = nextStop.lng;
    order++;
  }

  return optimized;
}

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

function calculateOptimizationScore(stops: OptimizedStop[], totalDistance: number): number {
  if (stops.length <= 1) return 100;

  // Score based on:
  // 1. Minimized total distance (40%)
  // 2. Priority adherence (30%)
  // 3. Time window compliance (30%)

  // Distance score: lower is better (normalized to expected max of 50 miles)
  const expectedMaxDistance = stops.length * 10; // 10 miles per stop average
  const distanceScore = Math.max(0, 100 - (totalDistance / expectedMaxDistance) * 100);

  // Priority score: check if high priority items are early
  let priorityScore = 100;
  for (let i = 0; i < stops.length; i++) {
    const expectedOrder = stops.slice().sort((a, b) => a.priority - b.priority).indexOf(stops[i]) + 1;
    const deviation = Math.abs(stops[i].order - expectedOrder);
    priorityScore -= deviation * 5;
  }
  priorityScore = Math.max(0, priorityScore);

  // Time window compliance: assume 80% compliance for now
  const timeScore = 80;

  return Math.round(distanceScore * 0.4 + priorityScore * 0.3 + timeScore * 0.3);
}
