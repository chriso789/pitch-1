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

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { action, phoneNumber, tenantId, direction } = await req.json();

    console.log('Communication router request:', { action, phoneNumber, tenantId, direction });

    if (action === 'route_inbound') {
      // Route inbound communication by looking up the destination phone number
      const result = await routeInbound(supabase, phoneNumber);
      return new Response(
        JSON.stringify({ success: true, data: result }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (action === 'get_outbound_number') {
      // Get the correct from-number for outbound communications
      const result = await getOutboundNumber(supabase, tenantId, phoneNumber);
      return new Response(
        JSON.stringify({ success: true, data: result }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (action === 'lookup_contact') {
      // Look up a contact by phone number within a tenant
      const result = await lookupContact(supabase, tenantId, phoneNumber);
      return new Response(
        JSON.stringify({ success: true, data: result }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    throw new Error(`Unknown action: ${action}`);
  } catch (error) {
    console.error('Communication router error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

async function routeInbound(supabase: any, phoneNumber: string): Promise<RoutingResult> {
  // Clean the phone number for matching
  const cleanedPhone = phoneNumber.replace(/[^\d+]/g, '');
  
  console.log('Routing inbound for phone:', cleanedPhone);

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
    console.log('Found location by phone number:', location.name);
    
    // Get assigned reps for this location
    const { data: assignments } = await supabase
      .from('user_location_assignments')
      .select('user_id, is_primary')
      .eq('location_id', location.id);

    const assignedReps = assignments?.map((a: any) => a.user_id) || [];
    if (location.manager_id && !assignedReps.includes(location.manager_id)) {
      assignedReps.unshift(location.manager_id);
    }

    // Get AI answering config for this tenant
    const { data: aiConfig } = await supabase
      .from('ai_answering_config')
      .select('is_enabled, business_hours')
      .eq('tenant_id', location.tenant_id)
      .single();

    // Get call forwarding rules
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
    console.log('Found tenant by communication_preferences');
    
    // Get AI answering config
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
    console.log('Found tenant by messaging_providers (fallback)');
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

  console.log('No routing found for phone number:', phoneNumber);
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
  // 1. If locationId provided, use that location's number
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

  // 2. Get primary location's number
  const { data: primaryLocation } = await supabase
    .from('locations')
    .select('id, telnyx_phone_number')
    .eq('tenant_id', tenantId)
    .eq('is_primary', true)
    .single();

  if (primaryLocation?.telnyx_phone_number) {
    return { fromNumber: primaryLocation.telnyx_phone_number, locationId: primaryLocation.id };
  }

  // 3. Get any location with a phone number
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

  // 4. Fall back to communication_preferences
  const { data: prefs } = await supabase
    .from('communication_preferences')
    .select('sms_from_number')
    .eq('tenant_id', tenantId)
    .single();

  if (prefs?.sms_from_number) {
    return { fromNumber: prefs.sms_from_number, locationId: null };
  }

  // 5. Use environment variable as last resort
  const envNumber = Deno.env.get('TELNYX_PHONE_NUMBER');
  return { fromNumber: envNumber || null, locationId: null };
}

async function lookupContact(supabase: any, tenantId: string, phoneNumber: string): Promise<{ contactId: string | null; contact: any | null }> {
  const cleanedPhone = phoneNumber.replace(/[^\d+]/g, '');
  
  // Try exact match first
  let { data: contact } = await supabase
    .from('contacts')
    .select('id, name_first, name_last, email, phone')
    .eq('tenant_id', tenantId)
    .eq('phone', cleanedPhone)
    .single();

  if (!contact) {
    // Try with + prefix
    const { data: contactWithPlus } = await supabase
      .from('contacts')
      .select('id, name_first, name_last, email, phone')
      .eq('tenant_id', tenantId)
      .eq('phone', `+${cleanedPhone.replace(/^\+/, '')}`)
      .single();
    contact = contactWithPlus;
  }

  if (!contact) {
    // Try without + prefix
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
