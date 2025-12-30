// ============================================================================
// PROPOSAL WEBHOOK - Real-time Rep Notifications
// ============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface WebhookPayload {
  event: 'viewed' | 'tier_selected' | 'accepted' | 'signed';
  estimateId: string;
  tenantId: string;
  viewerEmail?: string;
  selectedTier?: 'good' | 'better' | 'best';
  metadata?: Record<string, unknown>;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const payload: WebhookPayload = await req.json();
    const { event, estimateId, tenantId, viewerEmail, selectedTier, metadata } = payload;

    console.log(`[proposal-webhook] Event: ${event}, Estimate: ${estimateId}`);

    // Get estimate details
    const { data: estimate } = await supabase
      .from('enhanced_estimates')
      .select(`
        *,
        pipeline_entries (
          id,
          assigned_to
        )
      `)
      .eq('id', estimateId)
      .single();

    if (!estimate) {
      throw new Error('Estimate not found');
    }

    // Determine recipient (assigned rep or created_by)
    const recipientUserId = estimate.pipeline_entries?.assigned_to || estimate.created_by;

    if (!recipientUserId) {
      console.log('[proposal-webhook] No recipient found for notification');
      return new Response(JSON.stringify({ ok: true, notified: false }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Build notification message based on event type
    let title: string;
    let message: string;
    let priority: 'low' | 'medium' | 'high' | 'urgent' = 'medium';

    const customerName = estimate.customer_name || 'A customer';

    switch (event) {
      case 'viewed':
        title = '👀 Proposal Viewed';
        message = `${customerName} just opened your proposal #${estimate.estimate_number}`;
        priority = 'low';
        break;

      case 'tier_selected':
        const tierLabel = selectedTier ? selectedTier.charAt(0).toUpperCase() + selectedTier.slice(1) : 'a';
        title = '🎯 Tier Selected';
        message = `${customerName} is considering the ${tierLabel} option on proposal #${estimate.estimate_number}`;
        priority = 'medium';
        break;

      case 'accepted':
        title = '✅ Proposal Accepted!';
        message = `${customerName} accepted the ${selectedTier || ''} option on proposal #${estimate.estimate_number}. Awaiting signature.`;
        priority = 'high';
        break;

      case 'signed':
        title = '🎉 DEAL WON!';
        message = `${customerName} signed proposal #${estimate.estimate_number}! Time to celebrate! 🚀`;
        priority = 'urgent';
        break;

      default:
        title = 'Proposal Update';
        message = `Activity on proposal #${estimate.estimate_number}`;
    }

    // Create in-app notification
    const { error: notifyError } = await supabase
      .from('user_notifications')
      .insert({
        tenant_id: tenantId,
        user_id: recipientUserId,
        type: 'proposal_activity',
        title,
        message,
        priority,
        related_entity_type: 'enhanced_estimates',
        related_entity_id: estimateId,
        metadata: {
          event,
          estimate_number: estimate.estimate_number,
          customer_name: customerName,
          selected_tier: selectedTier,
          viewer_email: viewerEmail,
          ...metadata
        }
      });

    if (notifyError) {
      console.error('[proposal-webhook] Failed to create notification:', notifyError);
    }

    // For urgent events (signed), also try to send SMS/push if configured
    if (event === 'signed' || event === 'accepted') {
      // Get user's phone for SMS notification
      const { data: userProfile } = await supabase
        .from('profiles')
        .select('phone, notification_preferences')
        .eq('id', recipientUserId)
        .single();

      if (userProfile?.phone) {
        // Check if SMS notifications are enabled
        const prefs = userProfile.notification_preferences as Record<string, any> || {};
        const smsEnabled = prefs.proposal_sms !== false; // Default to enabled

        if (smsEnabled) {
          // Queue SMS notification
          try {
            await supabase.functions.invoke('messaging-send-sms', {
              body: {
                to: userProfile.phone,
                message: `${title}\n${message}`,
                tenantId
              }
            });
            console.log('[proposal-webhook] SMS notification queued');
          } catch (smsError) {
            console.error('[proposal-webhook] SMS notification failed:', smsError);
          }
        }
      }
    }

    // Log the webhook event
    await supabase.from('proposal_tracking').insert({
      tenant_id: tenantId,
      estimate_id: estimateId,
      event_type: `webhook_${event}`,
      metadata: { notified_user: recipientUserId }
    });

    return new Response(JSON.stringify({ 
      ok: true, 
      notified: true,
      recipientUserId 
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('[proposal-webhook] Error:', error);
    return new Response(JSON.stringify({ 
      ok: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
