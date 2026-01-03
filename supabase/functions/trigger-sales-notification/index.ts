import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Sales Notification Trigger
 * 
 * Sends real-time notifications to sales reps when:
 * - Lead becomes hot (score > 80)
 * - Estimate/proposal is viewed
 * - Proposal is signed
 * - Appointment is scheduled
 * - Deal is closed
 */
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  );

  try {
    const { 
      type,
      tenant_id,
      user_id,
      contact_id,
      project_id,
      title,
      message,
      metadata
    } = await req.json();

    console.log('[Sales Notification] Processing:', { type, tenant_id, user_id });

    if (!tenant_id || !user_id) {
      return new Response(JSON.stringify({ error: 'Missing tenant_id or user_id' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Create notification record
    const { data: notification, error: notifError } = await supabase
      .from('user_notifications')
      .insert({
        tenant_id,
        user_id,
        type: type,
        title,
        message,
        metadata: {
          ...metadata,
          contact_id,
          project_id,
        },
        is_read: false,
      })
      .select()
      .single();

    if (notifError) {
      console.error('[Sales Notification] Failed to create notification:', notifError);
      throw notifError;
    }

    // Broadcast via Supabase Realtime
    const channel = supabase.channel(`broadcast:${tenant_id}:${user_id}`);
    await channel.send({
      type: 'broadcast',
      event: 'notification',
      payload: {
        id: notification.id,
        type,
        title,
        message,
        metadata: notification.metadata,
        created_at: notification.created_at,
      },
    });

    console.log('[Sales Notification] Notification sent successfully');

    // For critical notifications, also send SMS if configured
    if (type === 'deal_closed' || type === 'proposal_signed') {
      // Get user's phone number
      const { data: profile } = await supabase
        .from('profiles')
        .select('phone')
        .eq('id', user_id)
        .single();

      if (profile?.phone) {
        // Check if user has SMS notifications enabled
        const { data: prefs } = await supabase
          .from('notification_preferences')
          .select('sms_enabled')
          .eq('user_id', user_id)
          .single();

        if (prefs?.sms_enabled) {
          // Send SMS via Telnyx
          try {
            await supabase.functions.invoke('telnyx-send-sms', {
              body: {
                to: profile.phone,
                message: `${title}: ${message}`,
                tenant_id,
              },
            });
            console.log('[Sales Notification] SMS sent to', profile.phone);
          } catch (smsError) {
            console.warn('[Sales Notification] Failed to send SMS:', smsError);
          }
        }
      }
    }

    return new Response(JSON.stringify({ 
      success: true, 
      notification_id: notification.id 
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('[Sales Notification] Error:', err);
    return new Response(JSON.stringify({ error: err.message || 'Unexpected error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
