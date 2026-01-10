import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface LeadPayload {
  first_name: string;
  last_name: string;
  email?: string;
  phone: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  message?: string;
  lead_source?: string;
  source_url?: string;
  appointment_requested?: string;
  custom_fields?: Record<string, unknown>;
}

interface ExternalLeadRequest {
  api_key: string;
  lead: LeadPayload;
}

// Hash API key for comparison
async function hashApiKey(key: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(key);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// Normalize phone number
function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, '').slice(-10);
}

// Generate unique lead number
function generateLeadNumber(): string {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `EXT-${timestamp}-${random}`;
}

serve(async (req: Request) => {
  console.log('[external-lead-webhook] Request received');
  
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const clientIp = req.headers.get('x-forwarded-for') || req.headers.get('cf-connecting-ip') || 'unknown';
  const userAgent = req.headers.get('user-agent') || 'unknown';

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const body: ExternalLeadRequest = await req.json();
    const { api_key, lead } = body;

    // Validate required fields
    if (!api_key) {
      return new Response(
        JSON.stringify({ success: false, error: 'API key is required' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!lead?.first_name || !lead?.phone) {
      return new Response(
        JSON.stringify({ success: false, error: 'first_name and phone are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Hash the API key and lookup
    const keyHash = await hashApiKey(api_key);
    const keyPrefix = api_key.substring(0, 8);

    console.log('[external-lead-webhook] Looking up API key:', keyPrefix);

    const { data: apiKeyRecord, error: keyError } = await supabase
      .from('company_api_keys')
      .select('id, tenant_id, permissions, rate_limit_per_hour, allowed_ips, usage_count')
      .eq('api_key_hash', keyHash)
      .eq('is_active', true)
      .is('revoked_at', null)
      .single();

    if (keyError || !apiKeyRecord) {
      console.error('[external-lead-webhook] Invalid API key:', keyPrefix);
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid or expired API key' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check rate limit (simple hourly check)
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count: recentSubmissions } = await supabase
      .from('external_lead_submissions')
      .select('id', { count: 'exact', head: true })
      .eq('api_key_id', apiKeyRecord.id)
      .gte('created_at', oneHourAgo);

    if ((recentSubmissions || 0) >= apiKeyRecord.rate_limit_per_hour) {
      console.error('[external-lead-webhook] Rate limit exceeded for key:', keyPrefix);
      return new Response(
        JSON.stringify({ success: false, error: 'Rate limit exceeded. Try again later.' }),
        { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check IP allowlist if configured
    if (apiKeyRecord.allowed_ips && apiKeyRecord.allowed_ips.length > 0) {
      if (!apiKeyRecord.allowed_ips.includes(clientIp)) {
        console.error('[external-lead-webhook] IP not in allowlist:', clientIp);
        return new Response(
          JSON.stringify({ success: false, error: 'IP address not authorized' }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    const tenantId = apiKeyRecord.tenant_id;
    console.log('[external-lead-webhook] Processing lead for tenant:', tenantId);

    // Check for duplicate contact (by phone or email)
    const normalizedPhone = normalizePhone(lead.phone);
    let existingContact = null;

    // First try phone match
    const { data: phoneMatch } = await supabase
      .from('contacts')
      .select('id, first_name, last_name, email, phone, assigned_rep')
      .eq('tenant_id', tenantId)
      .or(`phone.ilike.%${normalizedPhone},mobile_phone.ilike.%${normalizedPhone}`)
      .limit(1)
      .maybeSingle();

    if (phoneMatch) {
      existingContact = phoneMatch;
    } else if (lead.email) {
      // Try email match
      const { data: emailMatch } = await supabase
        .from('contacts')
        .select('id, first_name, last_name, email, phone, assigned_rep')
        .eq('tenant_id', tenantId)
        .ilike('email', lead.email)
        .limit(1)
        .maybeSingle();
      
      if (emailMatch) {
        existingContact = emailMatch;
      }
    }

    let contactId: string;
    let pipelineEntryId: string | null = null;
    let appointmentId: string | null = null;
    let isDuplicate = false;

    if (existingContact) {
      // Use existing contact
      contactId = existingContact.id;
      isDuplicate = true;
      console.log('[external-lead-webhook] Found existing contact:', contactId);
    } else {
      // Create new contact
      const fullAddress = [lead.address, lead.city, lead.state, lead.zip]
        .filter(Boolean)
        .join(', ');

      const { data: newContact, error: contactError } = await supabase
        .from('contacts')
        .insert({
          tenant_id: tenantId,
          first_name: lead.first_name,
          last_name: lead.last_name || '',
          email: lead.email,
          phone: lead.phone,
          address: fullAddress || null,
          city: lead.city,
          state: lead.state,
          zip: lead.zip,
          lead_source: lead.lead_source || 'website_form',
          notes: lead.message,
          status: 'new',
          custom_fields: lead.custom_fields || {}
        })
        .select('id')
        .single();

      if (contactError) {
        console.error('[external-lead-webhook] Error creating contact:', contactError);
        throw new Error('Failed to create contact');
      }

      contactId = newContact.id;
      console.log('[external-lead-webhook] Created new contact:', contactId);
    }

    // Create pipeline entry (lead) for the contact
    const leadNumber = generateLeadNumber();
    
    const { data: pipelineEntry, error: pipelineError } = await supabase
      .from('pipeline_entries')
      .insert({
        tenant_id: tenantId,
        contact_id: contactId,
        lead_number: leadNumber,
        status: 'lead',
        stage: 'new',
        lead_source: lead.lead_source || 'website_form',
        notes: lead.message,
        metadata: {
          source_url: lead.source_url,
          external_submission: true,
          submitted_at: new Date().toISOString()
        }
      })
      .select('id')
      .single();

    if (pipelineError) {
      console.error('[external-lead-webhook] Error creating pipeline entry:', pipelineError);
    } else {
      pipelineEntryId = pipelineEntry.id;
      console.log('[external-lead-webhook] Created pipeline entry:', pipelineEntryId);
    }

    // Create appointment if requested
    if (lead.appointment_requested) {
      try {
        const appointmentDate = new Date(lead.appointment_requested);
        const appointmentEnd = new Date(appointmentDate.getTime() + 60 * 60 * 1000); // 1 hour

        const { data: appointment, error: apptError } = await supabase
          .from('appointments')
          .insert({
            tenant_id: tenantId,
            contact_id: contactId,
            title: `Consultation - ${lead.first_name} ${lead.last_name || ''}`,
            appointment_type: 'consultation',
            scheduled_start: appointmentDate.toISOString(),
            scheduled_end: appointmentEnd.toISOString(),
            address: [lead.address, lead.city, lead.state, lead.zip].filter(Boolean).join(', '),
            notes: `Requested via website form. ${lead.message || ''}`,
            status: 'pending'
          })
          .select('id')
          .single();

        if (apptError) {
          console.error('[external-lead-webhook] Error creating appointment:', apptError);
        } else {
          appointmentId = appointment.id;
          console.log('[external-lead-webhook] Created appointment:', appointmentId);
        }
      } catch (dateError) {
        console.error('[external-lead-webhook] Invalid appointment date:', lead.appointment_requested);
      }
    }

    // Log the submission
    const { error: submissionError } = await supabase
      .from('external_lead_submissions')
      .insert({
        tenant_id: tenantId,
        api_key_id: apiKeyRecord.id,
        contact_id: contactId,
        pipeline_entry_id: pipelineEntryId,
        appointment_id: appointmentId,
        raw_payload: body,
        lead_source: lead.lead_source || 'website_form',
        source_url: lead.source_url,
        ip_address: clientIp,
        user_agent: userAgent,
        processing_status: 'processed',
        processed_at: new Date().toISOString()
      });

    if (submissionError) {
      console.error('[external-lead-webhook] Error logging submission:', submissionError);
    }

    // Update API key usage count
    await supabase
      .from('company_api_keys')
      .update({ 
        last_used_at: new Date().toISOString(),
        usage_count: (apiKeyRecord.usage_count || 0) + 1
      })
      .eq('id', apiKeyRecord.id);

    // Create notification for the company
    const { data: adminUsers } = await supabase
      .from('profiles')
      .select('id')
      .eq('tenant_id', tenantId)
      .in('role', ['owner', 'office_admin', 'sales_manager'])
      .limit(5);

    if (adminUsers && adminUsers.length > 0) {
      const notifications = adminUsers.map(user => ({
        tenant_id: tenantId,
        user_id: user.id,
        type: 'new_lead',
        title: 'New Website Lead',
        message: `${lead.first_name} ${lead.last_name || ''} submitted a lead via your website form.`,
        metadata: {
          contact_id: contactId,
          pipeline_entry_id: pipelineEntryId,
          lead_source: lead.lead_source || 'website_form'
        }
      }));

      await supabase.from('notifications').insert(notifications);
    }

    console.log('[external-lead-webhook] Lead processed successfully');

    return new Response(
      JSON.stringify({
        success: true,
        data: {
          lead_id: pipelineEntryId,
          contact_id: contactId,
          appointment_id: appointmentId,
          is_duplicate: isDuplicate,
          lead_number: leadNumber
        }
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[external-lead-webhook] Error:', error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error instanceof Error ? error.message : 'Internal server error' 
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
