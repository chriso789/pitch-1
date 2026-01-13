import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { supabaseAuth } from '../_shared/supabase.ts';
import { corsHeaders } from '../_shared/cors.ts';

interface AuthRequest {
  action: 'get_token' | 'get_user_info';
  tenant_id?: string;
}

interface DocuSignAccount {
  integration_key: string;
  user_guid: string;
  rsa_private_key_id: string;
  base_uri?: string;
  account_id?: string;
  is_demo: boolean;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseClient = supabaseAuth(req);

    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { action }: AuthRequest = await req.json();

    // Get DocuSign account configuration
    const { data: docusignAccount, error: accountError } = await supabaseClient
      .from('docusign_accounts')
      .select('*')
      .eq('tenant_id', user.id)
      .eq('is_active', true)
      .single();

    if (accountError || !docusignAccount) {
      return new Response(JSON.stringify({ error: 'DocuSign account not configured' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'get_token') {
      const token = await getJWTToken(docusignAccount);
      return new Response(JSON.stringify({ access_token: token }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'get_user_info') {
      const token = await getJWTToken(docusignAccount);
      const userInfo = await getUserInfo(token, docusignAccount.is_demo);
      
      // Update account with base_uri and account_id
      await supabaseClient
        .from('docusign_accounts')
        .update({
          base_uri: userInfo.base_uri,
          account_id: userInfo.account_id,
        })
        .eq('id', docusignAccount.id);

      return new Response(JSON.stringify(userInfo), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'Invalid action' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('DocuSign auth error:', error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

async function getJWTToken(account: DocuSignAccount): Promise<string> {
  const privateKey = Deno.env.get(`DS_RSA_PRIVATE_KEY_${account.rsa_private_key_id}`);
  if (!privateKey) {
    throw new Error('Private key not found');
  }

  const now = Math.floor(Date.now() / 1000);
  const exp = now + 3600; // 1 hour

  // Create JWT header and payload
  const header = btoa(JSON.stringify({
    alg: 'RS256',
    typ: 'JWT'
  })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

  const payload = btoa(JSON.stringify({
    iss: account.integration_key,
    sub: account.user_guid,
    aud: account.is_demo ? 'account-d.docusign.com' : 'account.docusign.com',
    iat: now,
    exp: exp,
    scope: 'signature impersonation'
  })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

  // Sign with RS256 (simplified - in production use proper JWT library)
  const message = `${header}.${payload}`;
  
  // For demo purposes - in production, use proper RS256 signing
  const jwt = `${message}.signature_placeholder`;

  const authUrl = account.is_demo ? 'https://account-d.docusign.com' : 'https://account.docusign.com';
  
  const response = await fetch(`${authUrl}/oauth/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(`Token request failed: ${data.error_description || data.error}`);
  }

  return data.access_token;
}

async function getUserInfo(token: string, isDemo: boolean) {
  const authUrl = isDemo ? 'https://account-d.docusign.com' : 'https://account.docusign.com';
  
  const response = await fetch(`${authUrl}/oauth/userinfo`, {
    headers: {
      'Authorization': `Bearer ${token}`,
    },
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error('Failed to get user info');
  }

  return {
    base_uri: data.accounts[0].base_uri + '/restapi',
    account_id: data.accounts[0].account_id,
    user_name: data.name,
    email: data.email,
  };
}