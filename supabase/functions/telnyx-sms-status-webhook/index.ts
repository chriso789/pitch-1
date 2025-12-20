import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Telnyx SMS Delivery Status Webhook
 * Receives delivery status updates from Telnyx and updates communication_history
 * 
 * Telnyx message statuses:
 * - queued: Message is queued for delivery
 * - sending: Message is being sent to carrier
 * - sent: Message was sent to carrier
 * - delivered: Message was delivered to recipient
 * - delivery_failed: Message delivery failed
 * - sending_failed: Message could not be sent to carrier
 */

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const body = await req.json();
    console.log('📨 Telnyx SMS status webhook received:', JSON.stringify(body, null, 2));

    // Telnyx sends events in data.payload format
    const eventType = body.data?.event_type;
    const payload = body.data?.payload;

    if (!eventType || !payload) {
      console.log('⚠️ Invalid webhook payload, missing event_type or payload');
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid webhook payload' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Only process message events
    if (!eventType.startsWith('message.')) {
      console.log(`ℹ️ Ignoring non-message event: ${eventType}`);
      return new Response(
        JSON.stringify({ success: true, message: 'Event type ignored' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const messageId = payload.id;
    const telnyxStatus = payload.to?.[0]?.status || eventType.replace('message.', '');
    
    console.log(`📱 Processing ${eventType} for message ${messageId}, status: ${telnyxStatus}`);

    // Map Telnyx statuses to our delivery_status
    const statusMap: Record<string, string> = {
      'queued': 'queued',
      'sending': 'sending',
      'sent': 'sent',
      'delivered': 'delivered',
      'delivery_failed': 'failed',
      'sending_failed': 'failed',
      'finalized': 'delivered', // Telnyx uses finalized for completed delivery
    };

    const deliveryStatus = statusMap[telnyxStatus] || telnyxStatus;
    
    // Extract error info if present
    const errorCode = payload.errors?.[0]?.code || payload.to?.[0]?.carrier?.error_code;
    const errorTitle = payload.errors?.[0]?.title || payload.to?.[0]?.carrier?.error_message;

    console.log(`🔄 Updating communication_history: message_id=${messageId}, status=${deliveryStatus}`);

    // Find and update the communication_history record by message_id in metadata
    // Use JSONB containment operator for efficient lookup
    const { data: records, error: findError } = await supabaseAdmin
      .from('communication_history')
      .select('id, tenant_id, metadata')
      .filter('metadata->>message_id', 'eq', messageId);

    if (findError) {
      console.error('❌ Error finding message record:', findError);
      throw findError;
    }

    if (!records || records.length === 0) {
      console.log(`⚠️ No communication_history record found for message_id: ${messageId}`);
      // Still return success - Telnyx might send webhooks for messages we don't have
      return new Response(
        JSON.stringify({ success: true, message: 'Message not found in system' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Update all matching records (should typically be 1)
    for (const record of records) {
      const updatedMetadata = {
        ...record.metadata,
        telnyx_status: telnyxStatus,
        last_status_update: new Date().toISOString(),
        ...(errorCode && { carrier_error_code: errorCode }),
        ...(errorTitle && { carrier_error_message: errorTitle }),
      };

      const { error: updateError } = await supabaseAdmin
        .from('communication_history')
        .update({
          delivery_status: deliveryStatus,
          delivery_status_updated_at: new Date().toISOString(),
          carrier_error_code: errorCode || null,
          metadata: updatedMetadata,
        })
        .eq('id', record.id);

      if (updateError) {
        console.error(`❌ Error updating record ${record.id}:`, updateError);
        throw updateError;
      }

      console.log(`✅ Updated communication_history record ${record.id} to status: ${deliveryStatus}`);

      // If failed, log detailed error info
      if (deliveryStatus === 'failed') {
        console.warn(`⚠️ Message ${messageId} delivery failed:`, {
          errorCode,
          errorTitle,
          carrier: payload.to?.[0]?.carrier,
        });
      }
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: `Updated ${records.length} record(s) to status: ${deliveryStatus}`,
        messageId,
        deliveryStatus,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('❌ Webhook processing error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
