import { supabase } from '@/integrations/supabase/client';

interface SaveVersionOptions {
  workspaceDocumentId: string;
  tenantId: string;
  userId: string;
  fileBlob: Blob;
  annotationState?: Record<string, any>;
  xfdf?: string;
  flattened?: boolean;
  changeSummary?: string;
}

export async function savePdfWorkspaceVersion({
  workspaceDocumentId,
  tenantId,
  userId,
  fileBlob,
  annotationState,
  xfdf,
  flattened = false,
  changeSummary,
}: SaveVersionOptions) {
  // 1. Get next version number
  const { data: versions } = await (supabase as any)
    .from('pdf_workspace_versions')
    .select('version_number')
    .eq('workspace_document_id', workspaceDocumentId)
    .order('version_number', { ascending: false })
    .limit(1);

  const nextVersion = (versions?.[0]?.version_number || 0) + 1;
  const bucket = flattened ? 'pdf-finalized' : 'pdf-working';
  const timestamp = Date.now();
  const filePath = `${tenantId}/pdf-workspace/${workspaceDocumentId}/${flattened ? 'final' : 'working'}/${timestamp}_v${nextVersion}.pdf`;

  // 2. Upload
  const { error: uploadError } = await supabase.storage
    .from(bucket)
    .upload(filePath, fileBlob, { contentType: 'application/pdf', upsert: true });

  if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`);

  // 3. Insert version
  const { data: ver, error: verErr } = await (supabase as any)
    .from('pdf_workspace_versions')
    .insert({
      workspace_document_id: workspaceDocumentId,
      tenant_id: tenantId,
      version_number: nextVersion,
      bucket,
      file_path: filePath,
      change_summary: changeSummary || (flattened ? 'Finalized' : `Draft v${nextVersion}`),
      annotation_state: annotationState || {},
      xfdf: xfdf || null,
      flattened,
      file_size: fileBlob.size,
      created_by: userId,
    })
    .select()
    .single();

  if (verErr) throw new Error(`Version insert failed: ${verErr.message}`);

  // 4. Update workspace document
  const updateFields: Record<string, any> = {
    updated_by: userId,
    status: flattened ? 'finalized' : 'editing',
  };

  if (flattened) {
    updateFields.finalized_bucket = bucket;
    updateFields.finalized_path = filePath;
  } else {
    updateFields.current_bucket = bucket;
    updateFields.current_path = filePath;
  }

  await (supabase as any)
    .from('pdf_workspace_documents')
    .update(updateFields)
    .eq('id', workspaceDocumentId);

  // 5. Audit
  await (supabase as any)
    .from('pdf_workspace_audit_events')
    .insert({
      workspace_document_id: workspaceDocumentId,
      tenant_id: tenantId,
      actor_id: userId,
      event_type: flattened ? 'finalized' : 'annotation_saved',
      event_data: { version_number: nextVersion, flattened },
    });

  return ver;
}
