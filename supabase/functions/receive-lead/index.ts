import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { supabaseService } from '../_shared/supabase.ts';
import { getEnv } from '../_shared/env.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-api-key',
};

// Growth Hub lead payload structure
interface GrowthHubLeadPayload {
  name: string;
  email?: string;
  phone: string;
  company?: string;
  source?: string;
  address?: string;
  city?: string;
  state?: string;
  service_interest?: string;
  notes?: string;
  lead_score?: number;
  priority?: string;
  external_id?: string;
  metadata?: {
    growth_hub_status?: string;
    visitor_id?: string;
    created_at?: string;
    [key: string]: unknown;
  };
}

// Split a full name into first/last name
function splitName(fullName: string): { firstName: string; lastName: string } {
  const parts = fullName?.trim().split(/\s+/) || ['Unknown'];
  const firstName = parts[0] || 'Unknown';
  const lastName = parts.slice(1).join(' ') || '';
  return { firstName, lastName };
}

// Normalize phone number
function normalizePhone(phone: string): string {
  return phone?.replace(/\D/g, '') || '';
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Only accept POST
    if (req.method !== 'POST') {
      return new Response(
        JSON.stringify({ success: false, error: 'Method not allowed' }),
        { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate API key
    const apiKey = req.headers.get('x-api-key');
    const expectedApiKey = getEnv('GROWTH_HUB_API_KEY', '');

    if (!apiKey || !expectedApiKey || apiKey !== expectedApiKey) {
      console.error('[receive-lead] Invalid or missing API key');
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid API key' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Parse the payload
    const payload: GrowthHubLeadPayload = await req.json();
    console.log('[receive-lead] Received payload from Growth Hub:', {
      name: payload.name,
      phone: payload.phone,
      source: payload.source,
      external_id: payload.external_id
    });

    // Validate required fields
    if (!payload.phone && !payload.email) {
      return new Response(
        JSON.stringify({ success: false, error: 'Phone or email is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create Supabase client with service role
    const supabase = supabaseService();

    // Get the default tenant (first tenant for simplicity)
    // In production, you'd want to configure this per-company
    const { data: defaultTenant } = await supabase
      .from('tenants')
      .select('id')
      .limit(1)
      .single();

    if (!defaultTenant) {
      console.error('[receive-lead] No default tenant found');
      return new Response(
        JSON.stringify({ success: false, error: 'No tenant configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const tenantId = defaultTenant.id;

    // Parse name into first/last
    const { firstName, lastName } = splitName(payload.name);

    // Check for duplicate contact
    const normalizedPhone = normalizePhone(payload.phone);
    let existingContact = null;

    if (normalizedPhone) {
      const { data: phoneMatch } = await supabase
        .from('contacts')
        .select('id, first_name, last_name')
        .eq('tenant_id', tenantId)
        .eq('is_deleted', false)
        .or(`phone.ilike.%${normalizedPhone}`)
        .limit(1)
        .maybeSingle();

      if (phoneMatch) {
        existingContact = phoneMatch;
      }
    }

    if (!existingContact && payload.email) {
      const { data: emailMatch } = await supabase
        .from('contacts')
        .select('id, first_name, last_name')
        .eq('tenant_id', tenantId)
        .eq('is_deleted', false)
        .ilike('email', payload.email)
        .limit(1)
        .maybeSingle();

      if (emailMatch) {
        existingContact = emailMatch;
      }
    }

    let contactId: string;
    let isNewContact = false;

    if (existingContact) {
      // Use existing contact
      contactId = existingContact.id;
      console.log('[receive-lead] Found existing contact:', contactId);
    } else {
      // Create new contact
      const contactData: Record<string, unknown> = {
        tenant_id: tenantId,
        first_name: firstName,
        last_name: lastName,
        phone: payload.phone,
        lead_source: payload.source || 'growth-hub',
        lead_status: 'new',
        lead_score: payload.lead_score || null,
        notes: payload.notes || null,
        metadata: {
          growth_hub_external_id: payload.external_id,
          company: payload.company,
          service_interest: payload.service_interest,
          priority: payload.priority,
          ...(payload.metadata || {}),
        },
      };

      // Add optional fields
      if (payload.email) contactData.email = payload.email;
      if (payload.address) contactData.address_street = payload.address;
      if (payload.city) contactData.address_city = payload.city;
      if (payload.state) contactData.address_state = payload.state;

      const { data: newContact, error: contactError } = await supabase
        .from('contacts')
        .insert(contactData)
        .select('id')
        .single();

      if (contactError) {
        console.error('[receive-lead] Error creating contact:', contactError);
        return new Response(
          JSON.stringify({ success: false, error: 'Failed to create contact' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      contactId = newContact.id;
      isNewContact = true;
      console.log('[receive-lead] Created new contact:', contactId);
    }

    // Create pipeline entry for this lead
    const pipelineData = {
      tenant_id: tenantId,
      contact_id: contactId,
      status: 'lead',
      source: payload.source || 'growth-hub',
      metadata: {
        growth_hub_external_id: payload.external_id,
        service_interest: payload.service_interest,
        priority: payload.priority,
        lead_score: payload.lead_score,
        ...(payload.metadata || {}),
      },
    };

    const { data: pipelineEntry, error: pipelineError } = await supabase
      .from('pipeline_entries')
      .insert(pipelineData)
      .select('id')
      .single();

    if (pipelineError) {
      console.error('[receive-lead] Error creating pipeline entry:', pipelineError);
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'Failed to create pipeline entry',
          contact_id: contactId
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('[receive-lead] Created pipeline entry:', pipelineEntry.id);

    // Log the submission for audit
    await supabase.from('audit_log').insert({
      tenant_id: tenantId,
      action: 'INSERT',
      table_name: 'pipeline_entries',
      record_id: pipelineEntry.id,
      new_values: {
        source: 'growth-hub',
        external_id: payload.external_id,
        is_new_contact: isNewContact,
      },
    });

    return new Response(
      JSON.stringify({
        success: true,
        pitch_crm_id: pipelineEntry.id,
        contact_id: contactId,
        is_new_contact: isNewContact,
        message: `Lead received and ${isNewContact ? 'created' : 'updated'}`,
      }),
      { status: 201, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('[receive-lead] Error:', error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error instanceof Error ? error.message : 'Internal server error' 
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
