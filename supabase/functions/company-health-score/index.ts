import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface HealthScoreRequest {
  action: 'calculate' | 'get_history' | 'get_recommendations' | 'compare';
  tenant_id: string;
  compare_tenant_ids?: string[];
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body: HealthScoreRequest = await req.json();
    const { action, tenant_id, compare_tenant_ids } = body;

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
      case 'calculate': {
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

        // Get active users (logged in last 7 days)
        const { count: activeUsers } = await supabaseAdmin
          .from('profiles')
          .select('*', { count: 'exact', head: true })
          .eq('tenant_id', tenant_id)
          .gte('last_sign_in', sevenDaysAgo);

        const { count: totalUsers } = await supabaseAdmin
          .from('profiles')
          .select('*', { count: 'exact', head: true })
          .eq('tenant_id', tenant_id);

        // Get project activity
        const { count: recentProjects } = await supabaseAdmin
          .from('projects')
          .select('*', { count: 'exact', head: true })
          .eq('tenant_id', tenant_id)
          .gte('created_at', thirtyDaysAgo);

        // Get proposal metrics
        const { data: proposals } = await supabaseAdmin
          .from('proposals')
          .select('status, created_at')
          .eq('tenant_id', tenant_id)
          .gte('created_at', thirtyDaysAgo);

        const proposalCount = proposals?.length || 0;
        const closedCount = proposals?.filter(p => p.status === 'accepted').length || 0;
        const closeRate = proposalCount > 0 ? (closedCount / proposalCount) * 100 : 0;

        // Get communication activity
        const { count: callsMade } = await supabaseAdmin
          .from('call_logs')
          .select('*', { count: 'exact', head: true })
          .eq('tenant_id', tenant_id)
          .gte('created_at', thirtyDaysAgo);

        // Calculate health score components
        const scores = {
          user_engagement: Math.min(100, ((activeUsers || 0) / Math.max(totalUsers || 1, 1)) * 100),
          project_activity: Math.min(100, (recentProjects || 0) * 10), // 10 points per project, max 100
          proposal_performance: Math.min(100, closeRate * 3), // 3x multiplier, max 100
          communication_volume: Math.min(100, (callsMade || 0) * 2) // 2 points per call, max 100
        };

        // Calculate overall health score (weighted average)
        const weights = {
          user_engagement: 0.25,
          project_activity: 0.25,
          proposal_performance: 0.30,
          communication_volume: 0.20
        };

        const overallScore = Math.round(
          scores.user_engagement * weights.user_engagement +
          scores.project_activity * weights.project_activity +
          scores.proposal_performance * weights.proposal_performance +
          scores.communication_volume * weights.communication_volume
        );

        const healthData = {
          tenant_id,
          overall_score: overallScore,
          component_scores: scores,
          metrics: {
            active_users: activeUsers || 0,
            total_users: totalUsers || 0,
            recent_projects: recentProjects || 0,
            proposals_sent: proposalCount,
            proposal_close_rate: Math.round(closeRate),
            calls_made: callsMade || 0
          },
          status: overallScore >= 70 ? 'healthy' : overallScore >= 40 ? 'needs_attention' : 'at_risk',
          calculated_at: new Date().toISOString()
        };

        // Save health score history
        await supabaseAdmin
          .from('company_health_scores')
          .insert({
            tenant_id,
            overall_score: overallScore,
            component_scores: scores,
            metrics: healthData.metrics
          });

        return new Response(
          JSON.stringify({ success: true, data: healthData }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'get_history': {
        const { data: history } = await supabaseAdmin
          .from('company_health_scores')
          .select('overall_score, component_scores, created_at')
          .eq('tenant_id', tenant_id)
          .order('created_at', { ascending: false })
          .limit(30);

        // Calculate trend
        let trend = 'stable';
        if (history && history.length >= 2) {
          const recent = history[0].overall_score;
          const previous = history[Math.min(6, history.length - 1)].overall_score;
          if (recent > previous + 5) trend = 'improving';
          else if (recent < previous - 5) trend = 'declining';
        }

        return new Response(
          JSON.stringify({ success: true, data: { history: history || [], trend } }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'get_recommendations': {
        // Get latest health score
        const { data: latestScore } = await supabaseAdmin
          .from('company_health_scores')
          .select('overall_score, component_scores, metrics')
          .eq('tenant_id', tenant_id)
          .order('created_at', { ascending: false })
          .limit(1)
          .single();

        const recommendations: Array<{ priority: string; category: string; action: string; impact: string }> = [];
        const scores = latestScore?.component_scores || {};
        const metrics = latestScore?.metrics || {};

        // Generate recommendations based on low scores
        if (scores.user_engagement < 50) {
          recommendations.push({
            priority: 'high',
            category: 'User Engagement',
            action: 'Schedule training sessions to increase user adoption',
            impact: 'Could improve engagement by 30%+'
          });
        }

        if (scores.project_activity < 40) {
          recommendations.push({
            priority: 'medium',
            category: 'Project Activity',
            action: 'Review lead sources and marketing efforts',
            impact: 'Increase project pipeline'
          });
        }

        if (scores.proposal_performance < 50) {
          recommendations.push({
            priority: 'high',
            category: 'Proposal Performance',
            action: 'Implement proposal follow-up automation',
            impact: 'Could increase close rate by 15-20%'
          });
        }

        if (scores.communication_volume < 40) {
          recommendations.push({
            priority: 'medium',
            category: 'Communication',
            action: 'Set up automated outreach campaigns',
            impact: 'Increase customer touchpoints'
          });
        }

        if (metrics.total_users > 5 && metrics.active_users < metrics.total_users * 0.5) {
          recommendations.push({
            priority: 'high',
            category: 'User Activation',
            action: 'Reach out to inactive users with re-engagement emails',
            impact: 'Recover inactive user productivity'
          });
        }

        return new Response(
          JSON.stringify({ success: true, data: recommendations }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'compare': {
        const tenantIds = [tenant_id, ...(compare_tenant_ids || [])].slice(0, 5);
        
        const comparisons = await Promise.all(tenantIds.map(async (tid) => {
          const { data: score } = await supabaseAdmin
            .from('company_health_scores')
            .select('overall_score, component_scores')
            .eq('tenant_id', tid)
            .order('created_at', { ascending: false })
            .limit(1)
            .single();

          const { data: tenant } = await supabaseAdmin
            .from('tenants')
            .select('name')
            .eq('id', tid)
            .single();

          return {
            tenant_id: tid,
            tenant_name: tenant?.name || 'Unknown',
            overall_score: score?.overall_score || 0,
            component_scores: score?.component_scores || {}
          };
        }));

        // Sort by overall score
        comparisons.sort((a, b) => b.overall_score - a.overall_score);

        // Calculate rank
        const yourRank = comparisons.findIndex(c => c.tenant_id === tenant_id) + 1;

        return new Response(
          JSON.stringify({ 
            success: true, 
            data: { 
              comparisons, 
              your_rank: yourRank,
              total_compared: comparisons.length
            } 
          }),
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
    console.error('[company-health-score] Unexpected error:', error);
    return new Response(
      JSON.stringify({ success: false, error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
