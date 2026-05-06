/**
 * PITCH PDF Form Engine
 * Detect, define, and fill form fields on PDF documents.
 */

import { supabase } from '@/integrations/supabase/client';

export interface PdfFormField {
  id: string;
  pdf_document_id: string;
  page_id: string | null;
  field_name: string;
  field_type: string;
  field_value: string | null;
  bounds: { x: number; y: number; width: number; height: number };
  options: Record<string, unknown>;
  is_required: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export class PdfFormEngine {
  /**
   * Add a form field definition to a document.
   */
  static async addField(
    pdfDocumentId: string,
    pageId: string,
    fieldName: string,
    fieldType: string,
    bounds: { x: number; y: number; width: number; height: number },
    options?: Record<string, unknown>
  ): Promise<PdfFormField> {
    const { data, error } = await (supabase as any)
      .from('pdf_form_fields')
      .insert({
        pdf_document_id: pdfDocumentId,
        page_id: pageId,
        field_name: fieldName,
        field_type: fieldType,
        bounds,
        options: options || {},
      })
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  /**
   * Load all form fields for a document.
   */
  static async loadFields(pdfDocumentId: string): Promise<PdfFormField[]> {
    const { data, error } = await (supabase as any)
      .from('pdf_form_fields')
      .select('*')
      .eq('pdf_document_id', pdfDocumentId)
      .order('sort_order');
    if (error) throw error;
    return data || [];
  }

  /**
   * Fill form fields with values.
   */
  static async fillFields(
    pdfDocumentId: string,
    values: Record<string, string>
  ): Promise<void> {
    const fields = await this.loadFields(pdfDocumentId);
    for (const field of fields) {
      const value = values[field.field_name];
      if (value !== undefined) {
        await (supabase as any)
          .from('pdf_form_fields')
          .update({ field_value: value })
          .eq('id', field.id);
      }
    }
  }

  /**
   * Delete a form field.
   */
  static async deleteField(fieldId: string): Promise<void> {
    const { error } = await (supabase as any)
      .from('pdf_form_fields')
      .delete()
      .eq('id', fieldId);
    if (error) throw error;
  }
}
