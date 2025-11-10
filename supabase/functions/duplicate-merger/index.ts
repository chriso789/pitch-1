import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface RequestData {
  action: string;
  data: any;
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { action, data }: RequestData = await req.json();
    
    // Get authorization header
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'No authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Initialize Supabase client
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        },
        global: {
          headers: {
            Authorization: authHeader,
          },
        },
      }
    );

    // Verify user authentication
    const { data: userData, error: authError } = await supabase.auth.getUser();
    if (authError || !userData.user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const userId = userData.user.id;

    // Get user's active tenant (supports multi-company switching)
    const { data: profile } = await supabase
      .from('profiles')
      .select('active_tenant_id, tenant_id')
      .eq('id', userId)
      .single();

    const tenantId = profile?.active_tenant_id || profile?.tenant_id;

    console.log(`Processing ${action} for user ${userId}, tenant ${tenantId}`);

    // Route to appropriate handler
    let result;
    switch (action) {
      case 'merge_contacts':
        result = await mergeContacts(supabase, tenantId, data, userId);
        break;
      case 'find_duplicates':
        result = await findDuplicatesManually(supabase, tenantId, data);
        break;
      case 'get_merge_preview':
        result = await getMergePreview(supabase, tenantId, data);
        break;
      default:
        throw new Error(`Unknown action: ${action}`);
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error('Error in duplicate-merger function:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

async function mergeContacts(supabase: any, tenantId: string, data: any, userId: string) {
  const { duplicate_id, primary_contact_id, duplicate_contact_id } = data;

  try {
    // Start a transaction-like approach
    console.log(`Merging contacts: primary=${primary_contact_id}, duplicate=${duplicate_contact_id}`);

    // Get both contacts
    const { data: primaryContact, error: primaryError } = await supabase
      .from('contacts')
      .select('*')
      .eq('id', primary_contact_id)
      .eq('tenant_id', tenantId)
      .single();

    if (primaryError) throw new Error(`Failed to fetch primary contact: ${primaryError.message}`);

    const { data: duplicateContact, error: duplicateError } = await supabase
      .from('contacts')
      .select('*')
      .eq('id', duplicate_contact_id)
      .eq('tenant_id', tenantId)
      .single();

    if (duplicateError) throw new Error(`Failed to fetch duplicate contact: ${duplicateError.message}`);

    // Merge contact data (prefer non-null values from either contact)
    const mergedData = {
      first_name: primaryContact.first_name || duplicateContact.first_name,
      last_name: primaryContact.last_name || duplicateContact.last_name,
      email: primaryContact.email || duplicateContact.email,
      phone: primaryContact.phone || duplicateContact.phone,
      company_name: primaryContact.company_name || duplicateContact.company_name,
      address_street: primaryContact.address_street || duplicateContact.address_street,
      address_city: primaryContact.address_city || duplicateContact.address_city,
      address_state: primaryContact.address_state || duplicateContact.address_state,
      address_zip: primaryContact.address_zip || duplicateContact.address_zip,
      notes: primaryContact.notes && duplicateContact.notes 
        ? `${primaryContact.notes}\n\n--- Merged from duplicate contact ---\n${duplicateContact.notes}`
        : primaryContact.notes || duplicateContact.notes,
      // Merge tags
      tags: [...new Set([...(primaryContact.tags || []), ...(duplicateContact.tags || [])])],
      // Merge metadata
      metadata: { ...duplicateContact.metadata, ...primaryContact.metadata },
      // Keep higher lead score
      lead_score: Math.max(primaryContact.lead_score || 0, duplicateContact.lead_score || 0),
      // Keep best qualification status
      qualification_status: primaryContact.qualification_status || duplicateContact.qualification_status,
      // Keep most recent activity dates
      last_scored_at: primaryContact.last_scored_at > duplicateContact.last_scored_at 
        ? primaryContact.last_scored_at : duplicateContact.last_scored_at,
      last_nurturing_activity: primaryContact.last_nurturing_activity > duplicateContact.last_nurturing_activity
        ? primaryContact.last_nurturing_activity : duplicateContact.last_nurturing_activity
    };

    // Update primary contact with merged data
    const { error: updateError } = await supabase
      .from('contacts')
      .update(mergedData)
      .eq('id', primary_contact_id);

    if (updateError) throw new Error(`Failed to update primary contact: ${updateError.message}`);

    // Update all references to the duplicate contact
    const referenceUpdates = [
      // Pipeline entries
      supabase.from('pipeline_entries').update({ contact_id: primary_contact_id }).eq('contact_id', duplicate_contact_id),
      // Communication history
      supabase.from('communication_history').update({ contact_id: primary_contact_id }).eq('contact_id', duplicate_contact_id),
      // Follow-up instances
      supabase.from('follow_up_instances').update({ contact_id: primary_contact_id }).eq('contact_id', duplicate_contact_id),
      // Nurturing enrollments
      supabase.from('nurturing_enrollments').update({ contact_id: primary_contact_id }).eq('contact_id', duplicate_contact_id),
      // Documents
      supabase.from('documents').update({ contact_id: primary_contact_id }).eq('contact_id', duplicate_contact_id),
      // Calls
      supabase.from('calls').update({ contact_id: primary_contact_id }).eq('contact_id', duplicate_contact_id),
    ];

    // Execute all updates
    const updateResults = await Promise.allSettled(referenceUpdates);
    
    // Log any failures but don't stop the process
    updateResults.forEach((result, index) => {
      if (result.status === 'rejected') {
        console.warn(`Reference update ${index} failed:`, result.reason);
      }
    });

    // Log the merge in the audit table
    const { error: logError } = await supabase
      .from('contact_merge_log')
      .insert({
        tenant_id: tenantId,
        primary_contact_id,
        merged_contact_id: duplicate_contact_id,
        merged_data: duplicateContact,
        merged_by: userId
      });

    if (logError) {
      console.warn('Failed to log merge:', logError);
    }

    // Delete the duplicate contact
    const { error: deleteError } = await supabase
      .from('contacts')
      .delete()
      .eq('id', duplicate_contact_id);

    if (deleteError) throw new Error(`Failed to delete duplicate contact: ${deleteError.message}`);

    // Update the potential duplicate record status
    const { error: statusError } = await supabase
      .from('potential_duplicates')
      .update({ 
        status: 'merged',
        reviewed_by: userId,
        reviewed_at: new Date().toISOString()
      })
      .eq('id', duplicate_id);

    if (statusError) {
      console.warn('Failed to update duplicate status:', statusError);
    }

    return { 
      success: true, 
      message: 'Contacts merged successfully',
      merged_contact_id: primary_contact_id
    };

  } catch (error: any) {
    console.error('Error merging contacts:', error);
    throw error;
  }
}

async function findDuplicatesManually(supabase: any, tenantId: string, data: any) {
  const { contact_id } = data;

  try {
    // Get the target contact
    const { data: targetContact, error: contactError } = await supabase
      .from('contacts')
      .select('*')
      .eq('id', contact_id)
      .eq('tenant_id', tenantId)
      .single();

    if (contactError) throw contactError;

    // Find potential duplicates manually (similar to trigger logic)
    const { data: allContacts, error: allContactsError } = await supabase
      .from('contacts')
      .select('*')
      .eq('tenant_id', tenantId)
      .neq('id', contact_id);

    if (allContactsError) throw allContactsError;

    const potentialDuplicates = [];

    for (const contact of allContacts) {
      let matchScore = 0;
      let fieldCount = 0;
      const matchFields = [];

      // Email match
      if (targetContact.email && contact.email) {
        fieldCount++;
        if (targetContact.email.toLowerCase().trim() === contact.email.toLowerCase().trim()) {
          matchScore++;
          matchFields.push('email');
        }
      }

      // Phone match
      if (targetContact.phone && contact.phone) {
        fieldCount++;
        const normalizePhone = (phone: string) => phone.replace(/[^0-9]/g, '');
        if (normalizePhone(targetContact.phone) === normalizePhone(contact.phone)) {
          matchScore++;
          matchFields.push('phone');
        }
      }

      // Name similarity
      if (targetContact.first_name && targetContact.last_name && contact.first_name && contact.last_name) {
        fieldCount++;
        const firstName1 = targetContact.first_name.toLowerCase().trim();
        const lastName1 = targetContact.last_name.toLowerCase().trim();
        const firstName2 = contact.first_name.toLowerCase().trim();
        const lastName2 = contact.last_name.toLowerCase().trim();

        if ((firstName1 === firstName2 && lastName1 === lastName2) ||
            firstName1.includes(firstName2) || firstName2.includes(firstName1) ||
            lastName1.includes(lastName2) || lastName2.includes(lastName1)) {
          matchScore += 0.8;
          matchFields.push('name');
        }
      }

      // Address match
      if (targetContact.address_street && contact.address_street) {
        fieldCount++;
        if (targetContact.address_street.toLowerCase().trim() === contact.address_street.toLowerCase().trim()) {
          matchScore++;
          matchFields.push('address');
        }
      }

      const totalScore = fieldCount > 0 ? matchScore / fieldCount : 0;

      if (totalScore >= 0.7 && matchFields.length > 0) {
        potentialDuplicates.push({
          contact,
          similarity_score: totalScore,
          match_fields: matchFields
        });
      }
    }

    return {
      target_contact: targetContact,
      potential_duplicates: potentialDuplicates
    };

  } catch (error: any) {
    console.error('Error finding duplicates manually:', error);
    throw error;
  }
}

async function getMergePreview(supabase: any, tenantId: string, data: any) {
  const { primary_contact_id, duplicate_contact_id } = data;

  try {
    // Get both contacts
    const { data: contacts, error } = await supabase
      .from('contacts')
      .select('*')
      .in('id', [primary_contact_id, duplicate_contact_id])
      .eq('tenant_id', tenantId);

    if (error) throw error;

    const primaryContact = contacts.find((c: any) => c.id === primary_contact_id);
    const duplicateContact = contacts.find((c: any) => c.id === duplicate_contact_id);

    if (!primaryContact || !duplicateContact) {
      throw new Error('One or both contacts not found');
    }

    // Create merge preview
    const mergePreview = {
      first_name: primaryContact.first_name || duplicateContact.first_name,
      last_name: primaryContact.last_name || duplicateContact.last_name,
      email: primaryContact.email || duplicateContact.email,
      phone: primaryContact.phone || duplicateContact.phone,
      company_name: primaryContact.company_name || duplicateContact.company_name,
      address_street: primaryContact.address_street || duplicateContact.address_street,
      address_city: primaryContact.address_city || duplicateContact.address_city,
      address_state: primaryContact.address_state || duplicateContact.address_state,
      address_zip: primaryContact.address_zip || duplicateContact.address_zip,
      tags: [...new Set([...(primaryContact.tags || []), ...(duplicateContact.tags || [])])],
      lead_score: Math.max(primaryContact.lead_score || 0, duplicateContact.lead_score || 0)
    };

    return {
      primary_contact: primaryContact,
      duplicate_contact: duplicateContact,
      merge_preview: mergePreview
    };

  } catch (error: any) {
    console.error('Error getting merge preview:', error);
    throw error;
  }
}
