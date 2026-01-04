import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface SessionData {
  channel?: string;
  site_domain?: string;
  landing_page?: string;
  referrer?: string;
  device_type?: string;
  user_agent?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  utm_term?: string;
  user_id?: string;
  tenant_id?: string;
}

interface SessionRequest {
  action: 'create' | 'update' | 'convert' | 'track_event';
  session_key: string;
  data: SessionData;
  event?: {
    event_type: string;
    event_path?: string;
    event_metadata?: Record<string, unknown>;
  };
}

// Simple rate limiting
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT = 200;
const RATE_LIMIT_WINDOW = 60000;

function checkRateLimit(key: string): boolean {
  const now = Date.now();
  const record = rateLimitMap.get(key);
  
  if (!record || now > record.resetTime) {
    rateLimitMap.set(key, { count: 1, resetTime: now + RATE_LIMIT_WINDOW });
    return true;
  }
  
  if (record.count >= RATE_LIMIT) {
    return false;
  }
  
  record.count++;
  return true;
}

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    
    if (!checkRateLimit(clientIp)) {
      return new Response(
        JSON.stringify({ success: false, error: 'Rate limit exceeded' }),
        { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Parse request body
    const body: SessionRequest = await req.json();
    
    // Validate required fields
    if (!body.action || !body.session_key) {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing required fields: action, session_key' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // track_event is no longer supported since marketing_events table doesn't exist
    const validActions = ['create', 'update', 'convert'];
    if (!validActions.includes(body.action)) {
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid action. Must be: create, update, or convert' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create service role client to bypass RLS
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false } }
    );

    const data = body.data || {};

    if (body.action === 'create') {
      // Use upsert to handle race conditions gracefully
      const sessionData = {
        session_key: body.session_key,
        tenant_id: data.tenant_id || null,
        channel: data.channel || 'direct',
        site_domain: data.site_domain,
        landing_page: data.landing_page,
        referrer: data.referrer,
        device_type: data.device_type,
        user_agent: data.user_agent,
        utm_source: data.utm_source,
        utm_medium: data.utm_medium,
        utm_campaign: data.utm_campaign,
        utm_content: data.utm_content,
        utm_term: data.utm_term,
        started_at: new Date().toISOString(),
        last_activity_at: new Date().toISOString(),
        page_views: 1,
        events_count: 0,
        converted: false
      };

      // Try upsert - on conflict, do nothing (keeps existing data)
      const { data: upsertResult, error: upsertError } = await supabaseAdmin
        .from('marketing_sessions')
        .upsert(sessionData, {
          onConflict: 'session_key',
          ignoreDuplicates: true
        })
        .select('id')
        .single();

      // If upsert succeeded, return the new session
      if (upsertResult && !upsertError) {
        console.log(`[track-marketing-session] Created session: ${upsertResult.id}`);
        return new Response(
          JSON.stringify({ success: true, session_id: upsertResult.id, action: 'created' }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // If upsert failed (likely duplicate), fetch the existing session
      const { data: existing, error: fetchError } = await supabaseAdmin
        .from('marketing_sessions')
        .select('id')
        .eq('session_key', body.session_key)
        .single();

      if (existing) {
        console.log(`[track-marketing-session] Found existing session: ${existing.id}`);
        return new Response(
          JSON.stringify({ success: true, session_id: existing.id, action: 'existing' }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Both failed - log and return error
      console.error('[track-marketing-session] Create error:', upsertError, fetchError);
      return new Response(
        JSON.stringify({ success: false, error: 'Failed to create session' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (body.action === 'update') {
      // Update session with correct column names
      const { error } = await supabaseAdmin
        .from('marketing_sessions')
        .update({
          last_activity_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('session_key', body.session_key);

      if (error) {
        console.error('[track-marketing-session] Update error:', error);
        return new Response(
          JSON.stringify({ success: false, error: 'Failed to update session' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({ success: true, action: 'updated' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (body.action === 'convert') {
      // Link session to user
      if (!data.user_id) {
        return new Response(
          JSON.stringify({ success: false, error: 'user_id required for conversion' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const { error } = await supabaseAdmin
        .from('marketing_sessions')
        .update({
          user_id: data.user_id,
          tenant_id: data.tenant_id || null,
          converted: true,
          converted_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('session_key', body.session_key);

      if (error) {
        console.error('[track-marketing-session] Convert error:', error);
        return new Response(
          JSON.stringify({ success: false, error: 'Failed to convert session' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      console.log(`[track-marketing-session] Converted session for user: ${data.user_id}`);
      return new Response(
        JSON.stringify({ success: true, action: 'converted' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ success: false, error: 'Invalid action' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[track-marketing-session] Unexpected error:', error);
    return new Response(
      JSON.stringify({ success: false, error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
