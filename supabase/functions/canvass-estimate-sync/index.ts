import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
)

// Secure token validation using database lookup
async function validateSession(sessionToken: string): Promise<{ userId: string; tenantId: string } | null> {
  try {
    const { data, error } = await supabase
      .rpc('validate_canvass_token', { p_token: sessionToken });
    
    if (error || !data || data.length === 0) {
      console.log('Token validation failed:', error?.message || 'No session found');
      return null;
    }
    
    return { userId: data[0].user_id, tenantId: data[0].tenant_id };
  } catch (err) {
    console.error('Token validation error:', err);
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { session_token, contact_id, estimate_data } = await req.json();
    
    // Validate session using secure database lookup
    const session = await validateSession(session_token);
    if (!session) {
      return new Response(
        JSON.stringify({ error: 'Invalid or expired session' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { userId: repId, tenantId } = session;

    // Get rep info
    const { data: rep, error: repError } = await supabase
      .from('profiles')
      .select('first_name, last_name')
      .eq('id', repId)
      .single();

    if (repError || !rep) {
      return new Response(
        JSON.stringify({ error: 'Representative not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Verify contact exists and get details
    const { data: contact, error: contactError } = await supabase
      .from('contacts')
      .select('id, tenant_id, first_name, last_name, address_street, address_city, address_state, address_zip')
      .eq('id', contact_id)
      .eq('tenant_id', tenantId)
      .single();

    if (contactError || !contact) {
      return new Response(
        JSON.stringify({ error: 'Contact not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check if pipeline entry exists, create if not
    let { data: pipelineEntry, error: pipelineError } = await supabase
      .from('pipeline_entries')
      .select('id, metadata')
      .eq('contact_id', contact_id)
      .eq('tenant_id', tenantId)
      .single();

    if (pipelineError || !pipelineEntry) {
      // Create pipeline entry
      const { data: newPipelineEntry, error: createError } = await supabase
        .from('pipeline_entries')
        .insert({
          tenant_id: tenantId,
          contact_id: contact_id,
          status: 'estimate',
          lead_quality_score: 80,
          assigned_to: repId,
          metadata: {
            source: 'canvassing',
            estimate_created_in_field: true
          },
          created_by: repId
        })
        .select()
        .single();

      if (createError) {
        console.error('Error creating pipeline entry:', createError);
        return new Response(
          JSON.stringify({ error: 'Failed to create pipeline entry' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      pipelineEntry = newPipelineEntry;
    }

    // Generate estimate number
    const estimateNumber = `EST-${Date.now()}-${contact_id.slice(-4)}`;

    // Create estimate record
    const estimateRecord = {
      tenant_id: tenantId,
      pipeline_entry_id: pipelineEntry!.id,
      estimate_number: estimateNumber,
      customer_name: `${contact.first_name} ${contact.last_name}`,
      customer_address: `${contact.address_street}, ${contact.address_city}, ${contact.address_state} ${contact.address_zip}`,
      roof_area_sq_ft: estimate_data.roof_area_sq_ft || 0,
      roof_pitch: estimate_data.roof_pitch || '4/12',
      complexity_level: estimate_data.complexity_level || 'moderate',
      season: estimate_data.season || 'spring',
      material_cost: estimate_data.material_cost || 0,
      labor_cost: estimate_data.labor_cost || 0,
      labor_hours: estimate_data.labor_hours || 0,
      labor_rate_per_hour: estimate_data.labor_rate_per_hour || 50,
      overhead_percent: estimate_data.overhead_percent || 20,
      target_profit_percent: estimate_data.target_profit_percent || 30,
      permit_costs: estimate_data.permit_costs || 0,
      line_items: estimate_data.line_items || [],
      property_details: {
        ...estimate_data.property_details,
        canvassed: true,
        field_estimate: true
      },
      notes: estimate_data.notes || 'Field estimate created via Storm Canvass Pro',
      internal_notes: `Created by ${rep.first_name} ${rep.last_name} during canvassing`,
      sales_rep_id: repId,
      created_by: repId,
      status: 'draft'
    };

    const { data: estimate, error: estimateError } = await supabase
      .from('enhanced_estimates')
      .insert(estimateRecord)
      .select()
      .single();

    if (estimateError) {
      console.error('Error creating estimate:', estimateError);
      return new Response(
        JSON.stringify({ error: 'Failed to create estimate' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Update pipeline entry status
    await supabase
      .from('pipeline_entries')
      .update({ 
        status: 'estimate',
        metadata: {
          ...(pipelineEntry!.metadata || {}),
          estimate_id: estimate.id,
          field_estimate_created: true,
          last_updated: new Date().toISOString()
        }
      })
      .eq('id', pipelineEntry!.id);

    // Update contact with estimate activity
    const { data: currentContact } = await supabase
      .from('contacts')
      .select('metadata')
      .eq('id', contact_id)
      .single();

    const updatedMetadata = {
      ...(currentContact?.metadata || {}),
      canvassing_activity: {
        ...((currentContact?.metadata as any)?.canvassing_activity || {}),
        field_estimate_created: true,
        estimate_created_at: new Date().toISOString(),
        estimate_created_by: repId
      }
    };

    await supabase
      .from('contacts')
      .update({ metadata: updatedMetadata })
      .eq('id', contact_id);

    return new Response(
      JSON.stringify({
        success: true,
        estimate_id: estimate.id,
        estimate_number: estimateNumber,
        pipeline_entry_id: pipelineEntry!.id,
        selling_price: estimate.selling_price
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Estimate sync error:', error);
    return new Response(
      JSON.stringify({ error: 'Estimate synchronization failed' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
