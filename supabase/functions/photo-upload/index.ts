import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface PhotoUploadRequest {
  action: 'upload' | 'update' | 'delete' | 'reorder' | 'set_primary' | 'toggle_estimate';
  tenant_id: string;
  entity_type?: 'contact' | 'lead' | 'project';
  entity_id?: string;
  contact_id?: string;
  lead_id?: string;
  project_id?: string;
  photo_id?: string;
  photo_ids?: string[];
  category?: string;
  description?: string;
  display_order?: number;
  include_in_estimate?: boolean;
  // Base64 encoded image data for upload
  file_data?: string;
  file_name?: string;
  mime_type?: string;
  // GPS metadata
  gps_latitude?: number;
  gps_longitude?: number;
  taken_at?: string;
}

const PHOTO_CATEGORIES = [
  'before', 'during', 'after', 'damage', 'materials', 
  'roof', 'siding', 'gutters', 'interior', 'safety', 
  'inspection', 'general', 'other'
];

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Get auth header
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ success: false, error: 'Authorization required' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false } }
    );

    // Create user client to get auth context
    const supabaseUser = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { 
        auth: { persistSession: false },
        global: { headers: { Authorization: authHeader } }
      }
    );

    // Get authenticated user
    const { data: { user }, error: authError } = await supabaseUser.auth.getUser();
    if (authError || !user) {
      console.error('[photo-upload] Auth error:', authError);
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid or expired token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get user's tenant
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('tenant_id, active_tenant_id')
      .eq('id', user.id)
      .single();

    if (profileError || !profile) {
      console.error('[photo-upload] Profile error:', profileError);
      return new Response(
        JSON.stringify({ success: false, error: 'User profile not found' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const userTenantId = profile.active_tenant_id || profile.tenant_id;

    const body: PhotoUploadRequest = await req.json();
    const { action, tenant_id } = body;

    // Validate tenant access
    if (tenant_id && tenant_id !== userTenantId) {
      console.warn(`[photo-upload] Tenant mismatch: user=${userTenantId}, request=${tenant_id}`);
      return new Response(
        JSON.stringify({ success: false, error: 'Tenant access denied' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const effectiveTenantId = tenant_id || userTenantId;

    switch (action) {
      case 'upload': {
        const { 
          entity_type, entity_id, contact_id, lead_id, project_id,
          file_data, file_name, mime_type, category = 'general',
          description, gps_latitude, gps_longitude, taken_at
        } = body;

        if (!file_data || !file_name) {
          return new Response(
            JSON.stringify({ success: false, error: 'file_data and file_name required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Determine entity IDs
        let finalContactId = contact_id;
        let finalLeadId = lead_id;
        let finalProjectId = project_id;

        if (entity_type && entity_id) {
          if (entity_type === 'contact') finalContactId = entity_id;
          else if (entity_type === 'lead') finalLeadId = entity_id;
          else if (entity_type === 'project') finalProjectId = entity_id;
        }

        if (!finalContactId && !finalLeadId && !finalProjectId) {
          return new Response(
            JSON.stringify({ success: false, error: 'At least one of contact_id, lead_id, or project_id required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Auto-detect category from filename
        let detectedCategory = category;
        const lowerName = file_name.toLowerCase();
        if (lowerName.includes('before') || lowerName.includes('initial')) detectedCategory = 'before';
        else if (lowerName.includes('after') || lowerName.includes('final')) detectedCategory = 'after';
        else if (lowerName.includes('damage') || lowerName.includes('broken')) detectedCategory = 'damage';
        else if (lowerName.includes('material')) detectedCategory = 'materials';
        else if (!PHOTO_CATEGORIES.includes(category)) detectedCategory = 'general';

        // Decode base64 file data
        const base64Data = file_data.includes(',') ? file_data.split(',')[1] : file_data;
        const binaryData = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));

        // Generate unique file path: {tenant_id}/{entity_type}/{entity_id}/{timestamp}_{random}.{ext}
        const ext = file_name.split('.').pop() || 'jpg';
        const timestamp = Date.now();
        const random = Math.random().toString(36).substring(2, 8);
        const entityFolder = finalLeadId || finalContactId || finalProjectId;
        const storagePath = `${effectiveTenantId}/${detectedCategory}/${entityFolder}/${timestamp}_${random}.${ext}`;

        // Upload to storage
        const { data: uploadData, error: uploadError } = await supabaseAdmin.storage
          .from('customer-photos')
          .upload(storagePath, binaryData, {
            contentType: mime_type || 'image/jpeg',
            cacheControl: '3600',
            upsert: false
          });

        if (uploadError) {
          console.error('[photo-upload] Storage upload error:', uploadError);
          return new Response(
            JSON.stringify({ success: false, error: 'Failed to upload file to storage' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Get public URL
        const { data: { publicUrl } } = supabaseAdmin.storage
          .from('customer-photos')
          .getPublicUrl(storagePath);

        // Get max display order for this entity
        const orderQuery = supabaseAdmin
          .from('customer_photos')
          .select('display_order')
          .eq('tenant_id', effectiveTenantId);
        
        if (finalLeadId) orderQuery.eq('lead_id', finalLeadId);
        else if (finalContactId) orderQuery.eq('contact_id', finalContactId);
        
        const { data: existingPhotos } = await orderQuery.order('display_order', { ascending: false }).limit(1);
        const nextOrder = existingPhotos?.length ? (existingPhotos[0].display_order || 0) + 1 : 0;

        // Insert into customer_photos table
        const { data: photo, error: dbError } = await supabaseAdmin
          .from('customer_photos')
          .insert({
            tenant_id: effectiveTenantId,
            contact_id: finalContactId || null,
            lead_id: finalLeadId || null,
            project_id: finalProjectId || null,
            file_url: publicUrl,
            file_path: storagePath,
            original_filename: file_name,
            file_size: binaryData.length,
            mime_type: mime_type || 'image/jpeg',
            category: detectedCategory,
            description: description || null,
            display_order: nextOrder,
            uploaded_by: user.id,
            gps_latitude: gps_latitude || null,
            gps_longitude: gps_longitude || null,
            taken_at: taken_at || null,
            include_in_estimate: false,
            is_primary: existingPhotos?.length === 0 // First photo is primary
          })
          .select()
          .single();

        if (dbError) {
          console.error('[photo-upload] Database insert error:', dbError);
          // Try to clean up storage
          await supabaseAdmin.storage.from('customer-photos').remove([storagePath]);
          return new Response(
            JSON.stringify({ success: false, error: 'Failed to save photo record' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        console.log(`[photo-upload] Photo uploaded successfully: ${photo.id} for tenant ${effectiveTenantId}`);
        return new Response(
          JSON.stringify({ success: true, data: photo }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'update': {
        const { photo_id, category, description, include_in_estimate } = body;

        if (!photo_id) {
          return new Response(
            JSON.stringify({ success: false, error: 'photo_id required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
        if (category !== undefined) updates.category = category;
        if (description !== undefined) updates.description = description;
        if (include_in_estimate !== undefined) updates.include_in_estimate = include_in_estimate;

        const { data: photo, error: updateError } = await supabaseAdmin
          .from('customer_photos')
          .update(updates)
          .eq('id', photo_id)
          .eq('tenant_id', effectiveTenantId)
          .select()
          .single();

        if (updateError) {
          console.error('[photo-upload] Update error:', updateError);
          return new Response(
            JSON.stringify({ success: false, error: 'Failed to update photo' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        console.log(`[photo-upload] Photo updated: ${photo_id}`);
        return new Response(
          JSON.stringify({ success: true, data: photo }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'delete': {
        const { photo_id, photo_ids } = body;
        const idsToDelete = photo_ids || (photo_id ? [photo_id] : []);

        if (idsToDelete.length === 0) {
          return new Response(
            JSON.stringify({ success: false, error: 'photo_id or photo_ids required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Get file paths first
        const { data: photos } = await supabaseAdmin
          .from('customer_photos')
          .select('id, file_path')
          .in('id', idsToDelete)
          .eq('tenant_id', effectiveTenantId);

        if (!photos?.length) {
          return new Response(
            JSON.stringify({ success: false, error: 'Photos not found' }),
            { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Delete from storage
        const paths = photos.map(p => p.file_path).filter(Boolean);
        if (paths.length > 0) {
          await supabaseAdmin.storage.from('customer-photos').remove(paths);
        }

        // Delete from database
        const { error: deleteError } = await supabaseAdmin
          .from('customer_photos')
          .delete()
          .in('id', idsToDelete)
          .eq('tenant_id', effectiveTenantId);

        if (deleteError) {
          console.error('[photo-upload] Delete error:', deleteError);
          return new Response(
            JSON.stringify({ success: false, error: 'Failed to delete photos' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        console.log(`[photo-upload] Deleted ${idsToDelete.length} photos`);
        return new Response(
          JSON.stringify({ success: true, data: { deleted: idsToDelete.length } }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'reorder': {
        const { photo_ids } = body;

        if (!photo_ids?.length) {
          return new Response(
            JSON.stringify({ success: false, error: 'photo_ids array required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Update display_order for each photo
        const updates = photo_ids.map((id: string, index: number) => 
          supabaseAdmin
            .from('customer_photos')
            .update({ display_order: index })
            .eq('id', id)
            .eq('tenant_id', effectiveTenantId)
        );

        await Promise.all(updates);

        console.log(`[photo-upload] Reordered ${photo_ids.length} photos`);
        return new Response(
          JSON.stringify({ success: true, data: { reordered: photo_ids.length } }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'set_primary': {
        const { photo_id, lead_id, contact_id } = body;

        if (!photo_id) {
          return new Response(
            JSON.stringify({ success: false, error: 'photo_id required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Unset current primary for this entity
        const unsetQuery = supabaseAdmin
          .from('customer_photos')
          .update({ is_primary: false })
          .eq('tenant_id', effectiveTenantId)
          .eq('is_primary', true);
        
        if (lead_id) unsetQuery.eq('lead_id', lead_id);
        else if (contact_id) unsetQuery.eq('contact_id', contact_id);

        await unsetQuery;

        // Set new primary
        const { data: photo, error: updateError } = await supabaseAdmin
          .from('customer_photos')
          .update({ is_primary: true })
          .eq('id', photo_id)
          .eq('tenant_id', effectiveTenantId)
          .select()
          .single();

        if (updateError) {
          console.error('[photo-upload] Set primary error:', updateError);
          return new Response(
            JSON.stringify({ success: false, error: 'Failed to set primary photo' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        console.log(`[photo-upload] Set primary photo: ${photo_id}`);
        return new Response(
          JSON.stringify({ success: true, data: photo }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'toggle_estimate': {
        const { photo_id, include_in_estimate } = body;

        if (!photo_id) {
          return new Response(
            JSON.stringify({ success: false, error: 'photo_id required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const { data: photo, error: updateError } = await supabaseAdmin
          .from('customer_photos')
          .update({ include_in_estimate: include_in_estimate ?? true })
          .eq('id', photo_id)
          .eq('tenant_id', effectiveTenantId)
          .select()
          .single();

        if (updateError) {
          console.error('[photo-upload] Toggle estimate error:', updateError);
          return new Response(
            JSON.stringify({ success: false, error: 'Failed to toggle estimate inclusion' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        console.log(`[photo-upload] Toggled estimate inclusion for photo: ${photo_id} = ${include_in_estimate}`);
        return new Response(
          JSON.stringify({ success: true, data: photo }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      default:
        return new Response(
          JSON.stringify({ success: false, error: 'Invalid action' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }

  } catch (error) {
    console.error('[photo-upload] Unexpected error:', error);
    return new Response(
      JSON.stringify({ success: false, error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
