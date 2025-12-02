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
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { session_token, pins } = await req.json();
    
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
      .select('id, tenant_id, first_name, last_name')
      .eq('id', repId)
      .single();

    if (repError || !rep) {
      return new Response(
        JSON.stringify({ error: 'Representative not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const results = [];

    // Process each pin
    for (const pin of pins) {
      try {
        const {
          latitude,
          longitude,
          address,
          property_details = {},
          disposition_id,
          notes = '',
          pin_metadata = {}
        } = pin;

        // Create contact record
        const contactData = {
          tenant_id: tenantId,
          first_name: property_details.homeowner_first_name || 'Canvass',
          last_name: property_details.homeowner_last_name || 'Lead',
          address_street: address?.street || '',
          address_city: address?.city || '',
          address_state: address?.state || '',
          address_zip: address?.zip || '',
          latitude: latitude,
          longitude: longitude,
          lead_source: 'canvassing',
          lead_source_details: {
            canvass_app: 'storm_canvass_pro',
            pin_created_at: pin_metadata.created_at || new Date().toISOString(),
            rep_id: repId,
            pin_id: pin_metadata.pin_id
          },
          notes: notes,
          created_by: repId,
          metadata: {
            canvassing_data: pin_metadata,
            property_details: property_details
          }
        };

        const { data: contact, error: contactError } = await supabase
          .from('contacts')
          .insert(contactData)
          .select()
          .single();

        if (contactError) {
          console.error('Error creating contact:', contactError);
          results.push({
            pin_id: pin_metadata.pin_id,
            success: false,
            error: contactError.message
          });
          continue;
        }

        // Update qualification status based on disposition
        if (disposition_id) {
          const { data: disposition } = await supabase
            .from('dialer_dispositions')
            .select('name, is_positive')
            .eq('id', disposition_id)
            .single();

          if (disposition) {
            await supabase
              .from('contacts')
              .update({
                qualification_status: disposition.is_positive ? 'qualified' : 'not_interested'
              })
              .eq('id', contact.id);

            // Create pipeline entry for positive dispositions
            if (disposition.is_positive) {
              const pipelineData = {
                tenant_id: tenantId,
                contact_id: contact.id,
                status: 'lead',
                lead_quality_score: 75,
                assigned_to: repId,
                metadata: {
                  source: 'canvassing',
                  disposition: disposition.name,
                  created_from_pin: true
                },
                created_by: repId
              };

              await supabase
                .from('pipeline_entries')
                .insert(pipelineData);
            }
          }
        }

        results.push({
          pin_id: pin_metadata.pin_id,
          success: true,
          contact_id: contact.id,
          contact_number: contact.contact_number
        });

      } catch (pinError) {
        console.error('Error processing pin:', pinError);
        results.push({
          pin_id: pin.pin_metadata?.pin_id,
          success: false,
          error: pinError instanceof Error ? pinError.message : 'Unknown error'
        });
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        synced_pins: results.filter(r => r.success).length,
        failed_pins: results.filter(r => !r.success).length,
        results: results
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Pin sync error:', error);
    return new Response(
      JSON.stringify({ error: 'Pin synchronization failed' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
