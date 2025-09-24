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

    // Login to Billtrust
    const billtrustResponse = await fetch('https://arc-aegis.billtrust.com/authentication/v1/login', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email,
        password
      })
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

    const loginData: BilltrustLoginResponse = await billtrustResponse.json();

    if (loginData.status !== 'LOGIN_SUCCESS') {
      return new Response(
        JSON.stringify({ 
          error: 'Login failed', 
          status: loginData.status 
        }),
        { 
          status: 401, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    // Generate API Key for permanent access
    const tenantId = loginData.defaultTenantId;
    
    const apiKeyResponse = await fetch(`https://arc-aegis.billtrust.com/authentication/v1/tenants/${tenantId}/users/profile/api-key`, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'X-Billtrust-Auth': loginData.accessToken
      }
    });

    let apiKeyData = null;
    if (apiKeyResponse.ok) {
      apiKeyData = await apiKeyResponse.json();
      console.log('API Key generated successfully');
    } else {
      console.warn('Failed to generate API key, will use token auth');
    }

    // Update supplier account with credentials
    if (supplierAccountId) {
      const { error: updateError } = await supabase
        .from('supplier_accounts')
        .update({
          billtrust_tenant_id: tenantId,
          api_key_id: apiKeyData?.keyId || null,
          encrypted_credentials: {
            accessToken: loginData.accessToken,
            apiKey: apiKeyData?.apiKey || null,
            expiresIn: loginData.expiresIn,
            tenants: loginData.tenants
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
        tenantId,
        tenantName: loginData.tenants.find(t => t.tenantId === tenantId)?.tenantName,
        accessToken: loginData.accessToken,
        apiKey: apiKeyData?.apiKey || null,
        keyId: apiKeyData?.keyId || null,
        expiresIn: loginData.expiresIn
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