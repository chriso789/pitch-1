import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-api-key',
};

interface LeadPayload {
  first_name: string;
  last_name?: string;
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
  appointment_date?: string;
  appointment_time?: string;
  appointment_notes?: string;
  service_type?: string;
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

// Parse appointment date and time into a Date object
function parseAppointmentDateTime(date?: string, time?: string): Date {
  if (!date) {
    // Default to tomorrow at 10am
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(10, 0, 0, 0);
    return tomorrow;
  }
  
  const appointmentDate = new Date(date);
  
  if (time) {
    // Try to parse time like "10:00 AM", "2:30 PM", "14:00", etc.
    const timeMatch = time.match(/(\d{1,2}):?(\d{2})?\s*(am|pm)?/i);
    if (timeMatch) {
      let hours = parseInt(timeMatch[1], 10);
      const minutes = parseInt(timeMatch[2] || "0", 10);
      const ampm = timeMatch[3]?.toLowerCase();
      
      if (ampm === "pm" && hours < 12) hours += 12;
      if (ampm === "am" && hours === 12) hours = 0;
      
      appointmentDate.setHours(hours, minutes, 0, 0);
    }
  } else {
    appointmentDate.setHours(10, 0, 0, 0);
  }
  
  return appointmentDate;
}

serve(async (req: Request) => {
  console.log('[external-lead-webhook] Request received');
  
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // Handle comma-separated IPs from Cloudflare - take only the first one
  const rawClientIp = req.headers.get('x-forwarded-for') || req.headers.get('cf-connecting-ip') || 'unknown';
  const clientIp = rawClientIp.split(',')[0].trim();
  const userAgent = req.headers.get('user-agent') || 'unknown';

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const body: ExternalLeadRequest = await req.json();
    const { api_key, lead } = body;

    // Validate required fields - only first_name and phone are truly required
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
      .select('id, tenant_id, permissions, rate_limit_per_hour, allowed_ips, usage_count, default_assignee_id')
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
    const defaultAssigneeId = apiKeyRecord.default_assignee_id;
    
    console.log('[external-lead-webhook] Processing lead for tenant:', tenantId);
    if (defaultAssigneeId) {
      console.log('[external-lead-webhook] Will assign to:', defaultAssigneeId);
    }

    // Check for duplicate contact (by phone or email)
    const normalizedPhone = normalizePhone(lead.phone);
    let existingContact = null;

    // First try phone match
    const { data: phoneMatch } = await supabase
      .from('contacts')
      .select('id, first_name, last_name, email, phone, assigned_to')
      .eq('tenant_id', tenantId)
      .eq('is_deleted', false)
      .or(`phone.ilike.%${normalizedPhone}`)
      .limit(1)
      .maybeSingle();

    if (phoneMatch) {
      existingContact = phoneMatch;
    } else if (lead.email) {
      // Try email match
      const { data: emailMatch } = await supabase
        .from('contacts')
        .select('id, first_name, last_name, email, phone, assigned_to')
        .eq('tenant_id', tenantId)
        .eq('is_deleted', false)
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
      
      // Update assignment if not already assigned and we have a default assignee
      if (!existingContact.assigned_to && defaultAssigneeId) {
        await supabase
          .from('contacts')
          .update({ assigned_to: defaultAssigneeId })
          .eq('id', contactId);
        console.log('[external-lead-webhook] Updated contact assignment to:', defaultAssigneeId);
      }
    } else {
      // Create new contact with correct column names
      // Only include fields that have values - dismiss missing optional fields
      const contactData: Record<string, unknown> = {
        tenant_id: tenantId,
        first_name: lead.first_name,
        last_name: lead.last_name || '',
        phone: lead.phone,
        lead_source: lead.lead_source || 'website_form',
        lead_status: 'new',
      };

      // Add optional fields only if provided
      if (lead.email) contactData.email = lead.email;
      if (lead.address) contactData.address_street = lead.address;
      if (lead.city) contactData.address_city = lead.city;
      if (lead.state) contactData.address_state = lead.state;
      if (lead.zip) contactData.address_zip = lead.zip;
      if (lead.message) contactData.notes = lead.message;
      if (lead.custom_fields) contactData.metadata = lead.custom_fields;
      
      // Auto-assign to default assignee if configured
      if (defaultAssigneeId) {
        contactData.assigned_to = defaultAssigneeId;
      }

      console.log('[external-lead-webhook] Creating contact with data:', JSON.stringify(contactData));

      const { data: newContact, error: contactError } = await supabase
        .from('contacts')
        .insert(contactData)
        .select('id')
        .single();

      if (contactError) {
        console.error('[external-lead-webhook] Error creating contact:', contactError);
        throw new Error(`Failed to create contact: ${contactError.message}`);
      }

      contactId = newContact.id;
      console.log('[external-lead-webhook] Created new contact:', contactId);
    }

    // Create pipeline entry (lead) for the contact
    const leadNumber = generateLeadNumber();
    
    const pipelineData: Record<string, unknown> = {
      tenant_id: tenantId,
      contact_id: contactId,
      lead_number: leadNumber,
      status: 'lead',
      stage: 'new',
      source: lead.lead_source || 'website_form',
      metadata: {
        source_url: lead.source_url,
        external_submission: true,
        submitted_at: new Date().toISOString(),
        service_type: lead.service_type
      }
    };
    
    // Add notes if provided
    if (lead.message) {
      pipelineData.notes = lead.message;
    }
    
    // Auto-assign pipeline entry to default assignee
    if (defaultAssigneeId) {
      pipelineData.assigned_to = defaultAssigneeId;
    }
    
    const { data: pipelineEntry, error: pipelineError } = await supabase
      .from('pipeline_entries')
      .insert(pipelineData)
      .select('id')
      .single();

    if (pipelineError) {
      console.error('[external-lead-webhook] Error creating pipeline entry:', pipelineError);
    } else {
      pipelineEntryId = pipelineEntry.id;
      console.log('[external-lead-webhook] Created pipeline entry:', pipelineEntryId);
    }

    // Create appointment if requested - support both appointment_requested and appointment_date/time
    if (lead.appointment_requested || lead.appointment_date) {
      try {
        let appointmentDate: Date;
        
        if (lead.appointment_requested) {
          // Direct datetime string
          appointmentDate = new Date(lead.appointment_requested);
        } else {
          // Parse from date + time fields
          appointmentDate = parseAppointmentDateTime(lead.appointment_date, lead.appointment_time);
        }
        
        const appointmentEnd = new Date(appointmentDate.getTime() + 60 * 60 * 1000); // 1 hour

        // Build appointment title with service type if provided
        const serviceType = lead.service_type || 'Consultation';
        const contactName = `${lead.first_name} ${lead.last_name || ''}`.trim();

        const appointmentData: Record<string, unknown> = {
          tenant_id: tenantId,
          contact_id: contactId,
          title: `${serviceType} - ${contactName}`,
          appointment_type: lead.service_type?.toLowerCase().replace(/\s+/g, '_') || 'consultation',
          scheduled_start: appointmentDate.toISOString(),
          scheduled_end: appointmentEnd.toISOString(),
          status: 'pending'
        };
        
        // Build notes from appointment_notes and message
        const notesParts = [
          lead.appointment_notes,
          lead.message,
          'Requested via website form.'
        ].filter(Boolean);
        appointmentData.notes = notesParts.join('\n\n');
        
        // Build address if provided
        const addressParts = [lead.address, lead.city, lead.state, lead.zip].filter(Boolean);
        if (addressParts.length > 0) {
          appointmentData.address = addressParts.join(', ');
        }
        
        // Assign appointment to default assignee
        if (defaultAssigneeId) {
          appointmentData.assigned_to = defaultAssigneeId;
        }

        console.log('[external-lead-webhook] Creating appointment:', JSON.stringify(appointmentData));

        const { data: appointment, error: apptError } = await supabase
          .from('appointments')
          .insert(appointmentData)
          .select('id')
          .single();

        if (apptError) {
          console.error('[external-lead-webhook] Error creating appointment:', apptError);
        } else {
          appointmentId = appointment.id;
          console.log('[external-lead-webhook] Created appointment:', appointmentId);
        }
      } catch (dateError) {
        console.error('[external-lead-webhook] Invalid appointment date:', lead.appointment_requested || lead.appointment_date, dateError);
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

    // Create notification for assigned user or admins
    const notifyUserIds: string[] = [];
    
    if (defaultAssigneeId) {
      notifyUserIds.push(defaultAssigneeId);
    } else {
      // Fallback: notify admins if no default assignee
      const { data: adminUsers } = await supabase
        .from('profiles')
        .select('id')
        .eq('tenant_id', tenantId)
        .in('role', ['owner', 'office_admin', 'sales_manager'])
        .limit(5);
      
      if (adminUsers) {
        notifyUserIds.push(...adminUsers.map(u => u.id));
      }
    }

    if (notifyUserIds.length > 0) {
      const notifications = notifyUserIds.map(userId => ({
        tenant_id: tenantId,
        user_id: userId,
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
          lead_number: leadNumber,
          assigned_to: defaultAssigneeId || null
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
