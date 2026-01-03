import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface AnalyticsRequest {
  action: 'performance' | 'heatmap' | 'rep_activity' | 'coverage' | 'log_visit';
  tenant_id: string;
  territory_id?: string;
  user_id?: string;
  date_range?: { start: string; end: string };
  visit_data?: {
    territory_id: string;
    contact_id?: string;
    visit_type: string;
    latitude: number;
    longitude: number;
    outcome?: string;
    notes?: string;
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body: AnalyticsRequest = await req.json();
    const { action, tenant_id, territory_id, user_id, date_range, visit_data } = body;

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

    // Get user from auth header
    const authHeader = req.headers.get('authorization');
    let authUserId: string | null = null;
    if (authHeader) {
      const { data: { user } } = await supabaseAdmin.auth.getUser(authHeader.replace('Bearer ', ''));
      authUserId = user?.id ?? null;
    }

    switch (action) {
      case 'performance': {
        // Get territory performance metrics
        const query = supabaseAdmin
          .from('territories')
          .select(`
            id, name, assigned_to, color, active, metrics,
            territory_visits(count),
            profiles:assigned_to(id, full_name)
          `)
          .eq('tenant_id', tenant_id);

        if (territory_id) {
          query.eq('id', territory_id);
        }

        const { data: territories, error } = await query;

        if (error) {
          console.error('[territory-analytics] Performance error:', error);
          return new Response(
            JSON.stringify({ success: false, error: 'Failed to get performance data' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Enrich with additional metrics from contacts/leads
        const enrichedData = await Promise.all(territories.map(async (territory) => {
          // Get leads in territory
          const { count: leadCount } = await supabaseAdmin
            .from('contacts')
            .select('*', { count: 'exact', head: true })
            .eq('tenant_id', tenant_id);

          // Get proposals in territory  
          const { count: proposalCount } = await supabaseAdmin
            .from('proposals')
            .select('*', { count: 'exact', head: true })
            .eq('tenant_id', tenant_id);

          return {
            ...territory,
            lead_count: leadCount || 0,
            proposal_count: proposalCount || 0,
            visit_count: territory.territory_visits?.[0]?.count || 0
          };
        }));

        return new Response(
          JSON.stringify({ success: true, data: enrichedData }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'heatmap': {
        // Get visit data for heatmap visualization
        const query = supabaseAdmin
          .from('territory_visits')
          .select('latitude, longitude, outcome, visited_at')
          .eq('tenant_id', tenant_id)
          .not('latitude', 'is', null)
          .not('longitude', 'is', null);

        if (territory_id) {
          query.eq('territory_id', territory_id);
        }

        if (date_range?.start && date_range?.end) {
          query.gte('visited_at', date_range.start).lte('visited_at', date_range.end);
        }

        const { data: visits, error } = await query.limit(5000);

        if (error) {
          console.error('[territory-analytics] Heatmap error:', error);
          return new Response(
            JSON.stringify({ success: false, error: 'Failed to get heatmap data' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Format for heatmap
        const heatmapData = visits.map(v => ({
          lat: v.latitude,
          lng: v.longitude,
          weight: v.outcome === 'appointment_set' ? 3 : v.outcome === 'interested' ? 2 : 1
        }));

        return new Response(
          JSON.stringify({ success: true, data: heatmapData }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'rep_activity': {
        // Get rep activity by territory
        const targetUserId = user_id || authUserId;
        
        const query = supabaseAdmin
          .from('territory_visits')
          .select(`
            id, visit_type, outcome, visited_at,
            territory:territory_id(id, name),
            contact:contact_id(id, first_name, last_name)
          `)
          .eq('tenant_id', tenant_id)
          .order('visited_at', { ascending: false });

        if (targetUserId) {
          query.eq('user_id', targetUserId);
        }

        if (date_range?.start && date_range?.end) {
          query.gte('visited_at', date_range.start).lte('visited_at', date_range.end);
        }

        const { data: activity, error } = await query.limit(100);

        if (error) {
          console.error('[territory-analytics] Rep activity error:', error);
          return new Response(
            JSON.stringify({ success: false, error: 'Failed to get rep activity' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Calculate summary stats
        const stats = {
          total_visits: activity.length,
          appointments_set: activity.filter(a => a.outcome === 'appointment_set').length,
          interested: activity.filter(a => a.outcome === 'interested').length,
          not_home: activity.filter(a => a.outcome === 'not_home').length,
          not_interested: activity.filter(a => a.outcome === 'not_interested').length
        };

        return new Response(
          JSON.stringify({ success: true, data: { activity, stats } }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'coverage': {
        // Get territory coverage analysis
        const { data: territories, error: terrError } = await supabaseAdmin
          .from('territories')
          .select('id, name, boundary_geojson, assigned_to, active')
          .eq('tenant_id', tenant_id)
          .eq('active', true);

        if (terrError) {
          console.error('[territory-analytics] Coverage error:', terrError);
          return new Response(
            JSON.stringify({ success: false, error: 'Failed to get coverage data' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Get visit counts per territory
        const coverageData = await Promise.all(territories.map(async (territory) => {
          const { count } = await supabaseAdmin
            .from('territory_visits')
            .select('*', { count: 'exact', head: true })
            .eq('territory_id', territory.id);

          return {
            territory_id: territory.id,
            name: territory.name,
            assigned_to: territory.assigned_to,
            visit_count: count || 0,
            boundary: territory.boundary_geojson
          };
        }));

        return new Response(
          JSON.stringify({ success: true, data: coverageData }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'log_visit': {
        if (!visit_data) {
          return new Response(
            JSON.stringify({ success: false, error: 'visit_data required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const { data: visit, error } = await supabaseAdmin
          .from('territory_visits')
          .insert({
            tenant_id,
            territory_id: visit_data.territory_id,
            user_id: authUserId,
            contact_id: visit_data.contact_id,
            visit_type: visit_data.visit_type,
            latitude: visit_data.latitude,
            longitude: visit_data.longitude,
            outcome: visit_data.outcome,
            notes: visit_data.notes,
            visited_at: new Date().toISOString()
          })
          .select()
          .single();

        if (error) {
          console.error('[territory-analytics] Log visit error:', error);
          return new Response(
            JSON.stringify({ success: false, error: 'Failed to log visit' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        console.log(`[territory-analytics] Logged visit: ${visit.id}`);
        return new Response(
          JSON.stringify({ success: true, data: visit }),
          { status: 201, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      default:
        return new Response(
          JSON.stringify({ success: false, error: 'Invalid action' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }

  } catch (error) {
    console.error('[territory-analytics] Unexpected error:', error);
    return new Response(
      JSON.stringify({ success: false, error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
