import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const QBO_CLIENT_ID = Deno.env.get('QBO_CLIENT_ID');
const QBO_CLIENT_SECRET = Deno.env.get('QBO_CLIENT_SECRET');
const QBO_REDIRECT_URI = Deno.env.get('QBO_REDIRECT_URI');
const QBO_AUTH_URL = 'https://appcenter.intuit.com/connect/oauth2';
const QBO_TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  x_refresh_token_expires_in: number;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: {
          headers: { Authorization: req.headers.get('Authorization')! },
        },
      }
    );

    // Verify user is authenticated
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      throw new Error('Unauthorized');
    }

    // Get user's tenant
    const { data: profile } = await supabase
      .from('profiles')
      .select('tenant_id, role')
      .eq('id', user.id)
      .single();

    if (!profile || !['admin', 'master'].includes(profile.role)) {
      throw new Error('Insufficient permissions');
    }

    const url = new URL(req.url);
    const action = url.searchParams.get('action');

    // Step 1: Initiate OAuth
    if (action === 'initiate') {
      const state = crypto.randomUUID();
      const scope = 'com.intuit.quickbooks.accounting openid email profile';
      
      // Store state in session for CSRF protection
      const authUrl = `${QBO_AUTH_URL}?` + new URLSearchParams({
        client_id: QBO_CLIENT_ID!,
        redirect_uri: QBO_REDIRECT_URI!,
        response_type: 'code',
        scope,
        state,
      });

      return new Response(
        JSON.stringify({ authUrl, state }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Step 2: Handle OAuth callback
    if (action === 'callback') {
      const { code, realmId, state } = await req.json();

      if (!code || !realmId) {
        throw new Error('Missing code or realmId');
      }

      // Exchange code for tokens
      const tokenResponse = await fetch(QBO_TOKEN_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json',
          'Authorization': `Basic ${btoa(`${QBO_CLIENT_ID}:${QBO_CLIENT_SECRET}`)}`,
        },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: QBO_REDIRECT_URI!,
        }),
      });

      if (!tokenResponse.ok) {
        const error = await tokenResponse.text();
        console.error('Token exchange failed:', error);
        throw new Error('Failed to exchange authorization code');
      }

      const tokens: TokenResponse = await tokenResponse.json();

      // Get company info
      const companyResponse = await fetch(
        `https://quickbooks.api.intuit.com/v3/company/${realmId}/companyinfo/${realmId}?minorversion=75`,
        {
          headers: {
            'Authorization': `Bearer ${tokens.access_token}`,
            'Accept': 'application/json',
          },
        }
      );

      const companyData = await companyResponse.json();
      const companyName = companyData.CompanyInfo?.CompanyName || 'Unknown';

      // Calculate token expiry
      const tokenExpiresAt = new Date(Date.now() + tokens.expires_in * 1000);

      // Store connection
      const { data: connection, error: insertError } = await supabase
        .from('qbo_connections')
        .upsert({
          tenant_id: profile.tenant_id,
          realm_id: realmId,
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          token_expires_at: tokenExpiresAt.toISOString(),
          scopes: 'com.intuit.quickbooks.accounting openid email profile',
          connected_by: user.id,
          is_active: true,
          qbo_company_name: companyName,
          metadata: {
            company_info: companyData.CompanyInfo,
          },
        }, {
          onConflict: 'tenant_id,realm_id',
        })
        .select()
        .single();

      if (insertError) {
        console.error('Failed to store connection:', insertError);
        throw new Error('Failed to store connection');
      }

      return new Response(
        JSON.stringify({
          success: true,
          connection: {
            id: connection.id,
            realmId: connection.realm_id,
            companyName: connection.qbo_company_name,
          },
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Step 3: Refresh token
    if (action === 'refresh') {
      const { data: connection } = await supabase
        .from('qbo_connections')
        .select('*')
        .eq('tenant_id', profile.tenant_id)
        .eq('is_active', true)
        .single();

      if (!connection) {
        throw new Error('No active QBO connection found');
      }

      const tokenResponse = await fetch(QBO_TOKEN_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json',
          'Authorization': `Basic ${btoa(`${QBO_CLIENT_ID}:${QBO_CLIENT_SECRET}`)}`,
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: connection.refresh_token,
        }),
      });

      if (!tokenResponse.ok) {
        throw new Error('Failed to refresh token');
      }

      const tokens: TokenResponse = await tokenResponse.json();
      const tokenExpiresAt = new Date(Date.now() + tokens.expires_in * 1000);

      await supabase
        .from('qbo_connections')
        .update({
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          token_expires_at: tokenExpiresAt.toISOString(),
          last_refresh_at: new Date().toISOString(),
        })
        .eq('id', connection.id);

      return new Response(
        JSON.stringify({ success: true }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Step 4: Disconnect
    if (action === 'disconnect') {
      await supabase
        .from('qbo_connections')
        .update({ is_active: false })
        .eq('tenant_id', profile.tenant_id);

      return new Response(
        JSON.stringify({ success: true }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    throw new Error('Invalid action');

  } catch (error) {
    console.error('Error in qbo-oauth-connect:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
