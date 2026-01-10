import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface RoutingResult {
  tenantId: string | null;
  locationId: string | null;
  locationName: string | null;
  assignedReps: string[];
  phoneNumber: string;
  aiAnsweringEnabled: boolean;
  forwardingRules: any | null;
  businessHours: any | null;
}

interface StaffMember {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  role: string;
  active_conversations: number;
  max_conversations: number;
  is_available: boolean;
  last_assignment_at: string | null;
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

    const body = await req.json();
    const { action, phoneNumber, tenantId, direction } = body;

    console.log('[communication-router] Request:', { action, phoneNumber, tenantId, direction });

    switch (action) {
      case 'route_inbound': {
        const result = await routeInbound(supabase, phoneNumber);
        return new Response(
          JSON.stringify({ success: true, data: result }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'get_outbound_number': {
        const result = await getOutboundNumber(supabase, tenantId, phoneNumber);
        return new Response(
          JSON.stringify({ success: true, data: result }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'lookup_contact': {
        const result = await lookupContact(supabase, tenantId, phoneNumber);
        return new Response(
          JSON.stringify({ success: true, data: result }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // ==========================================
      // NEW: Staff Assignment & Routing Actions
      // ==========================================

      case 'assign_conversation': {
        const { conversation_id, conversation_type, user_id, tenant_id } = body;
        const result = await assignConversation(supabase, tenant_id, conversation_id, conversation_type, user_id);
        return new Response(
          JSON.stringify({ success: true, data: result }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'reassign_conversation': {
        const { conversation_id, conversation_type, from_user_id, to_user_id, tenant_id, reason } = body;
        const result = await reassignConversation(supabase, tenant_id, conversation_id, conversation_type, from_user_id, to_user_id, reason);
        return new Response(
          JSON.stringify({ success: true, data: result }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'get_available_staff': {
        const { tenant_id, channel, location_id } = body;
        const result = await getAvailableStaff(supabase, tenant_id, channel, location_id);
        return new Response(
          JSON.stringify({ success: true, data: result }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'apply_routing_rules': {
        const { tenant_id, conversation_id, conversation_type, channel, location_id, metadata } = body;
        const result = await applyRoutingRules(supabase, tenant_id, conversation_id, conversation_type, channel, location_id, metadata);
        return new Response(
          JSON.stringify({ success: true, data: result }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'get_routing_rules': {
        const { tenant_id } = body;
        const result = await getRoutingRules(supabase, tenant_id);
        return new Response(
          JSON.stringify({ success: true, data: result }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'update_staff_availability': {
        const { tenant_id, user_id, is_available, availability_status } = body;
        const result = await updateStaffAvailability(supabase, tenant_id, user_id, is_available, availability_status);
        return new Response(
          JSON.stringify({ success: true, data: result }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'get_staff_workload': {
        const { tenant_id } = body;
        const result = await getStaffWorkload(supabase, tenant_id);
        return new Response(
          JSON.stringify({ success: true, data: result }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'rebalance_workloads': {
        const { tenant_id } = body;
        await rebalanceWorkloads(supabase, tenant_id);
        return new Response(
          JSON.stringify({ success: true, message: 'Workloads rebalanced' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      default:
        throw new Error(`Unknown action: ${action}`);
    }
  } catch (error) {
    console.error('[communication-router] Error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

async function routeInbound(supabase: any, phoneNumber: string): Promise<RoutingResult> {
  const cleanedPhone = phoneNumber.replace(/[^\d+]/g, '');
  console.log('[communication-router] Routing inbound for phone:', cleanedPhone);

  // 1. Look up location by telnyx_phone_number
  const { data: location } = await supabase
    .from('locations')
    .select(`
      id,
      name,
      tenant_id,
      telnyx_phone_number,
      manager_id,
      tenants!inner (
        id,
        name
      )
    `)
    .or(`telnyx_phone_number.eq.${cleanedPhone},telnyx_phone_number.eq.+${cleanedPhone.replace(/^\+/, '')}`)
    .single();

  if (location) {
    console.log('[communication-router] Found location by phone number:', location.name);
    
    const { data: assignments } = await supabase
      .from('user_location_assignments')
      .select('user_id, is_primary')
      .eq('location_id', location.id);

    const assignedReps = assignments?.map((a: any) => a.user_id) || [];
    if (location.manager_id && !assignedReps.includes(location.manager_id)) {
      assignedReps.unshift(location.manager_id);
    }

    const { data: aiConfig } = await supabase
      .from('ai_answering_config')
      .select('is_enabled, business_hours')
      .eq('tenant_id', location.tenant_id)
      .single();

    const { data: forwardingRules } = await supabase
      .from('call_forwarding_rules')
      .select('rules, is_active')
      .eq('tenant_id', location.tenant_id)
      .eq('is_active', true)
      .limit(1)
      .single();

    return {
      tenantId: location.tenant_id,
      locationId: location.id,
      locationName: location.name,
      assignedReps,
      phoneNumber: location.telnyx_phone_number,
      aiAnsweringEnabled: aiConfig?.is_enabled || false,
      forwardingRules: forwardingRules?.rules || null,
      businessHours: aiConfig?.business_hours || null,
    };
  }

  // 2. Fall back to communication_preferences lookup
  const { data: prefs } = await supabase
    .from('communication_preferences')
    .select('tenant_id, sms_from_number')
    .or(`sms_from_number.eq.${cleanedPhone},sms_from_number.eq.+${cleanedPhone.replace(/^\+/, '')}`)
    .single();

  if (prefs) {
    console.log('[communication-router] Found tenant by communication_preferences');
    
    const { data: aiConfig } = await supabase
      .from('ai_answering_config')
      .select('is_enabled, business_hours')
      .eq('tenant_id', prefs.tenant_id)
      .single();

    return {
      tenantId: prefs.tenant_id,
      locationId: null,
      locationName: null,
      assignedReps: [],
      phoneNumber: prefs.sms_from_number,
      aiAnsweringEnabled: aiConfig?.is_enabled || false,
      forwardingRules: null,
      businessHours: aiConfig?.business_hours || null,
    };
  }

  // 3. Fall back to messaging_providers lookup
  const { data: provider } = await supabase
    .from('messaging_providers')
    .select('tenant_id')
    .eq('provider_type', 'telnyx_sms')
    .limit(1)
    .single();

  if (provider) {
    console.log('[communication-router] Found tenant by messaging_providers (fallback)');
    return {
      tenantId: provider.tenant_id,
      locationId: null,
      locationName: null,
      assignedReps: [],
      phoneNumber: phoneNumber,
      aiAnsweringEnabled: false,
      forwardingRules: null,
      businessHours: null,
    };
  }

  console.log('[communication-router] No routing found for phone number:', phoneNumber);
  return {
    tenantId: null,
    locationId: null,
    locationName: null,
    assignedReps: [],
    phoneNumber: phoneNumber,
    aiAnsweringEnabled: false,
    forwardingRules: null,
    businessHours: null,
  };
}

async function getOutboundNumber(supabase: any, tenantId: string, locationId?: string): Promise<{ fromNumber: string | null; locationId: string | null }> {
  if (locationId) {
    const { data: location } = await supabase
      .from('locations')
      .select('telnyx_phone_number')
      .eq('id', locationId)
      .single();

    if (location?.telnyx_phone_number) {
      return { fromNumber: location.telnyx_phone_number, locationId };
    }
  }

  const { data: primaryLocation } = await supabase
    .from('locations')
    .select('id, telnyx_phone_number')
    .eq('tenant_id', tenantId)
    .eq('is_primary', true)
    .single();

  if (primaryLocation?.telnyx_phone_number) {
    return { fromNumber: primaryLocation.telnyx_phone_number, locationId: primaryLocation.id };
  }

  const { data: anyLocation } = await supabase
    .from('locations')
    .select('id, telnyx_phone_number')
    .eq('tenant_id', tenantId)
    .not('telnyx_phone_number', 'is', null)
    .limit(1)
    .single();

  if (anyLocation?.telnyx_phone_number) {
    return { fromNumber: anyLocation.telnyx_phone_number, locationId: anyLocation.id };
  }

  const { data: prefs } = await supabase
    .from('communication_preferences')
    .select('sms_from_number')
    .eq('tenant_id', tenantId)
    .single();

  if (prefs?.sms_from_number) {
    return { fromNumber: prefs.sms_from_number, locationId: null };
  }

  const envNumber = Deno.env.get('TELNYX_PHONE_NUMBER');
  return { fromNumber: envNumber || null, locationId: null };
}

async function lookupContact(supabase: any, tenantId: string, phoneNumber: string): Promise<{ contactId: string | null; contact: any | null }> {
  const cleanedPhone = phoneNumber.replace(/[^\d+]/g, '');
  
  let { data: contact } = await supabase
    .from('contacts')
    .select('id, name_first, name_last, email, phone')
    .eq('tenant_id', tenantId)
    .eq('phone', cleanedPhone)
    .single();

  if (!contact) {
    const { data: contactWithPlus } = await supabase
      .from('contacts')
      .select('id, name_first, name_last, email, phone')
      .eq('tenant_id', tenantId)
      .eq('phone', `+${cleanedPhone.replace(/^\+/, '')}`)
      .single();
    contact = contactWithPlus;
  }

  if (!contact) {
    const { data: contactWithoutPlus } = await supabase
      .from('contacts')
      .select('id, name_first, name_last, email, phone')
      .eq('tenant_id', tenantId)
      .eq('phone', cleanedPhone.replace(/^\+/, ''))
      .single();
    contact = contactWithoutPlus;
  }

  return {
    contactId: contact?.id || null,
    contact: contact || null,
  };
}

async function assignConversation(
  supabase: any,
  tenantId: string,
  conversationId: string,
  conversationType: string,
  userId: string
) {
  console.log(`[communication-router] Assigning conversation ${conversationId} to user ${userId}`);

  // Verify user is eligible
  const { data: workload } = await supabase
    .from('staff_workload')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('user_id', userId)
    .single();

  if (workload && !workload.is_available) {
    throw new Error('User is not available for assignment');
  }

  if (workload && workload.active_conversations >= workload.max_conversations) {
    throw new Error('User has reached maximum conversation limit');
  }

  // Update the conversation based on type
  if (conversationType === 'thread') {
    await supabase
      .from('communication_threads')
      .update({ assigned_to: userId, updated_at: new Date().toISOString() })
      .eq('id', conversationId);
  } else if (conversationType === 'sms_thread') {
    await supabase
      .from('sms_conversations')
      .update({ assigned_to: userId, updated_at: new Date().toISOString() })
      .eq('id', conversationId);
  } else if (conversationType === 'inbox_item') {
    await supabase
      .from('unified_inbox')
      .update({ assigned_to: userId, updated_at: new Date().toISOString() })
      .eq('id', conversationId);
  }

  // Update SLA tracking
  await supabase
    .from('conversation_sla_status')
    .update({ assigned_to: userId })
    .eq('conversation_id', conversationId)
    .eq('conversation_type', conversationType);

  // Increment workload
  await updateWorkload(supabase, tenantId, userId, 1);

  // Create notification
  await supabase.from('user_notifications').insert({
    tenant_id: tenantId,
    user_id: userId,
    type: 'conversation_assigned',
    title: 'New Conversation Assigned',
    message: 'You have been assigned a new conversation.',
    action_url: `/inbox/${conversationId}`
  });

  return { assigned_to: userId, conversation_id: conversationId };
}

async function reassignConversation(
  supabase: any,
  tenantId: string,
  conversationId: string,
  conversationType: string,
  fromUserId: string | null,
  toUserId: string,
  reason?: string
) {
  console.log(`[communication-router] Reassigning conversation ${conversationId} from ${fromUserId} to ${toUserId}`);

  // Assign to new user
  await assignConversation(supabase, tenantId, conversationId, conversationType, toUserId);

  // Decrement old user's workload
  if (fromUserId) {
    await updateWorkload(supabase, tenantId, fromUserId, -1);
  }

  // Notify old user
  if (fromUserId) {
    await supabase.from('user_notifications').insert({
      tenant_id: tenantId,
      user_id: fromUserId,
      type: 'conversation_reassigned',
      title: 'Conversation Reassigned',
      message: reason || 'A conversation has been reassigned to another team member.',
      metadata: { conversation_id: conversationId, new_assignee: toUserId }
    });
  }

  return { reassigned: true, from: fromUserId, to: toUserId };
}

async function getAvailableStaff(
  supabase: any,
  tenantId: string,
  channel?: string,
  locationId?: string
): Promise<StaffMember[]> {
  // Get all staff with workload info
  let query = supabase
    .from('staff_workload')
    .select(`
      user_id,
      active_conversations,
      max_conversations,
      is_available,
      availability_status,
      last_assignment_at,
      profile:profiles!inner(id, first_name, last_name, email, role)
    `)
    .eq('tenant_id', tenantId)
    .eq('is_available', true);

  const { data: workloads } = await query;

  // Filter to those with capacity
  const availableStaff = (workloads || [])
    .filter((w: any) => w.active_conversations < w.max_conversations)
    .map((w: any) => ({
      id: w.user_id,
      first_name: w.profile.first_name,
      last_name: w.profile.last_name,
      email: w.profile.email,
      role: w.profile.role,
      active_conversations: w.active_conversations,
      max_conversations: w.max_conversations,
      is_available: w.is_available,
      last_assignment_at: w.last_assignment_at
    }));

  // If locationId provided, prioritize staff assigned to that location
  if (locationId) {
    const { data: locationAssignments } = await supabase
      .from('user_location_assignments')
      .select('user_id')
      .eq('location_id', locationId);

    const locationUserIds = new Set(locationAssignments?.map((a: any) => a.user_id) || []);
    
    // Sort to put location-assigned staff first
    availableStaff.sort((a: StaffMember, b: StaffMember) => {
      const aInLocation = locationUserIds.has(a.id);
      const bInLocation = locationUserIds.has(b.id);
      if (aInLocation && !bInLocation) return -1;
      if (!aInLocation && bInLocation) return 1;
      return 0;
    });
  }

  return availableStaff;
}

async function applyRoutingRules(
  supabase: any,
  tenantId: string,
  conversationId: string,
  conversationType: string,
  channel: string,
  locationId?: string,
  metadata?: any
) {
  console.log(`[communication-router] Applying routing rules for conversation ${conversationId}`);

  // Get applicable routing rules (ordered by priority)
  const { data: rules } = await supabase
    .from('conversation_routing_rules')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('is_active', true)
    .order('priority', { ascending: true });

  if (!rules || rules.length === 0) {
    console.log('[communication-router] No routing rules found, using default assignment');
    return { assigned_to: null, reason: 'no_routing_rules' };
  }

  // Find matching rule
  for (const rule of rules) {
    // Check if rule applies to this location
    if (rule.location_id && rule.location_id !== locationId) {
      continue;
    }

    // Check channel condition
    if (rule.conditions?.channel && rule.conditions.channel !== channel) {
      continue;
    }

    // Check keyword conditions
    if (rule.conditions?.keywords && metadata?.message) {
      const keywords = rule.conditions.keywords as string[];
      const messageText = (metadata.message as string).toLowerCase();
      const hasKeyword = keywords.some(k => messageText.includes(k.toLowerCase()));
      if (!hasKeyword) continue;
    }

    // Rule matches - find assignee based on routing type
    let assignee: string | null = null;

    switch (rule.routing_type) {
      case 'round_robin':
        assignee = await getNextRoundRobin(supabase, tenantId, rule.eligible_users);
        break;
      case 'least_busy':
        assignee = await getLeastBusy(supabase, tenantId, rule.eligible_users);
        break;
      case 'skill_based':
        assignee = await getBySkill(supabase, tenantId, rule.conditions?.required_skills || []);
        break;
      case 'manager_only':
        assignee = await getManager(supabase, tenantId, locationId);
        break;
      case 'specific_user':
        assignee = rule.conditions?.user_id || rule.eligible_users?.[0];
        break;
    }

    if (assignee) {
      await assignConversation(supabase, tenantId, conversationId, conversationType, assignee);
      console.log(`[communication-router] Assigned to ${assignee} via rule: ${rule.name}`);
      return { assigned_to: assignee, rule_name: rule.name, routing_type: rule.routing_type };
    }

    // Try fallback user
    if (rule.fallback_user_id) {
      await assignConversation(supabase, tenantId, conversationId, conversationType, rule.fallback_user_id);
      return { assigned_to: rule.fallback_user_id, rule_name: rule.name, fallback: true };
    }
  }

  return { assigned_to: null, reason: 'no_available_staff' };
}

async function getNextRoundRobin(supabase: any, tenantId: string, eligibleUsers: string[]): Promise<string | null> {
  if (!eligibleUsers || eligibleUsers.length === 0) {
    return null;
  }

  // Get workload info for eligible users
  const { data: workloads } = await supabase
    .from('staff_workload')
    .select('user_id, is_available, active_conversations, max_conversations, last_round_robin_at')
    .eq('tenant_id', tenantId)
    .in('user_id', eligibleUsers)
    .eq('is_available', true)
    .order('last_round_robin_at', { ascending: true, nullsFirst: true });

  // Find first available user with capacity
  const available = (workloads || []).find(
    (w: any) => w.active_conversations < w.max_conversations
  );

  if (available) {
    // Update round robin timestamp
    await supabase
      .from('staff_workload')
      .update({ last_round_robin_at: new Date().toISOString() })
      .eq('tenant_id', tenantId)
      .eq('user_id', available.user_id);

    return available.user_id;
  }

  return null;
}

async function getLeastBusy(supabase: any, tenantId: string, eligibleUsers: string[]): Promise<string | null> {
  if (!eligibleUsers || eligibleUsers.length === 0) {
    // If no specific users, get all available staff
    const { data: workloads } = await supabase
      .from('staff_workload')
      .select('user_id, active_conversations, max_conversations')
      .eq('tenant_id', tenantId)
      .eq('is_available', true)
      .order('active_conversations', { ascending: true });

    const available = (workloads || []).find(
      (w: any) => w.active_conversations < w.max_conversations
    );
    return available?.user_id || null;
  }

  const { data: workloads } = await supabase
    .from('staff_workload')
    .select('user_id, active_conversations, max_conversations')
    .eq('tenant_id', tenantId)
    .in('user_id', eligibleUsers)
    .eq('is_available', true)
    .order('active_conversations', { ascending: true });

  const available = (workloads || []).find(
    (w: any) => w.active_conversations < w.max_conversations
  );

  return available?.user_id || null;
}

async function getBySkill(supabase: any, tenantId: string, requiredSkills: string[]): Promise<string | null> {
  if (!requiredSkills || requiredSkills.length === 0) {
    return getLeastBusy(supabase, tenantId, []);
  }

  const { data: workloads } = await supabase
    .from('staff_workload')
    .select('user_id, skills, active_conversations, max_conversations')
    .eq('tenant_id', tenantId)
    .eq('is_available', true)
    .order('active_conversations', { ascending: true });

  // Find user with matching skills and capacity
  const available = (workloads || []).find((w: any) => {
    if (w.active_conversations >= w.max_conversations) return false;
    const userSkills = w.skills || [];
    return requiredSkills.every(skill => userSkills.includes(skill));
  });

  return available?.user_id || null;
}

async function getManager(supabase: any, tenantId: string, locationId?: string): Promise<string | null> {
  // If location provided, get location manager
  if (locationId) {
    const { data: location } = await supabase
      .from('locations')
      .select('manager_id')
      .eq('id', locationId)
      .single();

    if (location?.manager_id) {
      return location.manager_id;
    }
  }

  // Get any manager for the tenant
  const { data: managers } = await supabase
    .from('profiles')
    .select('id')
    .eq('tenant_id', tenantId)
    .in('role', ['owner', 'corporate', 'office_admin', 'regional_manager', 'sales_manager'])
    .limit(1);

  return managers?.[0]?.id || null;
}

async function getRoutingRules(supabase: any, tenantId: string) {
  const { data: rules } = await supabase
    .from('conversation_routing_rules')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('priority', { ascending: true });

  return rules || [];
}

async function updateStaffAvailability(
  supabase: any,
  tenantId: string,
  userId: string,
  isAvailable: boolean,
  availabilityStatus?: string
) {
  const { data, error } = await supabase
    .from('staff_workload')
    .upsert({
      tenant_id: tenantId,
      user_id: userId,
      is_available: isAvailable,
      availability_status: availabilityStatus || (isAvailable ? 'online' : 'offline'),
      updated_at: new Date().toISOString()
    }, {
      onConflict: 'tenant_id,user_id'
    })
    .select()
    .single();

  if (error) {
    console.error('[communication-router] Error updating availability:', error);
    throw error;
  }

  return data;
}

async function getStaffWorkload(supabase: any, tenantId: string) {
  const { data } = await supabase
    .from('staff_workload')
    .select(`
      *,
      profile:profiles!inner(id, first_name, last_name, email, role)
    `)
    .eq('tenant_id', tenantId)
    .order('active_conversations', { descending: true });

  return data || [];
}

async function rebalanceWorkloads(supabase: any, tenantId?: string) {
  console.log('[communication-router] Rebalancing workloads');

  // Get actual conversation counts
  const tenantFilter = tenantId ? `.eq('tenant_id', '${tenantId}')` : '';

  // Count open conversations per user
  const { data: actualCounts } = await supabase
    .from('conversation_sla_status')
    .select('tenant_id, assigned_to')
    .eq('status', 'open')
    .not('assigned_to', 'is', null);

  // Group by tenant and user
  const countMap = new Map<string, number>();
  for (const row of actualCounts || []) {
    const key = `${row.tenant_id}:${row.assigned_to}`;
    countMap.set(key, (countMap.get(key) || 0) + 1);
  }

  // Update workload records
  const { data: workloads } = await supabase
    .from('staff_workload')
    .select('id, tenant_id, user_id, active_conversations');

  for (const workload of workloads || []) {
    const key = `${workload.tenant_id}:${workload.user_id}`;
    const actualCount = countMap.get(key) || 0;

    if (workload.active_conversations !== actualCount) {
      await supabase
        .from('staff_workload')
        .update({ active_conversations: actualCount })
        .eq('id', workload.id);
    }
  }

  console.log('[communication-router] Workload rebalance complete');
}

async function updateWorkload(supabase: any, tenantId: string, userId: string, delta: number) {
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
      last_assignment_at: delta > 0 ? new Date().toISOString() : undefined,
      updated_at: new Date().toISOString()
    }, {
      onConflict: 'tenant_id,user_id'
    });
}
