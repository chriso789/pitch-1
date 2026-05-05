import { supabase } from '@/integrations/supabase/client';

/**
 * Create a PDF Workspace entry from an existing document record.
 */
export async function createWorkspaceFromDocument({
  documentId,
  tenantId,
  userId,
}: {
  documentId: string;
  tenantId: string;
  userId: string;
}) {
  // 1. Load existing document
  const { data: doc, error: docErr } = await (supabase as any)
    .from('documents')
    .select('*')
    .eq('id', documentId)
    .single();

  if (docErr || !doc) throw new Error('Document not found');
  if (doc.mime_type !== 'application/pdf') throw new Error('Only PDF documents can be opened in the workspace');

  const wsDocId = crypto.randomUUID();

  // 2. Create workspace document
  const { data: wsDoc, error: wsErr } = await (supabase as any)
    .from('pdf_workspace_documents')
    .insert({
      id: wsDocId,
      tenant_id: tenantId,
      document_id: documentId,
      pipeline_entry_id: doc.pipeline_entry_id || null,
      title: doc.filename?.replace(/\.pdf$/i, '') || 'Untitled',
      original_filename: doc.filename || 'document.pdf',
      source_type: 'document',
      original_bucket: doc.file_path?.includes('smartdoc') ? 'smartdoc-assets' : 'documents',
      original_path: doc.file_path,
      current_bucket: doc.file_path?.includes('smartdoc') ? 'smartdoc-assets' : 'documents',
      current_path: doc.file_path,
      mime_type: 'application/pdf',
      file_size: doc.file_size || null,
      status: 'draft',
      created_by: userId,
    })
    .select()
    .single();

  if (wsErr) throw new Error(`Failed to create workspace doc: ${wsErr.message}`);

  // 3. Create version 1
  await (supabase as any)
    .from('pdf_workspace_versions')
    .insert({
      workspace_document_id: wsDocId,
      tenant_id: tenantId,
      version_number: 1,
      bucket: wsDoc.original_bucket,
      file_path: doc.file_path,
      change_summary: 'Opened from documents',
      file_size: doc.file_size || null,
      created_by: userId,
    });

  // 4. Audit
  await (supabase as any)
    .from('pdf_workspace_audit_events')
    .insert({
      workspace_document_id: wsDocId,
      tenant_id: tenantId,
      actor_id: userId,
      event_type: 'opened',
      event_data: { source_document_id: documentId },
    });

  return wsDoc;
}
