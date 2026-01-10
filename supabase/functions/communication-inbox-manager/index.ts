import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, serviceKey);
    const { action, ...data } = await req.json();
    console.log(`[communication-inbox-manager] Action: ${action}`);

    switch (action) {
      case 'get_threads': {
        const { tenant_id, status = 'open' } = data;
        const { data: threads } = await supabase.from('sms_conversations').select('*').eq('tenant_id', tenant_id).order('updated_at', { ascending: false }).limit(50);
        return new Response(JSON.stringify({ success: true, threads }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      case 'mark_read': {
        const { thread_id } = data;
        await supabase.from('sms_conversations').update({ is_read: true }).eq('id', thread_id);
        return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      // ==========================================
      // NEW: Staff Assignment Actions
      // ==========================================

      case 'assign_to_staff': {
        const { thread_id, user_id, tenant_id, conversation_type = 'sms_thread' } = data;
        
        // Verify user can be assigned
        const { data: workload } = await supabase
          .from('staff_workload')
          .select('*')
          .eq('tenant_id', tenant_id)
          .eq('user_id', user_id)
          .single();

        if (workload && !workload.is_available) {
          return new Response(
            JSON.stringify({ success: false, error: 'User is not available for assignment' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        if (workload && workload.active_conversations >= workload.max_conversations) {
          return new Response(
            JSON.stringify({ success: false, error: 'User has reached maximum conversation limit' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Update thread assignment
        if (conversation_type === 'sms_thread') {
          await supabase
            .from('sms_conversations')
            .update({ assigned_to: user_id, updated_at: new Date().toISOString() })
            .eq('id', thread_id);
        } else if (conversation_type === 'thread') {
          await supabase
            .from('communication_threads')
            .update({ assigned_to: user_id, updated_at: new Date().toISOString() })
            .eq('id', thread_id);
        } else if (conversation_type === 'inbox_item') {
          await supabase
            .from('unified_inbox')
            .update({ assigned_to: user_id, updated_at: new Date().toISOString() })
            .eq('id', thread_id);
        }

        // Update SLA tracking
        await supabase
          .from('conversation_sla_status')
          .update({ assigned_to: user_id })
          .eq('conversation_id', thread_id)
          .eq('conversation_type', conversation_type);

        // Increment workload
        await incrementWorkload(supabase, tenant_id, user_id);

        // Notify assigned user
        await supabase.from('user_notifications').insert({
          tenant_id,
          user_id,
          type: 'conversation_assigned',
          title: 'New Conversation Assigned',
          message: 'You have been assigned a new conversation.',
          action_url: `/inbox/${thread_id}`
        });

        return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      case 'get_staff_availability': {
        const { tenant_id, channel } = data;

        const { data: workload } = await supabase
          .from('staff_workload')
          .select(`
            *,
            profile:profiles!inner(first_name, last_name, email, role)
          `)
          .eq('tenant_id', tenant_id)
          .eq('is_available', true);

        const availableStaff = (workload || []).filter(
          (w: any) => w.active_conversations < w.max_conversations
        );

        return new Response(
          JSON.stringify({ success: true, available_staff: availableStaff }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'record_response': {
        const { conversation_id, conversation_type, responder_id } = data;

        // Mark first response for SLA
        await supabase
          .from('conversation_sla_status')
          .update({
            first_response_at: new Date().toISOString(),
            status: 'pending'
          })
          .eq('conversation_id', conversation_id)
          .eq('conversation_type', conversation_type)
          .is('first_response_at', null);

        return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      case 'resolve_conversation': {
        const { conversation_id, conversation_type, resolver_id } = data;

        // Get current assignment to update workload
        const { data: sla } = await supabase
          .from('conversation_sla_status')
          .select('assigned_to, tenant_id')
          .eq('conversation_id', conversation_id)
          .eq('conversation_type', conversation_type)
          .single();

        // Update SLA status
        await supabase
          .from('conversation_sla_status')
          .update({
            resolved_at: new Date().toISOString(),
            status: 'resolved'
          })
          .eq('conversation_id', conversation_id)
          .eq('conversation_type', conversation_type);

        // Decrement workload
        if (sla?.assigned_to && sla?.tenant_id) {
          await decrementWorkload(supabase, sla.tenant_id, sla.assigned_to);
        }

        // Update the conversation status
        if (conversation_type === 'sms_thread') {
          await supabase
            .from('sms_conversations')
            .update({ status: 'resolved', updated_at: new Date().toISOString() })
            .eq('id', conversation_id);
        }

        return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      case 'get_sla_status': {
        const { conversation_id, conversation_type } = data;

        const { data: slaStatus } = await supabase
          .from('conversation_sla_status')
          .select(`
            *,
            sla_policy:sla_policies(name, first_response_minutes, resolution_minutes)
          `)
          .eq('conversation_id', conversation_id)
          .eq('conversation_type', conversation_type)
          .single();

        if (!slaStatus) {
          return new Response(
            JSON.stringify({ success: true, data: null }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Calculate time remaining
        const now = new Date();
        const result = { ...slaStatus };

        if (slaStatus.first_response_due_at && !slaStatus.first_response_at) {
          const due = new Date(slaStatus.first_response_due_at);
          result.first_response_minutes_remaining = Math.floor((due.getTime() - now.getTime()) / 60000);
        }

        if (slaStatus.resolution_due_at && !slaStatus.resolved_at) {
          const due = new Date(slaStatus.resolution_due_at);
          result.resolution_minutes_remaining = Math.floor((due.getTime() - now.getTime()) / 60000);
        }

        return new Response(
          JSON.stringify({ success: true, data: result }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'get_workload_stats': {
        const { tenant_id } = data;

        const { data: workloads } = await supabase
          .from('staff_workload')
          .select(`
            *,
            profile:profiles!inner(first_name, last_name, email, role)
          `)
          .eq('tenant_id', tenant_id);

        // Get SLA breach counts
        const { data: breaches } = await supabase
          .from('conversation_sla_status')
          .select('assigned_to')
          .eq('tenant_id', tenant_id)
          .or('first_response_breached.eq.true,resolution_breached.eq.true');

        const breachCounts = new Map<string, number>();
        for (const breach of breaches || []) {
          if (breach.assigned_to) {
            breachCounts.set(breach.assigned_to, (breachCounts.get(breach.assigned_to) || 0) + 1);
          }
        }

        const stats = (workloads || []).map((w: any) => ({
          ...w,
          breach_count: breachCounts.get(w.user_id) || 0
        }));

        return new Response(
          JSON.stringify({ success: true, data: stats }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      default:
        return new Response(JSON.stringify({ success: false, error: 'Unknown action' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
  } catch (error: any) {
    console.error('[communication-inbox-manager] Error:', error);
    return new Response(JSON.stringify({ success: false, error: error.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});

// Helper functions
async function incrementWorkload(supabase: any, tenantId: string, userId: string) {
  const { data: existing } = await supabase
    .from('staff_workload')
    .select('active_conversations')
    .eq('tenant_id', tenantId)
    .eq('user_id', userId)
    .single();

  const newCount = (existing?.active_conversations || 0) + 1;

  await supabase
    .from('staff_workload')
    .upsert({
      tenant_id: tenantId,
      user_id: userId,
      active_conversations: newCount,
      last_assignment_at: new Date().toISOString()
    }, {
      onConflict: 'tenant_id,user_id'
    });
}

async function decrementWorkload(supabase: any, tenantId: string, userId: string) {
  const { data: existing } = await supabase
    .from('staff_workload')
    .select('active_conversations')
    .eq('tenant_id', tenantId)
    .eq('user_id', userId)
    .single();

  const newCount = Math.max(0, (existing?.active_conversations || 0) - 1);

  await supabase
    .from('staff_workload')
    .update({ active_conversations: newCount })
    .eq('tenant_id', tenantId)
    .eq('user_id', userId);
}
