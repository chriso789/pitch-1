// ============================================
// TEMPLATE FIELD EVALUATION ENGINE
// ============================================

import type {
  CanonicalPermitContext,
  MissingItem,
  ValidationError,
} from './permit_types.ts';

interface TemplateEvalResult {
  application_field_values: Record<string, unknown>;
  calculation_results: Record<string, unknown>;
  validation_errors: ValidationError[];
  template_missing_items: MissingItem[];
  output_plan: OutputPlan;
}

interface OutputPlan {
  application_pdf?: {
    input_pdf_storage?: {
      bucket: string;
      path: string;
    };
    field_map?: Array<{ pdf_field: string; value_key: string }>;
  };
  packet_zip?: {
    include: string[];
  };
}

/**
 * Evaluate template fields and calculations against the permit context.
 * This is a stub implementation - expand based on your template_json schema.
 */
export function evalTemplate(args: {
  context: CanonicalPermitContext;
  template_json: unknown;
}): TemplateEvalResult {
  const { context, template_json } = args;
  const template = template_json as any;

  const application_field_values: Record<string, unknown> = {};
  const calculation_results: Record<string, unknown> = {};
  const validation_errors: ValidationError[] = [];
  const template_missing_items: MissingItem[] = [];

  // === Extract common field values from context ===
  
  // Property address
  application_field_values['property_address'] = context.job.address.full;
  application_field_values['property_street'] = context.job.address.line1;
  application_field_values['property_city'] = context.job.address.city;
  application_field_values['property_state'] = context.job.address.state;
  application_field_values['property_zip'] = context.job.address.zip;

  // Owner information
  application_field_values['owner_name'] = context.contacts.owner.full_name;
  application_field_values['owner_first_name'] = context.contacts.owner.first_name;
  application_field_values['owner_last_name'] = context.contacts.owner.last_name;
  application_field_values['owner_phone'] = context.contacts.owner.phone;
  application_field_values['owner_email'] = context.contacts.owner.email;
  application_field_values['owner_mailing_address'] = context.contacts.owner.mailing_address.full;

  // Parcel information
  application_field_values['parcel_id'] = context.parcel?.parcel_id;
  application_field_values['folio'] = context.parcel?.folio;
  application_field_values['legal_description'] = context.parcel?.legal_description;
  application_field_values['subdivision'] = context.parcel?.subdivision;

  // Measurements
  application_field_values['roof_area_sqft'] = context.measurements?.total_roof_area_sqft;
  application_field_values['predominant_pitch'] = context.measurements?.predominant_pitch;
  application_field_values['stories'] = context.measurements?.stories;
  application_field_values['eaves_ft'] = context.measurements?.eaves_ft;
  application_field_values['rakes_ft'] = context.measurements?.rakes_ft;
  application_field_values['ridges_ft'] = context.measurements?.ridges_ft;
  application_field_values['valleys_ft'] = context.measurements?.valleys_ft;

  // Estimate
  application_field_values['contract_total'] = context.estimate?.contract_total;
  application_field_values['permit_type'] = context.estimate?.permit_type;
  application_field_values['primary_roof_system'] = context.estimate?.primary_roof_system.display_name;

  // Products
  application_field_values['fl_product_approval_number'] = context.products.primary.fl_product_approval_no;
  application_field_values['miami_dade_noa_number'] = context.products.primary.miami_dade_noa_no;
  application_field_values['primary_manufacturer'] = context.products.primary.manufacturer;
  application_field_values['primary_model'] = context.products.primary.model;

  // Company
  application_field_values['contractor_name'] = context.company?.legal_name;
  application_field_values['contractor_dba'] = context.company?.dba_name;
  application_field_values['contractor_license'] = context.company?.license_number;
  application_field_values['contractor_phone'] = context.company?.phone;
  application_field_values['contractor_email'] = context.company?.email;
  application_field_values['contractor_address'] = context.company?.address.full;

  // === Calculations ===
  
  // Calculate roof squares (area / 100)
  if (context.measurements?.total_roof_area_sqft) {
    const squares = context.measurements.total_roof_area_sqft / 100;
    calculation_results['roof_squares'] = Math.round(squares * 10) / 10;
    application_field_values['roof_squares'] = calculation_results['roof_squares'];
  }

  // Calculate linear feet total
  const eaves = context.measurements?.eaves_ft || 0;
  const rakes = context.measurements?.rakes_ft || 0;
  const ridges = context.measurements?.ridges_ft || 0;
  const valleys = context.measurements?.valleys_ft || 0;
  calculation_results['total_linear_ft'] = eaves + rakes + ridges + valleys;

  // === Process template fields if provided ===
  if (template?.fields && Array.isArray(template.fields)) {
    for (const field of template.fields) {
      try {
        // Handle source.ref fields
        if (field.source?.ref) {
          const value = resolveRef(field.source.ref, context);
          if (value !== undefined) {
            application_field_values[field.key] = value;
          }
        }
        
        // Handle calc.expr fields
        if (field.calc?.expr) {
          const result = evaluateExpression(field.calc.expr, context, application_field_values);
          if (result !== undefined) {
            calculation_results[field.key] = result;
            application_field_values[field.key] = result;
          }
        }

        // Check required fields
        if (field.required && application_field_values[field.key] == null) {
          validation_errors.push({
            key: field.key,
            severity: 'error',
            message: `Required field "${field.label || field.key}" is missing`,
          });
        }
      } catch (err) {
        validation_errors.push({
          key: field.key,
          severity: 'warning',
          message: `Error evaluating field ${field.key}: ${err}`,
        });
      }
    }
  }

  // === Run validations from template ===
  if (template?.validations && Array.isArray(template.validations)) {
    for (const validation of template.validations) {
      try {
        const shouldFire = evaluateCondition(validation.when, context, application_field_values);
        if (shouldFire) {
          validation_errors.push({
            key: validation.key,
            severity: validation.severity || 'error',
            message: validation.message,
          });
        }
      } catch (err) {
        // Skip failed validations
      }
    }
  }

  // === Build output plan ===
  const output_plan: OutputPlan = {};

  if (template?.outputs?.application_pdf) {
    output_plan.application_pdf = {
      input_pdf_storage: template.outputs.application_pdf.input_pdf_storage,
      field_map: template.outputs.application_pdf.field_map,
    };
  }

  if (template?.outputs?.packet_zip) {
    output_plan.packet_zip = {
      include: template.outputs.packet_zip.include || [],
    };
  }

  return {
    application_field_values,
    calculation_results,
    validation_errors,
    template_missing_items,
    output_plan,
  };
}

/**
 * Resolve a dotted reference path from the context
 */
function resolveRef(ref: string, context: CanonicalPermitContext): unknown {
  const parts = ref.split('.');
  let current: unknown = context;
  
  for (const part of parts) {
    if (current == null || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  
  return current;
}

/**
 * Evaluate a simple expression (stub - expand based on your needs)
 */
function evaluateExpression(
  expr: string,
  context: CanonicalPermitContext,
  values: Record<string, unknown>
): unknown {
  // Handle simple division expression like "measurements.total_roof_area_sqft / 100"
  if (expr.includes('/')) {
    const [leftStr, rightStr] = expr.split('/').map(s => s.trim());
    const left = resolveRef(leftStr, context) ?? values[leftStr];
    const right = parseFloat(rightStr) || (resolveRef(rightStr, context) ?? values[rightStr]);
    
    if (typeof left === 'number' && typeof right === 'number' && right !== 0) {
      return left / right;
    }
  }
  
  // Handle simple multiplication
  if (expr.includes('*')) {
    const [leftStr, rightStr] = expr.split('*').map(s => s.trim());
    const left = resolveRef(leftStr, context) ?? values[leftStr];
    const right = parseFloat(rightStr) || (resolveRef(rightStr, context) ?? values[rightStr]);
    
    if (typeof left === 'number' && typeof right === 'number') {
      return left * right;
    }
  }
  
  return undefined;
}

/**
 * Evaluate a condition object (stub - expand based on your condition schema)
 */
function evaluateCondition(
  condition: any,
  context: CanonicalPermitContext,
  values: Record<string, unknown>
): boolean {
  if (!condition || typeof condition !== 'object') {
    return false;
  }
  
  const { op, left, right, args } = condition;
  
  switch (op) {
    case 'isNull':
    case 'is_null': {
      const value = left?.ref ? resolveRef(left.ref, context) : values[left?.literal];
      return value == null;
    }
    case 'eq': {
      const leftVal = left?.ref ? resolveRef(left.ref, context) : left?.literal;
      const rightVal = right?.ref ? resolveRef(right.ref, context) : right?.literal;
      return leftVal === rightVal;
    }
    case 'lt': {
      const leftVal = left?.ref ? resolveRef(left.ref, context) : left?.literal;
      const rightVal = right?.ref ? resolveRef(right.ref, context) : right?.literal;
      return (leftVal as number) < (rightVal as number);
    }
    case 'gt': {
      const leftVal = left?.ref ? resolveRef(left.ref, context) : left?.literal;
      const rightVal = right?.ref ? resolveRef(right.ref, context) : right?.literal;
      return (leftVal as number) > (rightVal as number);
    }
    case 'and': {
      return (args || []).every((c: any) => evaluateCondition(c, context, values));
    }
    case 'or': {
      return (args || []).some((c: any) => evaluateCondition(c, context, values));
    }
    case 'not': {
      return !evaluateCondition(args?.[0], context, values);
    }
    default:
      return false;
  }
}
