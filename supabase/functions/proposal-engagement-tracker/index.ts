import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface EngagementRequest {
  action: 'track_view' | 'track_section' | 'get_engagement' | 'get_heatmap';
  tenant_id: string;
  proposal_id?: string;
  viewer_info?: {
    ip?: string;
    user_agent?: string;
    device?: string;
    location?: string;
  };
  section_data?: {
    section_id: string;
    time_spent_seconds: number;
    scroll_depth?: number;
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body: EngagementRequest = await req.json();
    const { action, tenant_id, proposal_id, viewer_info, section_data } = body;

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
      case 'track_view': {
        if (!proposal_id) {
          return new Response(
            JSON.stringify({ success: false, error: 'proposal_id required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Record view event
        const { data: viewEvent, error } = await supabaseAdmin
          .from('proposal_views')
          .insert({
            tenant_id,
            proposal_id,
            ip_address: viewer_info?.ip,
            user_agent: viewer_info?.user_agent,
            device_type: viewer_info?.device || detectDevice(viewer_info?.user_agent || ''),
            location: viewer_info?.location,
            viewed_at: new Date().toISOString()
          })
          .select()
          .single();

        if (error) {
          console.error('[proposal-engagement-tracker] Track view error:', error);
          // Don't fail - just log
        }

        // Update proposal view count
        await supabaseAdmin.rpc('increment_proposal_views', { prop_id: proposal_id });

        // Notify sales rep
        const { data: proposal } = await supabaseAdmin
          .from('proposals')
          .select('created_by, title')
          .eq('id', proposal_id)
          .single();

        if (proposal?.created_by) {
          await supabaseAdmin
            .from('user_notifications')
            .insert({
              tenant_id,
              user_id: proposal.created_by,
              type: 'proposal_viewed',
              title: 'Proposal Viewed',
              message: `Your proposal "${proposal.title}" was just viewed`,
              metadata: { proposal_id, viewer_info }
            });
        }

        console.log(`[proposal-engagement-tracker] Tracked view for proposal ${proposal_id}`);
        return new Response(
          JSON.stringify({ success: true, data: { view_id: viewEvent?.id } }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'track_section': {
        if (!proposal_id || !section_data) {
          return new Response(
            JSON.stringify({ success: false, error: 'proposal_id and section_data required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Record section engagement
        const { error } = await supabaseAdmin
          .from('proposal_section_views')
          .insert({
            tenant_id,
            proposal_id,
            section_id: section_data.section_id,
            time_spent_seconds: section_data.time_spent_seconds,
            scroll_depth: section_data.scroll_depth,
            recorded_at: new Date().toISOString()
          });

        if (error) {
          console.error('[proposal-engagement-tracker] Track section error:', error);
        }

        return new Response(
          JSON.stringify({ success: true }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'get_engagement': {
        if (!proposal_id) {
          return new Response(
            JSON.stringify({ success: false, error: 'proposal_id required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Get all views
        const { data: views } = await supabaseAdmin
          .from('proposal_views')
          .select('*')
          .eq('proposal_id', proposal_id)
          .order('viewed_at', { ascending: false });

        // Get section engagement
        const { data: sectionViews } = await supabaseAdmin
          .from('proposal_section_views')
          .select('*')
          .eq('proposal_id', proposal_id);

        // Calculate metrics
        const totalViews = views?.length || 0;
        const uniqueIPs = new Set(views?.map(v => v.ip_address)).size;
        const avgTimePerSection = sectionViews?.length 
          ? sectionViews.reduce((sum, s) => sum + (s.time_spent_seconds || 0), 0) / sectionViews.length 
          : 0;

        // Group section views
        const sectionEngagement: Record<string, { views: number; avg_time: number }> = {};
        sectionViews?.forEach(sv => {
          if (!sectionEngagement[sv.section_id]) {
            sectionEngagement[sv.section_id] = { views: 0, avg_time: 0 };
          }
          sectionEngagement[sv.section_id].views++;
          sectionEngagement[sv.section_id].avg_time += sv.time_spent_seconds || 0;
        });

        Object.keys(sectionEngagement).forEach(key => {
          sectionEngagement[key].avg_time = sectionEngagement[key].avg_time / sectionEngagement[key].views;
        });

        return new Response(
          JSON.stringify({ 
            success: true, 
            data: {
              total_views: totalViews,
              unique_viewers: uniqueIPs,
              avg_time_per_section: Math.round(avgTimePerSection),
              views: views?.slice(0, 20),
              section_engagement: sectionEngagement,
              last_viewed: views?.[0]?.viewed_at
            }
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'get_heatmap': {
        if (!proposal_id) {
          return new Response(
            JSON.stringify({ success: false, error: 'proposal_id required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Get scroll depth data for heatmap
        const { data: sectionViews } = await supabaseAdmin
          .from('proposal_section_views')
          .select('section_id, scroll_depth, time_spent_seconds')
          .eq('proposal_id', proposal_id);

        // Group by section for heatmap
        const heatmapData: Record<string, { attention_score: number; avg_scroll: number }> = {};
        
        sectionViews?.forEach(sv => {
          if (!heatmapData[sv.section_id]) {
            heatmapData[sv.section_id] = { attention_score: 0, avg_scroll: 0 };
          }
          // Attention score based on time spent
          heatmapData[sv.section_id].attention_score += (sv.time_spent_seconds || 0) / 10;
          heatmapData[sv.section_id].avg_scroll += sv.scroll_depth || 0;
        });

        // Normalize scores
        const maxScore = Math.max(...Object.values(heatmapData).map(h => h.attention_score), 1);
        Object.keys(heatmapData).forEach(key => {
          heatmapData[key].attention_score = heatmapData[key].attention_score / maxScore;
        });

        return new Response(
          JSON.stringify({ success: true, data: heatmapData }),
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
    console.error('[proposal-engagement-tracker] Unexpected error:', error);
    return new Response(
      JSON.stringify({ success: false, error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

function detectDevice(userAgent: string): string {
  const ua = userAgent.toLowerCase();
  if (ua.includes('mobile') || ua.includes('android') || ua.includes('iphone')) {
    return 'mobile';
  }
  if (ua.includes('tablet') || ua.includes('ipad')) {
    return 'tablet';
  }
  return 'desktop';
}
