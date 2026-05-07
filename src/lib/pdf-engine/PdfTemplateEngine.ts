/**
 * PITCH PDF Template Engine v2
 * 
 * Converts uploaded PDFs into reusable CRM-connected Smart Templates.
 * 
 * Flow:
 *   Upload PDF → Extract text graph → Detect smart fields → 
 *   Replace with smart tags → Save as reusable template
 * 
 * Template Structure:
 *   - layout_graph: full positional map of all objects
 *   - smart_fields: detected CRM-replaceable fields
 *   - font_map: font usage and replacement rules
 *   - operation_rules: compilation instructions
 */

import { supabase } from '@/integrations/supabase/client';
import { PdfSmartFieldDetector, type DetectedSmartField } from './PdfSmartFieldDetector';
import { PdfFontEngine } from './PdfFontEngine';
import type { PdfEngineObject } from './engineTypes';

// ═══════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════

export interface SmartTag {
  tag: string;         // e.g. {{customer.name}}
  label: string;       // "Customer Name"
  category: string;    // "contact" | "job" | "company" | "financial" | "date" | "system"
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
  layout_graph: TemplateLayoutGraph | null;
  reusable: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface TemplateLayoutGraph {
  version: 'layout-v2';
  pages: TemplatePageLayout[];
  font_map: Record<string, string>;
  operation_rules: TemplateOperationRule[];
  metadata: {
    source_page_count: number;
    total_objects: number;
    smart_field_count: number;
    created_from: string;
  };
}

export interface TemplatePageLayout {
  page_number: number;
  width: number;
  height: number;
  objects: TemplateObjectLayout[];
}

export interface TemplateObjectLayout {
  object_id: string;
  object_type: 'text' | 'image' | 'vector' | 'form_field';
  bounds: { x: number; y: number; width: number; height: number };
  content: Record<string, unknown>;
  is_smart_field: boolean;
  smart_field_key: string | null;
  font_info: Record<string, unknown>;
  z_index: number;
}

export interface TemplateOperationRule {
  field_key: string;
  operation: 'replace_text' | 'replace_image' | 'fill_form' | 'conditional_show';
  source_object_id: string;
  page_number: number;
  bounds: { x: number; y: number; width: number; height: number };
  layout_options: {
    alignment: 'left' | 'center' | 'right';
    max_lines: number;
    allow_expand: boolean;
    font_name: string;
    font_size: number;
  };
}

export interface TemplateExport {
  layout_graph: TemplateLayoutGraph;
  smart_fields: DetectedSmartField[];
  font_map: Record<string, string>;
  operation_rules: TemplateOperationRule[];
}

// Standard smart tags available system-wide
export const STANDARD_SMART_TAGS: SmartTag[] = [
  // Contact
  { tag: '{{customer.name}}', label: 'Customer Name', category: 'contact' },
  { tag: '{{customer.email}}', label: 'Customer Email', category: 'contact' },
  { tag: '{{customer.phone}}', label: 'Customer Phone', category: 'contact' },
  { tag: '{{customer.address}}', label: 'Customer Address', category: 'contact' },
  { tag: '{{customer.city}}', label: 'Customer City', category: 'contact' },
  { tag: '{{customer.state}}', label: 'Customer State', category: 'contact' },
  { tag: '{{customer.zip}}', label: 'Customer ZIP', category: 'contact' },
  // Job
  { tag: '{{job.number}}', label: 'Job Number', category: 'job' },
  { tag: '{{job.type}}', label: 'Job Type', category: 'job' },
  { tag: '{{job.address}}', label: 'Job Address', category: 'job' },
  { tag: '{{job.scope}}', label: 'Scope of Work', category: 'job' },
  { tag: '{{job.start_date}}', label: 'Start Date', category: 'job' },
  // Financial
  { tag: '{{estimate.total}}', label: 'Estimate Total', category: 'financial' },
  { tag: '{{estimate.subtotal}}', label: 'Subtotal', category: 'financial' },
  { tag: '{{estimate.tax}}', label: 'Tax Amount', category: 'financial' },
  { tag: '{{estimate.amount_due}}', label: 'Amount Due', category: 'financial' },
  // Company
  { tag: '{{company.name}}', label: 'Company Name', category: 'company' },
  { tag: '{{company.phone}}', label: 'Company Phone', category: 'company' },
  { tag: '{{company.email}}', label: 'Company Email', category: 'company' },
  { tag: '{{company.license}}', label: 'License Number', category: 'company' },
  { tag: '{{company.address}}', label: 'Company Address', category: 'company' },
  // System
  { tag: '{{today_date}}', label: "Today's Date", category: 'system' },
  { tag: '{{rep.name}}', label: 'Rep Name', category: 'system' },
  { tag: '{{rep.email}}', label: 'Rep Email', category: 'system' },
  { tag: '{{rep.phone}}', label: 'Rep Phone', category: 'system' },
];

// ═══════════════════════════════════════════════════════════════════
// ENGINE
// ═══════════════════════════════════════════════════════════════════

export class PdfTemplateEngine {
  /**
   * Convert an uploaded PDF into a Smart CRM Template.
   * This is the main entry point for the template conversion flow.
   */
  static async convertToTemplate(
    tenantId: string,
    userId: string,
    sourceDocumentId: string,
    title: string,
    objects: PdfEngineObject[],
    pageLayouts: Array<{ page_number: number; width: number; height: number }>,
    options?: { category?: string; description?: string }
  ): Promise<{ template: PdfTemplate; fields: DetectedSmartField[] }> {
    // Step 1: Detect smart fields
    const detectedFields = PdfSmartFieldDetector.detect(objects);
    console.log(`[TemplateEngine] Detected ${detectedFields.length} smart fields`);

    // Step 2: Build layout graph
    const layoutGraph = this.buildLayoutGraph(objects, pageLayouts, detectedFields);

    // Step 3: Build operation rules for each smart field
    const operationRules = this.buildOperationRules(detectedFields, objects);
    layoutGraph.operation_rules = operationRules;

    // Step 4: Extract font map
    const fontMap: Record<string, string> = {};
    for (const obj of objects) {
      const fi = obj.font_info as any;
      if (fi?.fontFamily) {
        fontMap[fi.fontFamily] = PdfFontEngine.findReplacementFont(fi.fontFamily);
      }
    }
    layoutGraph.font_map = fontMap;

    // Step 5: Build smart tags from detected fields
    const smartTags: SmartTag[] = detectedFields.map(f => ({
      tag: `{{${f.fieldKey}}}`,
      label: f.fieldKey.replace(/\./g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
      category: f.category,
      defaultValue: f.placeholderText,
    }));

    // Step 6: Save template
    const template = await this.saveAsTemplate(
      tenantId, userId, title,
      options?.description || `Smart template from ${title}`,
      sourceDocumentId, smartTags,
      options?.category || 'general',
      undefined, pageLayouts.length, layoutGraph,
    );

    // Step 7: Persist smart fields
    await PdfSmartFieldDetector.persistFields(template.id, detectedFields);

    return { template, fields: detectedFields };
  }

  /**
   * Build the full layout graph from objects.
   */
  static buildLayoutGraph(
    objects: PdfEngineObject[],
    pageLayouts: Array<{ page_number: number; width: number; height: number }>,
    smartFields: DetectedSmartField[],
  ): TemplateLayoutGraph {
    const smartFieldMap = new Map(smartFields.map(f => [f.objectId, f]));

    const pages: TemplatePageLayout[] = pageLayouts.map(pl => {
      const pageObjects = objects
        .filter(o => {
          const pageNum = (o.metadata as any)?.page_number;
          return pageNum === pl.page_number;
        })
        .map((o, idx) => {
          const sf = smartFieldMap.get(o.id);
          return {
            object_id: o.id,
            object_type: o.object_type as TemplateObjectLayout['object_type'],
            bounds: o.bounds,
            content: o.content,
            is_smart_field: !!sf,
            smart_field_key: sf?.fieldKey || null,
            font_info: o.font_info || {},
            z_index: idx,
          };
        });

      return {
        page_number: pl.page_number,
        width: pl.width,
        height: pl.height,
        objects: pageObjects,
      };
    });

    return {
      version: 'layout-v2',
      pages,
      font_map: {},
      operation_rules: [],
      metadata: {
        source_page_count: pageLayouts.length,
        total_objects: objects.length,
        smart_field_count: smartFields.length,
        created_from: 'pdf_upload',
      },
    };
  }

  /**
   * Build operation rules for template instantiation.
   */
  static buildOperationRules(
    fields: DetectedSmartField[],
    objects: PdfEngineObject[],
  ): TemplateOperationRule[] {
    const objectMap = new Map(objects.map(o => [o.id, o]));

    return fields.map(f => {
      const obj = objectMap.get(f.objectId);
      const fi = (obj?.font_info || {}) as any;
      const pageNum = (obj?.metadata as any)?.page_number || 1;

      return {
        field_key: f.fieldKey,
        operation: 'replace_text' as const,
        source_object_id: f.objectId,
        page_number: pageNum,
        bounds: f.bounds,
        layout_options: {
          alignment: 'left' as const,
          max_lines: 1,
          allow_expand: false,
          font_name: PdfFontEngine.findReplacementFont(fi.fontFamily || 'Helvetica'),
          font_size: fi.fontSize || 12,
        },
      };
    });
  }

  /**
   * Instantiate a template by replacing smart tags with real CRM data.
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
    pageCount?: number,
    layoutGraph?: TemplateLayoutGraph,
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
        layout_graph: layoutGraph || null,
        reusable: true,
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
   * Get a single template with smart fields.
   */
  static async getTemplate(templateId: string): Promise<PdfTemplate & { smart_fields_loaded: DetectedSmartField[] }> {
    const { data, error } = await (supabase as any)
      .from('pdf_templates')
      .select('*')
      .eq('id', templateId)
      .single();

    if (error) throw error;

    const fields = await PdfSmartFieldDetector.loadFields(templateId);

    return { ...data, smart_fields_loaded: fields };
  }

  /**
   * Export template as a portable structure.
   */
  static async exportTemplate(templateId: string): Promise<TemplateExport> {
    const template = await this.getTemplate(templateId);
    return {
      layout_graph: template.layout_graph || {
        version: 'layout-v2', pages: [], font_map: {}, operation_rules: [],
        metadata: { source_page_count: 0, total_objects: 0, smart_field_count: 0, created_from: 'export' },
      },
      smart_fields: template.smart_fields_loaded,
      font_map: template.layout_graph?.font_map || {},
      operation_rules: template.layout_graph?.operation_rules || [],
    };
  }

  /**
   * Delete a template (soft delete).
   */
  static async deleteTemplate(templateId: string): Promise<void> {
    const { error } = await (supabase as any)
      .from('pdf_templates')
      .update({ is_active: false })
      .eq('id', templateId);
    if (error) throw error;
  }
}
