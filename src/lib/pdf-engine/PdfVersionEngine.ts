/**
 * PITCH PDF Version Engine
 * Every compile creates an immutable version.
 */

import { supabase } from '@/integrations/supabase/client';
import type { PdfEngineVersion } from './engineTypes';

export class PdfVersionEngine {
  private documentId: string;
  private tenantId: string;

  constructor(documentId: string, tenantId: string) {
    this.documentId = documentId;
    this.tenantId = tenantId;
  }

  async createVersion(
    compiledBlob: Blob,
    operationCount: number,
    userId: string,
    snapshot?: Record<string, unknown>
  ): Promise<PdfEngineVersion> {
    // Get next version number
    const { data: existing } = await (supabase as any)
      .from('pdf_engine_versions')
      .select('version_number')
      .eq('pdf_document_id', this.documentId)
      .order('version_number', { ascending: false })
      .limit(1);

    const nextVersion = (existing?.[0]?.version_number ?? 0) + 1;

    // Upload compiled PDF
    const filePath = `${this.tenantId}/${this.documentId}/v${nextVersion}.pdf`;
    const { error: uploadErr } = await supabase.storage
      .from('pdf-compiled')
      .upload(filePath, compiledBlob, { contentType: 'application/pdf', upsert: true });
    if (uploadErr) throw uploadErr;

    // Create version record
    const { data, error } = await (supabase as any)
      .from('pdf_engine_versions')
      .insert({
        pdf_document_id: this.documentId,
        version_number: nextVersion,
        compiled_file_path: filePath,
        operation_count: operationCount,
        snapshot: snapshot || {},
        created_by: userId,
      })
      .select()
      .single();
    if (error) throw error;

    // Update current_version_id on document
    await (supabase as any)
      .from('pdf_documents')
      .update({ current_version_id: data.id, status: 'compiled' })
      .eq('id', this.documentId);

    return data;
  }

  async listVersions(): Promise<PdfEngineVersion[]> {
    const { data, error } = await (supabase as any)
      .from('pdf_engine_versions')
      .select('*')
      .eq('pdf_document_id', this.documentId)
      .order('version_number', { ascending: false });
    if (error) throw error;
    return data || [];
  }

  async getVersionUrl(version: PdfEngineVersion): Promise<string | null> {
    if (!version.compiled_file_path) return null;
    const { data } = await supabase.storage
      .from('pdf-compiled')
      .createSignedUrl(version.compiled_file_path, 3600);
    return data?.signedUrl || null;
  }
}
