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
    const formData = await req.formData();
    const sessionToken = formData.get('session_token') as string;
    const contactId = formData.get('contact_id') as string;
    const documentType = formData.get('document_type') as string || 'canvass_report';
    const description = formData.get('description') as string || '';
    
    // Validate session using secure database lookup
    const session = await validateSession(sessionToken);
    if (!session) {
      return new Response(
        JSON.stringify({ error: 'Invalid or expired session' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { userId: repId, tenantId } = session;

    // Verify contact exists and belongs to rep's tenant
    const { data: contact, error: contactError } = await supabase
      .from('contacts')
      .select('id, tenant_id')
      .eq('id', contactId)
      .eq('tenant_id', tenantId)
      .single();

    if (contactError || !contact) {
      return new Response(
        JSON.stringify({ error: 'Contact not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const uploadedFiles = [];
    
    // Process all uploaded files
    for (const [key, value] of formData.entries()) {
      if (key.startsWith('file_') && value instanceof File) {
        const file = value as File;
        const fileExt = file.name.split('.').pop();
        const fileName = `canvass_${contactId}_${Date.now()}.${fileExt}`;
        const filePath = `canvass-documents/${tenantId}/${fileName}`;

        // Upload to Supabase Storage
        const { data: uploadData, error: uploadError } = await supabase.storage
          .from('documents')
          .upload(filePath, file, {
            contentType: file.type,
            upsert: false
          });

        if (uploadError) {
          console.error('Upload error:', uploadError);
          continue;
        }

        // Create document record
        const documentData = {
          tenant_id: tenantId,
          contact_id: contactId,
          filename: file.name,
          file_path: filePath,
          mime_type: file.type,
          file_size: file.size,
          document_type: documentType,
          description: description || `Canvass document: ${file.name}`,
          uploaded_by: repId,
          is_visible_to_homeowner: false
        };

        const { data: document, error: docError } = await supabase
          .from('documents')
          .insert(documentData)
          .select()
          .single();

        if (docError) {
          console.error('Document record error:', docError);
          continue;
        }

        uploadedFiles.push({
          document_id: document.id,
          filename: file.name,
          file_path: filePath,
          success: true
        });
      }
    }

    // Update contact metadata with canvassing activity
    const { data: currentContact } = await supabase
      .from('contacts')
      .select('metadata')
      .eq('id', contactId)
      .single();

    const updatedMetadata = {
      ...(currentContact?.metadata || {}),
      canvassing_activity: {
        ...((currentContact?.metadata as any)?.canvassing_activity || {}),
        last_document_upload: new Date().toISOString(),
        total_documents: ((currentContact?.metadata as any)?.canvassing_activity?.total_documents || 0) + uploadedFiles.length,
        documents_uploaded_by: repId
      }
    };

    await supabase
      .from('contacts')
      .update({ metadata: updatedMetadata })
      .eq('id', contactId);

    return new Response(
      JSON.stringify({
        success: true,
        uploaded_files: uploadedFiles.length,
        files: uploadedFiles
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Document sync error:', error);
    return new Response(
      JSON.stringify({ error: 'Document synchronization failed' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
