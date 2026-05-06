/**
 * PITCH PDF Engine — Core Types
 * Instruction-based PDF editing architecture.
 * Source PDF is IMMUTABLE. All edits are operations.
 * Final output is recompiled from original + operation graph.
 */

// ── Object Graph ──

export interface PdfPageMeta {
  id: string;
  workspace_document_id: string;
  tenant_id: string;
  page_number: number;
  width: number;
  height: number;
  rotation: number;
  text_layer: PdfTextItem[];
  thumbnail_path: string | null;
}

export interface PdfTextItem {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontName?: string;
  fontSize?: number;
  transform?: number[];
}

export interface PdfObject {
  id: string;
  page_id: string;
  workspace_document_id: string;
  tenant_id: string;
  object_type: PdfObjectType;
  x: number;
  y: number;
  width: number | null;
  height: number | null;
  rotation: number;
  content: string | null;
  font_family: string | null;
  font_size: number | null;
  font_weight: string | null;
  font_color: string | null;
  opacity: number;
  z_index: number;
  metadata: Record<string, unknown>;
  is_deleted: boolean;
}

export type PdfObjectType = 'text' | 'image' | 'vector' | 'annotation' | 'form_field' | 'signature';

// ── Operations ──

export type PdfOperationType =
  | 'insert_text' | 'replace_text' | 'delete_text'
  | 'move_object' | 'resize_object' | 'rotate_object'
  | 'insert_image' | 'delete_object'
  | 'add_annotation' | 'delete_annotation'
  | 'add_redaction' | 'apply_redaction'
  | 'rotate_page' | 'delete_page' | 'insert_page' | 'reorder_pages'
  | 'smart_tag_replace' | 'ai_rewrite'
  | 'add_signature' | 'add_form_field'
  | 'batch';

export interface PdfOperation {
  id: string;
  workspace_document_id: string;
  tenant_id: string;
  sequence_number: number;
  operation_type: PdfOperationType;
  target_object_id: string | null;
  target_page_id: string | null;
  data: Record<string, unknown>;
  is_undone: boolean;
  actor_id: string;
  created_at: string;
}

// ── Operation Data Payloads ──

export interface ReplaceTextData {
  original_text: string;
  new_text: string;
  font_family?: string;
  font_size?: number;
}

export interface MoveObjectData {
  from_x: number;
  from_y: number;
  to_x: number;
  to_y: number;
}

export interface ResizeObjectData {
  from_width: number;
  from_height: number;
  to_width: number;
  to_height: number;
}

export interface InsertTextData {
  text: string;
  x: number;
  y: number;
  font_family: string;
  font_size: number;
  font_color?: string;
  page_number: number;
}

export interface SmartTagReplaceData {
  tag_key: string;
  tag_value: string;
  original_text: string;
}

export interface RedactionData {
  x: number;
  y: number;
  width: number;
  height: number;
  reason?: string;
}

// ── Compiler ──

export interface CompileRequest {
  workspace_document_id: string;
  tenant_id: string;
  include_annotations: boolean;
  flatten: boolean;
}

export interface CompileResult {
  pdf_blob: Blob;
  page_count: number;
  operations_applied: number;
}
