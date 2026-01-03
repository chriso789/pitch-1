import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface OptimizerRequest {
  action: 'optimize_route' | 'rebalance' | 'suggest_reschedule' | 'cluster_appointments';
  tenant_id: string;
  user_id?: string;
  date?: string;
  appointments?: string[];
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body: OptimizerRequest = await req.json();
    const { action, tenant_id, user_id, date, appointments } = body;

    if (!action || !tenant_id) {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing action or tenant_id' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false } }
    );

    switch (action) {
      case 'optimize_route': {
        const targetDate = date || new Date().toISOString().split('T')[0];
        const dayStart = `${targetDate}T00:00:00Z`;
        const dayEnd = `${targetDate}T23:59:59Z`;

        // Get appointments for the day
        let query = supabaseAdmin
          .from('appointments')
          .select(`
            id, scheduled_start, scheduled_end, address, latitude, longitude,
            contact:contact_id(first_name, last_name, address)
          `)
          .eq('tenant_id', tenant_id)
          .gte('scheduled_start', dayStart)
          .lte('scheduled_start', dayEnd)
          .neq('status', 'cancelled')
          .order('scheduled_start', { ascending: true });

        if (user_id) {
          query = query.eq('assigned_to', user_id);
        }

        const { data: appts } = await query;

        if (!appts?.length) {
          return new Response(
            JSON.stringify({ success: true, data: { route: [], total_distance: 0 } }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Simple distance-based optimization (nearest neighbor)
        const optimizedRoute = optimizeRoute(appts);

        return new Response(
          JSON.stringify({ success: true, data: optimizedRoute }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'rebalance': {
        const targetDate = date || new Date().toISOString().split('T')[0];
        
        // Get all reps and their appointment counts
        const { data: reps } = await supabaseAdmin
          .from('profiles')
          .select('id, full_name')
          .eq('tenant_id', tenant_id)
          .eq('role', 'sales_rep');

        if (!reps?.length) {
          return new Response(
            JSON.stringify({ success: true, data: { rebalanced: 0 } }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const dayStart = `${targetDate}T00:00:00Z`;
        const dayEnd = `${targetDate}T23:59:59Z`;

        // Get appointment counts per rep
        const repLoads = await Promise.all(reps.map(async (rep) => {
          const { count } = await supabaseAdmin
            .from('appointments')
            .select('*', { count: 'exact', head: true })
            .eq('assigned_to', rep.id)
            .gte('scheduled_start', dayStart)
            .lte('scheduled_start', dayEnd)
            .neq('status', 'cancelled');

          return { ...rep, count: count || 0 };
        }));

        // Calculate average load
        const totalAppts = repLoads.reduce((sum, r) => sum + r.count, 0);
        const avgLoad = Math.ceil(totalAppts / reps.length);

        // Find overloaded and underloaded reps
        const overloaded = repLoads.filter(r => r.count > avgLoad + 1);
        const underloaded = repLoads.filter(r => r.count < avgLoad - 1);

        const suggestions = overloaded.map(rep => ({
          from_rep: rep.id,
          from_rep_name: rep.full_name,
          current_load: rep.count,
          suggested_transfers: Math.floor((rep.count - avgLoad) / 2),
          potential_recipients: underloaded.map(u => ({ id: u.id, name: u.full_name, current_load: u.count }))
        }));

        return new Response(
          JSON.stringify({ 
            success: true, 
            data: { 
              suggestions,
              avg_load: avgLoad,
              total_appointments: totalAppts
            } 
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'suggest_reschedule': {
        // Find appointments that could be rescheduled for better efficiency
        const targetDate = date || new Date().toISOString().split('T')[0];
        const dayStart = `${targetDate}T00:00:00Z`;
        const dayEnd = `${targetDate}T23:59:59Z`;

        const { data: appts } = await supabaseAdmin
          .from('appointments')
          .select('id, scheduled_start, scheduled_end, address, latitude, longitude, assigned_to')
          .eq('tenant_id', tenant_id)
          .gte('scheduled_start', dayStart)
          .lte('scheduled_start', dayEnd)
          .neq('status', 'cancelled')
          .order('scheduled_start', { ascending: true });

        if (!appts?.length || appts.length < 3) {
          return new Response(
            JSON.stringify({ success: true, data: { suggestions: [] } }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Find appointments with large gaps or inefficient ordering
        const suggestions: unknown[] = [];
        
        for (let i = 1; i < appts.length; i++) {
          const prev = appts[i - 1];
          const curr = appts[i];
          
          const prevEnd = new Date(prev.scheduled_end);
          const currStart = new Date(curr.scheduled_start);
          const gapMinutes = (currStart.getTime() - prevEnd.getTime()) / (1000 * 60);
          
          // Flag if gap is more than 2 hours
          if (gapMinutes > 120) {
            suggestions.push({
              appointment_id: curr.id,
              current_time: curr.scheduled_start,
              suggested_time: prev.scheduled_end,
              reason: `Large gap of ${Math.round(gapMinutes)} minutes before this appointment`,
              savings_minutes: Math.round(gapMinutes - 30)
            });
          }
        }

        return new Response(
          JSON.stringify({ success: true, data: { suggestions } }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'cluster_appointments': {
        // Group appointments by geographic proximity
        const { data: appts } = await supabaseAdmin
          .from('appointments')
          .select('id, scheduled_start, latitude, longitude, address')
          .eq('tenant_id', tenant_id)
          .not('latitude', 'is', null)
          .not('longitude', 'is', null);

        if (!appts?.length) {
          return new Response(
            JSON.stringify({ success: true, data: { clusters: [] } }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Simple clustering by proximity (within 5 miles)
        const clusters: Array<{ center: { lat: number; lng: number }; appointments: string[] }> = [];
        const assigned = new Set<string>();

        for (const appt of appts) {
          if (assigned.has(appt.id)) continue;

          const cluster = {
            center: { lat: appt.latitude, lng: appt.longitude },
            appointments: [appt.id]
          };

          for (const other of appts) {
            if (other.id === appt.id || assigned.has(other.id)) continue;

            const distance = calculateDistance(
              appt.latitude, appt.longitude,
              other.latitude, other.longitude
            );

            if (distance < 5) { // Within 5 miles
              cluster.appointments.push(other.id);
              assigned.add(other.id);
            }
          }

          clusters.push(cluster);
          assigned.add(appt.id);
        }

        return new Response(
          JSON.stringify({ success: true, data: { clusters } }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      default:
        return new Response(
          JSON.stringify({ success: false, error: 'Invalid action' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }

  } catch (error) {
    console.error('[appointment-optimizer] Unexpected error:', error);
    return new Response(
      JSON.stringify({ success: false, error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

function optimizeRoute(appointments: Record<string, unknown>[]) {
  // Simple nearest neighbor algorithm
  const route: unknown[] = [];
  const remaining = [...appointments];
  
  if (remaining.length === 0) return { route: [], total_distance: 0 };
  
  // Start with first appointment
  route.push(remaining.shift());
  
  while (remaining.length > 0) {
    const last = route[route.length - 1] as Record<string, unknown>;
    let nearestIdx = 0;
    let nearestDist = Infinity;
    
    for (let i = 0; i < remaining.length; i++) {
      const appt = remaining[i] as Record<string, unknown>;
      if (last.latitude && last.longitude && appt.latitude && appt.longitude) {
        const dist = calculateDistance(
          last.latitude as number, last.longitude as number,
          appt.latitude as number, appt.longitude as number
        );
        if (dist < nearestDist) {
          nearestDist = dist;
          nearestIdx = i;
        }
      }
    }
    
    route.push(remaining.splice(nearestIdx, 1)[0]);
  }
  
  // Calculate total distance
  let totalDistance = 0;
  for (let i = 1; i < route.length; i++) {
    const prev = route[i - 1] as Record<string, unknown>;
    const curr = route[i] as Record<string, unknown>;
    if (prev.latitude && prev.longitude && curr.latitude && curr.longitude) {
      totalDistance += calculateDistance(
        prev.latitude as number, prev.longitude as number,
        curr.latitude as number, curr.longitude as number
      );
    }
  }
  
  return { route, total_distance: Math.round(totalDistance * 10) / 10 };
}

function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  // Haversine formula
  const R = 3959; // Earth's radius in miles
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}
