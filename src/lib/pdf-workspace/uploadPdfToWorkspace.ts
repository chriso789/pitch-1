import { supabase } from '@/integrations/supabase/client';

interface UploadPdfOptions {
  file: File;
  tenantId: string;
  userId: string;
  title?: string;
  pipelineEntryId?: string;
  contactId?: string;
  estimateId?: string;
}

export async function uploadPdfToWorkspace({
  file,
  tenantId,
  userId,
  title,
  pipelineEntryId,
  contactId,
  estimateId,
}: UploadPdfOptions) {
  const docId = crypto.randomUUID();
  const storagePath = `${tenantId}/pdf-workspace/${docId}/original/${file.name}`;

  // 1. Upload file to pdf-originals bucket
  const { error: uploadError } = await supabase.storage
    .from('pdf-originals')
    .upload(storagePath, file, { contentType: 'application/pdf', upsert: false });

  if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`);

  // 2. Create workspace document record
  const { data: doc, error: docError } = await (supabase as any)
    .from('pdf_workspace_documents')
    .insert({
      id: docId,
      tenant_id: tenantId,
      title: title || file.name.replace(/\.pdf$/i, ''),
      original_filename: file.name,
      source_type: 'uploaded',
      original_bucket: 'pdf-originals',
      original_path: storagePath,
      current_bucket: 'pdf-originals',
      current_path: storagePath,
      mime_type: 'application/pdf',
      file_size: file.size,
      status: 'draft',
      created_by: userId,
      pipeline_entry_id: pipelineEntryId || null,
      contact_id: contactId || null,
      estimate_id: estimateId || null,
    })
    .select()
    .single();

  if (docError) throw new Error(`Doc record failed: ${docError.message}`);

  // 3. Create version 1
  await (supabase as any)
    .from('pdf_workspace_versions')
    .insert({
      workspace_document_id: docId,
      tenant_id: tenantId,
      version_number: 1,
      bucket: 'pdf-originals',
      file_path: storagePath,
      change_summary: 'Original upload',
      file_size: file.size,
      created_by: userId,
    });

  // 4. Create audit event
  await (supabase as any)
    .from('pdf_workspace_audit_events')
    .insert({
      workspace_document_id: docId,
      tenant_id: tenantId,
      actor_id: userId,
      event_type: 'uploaded',
      event_data: { filename: file.name, size: file.size },
    });

  return doc;
}
