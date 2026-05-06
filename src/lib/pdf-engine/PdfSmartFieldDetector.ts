/**
 * PITCH PDF Smart Field Detector
 * Automatically detects CRM-replaceable fields in PDF text objects.
 * Identifies names, addresses, financials, dates, phone/email/license patterns.
 */

import { supabase } from '@/integrations/supabase/client';
import type { PdfEngineObject } from './engineTypes';

export interface DetectedSmartField {
  objectId: string;
  pageId: string;
  fieldKey: string;
  placeholderText: string;
  bounds: { x: number; y: number; width: number; height: number };
  confidence: number;
  category: string;
}

interface DetectionPattern {
  fieldKey: string;
  category: string;
  labelPatterns: RegExp[];
  valuePatterns?: RegExp[];
}

const DETECTION_PATTERNS: DetectionPattern[] = [
  // Names
  {
    fieldKey: 'customer.name',
    category: 'contact',
    labelPatterns: [
      /\b(homeowner|customer|client|insured|applicant|property\s*owner|name\s*of\s*owner)\s*:?\s*/i,
      /\b(name|full\s*name|customer\s*name)\s*:?\s*/i,
    ],
  },
  {
    fieldKey: 'customer.phone',
    category: 'contact',
    labelPatterns: [/\b(phone|telephone|mobile|cell|contact\s*number)\s*:?\s*/i],
    valuePatterns: [/\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}/],
  },
  {
    fieldKey: 'customer.email',
    category: 'contact',
    labelPatterns: [/\b(email|e-mail|email\s*address)\s*:?\s*/i],
    valuePatterns: [/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/],
  },
  // Addresses
  {
    fieldKey: 'customer.address',
    category: 'contact',
    labelPatterns: [
      /\b(property\s*address|job\s*site|project\s*address|address|street\s*address|mailing\s*address)\s*:?\s*/i,
    ],
    valuePatterns: [/\d+\s+[A-Za-z]+\s+(St|Ave|Blvd|Dr|Ln|Rd|Ct|Way|Pl|Cir)/i],
  },
  // Financial
  {
    fieldKey: 'estimate.total',
    category: 'financial',
    labelPatterns: [/\b(total|grand\s*total|amount\s*due|contract\s*price|project\s*total)\s*:?\s*/i],
    valuePatterns: [/\$[\d,]+\.?\d{0,2}/],
  },
  {
    fieldKey: 'estimate.subtotal',
    category: 'financial',
    labelPatterns: [/\b(subtotal|sub-total|materials?\s*total|labor\s*total)\s*:?\s*/i],
    valuePatterns: [/\$[\d,]+\.?\d{0,2}/],
  },
  // Dates
  {
    fieldKey: 'job.contract_date',
    category: 'date',
    labelPatterns: [/\b(contract\s*date|date\s*of\s*contract|agreement\s*date|effective\s*date)\s*:?\s*/i],
    valuePatterns: [/\d{1,2}\/\d{1,2}\/\d{2,4}|\w+\s+\d{1,2},?\s+\d{4}/],
  },
  {
    fieldKey: 'job.inspection_date',
    category: 'date',
    labelPatterns: [/\b(inspection\s*date|date\s*of\s*loss|date\s*of\s*inspection)\s*:?\s*/i],
  },
  {
    fieldKey: 'job.start_date',
    category: 'date',
    labelPatterns: [/\b(start\s*date|commencement\s*date|begin\s*date|project\s*start)\s*:?\s*/i],
  },
  // Company
  {
    fieldKey: 'company.name',
    category: 'company',
    labelPatterns: [/\b(contractor|company|business\s*name|firm\s*name|dba)\s*:?\s*/i],
  },
  {
    fieldKey: 'company.license',
    category: 'company',
    labelPatterns: [/\b(license|lic\.?\s*#?|license\s*number|contractor\s*license)\s*:?\s*/i],
    valuePatterns: [/[A-Z]{0,3}\d{4,}/],
  },
  // Job
  {
    fieldKey: 'job.number',
    category: 'job',
    labelPatterns: [/\b(job\s*#|job\s*number|project\s*#|claim\s*#|claim\s*number|reference)\s*:?\s*/i],
  },
  {
    fieldKey: 'job.scope',
    category: 'job',
    labelPatterns: [/\b(scope\s*of\s*work|description\s*of\s*work|work\s*to\s*be\s*performed)\s*:?\s*/i],
  },
  // Rep
  {
    fieldKey: 'rep.name',
    category: 'system',
    labelPatterns: [/\b(sales\s*rep|representative|salesperson|agent|prepared\s*by)\s*:?\s*/i],
  },
];

export class PdfSmartFieldDetector {
  /**
   * Detect smart fields from a set of PDF objects.
   */
  static detect(objects: PdfEngineObject[]): DetectedSmartField[] {
    const textObjects = objects.filter(o => o.object_type === 'text');
    const detected: DetectedSmartField[] = [];
    const usedObjectIds = new Set<string>();

    for (const obj of textObjects) {
      const text = (obj.content as any)?.text || '';
      if (!text || text.length < 2) continue;

      for (const pattern of DETECTION_PATTERNS) {
        if (usedObjectIds.has(obj.id)) break;

        for (const labelPattern of pattern.labelPatterns) {
          if (labelPattern.test(text)) {
            // Check if there's a value pattern and it matches
            let confidence = 0.7;
            if (pattern.valuePatterns) {
              const hasValue = pattern.valuePatterns.some(vp => vp.test(text));
              confidence = hasValue ? 0.9 : 0.6;
            }

            detected.push({
              objectId: obj.id,
              pageId: obj.page_id,
              fieldKey: pattern.fieldKey,
              placeholderText: text,
              bounds: obj.bounds,
              confidence,
              category: pattern.category,
            });
            usedObjectIds.add(obj.id);
            break;
          }
        }

        // Also check standalone value patterns (no label needed)
        if (!usedObjectIds.has(obj.id) && pattern.valuePatterns) {
          for (const vp of pattern.valuePatterns) {
            if (vp.test(text) && text.length < 100) {
              // Only if text is short enough to be a field value
              detected.push({
                objectId: obj.id,
                pageId: obj.page_id,
                fieldKey: pattern.fieldKey,
                placeholderText: text,
                bounds: obj.bounds,
                confidence: 0.5,
                category: pattern.category,
              });
              usedObjectIds.add(obj.id);
              break;
            }
          }
        }
      }
    }

    return detected.sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Persist detected smart fields to database.
   */
  static async persistFields(
    templateId: string,
    fields: DetectedSmartField[]
  ): Promise<void> {
    if (fields.length === 0) return;

    const rows = fields.map(f => ({
      template_id: templateId,
      page_id: f.pageId,
      object_id: f.objectId,
      field_key: f.fieldKey,
      placeholder_text: f.placeholderText,
      bounds: f.bounds,
      replacement_rules: { confidence: f.confidence, category: f.category },
    }));

    const { error } = await (supabase as any)
      .from('pdf_smart_fields')
      .insert(rows);

    if (error) console.warn('[SmartFieldDetector] Persist error:', error);
  }

  /**
   * Load smart fields for a template.
   */
  static async loadFields(templateId: string): Promise<DetectedSmartField[]> {
    const { data, error } = await (supabase as any)
      .from('pdf_smart_fields')
      .select('*')
      .eq('template_id', templateId);

    if (error) throw error;
    return (data || []).map((row: any) => ({
      objectId: row.object_id,
      pageId: row.page_id,
      fieldKey: row.field_key,
      placeholderText: row.placeholder_text,
      bounds: row.bounds,
      confidence: row.replacement_rules?.confidence || 0.5,
      category: row.replacement_rules?.category || 'unknown',
    }));
  }

  /**
   * Get all field categories.
   */
  static getFieldCategories(): string[] {
    return [...new Set(DETECTION_PATTERNS.map(p => p.category))];
  }

  /**
   * Convert field key to a smart tag format.
   */
  static toSmartTag(fieldKey: string): string {
    return `{{${fieldKey}}}`;
  }
}
