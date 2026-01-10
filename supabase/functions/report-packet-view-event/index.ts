// ============================================================================
// REPORT PACKET VIEW EVENT
// Public endpoint for client viewer tracking
// ============================================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ViewEventRequest {
  viewer_token: string;
  event_type: 'packet_viewed' | 'page_viewed' | 'download_clicked' | 'signature_started';
  meta?: {
    page_index?: number;
    dwell_ms?: number;
    scroll_depth?: number;
    referrer?: string;
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const body: ViewEventRequest = await req.json();
    const { viewer_token, event_type, meta = {} } = body;

    if (!viewer_token || !event_type) {
      return new Response(
        JSON.stringify({ success: false, error: { code: 'VALIDATION_ERROR', message: 'viewer_token and event_type required' } }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate token and get packet info
    const { data: viewer, error: viewerError } = await supabase
      .from('report_packet_viewers')
      .select('id, tenant_id, packet_id, is_revoked, view_count')
      .eq('viewer_token', viewer_token)
      .single();

    if (viewerError || !viewer) {
      return new Response(
        JSON.stringify({ success: false, error: { code: 'INVALID_TOKEN', message: 'Invalid or expired token' } }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (viewer.is_revoked) {
      return new Response(
        JSON.stringify({ success: false, error: { code: 'TOKEN_REVOKED', message: 'This link has been revoked' } }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check packet status
    const { data: packet, error: packetError } = await supabase
      .from('report_packets')
      .select('id, status, expires_at')
      .eq('id', viewer.packet_id)
      .single();

    if (packetError || !packet) {
      return new Response(
        JSON.stringify({ success: false, error: { code: 'PACKET_NOT_FOUND', message: 'Report not found' } }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check expiration
    if (packet.expires_at && new Date(packet.expires_at) < new Date()) {
      return new Response(
        JSON.stringify({ success: false, error: { code: 'PACKET_EXPIRED', message: 'This report has expired' } }),
        { status: 410, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check if voided
    if (packet.status === 'void') {
      return new Response(
        JSON.stringify({ success: false, error: { code: 'PACKET_VOIDED', message: 'This report is no longer available' } }),
        { status: 410, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get client info
    const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0] || 
                     req.headers.get('x-real-ip') || 
                     'unknown';
    const userAgent = req.headers.get('user-agent') || 'unknown';

    // Update viewer session
    const isFirstView = viewer.view_count === 0;
    await supabase
      .from('report_packet_viewers')
      .update({
        last_seen_at: new Date().toISOString(),
        ip_last: clientIp,
        ua_last: userAgent,
        view_count: viewer.view_count + (event_type === 'packet_viewed' ? 1 : 0),
        ...(isFirstView && {
          first_seen_at: new Date().toISOString(),
          ip_first: clientIp,
          ua_first: userAgent
        })
      })
      .eq('id', viewer.id);

    // Log event
    await supabase.from('report_packet_events').insert({
      tenant_id: viewer.tenant_id,
      packet_id: viewer.packet_id,
      event_type,
      actor_type: 'external_viewer',
      viewer_id: viewer.id,
      meta: {
        ...meta,
        ip: clientIp,
        user_agent: userAgent
      }
    });

    // Update packet status if first view
    if (isFirstView && event_type === 'packet_viewed' && packet.status === 'sent') {
      await supabase
        .from('report_packets')
        .update({ status: 'viewed' })
        .eq('id', viewer.packet_id);
    }

    return new Response(
      JSON.stringify({
        success: true,
        data: { recorded: true }
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Unexpected error:', error);
    return new Response(
      JSON.stringify({ success: false, error: { code: 'INTERNAL_ERROR', message: String(error) } }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
