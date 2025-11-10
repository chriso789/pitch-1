import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface AuthActivityLog {
  user_id?: string;
  email: string;
  event_type: 'login_success' | 'login_failed' | 'logout' | 'session_refresh' | 'password_reset_request';
  ip_address?: string;
  user_agent?: string;
  device_info?: string;
  location_info?: string;
  success: boolean;
  error_message?: string;
}

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    );

    const body = await req.json() as AuthActivityLog;
    
    console.log('📝 Logging auth activity:', {
      email: body.email,
      event_type: body.event_type,
      success: body.success,
      timestamp: new Date().toISOString()
    });

    // Extract additional info from request
    const user_agent = req.headers.get('user-agent') || body.user_agent || 'Unknown';
    const ip_address = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 
                       req.headers.get('x-real-ip') || 
                       body.ip_address || 
                       'Unknown';

    // Parse device info from user agent
    let device_info = 'Desktop';
    if (user_agent.toLowerCase().includes('mobile')) {
      device_info = 'Mobile';
    } else if (user_agent.toLowerCase().includes('tablet')) {
      device_info = 'Tablet';
    }

    // Get location from IP address using ip-api.com (free, no API key required)
    let location_info = body.location_info || null;
    if (ip_address && ip_address !== 'Unknown' && !location_info) {
      try {
        console.log('🌍 Looking up location for IP:', ip_address);
        const geoResponse = await fetch(`http://ip-api.com/json/${ip_address}?fields=status,country,countryCode,region,regionName,city,zip,lat,lon,timezone`);
        
        if (geoResponse.ok) {
          const geoData = await geoResponse.json();
          
          if (geoData.status === 'success') {
            location_info = `${geoData.city || 'Unknown'}, ${geoData.regionName || geoData.region || ''}, ${geoData.country || 'Unknown'}`;
            console.log('✅ Location resolved:', location_info);
          } else {
            console.log('⚠️ IP geolocation lookup failed:', geoData.message);
          }
        }
      } catch (geoError) {
        console.error('❌ Error fetching geolocation:', geoError);
        // Continue without location info
      }
    }

    // Prepare log entry
    const logEntry = {
      user_id: body.user_id || null,
      email: body.email,
      event_type: body.event_type,
      ip_address,
      user_agent,
      device_info,
      location_info: location_info,
      success: body.success,
      error_message: body.error_message || null,
      created_at: new Date().toISOString()
    };

    // Insert into session_activity_log table
    const { data, error } = await supabaseClient
      .from('session_activity_log')
      .insert(logEntry)
      .select()
      .single();

    if (error) {
      console.error('❌ Error logging auth activity:', error);
      throw error;
    }

    console.log('✅ Auth activity logged successfully:', data.id);

    return new Response(
      JSON.stringify({ 
        success: true, 
        log_id: data.id,
        message: 'Activity logged successfully' 
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200 
      }
    );

  } catch (error) {
    console.error('❌ Function error:', error);
    
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error.message 
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400 
      }
    );
  }
});
