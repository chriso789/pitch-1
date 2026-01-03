import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ConversationRequest {
  action: 'respond' | 'get_history' | 'classify_intent' | 'handoff';
  tenant_id: string;
  contact_id?: string;
  phone_number?: string;
  message?: string;
  conversation_id?: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body: ConversationRequest = await req.json();
    const { action, tenant_id, contact_id, phone_number, message, conversation_id } = body;

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

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');

    switch (action) {
      case 'respond': {
        if (!message || (!contact_id && !phone_number)) {
          return new Response(
            JSON.stringify({ success: false, error: 'message and contact_id or phone_number required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Get contact info
        let contact;
        if (contact_id) {
          const { data } = await supabaseAdmin
            .from('contacts')
            .select('*')
            .eq('id', contact_id)
            .single();
          contact = data;
        } else if (phone_number) {
          const { data } = await supabaseAdmin
            .from('contacts')
            .select('*')
            .eq('phone', phone_number)
            .eq('tenant_id', tenant_id)
            .single();
          contact = data;
        }

        // Get tenant info for context
        const { data: tenant } = await supabaseAdmin
          .from('tenants')
          .select('name, phone, website, settings')
          .eq('id', tenant_id)
          .single();

        // Get conversation history
        const { data: history } = await supabaseAdmin
          .from('sms_messages')
          .select('direction, body, created_at')
          .eq('contact_id', contact?.id || contact_id)
          .order('created_at', { ascending: false })
          .limit(10);

        const conversationContext = history?.reverse().map(m => ({
          role: m.direction === 'inbound' ? 'user' : 'assistant',
          content: m.body
        })) || [];

        if (!LOVABLE_API_KEY) {
          // Fallback response without AI
          const fallbackResponse = "Thanks for your message! A team member will get back to you shortly.";
          return new Response(
            JSON.stringify({ success: true, data: { response: fallbackResponse, ai_generated: false } }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Generate AI response
        const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${LOVABLE_API_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: 'google/gemini-2.5-flash',
            messages: [
              {
                role: 'system',
                content: `You are an SMS assistant for ${tenant?.name || 'our company'}, a construction/roofing company.
                
Your job is to:
- Answer questions about services and scheduling
- Help customers check project status
- Schedule appointments when possible
- Be friendly, professional, and concise (SMS format - keep responses under 160 characters when possible)
- If you can't help, offer to have a team member call them

Company info:
- Phone: ${tenant?.phone || 'our office'}
- Website: ${tenant?.website || 'our website'}

Customer info:
- Name: ${contact?.first_name || ''} ${contact?.last_name || ''}
- Has active project: ${contact?.has_active_project ? 'Yes' : 'Unknown'}

Keep responses brief and actionable for SMS format.`
              },
              ...conversationContext,
              { role: 'user', content: message }
            ],
            max_tokens: 200
          })
        });

        if (!aiResponse.ok) {
          console.error('[sms-conversation-ai] AI error:', await aiResponse.text());
          const fallbackResponse = "Thanks for your message! A team member will get back to you shortly.";
          return new Response(
            JSON.stringify({ success: true, data: { response: fallbackResponse, ai_generated: false } }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const aiData = await aiResponse.json();
        const generatedResponse = aiData.choices[0].message.content;

        // Queue the response
        await supabaseAdmin
          .from('message_queue')
          .insert({
            tenant_id,
            channel: 'sms',
            recipient: phone_number || contact?.phone,
            body: generatedResponse,
            metadata: { 
              ai_generated: true, 
              contact_id: contact?.id,
              conversation_id 
            }
          });

        console.log(`[sms-conversation-ai] Generated AI response for ${phone_number || contact_id}`);
        return new Response(
          JSON.stringify({ success: true, data: { response: generatedResponse, ai_generated: true } }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'get_history': {
        if (!contact_id && !phone_number) {
          return new Response(
            JSON.stringify({ success: false, error: 'contact_id or phone_number required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        let query = supabaseAdmin
          .from('sms_messages')
          .select('*')
          .eq('tenant_id', tenant_id)
          .order('created_at', { ascending: true });

        if (contact_id) {
          query = query.eq('contact_id', contact_id);
        }

        const { data: messages, error } = await query.limit(50);

        if (error) {
          return new Response(
            JSON.stringify({ success: false, error: 'Failed to get history' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        return new Response(
          JSON.stringify({ success: true, data: messages }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'classify_intent': {
        if (!message) {
          return new Response(
            JSON.stringify({ success: false, error: 'message required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        if (!LOVABLE_API_KEY) {
          return new Response(
            JSON.stringify({ success: true, data: { intent: 'unknown', confidence: 0.5 } }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${LOVABLE_API_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: 'google/gemini-2.5-flash',
            messages: [
              {
                role: 'system',
                content: `Classify the intent of this SMS message into one of these categories:
- schedule_appointment
- check_status
- request_quote
- complaint
- question
- greeting
- opt_out
- other

Respond with JSON: {"intent": "category", "confidence": 0.0-1.0, "entities": {}}`
              },
              { role: 'user', content: message }
            ],
            response_format: { type: 'json_object' }
          })
        });

        if (!aiResponse.ok) {
          return new Response(
            JSON.stringify({ success: true, data: { intent: 'unknown', confidence: 0.5 } }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const aiData = await aiResponse.json();
        const classification = JSON.parse(aiData.choices[0].message.content);

        return new Response(
          JSON.stringify({ success: true, data: classification }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'handoff': {
        if (!contact_id && !phone_number) {
          return new Response(
            JSON.stringify({ success: false, error: 'contact_id or phone_number required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Mark conversation for human handoff
        await supabaseAdmin
          .from('message_queue')
          .insert({
            tenant_id,
            channel: 'sms',
            recipient: phone_number,
            body: "I'm connecting you with a team member who can better assist you. They'll be in touch shortly!",
            metadata: { 
              handoff: true, 
              contact_id,
              requires_human_response: true
            }
          });

        // Create notification for team
        await supabaseAdmin
          .from('user_notifications')
          .insert({
            tenant_id,
            type: 'sms_handoff',
            title: 'SMS Conversation Needs Attention',
            message: `Customer at ${phone_number} needs human assistance`,
            metadata: { contact_id, phone_number }
          });

        console.log(`[sms-conversation-ai] Handed off conversation for ${phone_number}`);
        return new Response(
          JSON.stringify({ success: true, message: 'Conversation handed off to human' }),
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
    console.error('[sms-conversation-ai] Unexpected error:', error);
    return new Response(
      JSON.stringify({ success: false, error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
