import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { supabaseAuth } from '../_shared/supabase.ts';
import { corsHeaders } from '../_shared/cors.ts';

interface CreateEnvelopeRequest {
  template_slug: string;
  crm_object_type?: string;
  crm_object_id?: string;
  contact_id?: string;
  project_id?: string;
  pipeline_entry_id?: string;
  recipients: Array<{
    role: string;
    name: string;
    email: string;
    clientUserId?: string;
    authType?: string;
  }>;
  email_subject?: string;
  envelope_custom_fields?: Record<string, string>;
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

    const requestBody: CreateEnvelopeRequest = await req.json();
    const { template_slug, recipients, email_subject, envelope_custom_fields } = requestBody;

    // Get agreement template
    const { data: template, error: templateError } = await supabaseClient
      .from('agreement_templates')
      .select('*')
      .eq('slug', template_slug)
      .eq('is_active', true)
      .single();

    if (templateError || !template) {
      return new Response(JSON.stringify({ error: 'Template not found' }), {
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

    // Create envelope via DocuSign API
    const envelopeDefinition = {
      emailSubject: email_subject || `Please sign: ${template.name}`,
      status: 'created', // Draft status
      compositeTemplates: [
        {
          serverTemplates: [
            {
              sequence: '1',
              templateId: template.docusign_template_id,
            }
          ],
          inlineTemplates: [
            {
              sequence: '2',
              recipients: {
                signers: recipients.map((recipient, index) => ({
                  roleName: recipient.role,
                  name: recipient.name,
                  email: recipient.email,
                  recipientId: String(index + 1),
                  clientUserId: recipient.clientUserId,
                  routingOrder: index + 1,
                }))
              }
            }
          ]
        }
      ],
      customFields: envelope_custom_fields ? {
        textCustomFields: Object.entries(envelope_custom_fields).map(([name, value]) => ({
          name,
          value,
        }))
      } : undefined,
    };

    const envelopeResponse = await fetch(`${docusignAccount.base_uri}/v2.1/accounts/${docusignAccount.account_id}/envelopes`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ envelopeDefinition }),
    });

    const envelopeData = await envelopeResponse.json();
    if (!envelopeResponse.ok) {
      throw new Error(`DocuSign API error: ${envelopeData.message || 'Unknown error'}`);
    }

    // Create agreement instance
    const { data: agreementInstance, error: instanceError } = await supabaseClient
      .from('agreement_instances')
      .insert({
        tenant_id: user.id,
        template_slug,
        envelope_id: envelopeData.envelopeId,
        status: 'draft',
        crm_object_type: requestBody.crm_object_type,
        crm_object_id: requestBody.crm_object_id,
        contact_id: requestBody.contact_id,
        project_id: requestBody.project_id,
        pipeline_entry_id: requestBody.pipeline_entry_id,
        sender_user_id: user.id,
        email_subject: email_subject || `Please sign: ${template.name}`,
        envelope_custom_fields: envelope_custom_fields || {},
      })
      .select()
      .single();

    if (instanceError) {
      console.error('Failed to create agreement instance:', instanceError);
      throw new Error('Failed to create agreement instance');
    }

    // Create recipients
    const recipientInserts = recipients.map((recipient, index) => ({
      tenant_id: user.id,
      agreement_instance_id: agreementInstance.id,
      role: recipient.role,
      name: recipient.name,
      email: recipient.email,
      recipient_id: String(index + 1),
      client_user_id: recipient.clientUserId,
      auth_type: recipient.authType || 'none',
      routing_order: index + 1,
    }));

    await supabaseClient
      .from('recipients')
      .insert(recipientInserts);

    return new Response(JSON.stringify({
      success: true,
      agreement_instance_id: agreementInstance.id,
      envelope_id: envelopeData.envelopeId,
      status: 'draft',
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Create envelope error:', error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});