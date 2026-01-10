// ============================================
// UPLOAD COMPANY LOGO EDGE FUNCTION
// Bypasses Storage RLS by using service role
// with explicit tenant membership verification
// ============================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { supabaseAnon, supabaseService, getAuthUser, verifyTenantMembership } from '../_shared/supabase.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface UploadRequest {
  tenantId: string;
  fileBase64: string;
  contentType: string;
  fileExt: string;
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // 1. Authenticate user
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      console.error('[upload-company-logo] No authorization header');
      return new Response(
        JSON.stringify({ error: 'Authentication required' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = supabaseAnon(authHeader);
    const user = await getAuthUser(supabase);

    if (!user) {
      console.error('[upload-company-logo] User not authenticated');
      return new Response(
        JSON.stringify({ error: 'User not authenticated' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('[upload-company-logo] Authenticated user:', user.id);

    // 2. Parse request body
    const body: UploadRequest = await req.json();
    const { tenantId, fileBase64, contentType, fileExt } = body;

    if (!tenantId || !fileBase64 || !contentType || !fileExt) {
      console.error('[upload-company-logo] Missing required fields:', { 
        hasTenantId: !!tenantId, 
        hasFileBase64: !!fileBase64, 
        hasContentType: !!contentType, 
        hasFileExt: !!fileExt 
      });
      return new Response(
        JSON.stringify({ error: 'Missing required fields: tenantId, fileBase64, contentType, fileExt' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate content type
    const allowedTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/svg+xml', 'image/webp'];
    if (!allowedTypes.includes(contentType)) {
      console.error('[upload-company-logo] Invalid content type:', contentType);
      return new Response(
        JSON.stringify({ error: 'Invalid file type. Allowed: PNG, JPG, SVG, WebP' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate file extension
    const allowedExts = ['png', 'jpg', 'jpeg', 'svg', 'webp'];
    if (!allowedExts.includes(fileExt.toLowerCase())) {
      console.error('[upload-company-logo] Invalid file extension:', fileExt);
      return new Response(
        JSON.stringify({ error: 'Invalid file extension' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('[upload-company-logo] Uploading for tenant:', tenantId, 'user:', user.id);

    // 3. Verify tenant membership
    const hasAccess = await verifyTenantMembership(user.id, tenantId);
    if (!hasAccess) {
      console.error('[upload-company-logo] User does not have access to tenant:', tenantId);
      return new Response(
        JSON.stringify({ error: 'Access denied. You do not have permission to upload to this company.' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('[upload-company-logo] Tenant access verified');

    // 4. Decode base64 and upload using service role
    const binaryString = atob(fileBase64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    const admin = supabaseService();
    const fileName = `${tenantId}/${crypto.randomUUID()}.${fileExt}`;

    console.log('[upload-company-logo] Uploading file:', fileName, 'size:', bytes.length);

    const { data: uploadData, error: uploadError } = await admin.storage
      .from('company-logos')
      .upload(fileName, bytes, {
        contentType,
        cacheControl: '3600',
        upsert: true,
      });

    if (uploadError) {
      console.error('[upload-company-logo] Storage upload error:', uploadError);
      return new Response(
        JSON.stringify({ error: `Upload failed: ${uploadError.message}` }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('[upload-company-logo] Upload successful:', uploadData.path);

    // 5. Get public URL
    const { data: urlData } = admin.storage
      .from('company-logos')
      .getPublicUrl(fileName);

    console.log('[upload-company-logo] Public URL:', urlData.publicUrl);

    return new Response(
      JSON.stringify({
        success: true,
        publicUrl: urlData.publicUrl,
        storagePath: fileName,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[upload-company-logo] Unexpected error:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
