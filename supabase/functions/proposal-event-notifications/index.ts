import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface NotificationPayload {
  estimateId: string;
  eventType: 'viewed' | 'tier_selected' | 'signed';
  customerName?: string;
  propertyAddress?: string;
  selectedTier?: string;
  tierAmount?: number;
  customerPhone?: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const payload: NotificationPayload = await req.json();
    const { estimateId, eventType, customerName, propertyAddress, selectedTier, tierAmount, customerPhone } = payload;

    console.log(`[Proposal Notification] Processing ${eventType} event for estimate ${estimateId}`);

    // Get the estimate and associated rep info
    const { data: estimate, error: estimateError } = await supabaseClient
      .from('enhanced_estimates')
      .select(`
        *,
        created_by_profile:profiles!enhanced_estimates_created_by_fkey (
          id,
          full_name,
          phone
        )
      `)
      .eq('id', estimateId)
      .single();

    if (estimateError || !estimate) {
      console.error('Estimate not found:', estimateError);
      return new Response(JSON.stringify({ error: 'Estimate not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Update estimate tracking fields
    const updateFields: Record<string, any> = {};
    if (eventType === 'viewed') {
      updateFields.last_viewed_at = new Date().toISOString();
      updateFields.view_count = (estimate.view_count || 0) + 1;
      if (!estimate.first_viewed_at) {
        updateFields.first_viewed_at = new Date().toISOString();
      }
    } else if (eventType === 'tier_selected') {
      updateFields.tier_selected_at = new Date().toISOString();
      if (selectedTier) {
        updateFields.selected_tier = selectedTier;
      }
    } else if (eventType === 'signed') {
      updateFields.signed_at = new Date().toISOString();
      updateFields.status = 'accepted';
    }

    if (Object.keys(updateFields).length > 0) {
      await supabaseClient
        .from('enhanced_estimates')
        .update(updateFields)
        .eq('id', estimateId);
    }

    // Get notification preferences for the rep
    const repId = estimate.created_by;
    if (!repId) {
      console.log('No rep assigned to estimate');
      return new Response(JSON.stringify({ success: true, notified: false }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const { data: prefs } = await supabaseClient
      .from('proposal_notification_preferences')
      .select('*')
      .eq('user_id', repId)
      .eq('tenant_id', estimate.tenant_id)
      .single();

    // Default to sending SMS if no preferences set
    const shouldSendSMS = prefs 
      ? (eventType === 'viewed' && prefs.sms_on_view) ||
        (eventType === 'tier_selected' && prefs.sms_on_tier_select) ||
        (eventType === 'signed' && prefs.sms_on_signature)
      : true; // Default to true if no prefs

    if (!shouldSendSMS) {
      console.log('SMS notifications disabled for this event type');
      return new Response(JSON.stringify({ success: true, notified: false }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Get rep's phone number
    const repPhone = prefs?.phone_number || estimate.created_by_profile?.phone;
    if (!repPhone) {
      console.log('No phone number found for rep');
      return new Response(JSON.stringify({ success: true, notified: false, reason: 'no_phone' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Build SMS message based on event type
    let smsMessage = '';
    const custName = customerName || estimate.customer_name || 'Customer';
    const address = propertyAddress || estimate.customer_address || '';

    switch (eventType) {
      case 'viewed':
        smsMessage = `[PITCH] ${custName} just viewed your proposal${address ? ` for ${address}` : ''}. Follow up now!`;
        break;
      case 'tier_selected':
        const tier = selectedTier?.toUpperCase() || 'SELECTED';
        const amount = tierAmount ? `($${tierAmount.toLocaleString()})` : '';
        smsMessage = `[PITCH] ${custName} selected the ${tier} tier ${amount}! Ready to sign${customerPhone ? `. Call: ${customerPhone}` : ''}`;
        break;
      case 'signed':
        smsMessage = `[PITCH] 🎉 SIGNED! ${custName} accepted proposal #${estimate.estimate_number || estimateId.slice(0, 8)}. New customer!`;
        break;
    }

    // Get tenant's Telnyx number
    const { data: tenantNumbers } = await supabaseClient
      .from('provisioned_phone_numbers')
      .select('phone_number')
      .eq('tenant_id', estimate.tenant_id)
      .eq('is_primary', true)
      .limit(1);

    const fromNumber = tenantNumbers?.[0]?.phone_number;
    if (!fromNumber) {
      console.log('No Telnyx number configured for tenant');
      return new Response(JSON.stringify({ success: true, notified: false, reason: 'no_from_number' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Send SMS via Telnyx
    const telnyxApiKey = Deno.env.get('TELNYX_API_KEY');
    if (!telnyxApiKey) {
      console.error('TELNYX_API_KEY not configured');
      return new Response(JSON.stringify({ success: false, error: 'SMS not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const smsResponse = await fetch('https://api.telnyx.com/v2/messages', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${telnyxApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: fromNumber,
        to: repPhone,
        text: smsMessage
      })
    });

    if (!smsResponse.ok) {
      const errorText = await smsResponse.text();
      console.error('Telnyx SMS failed:', errorText);
      return new Response(JSON.stringify({ success: false, error: 'SMS send failed' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const smsResult = await smsResponse.json();
    console.log(`[Proposal Notification] SMS sent successfully to ${repPhone}`);

    // Cancel pending follow-ups if signed
    if (eventType === 'signed') {
      await supabaseClient
        .from('proposal_follow_ups')
        .update({ status: 'cancelled' })
        .eq('estimate_id', estimateId)
        .eq('status', 'pending');
    }

    return new Response(JSON.stringify({ 
      success: true, 
      notified: true,
      messageId: smsResult.data?.id 
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('[Proposal Notification] Error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
