/**
 * PITCH PDF Engine — Main Orchestrator
 * Ties together parsing, object store, operations, compilation, and versioning.
 */

import { supabase } from '@/integrations/supabase/client';
import { parsePdfToObjectGraph } from './PdfObjectParser';
import { persistParsedPages, loadDocumentObjects, loadDocumentPages } from './PdfObjectStore';
import { PdfOperationEngine } from './PdfOperationEngine';
import { compileFromOperations } from './PdfCompiler';
import { PdfVersionEngine } from './PdfVersionEngine';
import type { PdfDocument, PdfEnginePage, PdfEngineObject, PdfEngineOperation } from './engineTypes';

export class PdfEngine {
  private documentId: string;
  private tenantId: string;
  private userId: string;
  private opEngine: PdfOperationEngine;
  private versionEngine: PdfVersionEngine;

  constructor(documentId: string, tenantId: string, userId: string) {
    this.documentId = documentId;
    this.tenantId = tenantId;
    this.userId = userId;
    this.opEngine = new PdfOperationEngine(documentId, userId);
    this.versionEngine = new PdfVersionEngine(documentId, tenantId);
  }

  /**
   * Create a new PDF document record and upload the original file.
   */
  static async createDocument(
    file: File,
    title: string,
    tenantId: string,
    userId: string,
    sourceDocumentId?: string
  ): Promise<PdfDocument> {
    // Upload original
    const filePath = `${tenantId}/${crypto.randomUUID()}/${file.name}`;
    const { error: uploadErr } = await supabase.storage
      .from('pdf-originals')
      .upload(filePath, file, { contentType: 'application/pdf' });
    if (uploadErr) throw uploadErr;

    // Create record
    const { data, error } = await (supabase as any)
      .from('pdf_documents')
      .insert({
        tenant_id: tenantId,
        source_document_id: sourceDocumentId || null,
        title,
        original_file_path: filePath,
        status: 'draft',
        created_by: userId,
      })
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  /**
   * Parse the original PDF into pages + objects.
   */
  async parse(): Promise<{ pageCount: number; objectCount: number }> {
    // Load original from storage
    const doc = await this.getDocument();
    const { data: fileData, error } = await supabase.storage
      .from('pdf-originals')
      .download(doc.original_file_path);
    if (error || !fileData) throw error || new Error('Failed to download original');

    const arrayBuffer = await fileData.arrayBuffer();
    const pages = await parsePdfToObjectGraph(arrayBuffer);
    const result = await persistParsedPages(this.documentId, pages);
    return { pageCount: pages.length, objectCount: result.objectCount };
  }

  async getDocument(): Promise<PdfDocument> {
    const { data, error } = await (supabase as any)
      .from('pdf_documents')
      .select('*')
      .eq('id', this.documentId)
      .single();
    if (error) throw error;
    return data;
  }

  async getPages(): Promise<PdfEnginePage[]> {
    return loadDocumentPages(this.documentId);
  }

  async getObjects(): Promise<PdfEngineObject[]> {
    return loadDocumentObjects(this.documentId);
  }

  async getOperations(): Promise<PdfEngineOperation[]> {
    return this.opEngine.load();
  }

  get operations() { return this.opEngine; }
  get versions() { return this.versionEngine; }

  /**
   * Get a signed URL for the original PDF.
   */
  async getOriginalUrl(): Promise<string> {
    const doc = await this.getDocument();
    const { data } = await supabase.storage
      .from('pdf-originals')
      .createSignedUrl(doc.original_file_path, 3600);
    return data?.signedUrl || '';
  }

  /**
   * Compile and create a new version.
   */
  async compileAndVersion(): Promise<{ versionNumber: number; url: string | null }> {
    const doc = await this.getDocument();
    const { data: fileData } = await supabase.storage
      .from('pdf-originals')
      .download(doc.original_file_path);
    if (!fileData) throw new Error('Cannot download original');

    const arrayBuffer = await fileData.arrayBuffer();
    const ops = await this.opEngine.load();
    const objects = await this.getObjects();
    const activeOps = ops.filter(o => !o.is_undone);

    const compiled = await compileFromOperations(arrayBuffer, activeOps, objects);
    const blob = new Blob([compiled.buffer as ArrayBuffer], { type: 'application/pdf' });

    const version = await this.versionEngine.createVersion(
      blob,
      activeOps.length,
      this.userId
    );

    const url = await this.versionEngine.getVersionUrl(version);
    return { versionNumber: version.version_number, url };
  }
}
