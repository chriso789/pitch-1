/**
 * PITCH PDF Template Engine
 * Save documents as templates with smart tag placeholders.
 * Instantiate templates by replacing tags with real data.
 */

import { supabase } from '@/integrations/supabase/client';

export interface SmartTag {
  tag: string;         // e.g. {{customer_name}}
  label: string;       // "Customer Name"
  category: string;    // "contact" | "job" | "company"
  defaultValue?: string;
}

export interface PdfTemplate {
  id: string;
  tenant_id: string;
  source_document_id: string | null;
  title: string;
  description: string | null;
  smart_tags: SmartTag[];
  category: string;
  is_active: boolean;
  original_file_path: string | null;
  page_count: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

// Standard smart tags available system-wide
export const STANDARD_SMART_TAGS: SmartTag[] = [
  { tag: '{{customer_name}}', label: 'Customer Name', category: 'contact' },
  { tag: '{{customer_email}}', label: 'Customer Email', category: 'contact' },
  { tag: '{{customer_phone}}', label: 'Customer Phone', category: 'contact' },
  { tag: '{{customer_address}}', label: 'Customer Address', category: 'contact' },
  { tag: '{{job_number}}', label: 'Job Number', category: 'job' },
  { tag: '{{job_type}}', label: 'Job Type', category: 'job' },
  { tag: '{{estimate_total}}', label: 'Estimate Total', category: 'job' },
  { tag: '{{company_name}}', label: 'Company Name', category: 'company' },
  { tag: '{{company_phone}}', label: 'Company Phone', category: 'company' },
  { tag: '{{company_email}}', label: 'Company Email', category: 'company' },
  { tag: '{{today_date}}', label: 'Today\'s Date', category: 'system' },
  { tag: '{{rep_name}}', label: 'Rep Name', category: 'system' },
];

export class PdfTemplateEngine {
  /**
   * Save a PDF document as a reusable template.
   */
  static async saveAsTemplate(
    tenantId: string,
    userId: string,
    title: string,
    description: string,
    sourceDocumentId: string,
    smartTags: SmartTag[],
    category: string = 'general',
    originalFilePath?: string,
    pageCount?: number
  ): Promise<PdfTemplate> {
    const { data, error } = await (supabase as any)
      .from('pdf_templates')
      .insert({
        tenant_id: tenantId,
        source_document_id: sourceDocumentId,
        title,
        description,
        smart_tags: smartTags,
        category,
        is_active: true,
        original_file_path: originalFilePath || null,
        page_count: pageCount || 0,
        created_by: userId,
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  /**
   * List templates for a tenant.
   */
  static async listTemplates(tenantId: string, category?: string): Promise<PdfTemplate[]> {
    let query = (supabase as any)
      .from('pdf_templates')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .order('created_at', { ascending: false });

    if (category) query = query.eq('category', category);
    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  }

  /**
   * Replace smart tags in text objects with real values.
   */
  static replaceSmartTags(
    text: string,
    values: Record<string, string>
  ): string {
    let result = text;
    for (const [tag, value] of Object.entries(values)) {
      const pattern = tag.startsWith('{{') ? tag : `{{${tag}}}`;
      result = result.split(pattern).join(value);
    }
    return result;
  }

  /**
   * Delete a template.
   */
  static async deleteTemplate(templateId: string): Promise<void> {
    const { error } = await (supabase as any)
      .from('pdf_templates')
      .update({ is_active: false })
      .eq('id', templateId);
    if (error) throw error;
  }
}
