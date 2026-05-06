/**
 * PITCH Internal PDF Engine — Core Types
 * Standalone from the legacy workspace types.
 */

export interface PdfDocument {
  id: string;
  tenant_id: string;
  source_document_id: string | null;
  title: string;
  original_file_path: string;
  current_version_id: string | null;
  page_count: number;
  status: 'draft' | 'parsed' | 'editing' | 'compiled' | 'finalized';
  metadata: Record<string, unknown>;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface PdfEnginePage {
  id: string;
  pdf_document_id: string;
  page_number: number;
  width: number;
  height: number;
  rotation: number;
  thumbnail_path: string | null;
  render_path: string | null;
  extracted_text: string | null;
  metadata: Record<string, unknown>;
}

export interface PdfEngineObject {
  id: string;
  pdf_document_id: string;
  page_id: string;
  object_type: 'text' | 'image' | 'vector' | 'annotation' | 'form_field' | 'signature' | 'redaction';
  object_key: string;
  bounds: { x: number; y: number; width: number; height: number };
  transform: Record<string, unknown>;
  content: Record<string, unknown>;
  font_info: { fontFamily?: string; fontSize?: number; fontWeight?: string; color?: string };
  z_index: number;
  is_editable: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export type PdfEngineOperationType =
  | 'replace_text' | 'add_text' | 'move_object' | 'delete_object'
  | 'rotate_page' | 'reorder_page' | 'insert_page' | 'delete_page'
  | 'add_annotation' | 'remove_annotation'
  | 'add_redaction' | 'apply_redaction'
  | 'add_signature' | 'update_form_field'
  | 'ai_rewrite' | 'ocr_extract' | 'fill_form_field';

export interface PdfEngineOperation {
  id: string;
  pdf_document_id: string;
  page_id: string | null;
  operation_type: PdfEngineOperationType;
  target_object_id: string | null;
  operation_payload: Record<string, unknown>;
  is_undone: boolean;
  created_by: string | null;
  created_at: string;
}

export interface PdfEngineVersion {
  id: string;
  pdf_document_id: string;
  version_number: number;
  compiled_file_path: string | null;
  operation_count: number;
  snapshot: Record<string, unknown>;
  created_by: string | null;
  created_at: string;
}

export interface PdfEngineAnnotation {
  id: string;
  pdf_document_id: string;
  page_id: string | null;
  annotation_type: string | null;
  annotation_data: Record<string, unknown>;
  created_by: string | null;
  created_at: string;
}
