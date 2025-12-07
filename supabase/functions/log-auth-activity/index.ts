import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Valid event types - only accept known enum values
const VALID_EVENT_TYPES = [
  'login_success', 
  'login_failed', 
  'logout', 
  'session_refresh', 
  'password_reset_request'
] as const;

type EventType = typeof VALID_EVENT_TYPES[number];

// Rate limiting store (in-memory, per function instance)
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 10; // requests per minute
const RATE_WINDOW = 60000; // 1 minute in ms

function checkRateLimit(userId: string): boolean {
  const now = Date.now();
  const userLimit = rateLimitMap.get(userId);
  
  if (!userLimit || now > userLimit.resetAt) {
    rateLimitMap.set(userId, { count: 1, resetAt: now + RATE_WINDOW });
    return true;
  }
  
  if (userLimit.count >= RATE_LIMIT) {
    return false;
  }
  
  userLimit.count++;
  return true;
}

interface AuthActivityRequest {
  event_type: string;
  success?: boolean;
  error_message?: string;
}

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Create client with forwarded auth for authentication check
    const authClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { 
        global: { 
          headers: { Authorization: req.headers.get('Authorization')! } 
        } 
      }
    );

    // Get authenticated user from JWT - this is the secure way
    const { data: { user }, error: authError } = await authClient.auth.getUser();
    
    // Use service role for insert (bypasses RLS issues with users table reference)
    const serviceClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );
    
    if (authError || !user) {
      console.warn('⚠️ Unauthenticated request to log-auth-activity');
      return new Response(
        JSON.stringify({ success: false, error: 'Authentication required' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 401 }
      );
    }

    // Rate limiting check - prevent log flooding attacks
    if (!checkRateLimit(user.id)) {
      console.warn(`⚠️ Rate limit exceeded for user ${user.id}`);
      return new Response(
        JSON.stringify({ success: false, error: 'Rate limit exceeded. Max 10 events per minute.' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 429 }
      );
    }

    const body = await req.json() as AuthActivityRequest;
    
    // Validate event_type against allowed enum values
    if (!body.event_type || !VALID_EVENT_TYPES.includes(body.event_type as EventType)) {
      console.warn(`⚠️ Invalid event_type: ${body.event_type}`);
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: `Invalid event_type. Must be one of: ${VALID_EVENT_TYPES.join(', ')}` 
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    console.log('📝 Logging auth activity:', {
      user_id: user.id,
      email: user.email,
      event_type: body.event_type,
      timestamp: new Date().toISOString()
    });

    // Extract info from request headers (more reliable than body)
    const user_agent = req.headers.get('user-agent') || 'Unknown';
    const ip_address = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 
                       req.headers.get('x-real-ip') || 
                       'Unknown';

    // Parse device info from user agent
    let device_info = 'Desktop';
    if (user_agent.toLowerCase().includes('mobile')) {
      device_info = 'Mobile';
    } else if (user_agent.toLowerCase().includes('tablet')) {
      device_info = 'Tablet';
    }

    // Prepare log entry - IMPORTANT: use authenticated user's info from JWT, not body params
    const logEntry = {
      user_id: user.id,           // From JWT, NOT from request body
      email: user.email,          // From JWT, NOT from request body
      event_type: body.event_type as EventType,
      ip_address,
      user_agent,
      device_info,
      location_info: null,        // Skip external geolocation API for security
      success: body.success ?? true,
      error_message: typeof body.error_message === 'string' 
        ? body.error_message.slice(0, 500)  // Limit error message length
        : null,
      created_at: new Date().toISOString()
    };

    // Insert using service role to bypass RLS issues
    const { data, error } = await serviceClient
      .from('session_activity_log')
      .insert(logEntry)
      .select('id')
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
        error: 'Failed to log activity' 
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400 
      }
    );
  }
});
