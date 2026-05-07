/**
 * PITCH PDF Template Fill Engine
 * Resolves smart fields from CRM data (contacts, jobs, estimates, etc.)
 * and produces a fill result with resolved/missing field reports.
 */

export interface CrmContext {
  customer?: Record<string, any>;
  job?: Record<string, any>;
  company?: Record<string, any>;
  estimate?: Record<string, any>;
  measurement?: Record<string, any>;
  warranty?: Record<string, any>;
  permit?: Record<string, any>;
}

export interface SmartFieldDefinition {
  fieldKey: string;
  category?: string;
  required?: boolean;
  defaultValue?: string;
}

export interface TemplateFillResult {
  resolvedFields: Record<string, string>;
  missingFields: string[];
  warnings: string[];
  totalFields: number;
  resolvedCount: number;
  fillPercentage: number;
}

export class PdfTemplateFillEngine {
  /**
   * Resolve smart field tags against CRM context data.
   * Supports dot-notation: customer.name, job.address, estimate.total, etc.
   */
  static resolve(
    fields: SmartFieldDefinition[],
    context: CrmContext
  ): TemplateFillResult {
    const resolvedFields: Record<string, string> = {};
    const missingFields: string[] = [];
    const warnings: string[] = [];

    for (const field of fields) {
      const key = field.fieldKey;
      const value = this.resolveField(key, context);

      if (value !== null && value !== undefined && value !== '') {
        resolvedFields[key] = String(value);
      } else if (field.defaultValue) {
        resolvedFields[key] = field.defaultValue;
        warnings.push(`${key}: using default value "${field.defaultValue}"`);
      } else {
        missingFields.push(key);
        if (field.required) {
          warnings.push(`${key}: REQUIRED field is missing`);
        }
      }
    }

    return {
      resolvedFields,
      missingFields,
      warnings,
      totalFields: fields.length,
      resolvedCount: Object.keys(resolvedFields).length,
      fillPercentage: fields.length > 0
        ? Math.round((Object.keys(resolvedFields).length / fields.length) * 100)
        : 100,
    };
  }

  /**
   * Resolve a single dot-notation field key against the CRM context.
   */
  private static resolveField(key: string, context: CrmContext): string | null {
    const parts = key.split('.');
    if (parts.length < 2) return null;

    const [namespace, ...rest] = parts;
    const fieldName = rest.join('.');
    const source = (context as any)[namespace];

    if (!source) return null;

    // Support nested access: customer.address.city
    let current: any = source;
    for (const part of rest) {
      if (current == null || typeof current !== 'object') return null;
      current = current[part];
    }

    if (current === null || current === undefined) return null;

    // Format dates
    if (current instanceof Date) {
      return current.toLocaleDateString();
    }

    // Format numbers
    if (typeof current === 'number') {
      // Check if it looks like currency
      if (fieldName.includes('total') || fieldName.includes('amount') || fieldName.includes('price') || fieldName.includes('cost')) {
        return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(current);
      }
      return String(current);
    }

    return String(current);
  }

  /**
   * Build a sample CRM context for template test-fill.
   */
  static buildSampleContext(data?: {
    contact?: Record<string, any>;
    job?: Record<string, any>;
    company?: Record<string, any>;
    estimate?: Record<string, any>;
  }): CrmContext {
    return {
      customer: data?.contact || {
        name: 'John Doe',
        first_name: 'John',
        last_name: 'Doe',
        email: 'john@example.com',
        phone: '(555) 123-4567',
        address: '123 Main Street',
        city: 'Austin',
        state: 'TX',
        zip: '78701',
      },
      job: data?.job || {
        number: 'JOB-001',
        name: 'Roof Replacement',
        address: '123 Main Street, Austin TX',
        status: 'In Progress',
        type: 'Residential',
        start_date: new Date().toLocaleDateString(),
      },
      company: data?.company || {
        name: 'PITCH Roofing Co.',
        phone: '(555) 000-0000',
        email: 'info@pitchroofing.com',
        address: '456 Business Ave, Austin TX 78702',
        license: 'LIC-12345',
      },
      estimate: data?.estimate || {
        number: 'EST-001',
        total: 12500,
        subtotal: 11364,
        tax: 1136,
        date: new Date().toLocaleDateString(),
        valid_until: new Date(Date.now() + 30 * 86400000).toLocaleDateString(),
      },
      measurement: {
        total_area: 2400,
        pitch: '6/12',
        squares: 24,
        perimeter: 220,
      },
      warranty: {
        type: 'Manufacturer 25-Year',
        start_date: new Date().toLocaleDateString(),
        end_date: new Date(Date.now() + 25 * 365 * 86400000).toLocaleDateString(),
      },
      permit: {
        number: 'PRM-2026-001',
        status: 'Approved',
        issued_date: new Date().toLocaleDateString(),
      },
    };
  }
}
