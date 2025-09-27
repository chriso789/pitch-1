import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { corsHeaders } from "../_shared/cors.ts";

interface EmbeddedViewRequest {
  agreement_instance_id: string;
  view_type: 'sender' | 'recipient';
  recipient_role?: string;
  return_url: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { auth: { persistSession: false }, global: { headers: { Authorization: req.headers.get('Authorization')! } } }
    );

    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { agreement_instance_id, view_type, recipient_role, return_url }: EmbeddedViewRequest = await req.json();

    // Get agreement instance
    const { data: agreementInstance, error: instanceError } = await supabaseClient
      .from('agreement_instances')
      .select('*')
      .eq('id', agreement_instance_id)
      .single();

    if (instanceError || !agreementInstance) {
      return new Response(JSON.stringify({ error: 'Agreement instance not found' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get DocuSign account
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

    // Get access token
    const tokenResponse = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/docusign-auth`, {
      method: 'POST',
      headers: {
        'Authorization': req.headers.get('Authorization')!,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ action: 'get_token' }),
    });

    const { access_token } = await tokenResponse.json();
    if (!access_token) {
      throw new Error('Failed to get access token');
    }

    let viewUrl: string;

    if (view_type === 'sender') {
      // Create sender view for embedded sending
      const senderViewResponse = await fetch(
        `${docusignAccount.base_uri}/v2.1/accounts/${docusignAccount.account_id}/envelopes/${agreementInstance.envelope_id}/views/sender`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            returnUrl: return_url,
          }),
        }
      );

      if (!senderViewResponse.ok) {
        const errorData = await senderViewResponse.json();
        throw new Error(`DocuSign sender view API error: ${errorData.message || 'Unknown error'}`);
      }

      const senderViewData = await senderViewResponse.json();
      viewUrl = senderViewData.url;

    } else if (view_type === 'recipient') {
      // Get recipient for embedded signing
      if (!recipient_role) {
        return new Response(JSON.stringify({ error: 'Recipient role required for recipient view' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const { data: recipient, error: recipientError } = await supabaseClient
        .from('recipients')
        .select('*')
        .eq('agreement_instance_id', agreement_instance_id)
        .eq('role', recipient_role)
        .single();

      if (recipientError || !recipient) {
        return new Response(JSON.stringify({ error: 'Recipient not found' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      if (!recipient.client_user_id) {
        return new Response(JSON.stringify({ error: 'Recipient not configured for embedded signing' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Create recipient view for embedded signing
      const recipientViewResponse = await fetch(
        `${docusignAccount.base_uri}/v2.1/accounts/${docusignAccount.account_id}/envelopes/${agreementInstance.envelope_id}/views/recipient`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            returnUrl: return_url,
            authenticationMethod: 'none',
            email: recipient.email,
            userName: recipient.name,
            recipientId: recipient.recipient_id,
            clientUserId: recipient.client_user_id,
          }),
        }
      );

      if (!recipientViewResponse.ok) {
        const errorData = await recipientViewResponse.json();
        throw new Error(`DocuSign recipient view API error: ${errorData.message || 'Unknown error'}`);
      }

      const recipientViewData = await recipientViewResponse.json();
      viewUrl = recipientViewData.url;

    } else {
      return new Response(JSON.stringify({ error: 'Invalid view type' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({
      success: true,
      view_url: viewUrl,
      expires_in: 300, // 5 minutes
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Embedded view error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});