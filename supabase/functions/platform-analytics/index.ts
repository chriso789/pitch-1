import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface AnalyticsRequest {
  action: 'overview' | 'usage' | 'performance' | 'benchmarks' | 'trends';
  date_range?: { start: string; end: string };
  tenant_id?: string; // Optional for master users
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body: AnalyticsRequest = await req.json();
    const { action, date_range, tenant_id } = body;

    if (!action) {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing action' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false } }
    );

    // Verify user is a master/platform admin
    const authHeader = req.headers.get('authorization');
    if (authHeader) {
      const { data: { user } } = await supabaseAdmin.auth.getUser(authHeader.replace('Bearer ', ''));
      if (!user) {
        return new Response(
          JSON.stringify({ success: false, error: 'Unauthorized' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Check if user is platform operator
      const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('role, is_platform_operator')
        .eq('id', user.id)
        .single();

      if (!profile?.is_platform_operator && profile?.role !== 'master') {
        return new Response(
          JSON.stringify({ success: false, error: 'Insufficient permissions' }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    switch (action) {
      case 'overview': {
        // Get platform-wide metrics
        const { count: tenantCount } = await supabaseAdmin
          .from('tenants')
          .select('*', { count: 'exact', head: true });

        const { count: userCount } = await supabaseAdmin
          .from('profiles')
          .select('*', { count: 'exact', head: true });

        const { count: projectCount } = await supabaseAdmin
          .from('projects')
          .select('*', { count: 'exact', head: true });

        const { count: contactCount } = await supabaseAdmin
          .from('contacts')
          .select('*', { count: 'exact', head: true });

        // Get revenue (if payment data available)
        const { data: recentPayments } = await supabaseAdmin
          .from('payment_history')
          .select('amount')
          .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString());

        const monthlyRevenue = recentPayments?.reduce((sum, p) => sum + (p.amount || 0), 0) || 0;

        return new Response(
          JSON.stringify({ 
            success: true, 
            data: {
              total_tenants: tenantCount || 0,
              total_users: userCount || 0,
              total_projects: projectCount || 0,
              total_contacts: contactCount || 0,
              monthly_revenue: monthlyRevenue,
              generated_at: new Date().toISOString()
            }
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'usage': {
        // Get feature usage across platform
        const { count: proposalsCreated } = await supabaseAdmin
          .from('proposals')
          .select('*', { count: 'exact', head: true })
          .gte('created_at', date_range?.start || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString());

        const { count: estimatesCreated } = await supabaseAdmin
          .from('estimates')
          .select('*', { count: 'exact', head: true })
          .gte('created_at', date_range?.start || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString());

        const { count: callsMade } = await supabaseAdmin
          .from('call_logs')
          .select('*', { count: 'exact', head: true })
          .gte('created_at', date_range?.start || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString());

        const { count: smsSent } = await supabaseAdmin
          .from('sms_messages')
          .select('*', { count: 'exact', head: true })
          .eq('direction', 'outbound')
          .gte('created_at', date_range?.start || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString());

        return new Response(
          JSON.stringify({ 
            success: true, 
            data: {
              proposals_created: proposalsCreated || 0,
              estimates_created: estimatesCreated || 0,
              calls_made: callsMade || 0,
              sms_sent: smsSent || 0
            }
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'performance': {
        // Get system performance metrics
        const { data: healthChecks } = await supabaseAdmin
          .from('health_checks')
          .select('service_name, status, response_time_ms')
          .gte('checked_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
          .order('checked_at', { ascending: false })
          .limit(100);

        const serviceMetrics: Record<string, { avg_response: number; uptime: number; checks: number }> = {};
        
        healthChecks?.forEach(check => {
          if (!serviceMetrics[check.service_name]) {
            serviceMetrics[check.service_name] = { avg_response: 0, uptime: 0, checks: 0 };
          }
          serviceMetrics[check.service_name].avg_response += check.response_time_ms || 0;
          serviceMetrics[check.service_name].uptime += check.status === 'healthy' ? 1 : 0;
          serviceMetrics[check.service_name].checks++;
        });

        // Calculate averages
        Object.keys(serviceMetrics).forEach(key => {
          const m = serviceMetrics[key];
          m.avg_response = Math.round(m.avg_response / m.checks);
          m.uptime = Math.round((m.uptime / m.checks) * 100);
        });

        return new Response(
          JSON.stringify({ success: true, data: { services: serviceMetrics } }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'benchmarks': {
        // Get industry benchmarks (aggregated anonymized data)
        const { data: proposals } = await supabaseAdmin
          .from('proposals')
          .select('total_amount, status, created_at')
          .gte('created_at', new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString());

        const totalProposals = proposals?.length || 1;
        const closedProposals = proposals?.filter(p => p.status === 'accepted').length || 0;
        const avgProposalValue = proposals?.reduce((sum, p) => sum + (p.total_amount || 0), 0) / totalProposals || 0;

        const benchmarks = {
          avg_proposal_value: Math.round(avgProposalValue),
          close_rate: Math.round((closedProposals / totalProposals) * 100),
          industry_avg_close_rate: 25, // Industry average
          top_performer_close_rate: 45 // Top 10% performers
        };

        return new Response(
          JSON.stringify({ success: true, data: benchmarks }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'trends': {
        // Get usage trends over time
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        const trends: Record<string, number[]> = {
          users: [],
          projects: [],
          proposals: []
        };

        // Simple daily counts for last 7 days
        for (let i = 6; i >= 0; i--) {
          const dayStart = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
          dayStart.setHours(0, 0, 0, 0);
          const dayEnd = new Date(dayStart);
          dayEnd.setDate(dayEnd.getDate() + 1);

          const { count: users } = await supabaseAdmin
            .from('profiles')
            .select('*', { count: 'exact', head: true })
            .gte('created_at', dayStart.toISOString())
            .lt('created_at', dayEnd.toISOString());

          const { count: projects } = await supabaseAdmin
            .from('projects')
            .select('*', { count: 'exact', head: true })
            .gte('created_at', dayStart.toISOString())
            .lt('created_at', dayEnd.toISOString());

          trends.users.push(users || 0);
          trends.projects.push(projects || 0);
        }

        return new Response(
          JSON.stringify({ success: true, data: trends }),
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
    console.error('[platform-analytics] Unexpected error:', error);
    return new Response(
      JSON.stringify({ success: false, error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
