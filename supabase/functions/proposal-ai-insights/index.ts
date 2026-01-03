import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface InsightsRequest {
  action: 'predict_close' | 'suggest_followup' | 'compare' | 'get_recommendations';
  tenant_id: string;
  proposal_id?: string;
  proposal_ids?: string[];
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body: InsightsRequest = await req.json();
    const { action, tenant_id, proposal_id, proposal_ids } = body;

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

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');

    switch (action) {
      case 'predict_close': {
        if (!proposal_id) {
          return new Response(
            JSON.stringify({ success: false, error: 'proposal_id required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Get proposal data
        const { data: proposal } = await supabaseAdmin
          .from('proposals')
          .select(`
            *,
            estimate:estimate_id(total_amount),
            contact:contact_id(first_name, last_name)
          `)
          .eq('id', proposal_id)
          .single();

        // Get engagement data
        const { data: views } = await supabaseAdmin
          .from('proposal_views')
          .select('*')
          .eq('proposal_id', proposal_id);

        const { data: sectionViews } = await supabaseAdmin
          .from('proposal_section_views')
          .select('*')
          .eq('proposal_id', proposal_id);

        // Calculate engagement score
        const viewCount = views?.length || 0;
        const totalTimeSpent = sectionViews?.reduce((sum, s) => sum + (s.time_spent_seconds || 0), 0) || 0;
        const uniqueViewers = new Set(views?.map(v => v.ip_address)).size;

        // Simple prediction model
        let probability = 30; // Base probability

        // Engagement factors
        if (viewCount >= 3) probability += 15;
        if (viewCount >= 5) probability += 10;
        if (totalTimeSpent >= 300) probability += 20; // 5+ minutes
        if (uniqueViewers >= 2) probability += 10; // Multiple stakeholders

        // Proposal age factor
        const proposalAge = (Date.now() - new Date(proposal?.created_at).getTime()) / (1000 * 60 * 60 * 24);
        if (proposalAge < 3) probability += 10;
        if (proposalAge > 14) probability -= 15;

        // Cap at 95%
        probability = Math.min(95, Math.max(5, probability));

        const insight = {
          proposal_id,
          close_probability: probability,
          confidence: 0.7,
          factors: {
            view_count: viewCount,
            time_spent: totalTimeSpent,
            unique_viewers: uniqueViewers,
            proposal_age_days: Math.round(proposalAge)
          },
          recommendation: probability >= 60 
            ? 'High likelihood of close - consider following up to finalize'
            : probability >= 40
              ? 'Moderate interest - schedule a call to address questions'
              : 'Low engagement - send a reminder or offer incentive'
        };

        return new Response(
          JSON.stringify({ success: true, data: insight }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'suggest_followup': {
        if (!proposal_id) {
          return new Response(
            JSON.stringify({ success: false, error: 'proposal_id required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Get last view time
        const { data: lastView } = await supabaseAdmin
          .from('proposal_views')
          .select('viewed_at')
          .eq('proposal_id', proposal_id)
          .order('viewed_at', { ascending: false })
          .limit(1)
          .single();

        const { data: proposal } = await supabaseAdmin
          .from('proposals')
          .select('created_at, total_amount, title')
          .eq('id', proposal_id)
          .single();

        const now = new Date();
        const lastViewDate = lastView ? new Date(lastView.viewed_at) : null;
        const proposalDate = new Date(proposal?.created_at);
        const daysSinceLastView = lastViewDate 
          ? Math.floor((now.getTime() - lastViewDate.getTime()) / (1000 * 60 * 60 * 24))
          : null;
        const daysSinceProposal = Math.floor((now.getTime() - proposalDate.getTime()) / (1000 * 60 * 60 * 24));

        // Determine best followup time and method
        let suggestion;
        if (!lastView) {
          suggestion = {
            action: 'send_reminder',
            urgency: 'high',
            message: 'Proposal has not been viewed yet. Send a reminder email with a personal note.',
            best_time: 'Today, morning',
            channel: 'email'
          };
        } else if (daysSinceLastView && daysSinceLastView >= 3) {
          suggestion = {
            action: 'phone_call',
            urgency: 'medium',
            message: `No activity for ${daysSinceLastView} days. Call to check if they have questions.`,
            best_time: 'Tomorrow, 10 AM',
            channel: 'phone'
          };
        } else if (daysSinceProposal >= 7) {
          suggestion = {
            action: 'offer_incentive',
            urgency: 'medium',
            message: 'Proposal is aging. Consider offering a time-limited discount.',
            best_time: 'This week',
            channel: 'email'
          };
        } else {
          suggestion = {
            action: 'wait',
            urgency: 'low',
            message: 'Recent activity detected. Wait for them to reach out or follow up in 2 days.',
            best_time: `In ${3 - (daysSinceLastView || 0)} days`,
            channel: 'email'
          };
        }

        return new Response(
          JSON.stringify({ success: true, data: suggestion }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'compare': {
        const idsToCompare = proposal_ids || [];
        if (idsToCompare.length < 2) {
          return new Response(
            JSON.stringify({ success: false, error: 'At least 2 proposal_ids required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Get proposals with engagement data
        const comparisons = await Promise.all(idsToCompare.slice(0, 5).map(async (id) => {
          const { data: proposal } = await supabaseAdmin
            .from('proposals')
            .select('id, title, total_amount, status, created_at')
            .eq('id', id)
            .single();

          const { count: viewCount } = await supabaseAdmin
            .from('proposal_views')
            .select('*', { count: 'exact', head: true })
            .eq('proposal_id', id);

          const { data: sectionViews } = await supabaseAdmin
            .from('proposal_section_views')
            .select('time_spent_seconds')
            .eq('proposal_id', id);

          const totalTime = sectionViews?.reduce((sum, s) => sum + (s.time_spent_seconds || 0), 0) || 0;

          return {
            ...proposal,
            view_count: viewCount || 0,
            total_time_spent: totalTime,
            engagement_score: ((viewCount || 0) * 10) + (totalTime / 30)
          };
        }));

        // Sort by engagement score
        comparisons.sort((a, b) => (b.engagement_score || 0) - (a.engagement_score || 0));

        return new Response(
          JSON.stringify({ success: true, data: comparisons }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'get_recommendations': {
        // Get all recent proposals with low engagement
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        const { data: proposals } = await supabaseAdmin
          .from('proposals')
          .select('id, title, created_at, status')
          .eq('tenant_id', tenant_id)
          .eq('status', 'sent')
          .gte('created_at', thirtyDaysAgo.toISOString());

        const recommendations = await Promise.all((proposals || []).map(async (p) => {
          const { count } = await supabaseAdmin
            .from('proposal_views')
            .select('*', { count: 'exact', head: true })
            .eq('proposal_id', p.id);

          const daysSince = Math.floor((Date.now() - new Date(p.created_at).getTime()) / (1000 * 60 * 60 * 24));

          let priority = 'low';
          let action = '';

          if ((count || 0) === 0 && daysSince >= 2) {
            priority = 'high';
            action = 'Send reminder - no views yet';
          } else if ((count || 0) < 2 && daysSince >= 5) {
            priority = 'medium';
            action = 'Follow up call - low engagement';
          } else if (daysSince >= 14) {
            priority = 'medium';
            action = 'Check in - proposal aging';
          }

          return {
            proposal_id: p.id,
            title: p.title,
            views: count || 0,
            days_old: daysSince,
            priority,
            recommended_action: action || 'No action needed'
          };
        }));

        // Sort by priority
        const priorityOrder = { high: 0, medium: 1, low: 2 };
        recommendations.sort((a, b) => 
          (priorityOrder[a.priority as keyof typeof priorityOrder] || 2) - 
          (priorityOrder[b.priority as keyof typeof priorityOrder] || 2)
        );

        return new Response(
          JSON.stringify({ success: true, data: recommendations.filter(r => r.recommended_action !== 'No action needed') }),
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
    console.error('[proposal-ai-insights] Unexpected error:', error);
    return new Response(
      JSON.stringify({ success: false, error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
