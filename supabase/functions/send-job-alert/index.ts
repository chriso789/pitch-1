import { createClient } from 'npm:@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const token = authHeader.replace('Bearer ', '');
    const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { alert_type, user_id, job_id, title, body, data } = await req.json();

    if (!alert_type || !user_id || !title || !body) {
      return new Response(JSON.stringify({ error: 'Missing required fields: alert_type, user_id, title, body' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const serviceClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Get user's tenant
    const { data: profile } = await serviceClient
      .from('profiles')
      .select('tenant_id, active_tenant_id')
      .eq('id', user_id)
      .single();

    const companyId = profile?.active_tenant_id || profile?.tenant_id;
    if (!companyId) {
      return new Response(JSON.stringify({ error: 'No tenant found for user' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Insert alert record
    const { data: alert, error: alertError } = await serviceClient
      .from('job_alerts')
      .insert({
        company_id: companyId,
        user_id,
        job_id: job_id || null,
        alert_type,
        title,
        body,
        data_json: data || {},
      })
      .select('id')
      .single();

    if (alertError) {
      console.error('Alert insert failed:', alertError);
      return new Response(JSON.stringify({ error: 'Failed to create alert' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Look up user's registered devices for push
    const { data: devices } = await serviceClient
      .from('mobile_devices')
      .select('id, push_token, platform')
      .eq('user_id', user_id);

    // Log push payload (actual APNs/FCM sending deferred until credentials configured)
    if (devices && devices.length > 0) {
      console.log(`[send-job-alert] Would send push to ${devices.length} device(s):`, {
        alert_type,
        title,
        body,
        devices: devices.map(d => ({ id: d.id, platform: d.platform })),
      });
    }

    return new Response(JSON.stringify({
      success: true,
      alert_id: alert.id,
      devices_found: devices?.length || 0,
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('send-job-alert error:', err);
    return new Response(JSON.stringify({ error: 'Server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
