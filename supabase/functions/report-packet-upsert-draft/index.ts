// ============================================================================
// REPORT PACKET UPSERT DRAFT
// Creates or updates a report packet draft with section manifest
// ============================================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface SectionConfig {
  section_type: 'cover' | 'measurement' | 'photos' | 'estimate' | 'marketing' | 'signature';
  order: number;
  enabled: boolean;
  config?: Record<string, unknown>;
  file_id?: string;
  source_document_id?: string;
  display_name?: string;
}

interface UpsertDraftRequest {
  packet_id?: string; // If provided, update existing
  subject_type: 'lead' | 'job' | 'contact' | 'pipeline_entry' | 'project';
  subject_id: string;
  title: string;
  message_to_client?: string;
  expires_at?: string;
  section_manifest: SectionConfig[];
  template_id?: string;
}

serve(async (req) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ success: false, error: { code: 'UNAUTHORIZED', message: 'Missing authorization header' } }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get user from auth header
    const anonClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } }
    });
    
    const { data: { user }, error: authError } = await anonClient.auth.getUser();
    if (authError || !user) {
      return new Response(
        JSON.stringify({ success: false, error: { code: 'UNAUTHORIZED', message: 'Invalid user' } }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get user's active tenant
    const { data: tenantData, error: tenantError } = await anonClient.rpc('get_user_active_tenant_id');
    if (tenantError || !tenantData) {
      return new Response(
        JSON.stringify({ success: false, error: { code: 'NO_TENANT', message: 'No active tenant found' } }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    const tenantId = tenantData;

    // Parse request body
    const body: UpsertDraftRequest = await req.json();
    const { packet_id, subject_type, subject_id, title, message_to_client, expires_at, section_manifest, template_id } = body;

    // Validate required fields
    if (!subject_type || !subject_id || !title) {
      return new Response(
        JSON.stringify({ success: false, error: { code: 'VALIDATION_ERROR', message: 'subject_type, subject_id, and title are required' } }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Capture branding snapshot
    const { data: brandingSnapshot, error: brandingError } = await supabase.rpc('capture_branding_snapshot', {
      p_tenant_id: tenantId
    });

    if (brandingError) {
      console.error('Error capturing branding snapshot:', brandingError);
      return new Response(
        JSON.stringify({ success: false, error: { code: 'BRANDING_ERROR', message: 'Failed to capture branding snapshot' } }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let resultPacketId: string;
    let isNew = false;

    if (packet_id) {
      // Update existing packet
      const { data: existingPacket, error: fetchError } = await supabase
        .from('report_packets')
        .select('id, tenant_id, status')
        .eq('id', packet_id)
        .eq('tenant_id', tenantId)
        .single();

      if (fetchError || !existingPacket) {
        return new Response(
          JSON.stringify({ success: false, error: { code: 'NOT_FOUND', message: 'Packet not found' } }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Don't allow editing signed/void packets
      if (['signed', 'void'].includes(existingPacket.status)) {
        return new Response(
          JSON.stringify({ success: false, error: { code: 'INVALID_STATUS', message: 'Cannot edit signed or voided packets' } }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const { error: updateError } = await supabase
        .from('report_packets')
        .update({
          title,
          message_to_client,
          expires_at,
          section_manifest,
          template_id,
          status: 'draft', // Reset to draft on edit
          updated_at: new Date().toISOString()
        })
        .eq('id', packet_id);

      if (updateError) {
        console.error('Error updating packet:', updateError);
        return new Response(
          JSON.stringify({ success: false, error: { code: 'UPDATE_ERROR', message: 'Failed to update packet' } }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      resultPacketId = packet_id;
    } else {
      // Create new packet
      const { data: newPacket, error: insertError } = await supabase
        .from('report_packets')
        .insert({
          tenant_id: tenantId,
          subject_type,
          subject_id,
          title,
          message_to_client,
          expires_at,
          branding_snapshot: brandingSnapshot,
          section_manifest: section_manifest || [],
          template_id,
          created_by: user.id,
          status: 'draft'
        })
        .select('id')
        .single();

      if (insertError || !newPacket) {
        console.error('Error creating packet:', insertError);
        return new Response(
          JSON.stringify({ success: false, error: { code: 'INSERT_ERROR', message: 'Failed to create packet' } }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      resultPacketId = newPacket.id;
      isNew = true;
    }

    // Log event
    await supabase.from('report_packet_events').insert({
      tenant_id: tenantId,
      packet_id: resultPacketId,
      event_type: isNew ? 'packet_regenerated' : 'packet_regenerated',
      actor_type: 'internal_user',
      actor_user_id: user.id,
      meta: {
        action: isNew ? 'created' : 'updated',
        section_count: section_manifest?.length || 0
      }
    });

    // Fetch the full packet to return
    const { data: packet, error: fetchError } = await supabase
      .from('report_packets')
      .select('*')
      .eq('id', resultPacketId)
      .single();

    return new Response(
      JSON.stringify({
        success: true,
        data: {
          packet_id: resultPacketId,
          packet,
          is_new: isNew
        }
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Unexpected error:', error);
    return new Response(
      JSON.stringify({ success: false, error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
