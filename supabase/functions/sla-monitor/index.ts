import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface SLAStatus {
  id: string;
  tenant_id: string;
  conversation_id: string;
  conversation_type: string;
  sla_policy_id: string;
  assigned_to: string | null;
  started_at: string;
  first_response_at: string | null;
  first_response_due_at: string | null;
  resolution_due_at: string | null;
  first_response_breached: boolean;
  resolution_breached: boolean;
  current_escalation_level: number;
  escalation_history: any[];
  status: string;
  sla_policy?: {
    id: string;
    name: string;
    first_response_minutes: number;
    resolution_minutes: number;
    escalation_levels: any[];
    business_hours_only: boolean;
    business_hours: any;
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { action } = await req.json();
    console.log('[sla-monitor] Action:', action);

    switch (action) {
      case 'check_all':
        await checkAllSLABreaches(supabase);
        return new Response(
          JSON.stringify({ success: true, message: 'SLA check completed' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );

      case 'check_tenant': {
        const { tenant_id } = await req.json();
        await checkTenantSLABreaches(supabase, tenant_id);
        return new Response(
          JSON.stringify({ success: true, message: 'Tenant SLA check completed' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'create_sla_tracking': {
        const body = await req.json();
        const result = await createSLATracking(supabase, body);
        return new Response(
          JSON.stringify({ success: true, data: result }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'record_response': {
        const body = await req.json();
        await recordResponse(supabase, body.conversation_id, body.conversation_type);
        return new Response(
          JSON.stringify({ success: true }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'resolve_conversation': {
        const body = await req.json();
        await resolveConversation(supabase, body.conversation_id, body.conversation_type);
        return new Response(
          JSON.stringify({ success: true }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'get_sla_status': {
        const body = await req.json();
        const status = await getSLAStatus(supabase, body.conversation_id, body.conversation_type);
        return new Response(
          JSON.stringify({ success: true, data: status }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      default:
        throw new Error(`Unknown action: ${action}`);
    }
  } catch (error) {
    console.error('[sla-monitor] Error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

async function checkAllSLABreaches(supabase: any) {
  const now = new Date();
  console.log('[sla-monitor] Checking all SLA breaches at:', now.toISOString());

  // Get all open conversations with SLA tracking
  const { data: openSLAs, error } = await supabase
    .from('conversation_sla_status')
    .select(`
      *,
      sla_policy:sla_policies(*)
    `)
    .eq('status', 'open')
    .or(`first_response_due_at.lt.${now.toISOString()},resolution_due_at.lt.${now.toISOString()}`);

  if (error) {
    console.error('[sla-monitor] Error fetching SLAs:', error);
    return;
  }

  console.log(`[sla-monitor] Found ${openSLAs?.length || 0} conversations at risk`);

  for (const sla of openSLAs || []) {
    await processSLABreaches(supabase, sla, now);
  }
}

async function checkTenantSLABreaches(supabase: any, tenantId: string) {
  const now = new Date();
  
  const { data: openSLAs } = await supabase
    .from('conversation_sla_status')
    .select(`
      *,
      sla_policy:sla_policies(*)
    `)
    .eq('tenant_id', tenantId)
    .eq('status', 'open');

  for (const sla of openSLAs || []) {
    await processSLABreaches(supabase, sla, now);
  }
}

async function processSLABreaches(supabase: any, sla: SLAStatus, now: Date) {
  const policy = sla.sla_policy;
  if (!policy) return;

  const updates: any = {};
  const escalationLevels = policy.escalation_levels || [];

  // Check first response breach
  if (!sla.first_response_at && sla.first_response_due_at) {
    const dueDate = new Date(sla.first_response_due_at);
    if (now > dueDate && !sla.first_response_breached) {
      updates.first_response_breached = true;
      await triggerEscalation(supabase, sla, 'first_response_breached', policy);
      console.log(`[sla-monitor] First response breached for conversation: ${sla.conversation_id}`);
    }
  }

  // Check resolution breach
  if (sla.resolution_due_at) {
    const resolutionDue = new Date(sla.resolution_due_at);
    if (now > resolutionDue && !sla.resolution_breached) {
      updates.resolution_breached = true;
      updates.status = 'breached';
      await triggerEscalation(supabase, sla, 'resolution_breached', policy);
      console.log(`[sla-monitor] Resolution breached for conversation: ${sla.conversation_id}`);
    }
  }

  // Check escalation timing
  for (const level of escalationLevels) {
    if (sla.current_escalation_level < level.level) {
      const escalateAfter = new Date(sla.started_at);
      escalateAfter.setMinutes(escalateAfter.getMinutes() + level.after_minutes);

      if (now > escalateAfter && !sla.first_response_at) {
        await escalateConversation(supabase, sla, level);
        updates.current_escalation_level = level.level;
        updates.last_escalation_at = now.toISOString();
        updates.escalation_history = [
          ...sla.escalation_history,
          {
            level: level.level,
            reason: 'time_exceeded',
            timestamp: now.toISOString(),
            notify_user_id: level.notify_user_id
          }
        ];
        break; // Only process one escalation at a time
      }
    }
  }

  // Apply updates if any
  if (Object.keys(updates).length > 0) {
    await supabase
      .from('conversation_sla_status')
      .update(updates)
      .eq('id', sla.id);
  }
}

async function triggerEscalation(supabase: any, sla: SLAStatus, reason: string, policy: any) {
  const escalationLevels = policy.escalation_levels || [];
  const nextLevel = sla.current_escalation_level + 1;
  const escalation = escalationLevels.find((e: any) => e.level === nextLevel);

  if (escalation?.notify_user_id) {
    // Create notification for the escalation target
    await supabase.from('user_notifications').insert({
      tenant_id: sla.tenant_id,
      user_id: escalation.notify_user_id,
      type: 'sla_escalation',
      title: 'SLA Escalation: Conversation Needs Attention',
      message: `A conversation has breached SLA (${reason}). Immediate attention required.`,
      action_url: `/inbox/${sla.conversation_id}`,
      metadata: {
        conversation_id: sla.conversation_id,
        conversation_type: sla.conversation_type,
        reason,
        escalation_level: nextLevel,
        sla_policy_name: policy.name
      }
    });

    console.log(`[sla-monitor] Escalation notification sent to user: ${escalation.notify_user_id}`);
  }

  // If configured to reassign, do so
  if (escalation?.reassign_to) {
    await reassignConversation(supabase, sla, escalation.reassign_to);
  }
}

async function escalateConversation(supabase: any, sla: SLAStatus, level: any) {
  // Send notification to escalation target
  if (level.notify_user_id) {
    await supabase.from('user_notifications').insert({
      tenant_id: sla.tenant_id,
      user_id: level.notify_user_id,
      type: 'sla_warning',
      title: `SLA Warning: Level ${level.level} Escalation`,
      message: `Conversation has been waiting for ${level.after_minutes} minutes without response.`,
      action_url: `/inbox/${sla.conversation_id}`,
      metadata: {
        conversation_id: sla.conversation_id,
        conversation_type: sla.conversation_type,
        escalation_level: level.level,
        minutes_waiting: level.after_minutes
      }
    });
  }

  // Optionally reassign
  if (level.reassign_to) {
    await reassignConversation(supabase, sla, level.reassign_to);
  }
}

async function reassignConversation(supabase: any, sla: SLAStatus, newAssignee: string) {
  // Update SLA status
  await supabase
    .from('conversation_sla_status')
    .update({ assigned_to: newAssignee })
    .eq('id', sla.id);

  // Update the actual conversation based on type
  if (sla.conversation_type === 'thread') {
    await supabase
      .from('communication_threads')
      .update({ assigned_to: newAssignee })
      .eq('id', sla.conversation_id);
  } else if (sla.conversation_type === 'sms_thread') {
    await supabase
      .from('sms_conversations')
      .update({ assigned_to: newAssignee })
      .eq('id', sla.conversation_id);
  } else if (sla.conversation_type === 'inbox_item') {
    await supabase
      .from('unified_inbox')
      .update({ assigned_to: newAssignee })
      .eq('id', sla.conversation_id);
  }

  // Notify new assignee
  await supabase.from('user_notifications').insert({
    tenant_id: sla.tenant_id,
    user_id: newAssignee,
    type: 'conversation_reassigned',
    title: 'Conversation Reassigned to You',
    message: 'A conversation has been escalated and reassigned to you due to SLA requirements.',
    action_url: `/inbox/${sla.conversation_id}`
  });

  // Update workload
  await updateWorkload(supabase, sla.tenant_id, newAssignee, 1);
  if (sla.assigned_to) {
    await updateWorkload(supabase, sla.tenant_id, sla.assigned_to, -1);
  }

  console.log(`[sla-monitor] Conversation ${sla.conversation_id} reassigned to ${newAssignee}`);
}

async function createSLATracking(supabase: any, params: {
  tenant_id: string;
  conversation_id: string;
  conversation_type: string;
  assigned_to?: string;
}) {
  // Get the active SLA policy for this tenant
  const { data: policy } = await supabase
    .from('sla_policies')
    .select('*')
    .eq('tenant_id', params.tenant_id)
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (!policy) {
    console.log('[sla-monitor] No active SLA policy for tenant:', params.tenant_id);
    return null;
  }

  const now = new Date();
  const firstResponseDue = new Date(now);
  firstResponseDue.setMinutes(firstResponseDue.getMinutes() + policy.first_response_minutes);

  const resolutionDue = new Date(now);
  resolutionDue.setMinutes(resolutionDue.getMinutes() + policy.resolution_minutes);

  const { data: slaStatus, error } = await supabase
    .from('conversation_sla_status')
    .upsert({
      tenant_id: params.tenant_id,
      conversation_id: params.conversation_id,
      conversation_type: params.conversation_type,
      sla_policy_id: policy.id,
      assigned_to: params.assigned_to,
      started_at: now.toISOString(),
      first_response_due_at: firstResponseDue.toISOString(),
      resolution_due_at: resolutionDue.toISOString(),
      status: 'open'
    }, {
      onConflict: 'tenant_id,conversation_id,conversation_type'
    })
    .select()
    .single();

  if (error) {
    console.error('[sla-monitor] Error creating SLA tracking:', error);
    return null;
  }

  console.log('[sla-monitor] Created SLA tracking for conversation:', params.conversation_id);
  return slaStatus;
}

async function recordResponse(supabase: any, conversationId: string, conversationType: string) {
  const now = new Date().toISOString();

  const { error } = await supabase
    .from('conversation_sla_status')
    .update({
      first_response_at: now,
      status: 'pending'
    })
    .eq('conversation_id', conversationId)
    .eq('conversation_type', conversationType)
    .is('first_response_at', null);

  if (error) {
    console.error('[sla-monitor] Error recording response:', error);
  } else {
    console.log('[sla-monitor] Recorded first response for:', conversationId);
  }
}

async function resolveConversation(supabase: any, conversationId: string, conversationType: string) {
  const now = new Date().toISOString();

  // Get the SLA status first to update workload
  const { data: sla } = await supabase
    .from('conversation_sla_status')
    .select('assigned_to, tenant_id')
    .eq('conversation_id', conversationId)
    .eq('conversation_type', conversationType)
    .single();

  const { error } = await supabase
    .from('conversation_sla_status')
    .update({
      resolved_at: now,
      status: 'resolved'
    })
    .eq('conversation_id', conversationId)
    .eq('conversation_type', conversationType);

  if (error) {
    console.error('[sla-monitor] Error resolving conversation:', error);
  } else {
    console.log('[sla-monitor] Resolved conversation:', conversationId);
    
    // Decrement workload
    if (sla?.assigned_to) {
      await updateWorkload(supabase, sla.tenant_id, sla.assigned_to, -1);
    }
  }
}

async function getSLAStatus(supabase: any, conversationId: string, conversationType: string) {
  const { data, error } = await supabase
    .from('conversation_sla_status')
    .select(`
      *,
      sla_policy:sla_policies(name, first_response_minutes, resolution_minutes)
    `)
    .eq('conversation_id', conversationId)
    .eq('conversation_type', conversationType)
    .single();

  if (error) {
    return null;
  }

  // Calculate time remaining
  const now = new Date();
  const result = { ...data };

  if (data.first_response_due_at && !data.first_response_at) {
    const due = new Date(data.first_response_due_at);
    result.first_response_minutes_remaining = Math.floor((due.getTime() - now.getTime()) / 60000);
  }

  if (data.resolution_due_at && !data.resolved_at) {
    const due = new Date(data.resolution_due_at);
    result.resolution_minutes_remaining = Math.floor((due.getTime() - now.getTime()) / 60000);
  }

  return result;
}

async function updateWorkload(supabase: any, tenantId: string, userId: string, delta: number) {
  // Upsert workload record
  const { data: existing } = await supabase
    .from('staff_workload')
    .select('active_conversations')
    .eq('tenant_id', tenantId)
    .eq('user_id', userId)
    .single();

  const newCount = Math.max(0, (existing?.active_conversations || 0) + delta);

  await supabase
    .from('staff_workload')
    .upsert({
      tenant_id: tenantId,
      user_id: userId,
      active_conversations: newCount,
      last_assignment_at: delta > 0 ? new Date().toISOString() : undefined
    }, {
      onConflict: 'tenant_id,user_id'
    });
}
