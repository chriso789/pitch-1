/**
 * PITCH PDF Form Engine v2
 * 
 * Detect, extract, edit, create, and flatten AcroForm fields.
 * Converts form fields to smart fields for template reuse.
 * No external form SDKs — uses pdf-lib for extraction/editing.
 */

import { supabase } from '@/integrations/supabase/client';
import { PDFDocument } from 'pdf-lib';

// ═══════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════

export type FormFieldType = 'text' | 'checkbox' | 'radio' | 'dropdown' | 'signature' | 'date' | 'number';

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
  readonly: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface AcroFormExtractionResult {
  fields: ExtractedAcroField[];
  has_acroform: boolean;
  field_count: number;
  warnings: string[];
}

export interface ExtractedAcroField {
  name: string;
  type: FormFieldType;
  value: string | null;
  bounds: { x: number; y: number; width: number; height: number };
  page_number: number;
  readonly: boolean;
  required: boolean;
  options?: string[];  // for dropdowns/radios
  max_length?: number;
  multi_line?: boolean;
}

// ═══════════════════════════════════════════════════════════════════
// ENGINE
// ═══════════════════════════════════════════════════════════════════

export class PdfFormEngine {
  /**
   * Extract AcroForm fields from PDF bytes using pdf-lib.
   */
  static async extractAcroForms(pdfBytes: ArrayBuffer): Promise<AcroFormExtractionResult> {
    const warnings: string[] = [];
    const fields: ExtractedAcroField[] = [];

    try {
      const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
      const form = pdfDoc.getForm();
      const formFields = form.getFields();

      if (formFields.length === 0) {
        return { fields: [], has_acroform: false, field_count: 0, warnings: [] };
      }

      const pages = pdfDoc.getPages();

      for (const field of formFields) {
        try {
          const name = field.getName();
          const widgets = field.acroField.getWidgets();

          for (const widget of widgets) {
            const rect = widget.getRectangle();
            const pageRef = widget.P();
            let pageNumber = 1;

            if (pageRef) {
              const pageIdx = pages.findIndex(p => p.ref === pageRef);
              if (pageIdx >= 0) pageNumber = pageIdx + 1;
            }

            const bounds = {
              x: rect.x,
              y: rect.y,
              width: rect.width,
              height: rect.height,
            };

            // Determine field type
            let type: FormFieldType = 'text';
            let value: string | null = null;
            let options: string[] | undefined;

            const fieldType = field.constructor.name;
            if (fieldType.includes('Text')) {
              type = 'text';
              try { value = (field as any).getText?.() || null; } catch { /* */ }
            } else if (fieldType.includes('Check')) {
              type = 'checkbox';
              try { value = (field as any).isChecked?.() ? 'true' : 'false'; } catch { /* */ }
            } else if (fieldType.includes('Radio')) {
              type = 'radio';
              try { value = (field as any).getSelected?.() || null; } catch { /* */ }
            } else if (fieldType.includes('Dropdown') || fieldType.includes('Option')) {
              type = 'dropdown';
              try {
                options = (field as any).getOptions?.() || [];
                value = (field as any).getSelected?.() || null;
              } catch { /* */ }
            } else if (fieldType.includes('Signature')) {
              type = 'signature';
            }

            fields.push({
              name,
              type,
              value,
              bounds,
              page_number: pageNumber,
              readonly: field.isReadOnly(),
              required: false, // pdf-lib doesn't expose required flag easily
              options,
            });
          }
        } catch (err) {
          warnings.push(`Field extraction error: ${(err as Error).message}`);
        }
      }
    } catch (err) {
      warnings.push(`AcroForm extraction failed: ${(err as Error).message}`);
    }

    return {
      fields,
      has_acroform: fields.length > 0,
      field_count: fields.length,
      warnings,
    };
  }

  /**
   * Persist extracted AcroForm fields to database.
   */
  static async persistAcroFields(
    pdfDocumentId: string,
    extractedFields: ExtractedAcroField[],
  ): Promise<PdfFormField[]> {
    if (extractedFields.length === 0) return [];

    const rows = extractedFields.map((f, idx) => ({
      pdf_document_id: pdfDocumentId,
      field_name: f.name,
      field_type: f.type,
      field_value: f.value,
      bounds: f.bounds,
      options: { page_number: f.page_number, choices: f.options, max_length: f.max_length },
      is_required: f.required,
      readonly: f.readonly,
      sort_order: idx,
    }));

    const { data, error } = await (supabase as any)
      .from('pdf_form_fields')
      .insert(rows)
      .select();

    if (error) throw error;
    return data || [];
  }

  /**
   * Convert form fields to smart fields for template use.
   */
  static convertToSmartFields(
    formFields: PdfFormField[],
  ): Array<{ field_key: string; placeholder_text: string; bounds: any }> {
    const smartFieldMap: Record<string, string> = {
      'name': 'customer.name',
      'customer_name': 'customer.name',
      'homeowner': 'customer.name',
      'address': 'customer.address',
      'property_address': 'customer.address',
      'phone': 'customer.phone',
      'email': 'customer.email',
      'total': 'estimate.total',
      'amount': 'estimate.total',
      'date': 'job.contract_date',
      'contract_date': 'job.contract_date',
      'license': 'company.license',
      'company': 'company.name',
      'contractor': 'company.name',
    };

    return formFields.map(f => {
      const normalizedName = f.field_name.toLowerCase().replace(/[\s_-]+/g, '_');
      const matchedKey = Object.entries(smartFieldMap).find(([k]) => normalizedName.includes(k));

      return {
        field_key: matchedKey ? matchedKey[1] : `form.${normalizedName}`,
        placeholder_text: f.field_value || f.field_name,
        bounds: f.bounds,
      };
    });
  }

  /**
   * Fill form fields with values and return modified PDF bytes.
   */
  static async fillAndFlatten(
    pdfBytes: ArrayBuffer,
    values: Record<string, string>,
    flatten: boolean = false,
  ): Promise<Uint8Array> {
    const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
    const form = pdfDoc.getForm();

    for (const [fieldName, value] of Object.entries(values)) {
      try {
        const field = form.getField(fieldName);
        const fieldType = field.constructor.name;

        if (fieldType.includes('Text')) {
          (field as any).setText(value);
        } else if (fieldType.includes('Check')) {
          if (value === 'true' || value === '1' || value === 'yes') {
            (field as any).check();
          } else {
            (field as any).uncheck();
          }
        } else if (fieldType.includes('Dropdown') || fieldType.includes('Option')) {
          (field as any).select(value);
        } else if (fieldType.includes('Radio')) {
          (field as any).select(value);
        }
      } catch {
        // Field not found or type mismatch — skip
      }
    }

    if (flatten) {
      form.flatten();
    }

    return await pdfDoc.save();
  }

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
   * Fill form fields with values (DB update).
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
