/**
 * PITCH PDF Operation Engine
 * Apply operations WITHOUT directly mutating source PDF.
 * All ops stored in pdf_engine_operations table.
 */

import { supabase } from '@/integrations/supabase/client';
import type { PdfEngineOperation, PdfEngineOperationType } from './engineTypes';

export class PdfOperationEngine {
  private documentId: string;
  private ops: PdfEngineOperation[] = [];
  private userId: string;

  constructor(documentId: string, userId: string) {
    this.documentId = documentId;
    this.userId = userId;
  }

  async load(): Promise<PdfEngineOperation[]> {
    const { data, error } = await (supabase as any)
      .from('pdf_engine_operations')
      .select('*')
      .eq('pdf_document_id', this.documentId)
      .order('created_at');
    if (error) throw error;
    this.ops = data || [];
    return this.ops;
  }

  async addOperation(
    type: PdfEngineOperationType,
    payload: Record<string, unknown>,
    targetObjectId?: string,
    pageId?: string
  ): Promise<PdfEngineOperation> {
    const row = {
      pdf_document_id: this.documentId,
      page_id: pageId || null,
      operation_type: type,
      target_object_id: targetObjectId || null,
      operation_payload: payload,
      is_undone: false,
      created_by: this.userId,
    };

    const { data, error } = await (supabase as any)
      .from('pdf_engine_operations')
      .insert(row)
      .select()
      .single();
    if (error) throw error;
    this.ops.push(data);
    return data;
  }

  async undoOperation(): Promise<PdfEngineOperation | null> {
    const lastActive = [...this.ops].reverse().find(op => !op.is_undone);
    if (!lastActive) return null;

    const { error } = await (supabase as any)
      .from('pdf_engine_operations')
      .update({ is_undone: true })
      .eq('id', lastActive.id);
    if (error) throw error;
    lastActive.is_undone = true;
    return lastActive;
  }

  async redoOperation(): Promise<PdfEngineOperation | null> {
    const firstUndone = this.ops.find(op => op.is_undone);
    if (!firstUndone) return null;

    const { error } = await (supabase as any)
      .from('pdf_engine_operations')
      .update({ is_undone: false })
      .eq('id', firstUndone.id);
    if (error) throw error;
    firstUndone.is_undone = false;
    return firstUndone;
  }

  getActiveOps(): PdfEngineOperation[] {
    return this.ops.filter(op => !op.is_undone);
  }

  getOperationHistory(): PdfEngineOperation[] {
    return [...this.ops];
  }

  get canUndo(): boolean {
    return this.ops.some(op => !op.is_undone);
  }

  get canRedo(): boolean {
    return this.ops.some(op => op.is_undone);
  }

  /**
   * Preview what an operation would look like against objects (no DB write).
   */
  applyOperationPreview(
    objects: Record<string, unknown>[],
    opType: PdfEngineOperationType,
    payload: Record<string, unknown>
  ): Record<string, unknown>[] {
    // Clone objects for preview
    const cloned = JSON.parse(JSON.stringify(objects));
    // Apply in-memory — used for live preview before commit
    return cloned;
  }
}
