import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';
import { corsHeaders } from '../_shared/cors.ts';

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: {
          headers: { Authorization: req.headers.get('Authorization')! },
        },
      }
    );

    const { pipelineEntryId, batchMode = false } = await req.json();

    console.log('🔄 Starting coordinate sync:', { pipelineEntryId, batchMode });

    let syncedCount = 0;
    let errorCount = 0;
    const errors: string[] = [];

    if (batchMode) {
      // Batch mode: sync all pipeline entries with mismatched coordinates
      const { data: entries, error: fetchError } = await supabaseClient
        .from('pipeline_entries')
        .select(`
          id,
          contact_id,
          metadata,
          contacts!inner(verified_address, latitude, longitude)
        `);

      if (fetchError) {
        throw new Error(`Failed to fetch pipeline entries: ${fetchError.message}`);
      }

      console.log(`📊 Found ${entries?.length || 0} pipeline entries to check`);

      for (const entry of entries || []) {
        try {
          const contact = (entry as any).contacts;
          
          // Skip if no contact verified address
          if (!contact?.verified_address?.lat || !contact?.verified_address?.lng) {
            continue;
          }

          const metadata = entry.metadata || {};
          const currentLat = (metadata as any)?.verified_address?.geometry?.location?.lat || 
                           (metadata as any)?.verified_address?.lat;
          const currentLng = (metadata as any)?.verified_address?.geometry?.location?.lng || 
                           (metadata as any)?.verified_address?.lng;

          // Calculate distance if coordinates exist
          if (currentLat && currentLng) {
            const latDiff = Math.abs(contact.verified_address.lat - currentLat);
            const lngDiff = Math.abs(contact.verified_address.lng - currentLng);
            const distance = Math.sqrt(latDiff * latDiff + lngDiff * lngDiff) * 111000; // rough meters

            // Skip if coordinates are already in sync (<10m difference)
            if (distance < 10) {
              continue;
            }

            console.log(`⚠️ Coordinate mismatch detected for ${entry.id}: ${distance.toFixed(0)}m`);
          }

          // Update pipeline entry with correct coordinates from contact
          const { error: updateError } = await supabaseClient
            .from('pipeline_entries')
            .update({
              metadata: {
                ...metadata,
                verified_address: {
                  ...contact.verified_address,
                  geometry: {
                    location: {
                      lat: contact.verified_address.lat,
                      lng: contact.verified_address.lng
                    }
                  }
                },
                coordinate_sync_timestamp: new Date().toISOString(),
                coordinate_sync_source: 'contact_verified_address'
              }
            })
            .eq('id', entry.id);

          if (updateError) {
            errors.push(`Failed to sync ${entry.id}: ${updateError.message}`);
            errorCount++;
          } else {
            syncedCount++;
            console.log(`✅ Synced coordinates for ${entry.id}`);
          }
        } catch (err: any) {
          errors.push(`Error processing ${entry.id}: ${err.message}`);
          errorCount++;
        }
      }

    } else {
      // Single mode: sync specific pipeline entry
      if (!pipelineEntryId) {
        throw new Error('pipelineEntryId required for single mode');
      }

      const { data: entry, error: fetchError } = await supabaseClient
        .from('pipeline_entries')
        .select(`
          id,
          contact_id,
          metadata,
          contacts!inner(verified_address, latitude, longitude)
        `)
        .eq('id', pipelineEntryId)
        .single();

      if (fetchError) {
        throw new Error(`Failed to fetch pipeline entry: ${fetchError.message}`);
      }

      const contact = (entry as any)?.contacts;

      if (!contact?.verified_address?.lat || !contact?.verified_address?.lng) {
        throw new Error('Contact does not have verified address coordinates');
      }

      const metadata = entry.metadata || {};

      // Update pipeline entry with correct coordinates from contact
      const { error: updateError } = await supabaseClient
        .from('pipeline_entries')
        .update({
          metadata: {
            ...metadata,
            verified_address: {
              ...contact.verified_address,
              geometry: {
                location: {
                  lat: contact.verified_address.lat,
                  lng: contact.verified_address.lng
                }
              }
            },
            coordinate_sync_timestamp: new Date().toISOString(),
            coordinate_sync_source: 'contact_verified_address'
          }
        })
        .eq('id', pipelineEntryId);

      if (updateError) {
        throw new Error(`Failed to update coordinates: ${updateError.message}`);
      }

      syncedCount = 1;
      console.log(`✅ Successfully synced coordinates for ${pipelineEntryId}`);
    }

    return new Response(
      JSON.stringify({
        success: true,
        syncedCount,
        errorCount,
        errors: errors.length > 0 ? errors : undefined,
        message: batchMode 
          ? `Synced ${syncedCount} entries, ${errorCount} errors`
          : `Successfully synced coordinates for pipeline entry`
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200 
      }
    );

  } catch (error: any) {
    console.error('❌ Coordinate sync error:', error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error.message 
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500 
      }
    );
  }
});
