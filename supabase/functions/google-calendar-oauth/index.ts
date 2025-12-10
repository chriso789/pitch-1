import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const GOOGLE_OAUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const GOOGLE_CALENDAR_API = 'https://www.googleapis.com/calendar/v3';

// Simple encryption using base64 (in production, use proper encryption)
const encryptToken = (token: string): string => {
  return btoa(token);
};

const decryptToken = (encrypted: string): string => {
  return atob(encrypted);
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Client for auth verification
    const supabaseAuth = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        auth: {
          persistSession: false,
        },
      }
    );

    // Admin client for database operations (bypasses RLS)
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      {
        auth: {
          persistSession: false,
        },
      }
    );

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('No authorization header');
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userError } = await supabaseAuth.auth.getUser(token);

    if (userError || !user) {
      throw new Error('Unauthorized');
    }

    const { action, code, state, realmId } = await req.json();
    console.log(`Google Calendar OAuth action: ${action}`, { userId: user.id });

    const clientId = Deno.env.get('GOOGLE_CALENDAR_CLIENT_ID');
    const clientSecret = Deno.env.get('GOOGLE_CALENDAR_CLIENT_SECRET');
    
    // Get the origin from the request header for the frontend callback URL
    const origin = req.headers.get('origin') || req.headers.get('referer')?.replace(/\/$/, '') || '';
    const redirectUri = `${origin}/google-calendar/callback`;

    if (!clientId || !clientSecret) {
      throw new Error('Google Calendar credentials not configured');
    }

    // Get user's active tenant (supports multi-company switching)
    console.log('Fetching profile for user:', user.id);
    
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('active_tenant_id, tenant_id')
      .eq('id', user.id)
      .maybeSingle();

    console.log('Profile query result:', { profile, profileError });

    if (profileError) {
      console.error('Failed to fetch profile:', profileError);
      throw new Error(`Database error fetching profile: ${profileError.message}`);
    }

    if (!profile) {
      console.error('No profile found for user:', user.id);
      throw new Error('User profile not found. Please contact an administrator to set up your profile.');
    }

    const tenantId = profile.active_tenant_id || profile.tenant_id;
    console.log('Resolved tenant ID:', tenantId);
    
    if (!tenantId) {
      console.error('Profile exists but has no tenant_id:', profile);
      throw new Error('User tenant not found - profile has no tenant_id or active_tenant_id');
    }

    switch (action) {
      case 'initiate': {
        const scopes = [
          'https://www.googleapis.com/auth/calendar.events',
          'https://www.googleapis.com/auth/calendar.readonly',
        ].join(' ');

        const stateParam = btoa(JSON.stringify({ userId: user.id, tenantId, timestamp: Date.now() }));

        const authUrl = `${GOOGLE_OAUTH_URL}?` +
          `client_id=${encodeURIComponent(clientId)}&` +
          `redirect_uri=${encodeURIComponent(redirectUri)}&` +
          `response_type=code&` +
          `scope=${encodeURIComponent(scopes)}&` +
          `access_type=offline&` +
          `prompt=consent&` +
          `state=${encodeURIComponent(stateParam)}`;

        console.log('Generated Google OAuth URL');

        return new Response(
          JSON.stringify({ authUrl, state: stateParam }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'callback': {
        if (!code || !state) {
          throw new Error('Missing authorization code or state');
        }

        // Verify state
        const stateData = JSON.parse(atob(state));
        if (stateData.userId !== user.id) {
          throw new Error('Invalid state parameter');
        }

        // Exchange code for tokens
        const tokenResponse = await fetch(GOOGLE_TOKEN_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            code,
            client_id: clientId,
            client_secret: clientSecret,
            redirect_uri: redirectUri,
            grant_type: 'authorization_code',
          }),
        });

        if (!tokenResponse.ok) {
          const error = await tokenResponse.text();
          console.error('Token exchange failed:', error);
          throw new Error('Failed to exchange authorization code');
        }

        const tokens = await tokenResponse.json();
        console.log('Successfully exchanged code for tokens');

        // Get calendar info
        const calendarResponse = await fetch(`${GOOGLE_CALENDAR_API}/users/me/calendarList/primary`, {
          headers: { Authorization: `Bearer ${tokens.access_token}` },
        });

        let calendarId = 'primary';
        let calendarName = 'Primary Calendar';

        if (calendarResponse.ok) {
          const calendar = await calendarResponse.json();
          calendarId = calendar.id;
          calendarName = calendar.summary || 'Primary Calendar';
        }

        // Calculate token expiry
        const expiresAt = new Date(Date.now() + (tokens.expires_in * 1000));

        // Store connection in database
        const { error: upsertError } = await supabaseAdmin
          .from('google_calendar_connections')
          .upsert({
            user_id: user.id,
            tenant_id: tenantId,
            access_token_encrypted: encryptToken(tokens.access_token),
            refresh_token_encrypted: encryptToken(tokens.refresh_token),
            token_expires_at: expiresAt.toISOString(),
            calendar_id: calendarId,
            calendar_name: calendarName,
            is_active: true,
            connected_at: new Date().toISOString(),
          }, {
            onConflict: 'user_id,tenant_id',
          });

        if (upsertError) {
          console.error('Failed to store connection:', upsertError);
          throw new Error('Failed to store connection');
        }

        console.log('Successfully stored Google Calendar connection');

        return new Response(
          JSON.stringify({ 
            success: true, 
            calendarName,
            calendarId 
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'disconnect': {
        // Get current connection
        const { data: connection } = await supabaseAdmin
          .from('google_calendar_connections')
          .select('access_token_encrypted')
          .eq('user_id', user.id)
          .eq('tenant_id', tenantId)
          .single();

        if (connection) {
          // Revoke token with Google
          const accessToken = decryptToken(connection.access_token_encrypted);
          try {
            await fetch(`${GOOGLE_REVOKE_URL}?token=${accessToken}`, { method: 'POST' });
          } catch (error) {
            console.error('Failed to revoke token with Google:', error);
          }
        }

        // Mark as inactive in database
        const { error: updateError } = await supabaseAdmin
          .from('google_calendar_connections')
          .update({ is_active: false })
          .eq('user_id', user.id)
          .eq('tenant_id', tenantId);

        if (updateError) {
          throw new Error('Failed to disconnect');
        }

        console.log('Successfully disconnected Google Calendar');

        return new Response(
          JSON.stringify({ success: true }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'status': {
        // Get connection status
        const { data: connection } = await supabaseAdmin
          .from('google_calendar_connections')
          .select('calendar_name, calendar_id, connected_at, last_synced_at, is_active, token_expires_at')
          .eq('user_id', user.id)
          .eq('tenant_id', tenantId)
          .eq('is_active', true)
          .single();

        return new Response(
          JSON.stringify({ 
            connected: !!connection,
            connection: connection || null
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      default:
        throw new Error('Invalid action');
    }
  } catch (error) {
    console.error('Error in google-calendar-oauth:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        status: 400, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});
