/**
 * PITCH PDF Operation Manager
 * Manages the instruction-based edit history.
 * Operations are append-only. Undo marks as is_undone, redo unmarks.
 * This is the undo/redo + audit trail engine.
 */

import { supabase } from '@/integrations/supabase/client';
import type { PdfOperation, PdfOperationType } from './types';

export class OperationManager {
  private documentId: string;
  private tenantId: string;
  private actorId: string;
  private nextSeq: number = 1;
  private localOps: PdfOperation[] = [];

  constructor(documentId: string, tenantId: string, actorId: string) {
    this.documentId = documentId;
    this.tenantId = tenantId;
    this.actorId = actorId;
  }

  /** Load existing operations from database */
  async load(): Promise<PdfOperation[]> {
    const { data, error } = await (supabase as any)
      .from('pdf_operations')
      .select('*')
      .eq('workspace_document_id', this.documentId)
      .eq('tenant_id', this.tenantId)
      .order('sequence_number', { ascending: true });

    if (error) throw error;
    this.localOps = data || [];
    this.nextSeq = this.localOps.length > 0
      ? Math.max(...this.localOps.map((o: PdfOperation) => o.sequence_number)) + 1
      : 1;
    return this.localOps;
  }

  /** Push a new operation */
  async push(
    type: PdfOperationType,
    data: Record<string, unknown>,
    targetObjectId?: string,
    targetPageId?: string
  ): Promise<PdfOperation> {
    const op: Partial<PdfOperation> = {
      workspace_document_id: this.documentId,
      tenant_id: this.tenantId,
      sequence_number: this.nextSeq,
      operation_type: type,
      target_object_id: targetObjectId || null,
      target_page_id: targetPageId || null,
      data,
      is_undone: false,
      actor_id: this.actorId,
    };

    const { data: inserted, error } = await (supabase as any)
      .from('pdf_operations')
      .insert(op)
      .select()
      .single();

    if (error) throw error;
    this.localOps.push(inserted);
    this.nextSeq++;
    return inserted;
  }

  /** Undo the last non-undone operation */
  async undo(): Promise<PdfOperation | null> {
    const lastActive = [...this.localOps]
      .reverse()
      .find(op => !op.is_undone);

    if (!lastActive) return null;

    const { error } = await (supabase as any)
      .from('pdf_operations')
      .update({ is_undone: true })
      .eq('id', lastActive.id);

    if (error) throw error;
    lastActive.is_undone = true;
    return lastActive;
  }

  /** Redo the most recent undone operation */
  async redo(): Promise<PdfOperation | null> {
    const firstUndone = this.localOps.find(op => op.is_undone);
    if (!firstUndone) return null;

    const { error } = await (supabase as any)
      .from('pdf_operations')
      .update({ is_undone: false })
      .eq('id', firstUndone.id);

    if (error) throw error;
    firstUndone.is_undone = false;
    return firstUndone;
  }

  /** Get active (non-undone) operations in order */
  getActiveOps(): PdfOperation[] {
    return this.localOps.filter(op => !op.is_undone);
  }

  /** Check undo/redo availability */
  get canUndo(): boolean {
    return this.localOps.some(op => !op.is_undone);
  }

  get canRedo(): boolean {
    return this.localOps.some(op => op.is_undone);
  }

  get allOps(): PdfOperation[] {
    return [...this.localOps];
  }
}
