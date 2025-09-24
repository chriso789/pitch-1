import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const supabase = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
);

interface BilltrustAuthRequest {
  email: string;
  password: string;
  supplierAccountId?: string;
}

interface BilltrustLoginResponse {
  status: string;
  userId: string;
  email: string;
  accessToken: string;
  expiresIn: number;
  tenants: Array<{
    tenantId: string;
    tenantName: string;
    isPartner: boolean;
  }>;
  defaultTenantId: string;
}

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { email, password, supplierAccountId }: BilltrustAuthRequest = await req.json();

    console.log(`Attempting Billtrust login for: ${email}`);

    // Login to Billtrust SRS
    const billtrustResponse = await fetch('https://secure.billtrust.com/srsicorp/ig/signin', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      body: new URLSearchParams({
        'username': email,
        'password': password,
        'remember': 'false'
      }).toString()
    });

    if (!billtrustResponse.ok) {
      const errorText = await billtrustResponse.text();
      console.error('Billtrust login failed:', errorText);
      return new Response(
        JSON.stringify({ 
          error: 'Authentication failed', 
          details: errorText 
        }),
        { 
          status: 401, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    const responseText = await billtrustResponse.text();
    console.log('Billtrust SRS response:', responseText);

    // Check if login was successful (SRS may return different formats)
    let loginData: any = {};
    let isSuccess = false;

    try {
      // Try to parse as JSON first
      loginData = JSON.parse(responseText);
      isSuccess = loginData.status === 'LOGIN_SUCCESS' || loginData.success === true;
    } catch {
      // If not JSON, check for redirect or success indicators in HTML
      isSuccess = responseText.includes('dashboard') || 
                  responseText.includes('success') ||
                  !responseText.includes('error') && !responseText.includes('invalid');
      
      // Extract any relevant data from the response
      if (isSuccess) {
        loginData = {
          status: 'LOGIN_SUCCESS',
          accessToken: 'srs-session-token', // Placeholder - would extract from cookies/headers
          tenantId: 'srs-tenant',
          email: email
        };
      }
    }

    if (!isSuccess) {
      return new Response(
        JSON.stringify({ 
          error: 'Login failed', 
          details: 'Invalid credentials or login failed',
          response: responseText.substring(0, 500) // First 500 chars for debugging
        }),
        { 
          status: 401, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    // For SRS, we may not have traditional API key generation
    // Instead, we'll use session-based authentication
    const sessionCookies = billtrustResponse.headers.get('set-cookie') || '';
    
    // Update supplier account with SRS credentials
    if (supplierAccountId) {
      const { error: updateError } = await supabase
        .from('supplier_accounts')
        .update({
          billtrust_tenant_id: loginData.tenantId || 'srs-tenant',
          api_key_id: null, // SRS doesn't use API keys
          encrypted_credentials: {
            accessToken: loginData.accessToken || 'srs-session',
            sessionCookies: sessionCookies,
            loginEmail: email,
            expiresIn: 3600 // 1 hour default
          },
          connection_status: 'connected',
          last_sync_at: new Date().toISOString(),
          last_error: null
        })
        .eq('id', supplierAccountId);

      if (updateError) {
        console.error('Failed to update supplier account:', updateError);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        tenantId: loginData.tenantId || 'srs-tenant',
        tenantName: 'SRS Corp',
        accessToken: loginData.accessToken || 'srs-session',
        sessionCookies: sessionCookies,
        apiKey: null, // SRS uses session-based auth
        keyId: null,
        expiresIn: loginData.expiresIn || 3600
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );

  } catch (error) {
    console.error('Error in billtrust-auth:', error);
    return new Response(
      JSON.stringify({ 
        error: 'Internal server error', 
        details: error.message 
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});