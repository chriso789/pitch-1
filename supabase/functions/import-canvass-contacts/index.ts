import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface CanvassContact {
  date_in_tz?: string;
  time_in_tz?: string;
  status_name?: string;
  sub_status_name?: string;
  email?: string;
  ho_name?: string;
  rep_name?: string;
  address?: string;
  city?: string;
  state?: string;
  zipcode?: string;
  last_note?: string;
  present_at_location?: string;
}

// Map status names to qualification_status - handles all 12 canvassing statuses
function mapStatus(statusName: string | undefined): string {
  if (!statusName) return 'new';
  const normalized = statusName.toLowerCase().trim();
  
  // Check "not interested" first (before "interested")
  if (normalized.includes('not interested')) return 'not_interested';
  if (normalized.includes('interested')) return 'qualified';
  if (normalized.includes('storm damage')) return 'storm_damage';
  if (normalized.includes('old roof')) return 'old_roof_marketing';
  if (normalized.includes('new roof')) return 'new_roof';
  if (normalized.includes('no answer')) return 'no_answer';
  if (normalized.includes('not home')) return 'not_home';
  
  // NEW mappings for additional statuses
  if (normalized.includes('go back')) return 'go_back';
  if (normalized.includes('contract signed')) return 'contract_signed';
  if (normalized.includes('unqualified')) return 'unqualified';
  if (normalized.includes('not contacted')) return 'not_contacted';
  if (normalized.includes('inspection needed')) return 'inspection_needed';
  if (normalized.includes('already solar')) return 'already_solar';
  
  return 'new';
}

// Parse homeowner name into first and last
function parseName(hoName: string | undefined): { firstName: string; lastName: string } {
  if (!hoName || hoName.trim() === '') {
    return { firstName: 'Unknown', lastName: 'Homeowner' };
  }
  
  const cleaned = hoName.trim();
  const parts = cleaned.split(/\s+/);
  
  if (parts.length === 1) {
    return { firstName: parts[0], lastName: '' };
  }
  
  const firstName = parts[0];
  const lastName = parts.slice(1).join(' ');
  return { firstName, lastName };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('authorization');
    if (!authHeader) {
      throw new Error('Missing authorization header');
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Get user from token
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    );
    
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      throw new Error('Unauthorized');
    }

    // Get user's tenant
    const { data: profile } = await supabase
      .from('profiles')
      .select('tenant_id, active_tenant_id')
      .eq('id', user.id)
      .single();

    if (!profile) {
      throw new Error('Profile not found');
    }

    const tenantId = profile.active_tenant_id || profile.tenant_id;
    const { contacts } = await req.json() as { contacts: CanvassContact[] };

    if (!contacts || !Array.isArray(contacts)) {
      throw new Error('Invalid contacts data');
    }

    console.log(`Processing ${contacts.length} contacts for tenant ${tenantId}`);

    // Get all profiles for rep assignment lookup
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, email, first_name, last_name')
      .eq('tenant_id', tenantId);

    const profilesByEmail = new Map(
      (profiles || []).map(p => [p.email?.toLowerCase(), p.id])
    );

    // Get existing contacts to check for duplicates (by address)
    const { data: existingContacts } = await supabase
      .from('contacts')
      .select('id, address_street, address_city, address_state, address_zip')
      .eq('tenant_id', tenantId);

    const existingAddresses = new Set(
      (existingContacts || []).map(c => 
        `${c.address_street || ''}-${c.address_city || ''}-${c.address_state || ''}-${c.address_zip || ''}`.toLowerCase()
      )
    );

    const results = {
      imported: 0,
      duplicates: 0,
      errors: 0,
      errorMessages: [] as string[],
    };

    // Process in batches of 50
    const batchSize = 50;
    for (let i = 0; i < contacts.length; i += batchSize) {
      const batch = contacts.slice(i, i + batchSize);
      const toInsert = [];

      for (const contact of batch) {
        try {
          // Check for duplicate by address
          const addressKey = `${contact.address || ''}-${contact.city || ''}-${contact.state || ''}-${contact.zipcode || ''}`.toLowerCase();
          if (existingAddresses.has(addressKey)) {
            results.duplicates++;
            continue;
          }

          const { firstName, lastName } = parseName(contact.ho_name);
          
          // Try email first, then rep_name for assignment
          let assignedTo = contact.email ? profilesByEmail.get(contact.email.toLowerCase()) : null;
          if (!assignedTo && contact.rep_name) {
            const repProfile = (profiles || []).find(p => 
              `${p.first_name} ${p.last_name}`.toLowerCase() === contact.rep_name?.toLowerCase()
            );
            assignedTo = repProfile?.id || null;
          }
          
          // Parse sub_status for priority
          const subStatus = contact.sub_status_name?.toLowerCase() || '';
          const priority = subStatus.includes('high') ? 'high' : 
                          subStatus.includes('medium') ? 'medium' : null;
          
          // Parse date/time
          let createdAt = new Date().toISOString();
          if (contact.date_in_tz) {
            try {
              const dateStr = contact.date_in_tz;
              const timeStr = contact.time_in_tz || '12:00:00';
              createdAt = new Date(`${dateStr}T${timeStr}`).toISOString();
            } catch (e) {
              // Use current date if parsing fails
            }
          }

          toInsert.push({
            tenant_id: tenantId,
            first_name: firstName,
            last_name: lastName,
            address_street: contact.address || '',
            address_city: contact.city || '',
            address_state: contact.state || '',
            address_zip: contact.zipcode || '',
            lead_source: 'Door Knock',
            qualification_status: mapStatus(contact.status_name),
            assigned_to: assignedTo,
            notes: contact.last_note || null,
            created_at: createdAt,
            metadata: {
              imported_from: 'canvass_excel',
              original_status: contact.status_name,
              sub_status: contact.sub_status_name,
              priority,
              rep_name: contact.rep_name,
              canvasser_email: contact.email,
              present_at_location: contact.present_at_location === 'Y',
              import_date: new Date().toISOString(),
            },
          });

          // Add to existing set to prevent duplicates within this import
          existingAddresses.add(addressKey);
        } catch (e) {
          results.errors++;
          results.errorMessages.push(`Row error: ${e.message}`);
        }
      }

      if (toInsert.length > 0) {
        const { error: insertError } = await supabase
          .from('contacts')
          .insert(toInsert);

        if (insertError) {
          console.error('Insert error:', insertError);
          results.errors += toInsert.length;
          results.errorMessages.push(insertError.message);
        } else {
          results.imported += toInsert.length;
        }
      }

      console.log(`Processed batch ${Math.floor(i / batchSize) + 1}, imported: ${results.imported}`);
    }

    console.log('Import complete:', results);

    return new Response(
      JSON.stringify({
        success: true,
        results,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Import error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
