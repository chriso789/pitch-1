import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface SMSRequest {
  action: 'process' | 'configure' | 'get_config' | 'test';
  tenant_id: string;
  from_number?: string;
  to_number?: string;
  message?: string;
  config?: {
    enabled?: boolean;
    keywords?: Record<string, string>;
    business_hours?: { start: string; end: string; timezone: string };
    after_hours_message?: string;
  };
}

const DEFAULT_KEYWORDS: Record<string, string> = {
  'STOP': 'You have been unsubscribed. Reply START to re-subscribe.',
  'HELP': 'For assistance, call us at {{company_phone}} or visit {{company_website}}',
  'QUOTE': 'Thanks for your interest! A team member will send you a quote shortly.',
  'STATUS': 'We\'ll check on your project status and get back to you shortly.',
  'SCHEDULE': 'To schedule an appointment, visit {{booking_link}} or call {{company_phone}}'
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body: SMSRequest = await req.json();
    const { action, tenant_id, from_number, to_number, message, config } = body;

    if (!action || !tenant_id) {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing action or tenant_id' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false } }
    );

    switch (action) {
      case 'process': {
        if (!from_number || !message) {
          return new Response(
            JSON.stringify({ success: false, error: 'from_number and message required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Get tenant config
        const { data: tenantConfig } = await supabaseAdmin
          .from('tenant_settings')
          .select('sms_auto_responder_config')
          .eq('tenant_id', tenant_id)
          .single();

        const smsConfig = tenantConfig?.sms_auto_responder_config || {};
        if (smsConfig.enabled === false) {
          return new Response(
            JSON.stringify({ success: true, data: { response: null, reason: 'auto-responder disabled' } }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Check for keyword triggers
        const upperMessage = message.toUpperCase().trim();
        const keywords = smsConfig.keywords || DEFAULT_KEYWORDS;
        
        for (const [keyword, response] of Object.entries(keywords)) {
          if (upperMessage === keyword || upperMessage.startsWith(keyword + ' ')) {
            // Handle STOP keyword specially
            if (keyword === 'STOP') {
              await supabaseAdmin
                .from('contacts')
                .update({ sms_opt_out: true })
                .eq('phone', from_number);
            }

            // Get tenant info for personalization
            const { data: tenant } = await supabaseAdmin
              .from('tenants')
              .select('name, phone, website')
              .eq('id', tenant_id)
              .single();

            const personalizedResponse = (response as string)
              .replace(/\{\{company_phone\}\}/g, tenant?.phone || 'our office')
              .replace(/\{\{company_website\}\}/g, tenant?.website || 'our website')
              .replace(/\{\{booking_link\}\}/g, `${tenant?.website}/book` || 'our booking page');

            // Queue response
            await supabaseAdmin
              .from('message_queue')
              .insert({
                tenant_id,
                channel: 'sms',
                recipient: from_number,
                body: personalizedResponse,
                metadata: { keyword_trigger: keyword, auto_response: true }
              });

            console.log(`[sms-auto-responder] Keyword "${keyword}" triggered for ${from_number}`);
            return new Response(
              JSON.stringify({ success: true, data: { response: personalizedResponse, keyword } }),
              { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
          }
        }

        // Check business hours
        const businessHours = smsConfig.business_hours;
        if (businessHours) {
          const now = new Date();
          const currentHour = now.getHours();
          const startHour = parseInt(businessHours.start?.split(':')[0] || '9');
          const endHour = parseInt(businessHours.end?.split(':')[0] || '17');

          if (currentHour < startHour || currentHour >= endHour) {
            const afterHoursMsg = smsConfig.after_hours_message || 
              'Thanks for your message! Our office is currently closed. We\'ll respond during business hours.';

            await supabaseAdmin
              .from('message_queue')
              .insert({
                tenant_id,
                channel: 'sms',
                recipient: from_number,
                body: afterHoursMsg,
                metadata: { after_hours: true, auto_response: true }
              });

            return new Response(
              JSON.stringify({ success: true, data: { response: afterHoursMsg, after_hours: true } }),
              { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
          }
        }

        // No auto-response triggered - will need AI or human response
        return new Response(
          JSON.stringify({ success: true, data: { response: null, reason: 'no trigger matched' } }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'configure': {
        if (!config) {
          return new Response(
            JSON.stringify({ success: false, error: 'config required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const { error } = await supabaseAdmin
          .from('tenant_settings')
          .upsert({
            tenant_id,
            sms_auto_responder_config: config,
            updated_at: new Date().toISOString()
          }, { onConflict: 'tenant_id' });

        if (error) {
          console.error('[sms-auto-responder] Configure error:', error);
          return new Response(
            JSON.stringify({ success: false, error: 'Failed to save config' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        console.log(`[sms-auto-responder] Updated config for tenant ${tenant_id}`);
        return new Response(
          JSON.stringify({ success: true }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'get_config': {
        const { data: tenantConfig } = await supabaseAdmin
          .from('tenant_settings')
          .select('sms_auto_responder_config')
          .eq('tenant_id', tenant_id)
          .single();

        return new Response(
          JSON.stringify({ 
            success: true, 
            data: tenantConfig?.sms_auto_responder_config || { 
              enabled: true, 
              keywords: DEFAULT_KEYWORDS 
            } 
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'test': {
        if (!message) {
          return new Response(
            JSON.stringify({ success: false, error: 'message required for test' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Simulate processing without sending
        const upperMessage = message.toUpperCase().trim();
        const { data: tenantConfig } = await supabaseAdmin
          .from('tenant_settings')
          .select('sms_auto_responder_config')
          .eq('tenant_id', tenant_id)
          .single();

        const keywords = tenantConfig?.sms_auto_responder_config?.keywords || DEFAULT_KEYWORDS;

        for (const [keyword, response] of Object.entries(keywords)) {
          if (upperMessage === keyword || upperMessage.startsWith(keyword + ' ')) {
            return new Response(
              JSON.stringify({ 
                success: true, 
                data: { 
                  would_respond: true, 
                  keyword, 
                  response,
                  note: 'Test mode - no message sent'
                } 
              }),
              { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
          }
        }

        return new Response(
          JSON.stringify({ 
            success: true, 
            data: { 
              would_respond: false, 
              reason: 'No keyword match',
              note: 'Test mode - message would go to AI or human'
            } 
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      default:
        return new Response(
          JSON.stringify({ success: false, error: 'Invalid action' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }

  } catch (error) {
    console.error('[sms-auto-responder] Unexpected error:', error);
    return new Response(
      JSON.stringify({ success: false, error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
