/**
 * Permit Template Field Resolver
 * 
 * Resolves template fields using either source.ref or calc.expr,
 * runs validations, and returns structured results.
 */

import type {
  PermitContext,
  TemplateDefinition,
  TemplateField,
  TemplateValidation,
  ResolvedFields,
  ValidationError,
  ExpressionCondition,
} from './types';

import { evaluateExpression, resolveRef } from './expressionEvaluator';

/**
 * Resolve a single template field value
 */
function resolveFieldValue(
  field: TemplateField,
  context: PermitContext,
  errors: ValidationError[]
): unknown {
  // calc.expr takes precedence over source.ref
  if (field.calc?.expr) {
    const result = evaluateExpression(field.calc.expr, context);
    
    // Add any evaluation errors
    for (const error of result.errors) {
      errors.push({
        field: field.key,
        severity: 'error',
        message: `Calculation error: ${error}`,
      });
    }
    
    return result.value;
  }

  // Fall back to source.ref
  if (field.source?.ref) {
    return resolveRef(field.source.ref, context);
  }

  return null;
}

/**
 * Evaluate a validation condition
 */
function evaluateCondition(
  condition: ExpressionCondition,
  context: PermitContext
): boolean {
  const { op, left, right, value, args } = condition;

  // Helper to get a value from ref or literal
  const getValue = (v: typeof left): unknown => {
    if (!v) return null;
    if (v.ref) return resolveRef(v.ref, context);
    return v.literal;
  };

  switch (op) {
    case 'is_empty': {
      const val = getValue(value);
      return val == null || val === '' || (Array.isArray(val) && val.length === 0);
    }
    
    case 'is_null': {
      const val = getValue(value);
      return val == null;
    }
    
    case 'eq':
      return getValue(left) === getValue(right);
    
    case 'ne':
      return getValue(left) !== getValue(right);
    
    case 'gt': {
      const l = getValue(left);
      const r = getValue(right);
      return typeof l === 'number' && typeof r === 'number' && l > r;
    }
    
    case 'gte': {
      const l = getValue(left);
      const r = getValue(right);
      return typeof l === 'number' && typeof r === 'number' && l >= r;
    }
    
    case 'lt': {
      const l = getValue(left);
      const r = getValue(right);
      return typeof l === 'number' && typeof r === 'number' && l < r;
    }
    
    case 'lte': {
      const l = getValue(left);
      const r = getValue(right);
      return typeof l === 'number' && typeof r === 'number' && l <= r;
    }
    
    case 'and': {
      if (!args) return true;
      return args.every(arg => evaluateCondition(arg, context));
    }
    
    case 'or': {
      if (!args) return false;
      return args.some(arg => evaluateCondition(arg, context));
    }
    
    case 'not': {
      if (!args || args.length === 0) return true;
      return !evaluateCondition(args[0], context);
    }
    
    default:
      console.warn(`Unknown condition operator: ${op}`);
      return false;
  }
}

/**
 * Run template validations
 */
function runValidations(
  validations: TemplateValidation[],
  context: PermitContext,
  errors: ValidationError[]
): void {
  for (const validation of validations) {
    try {
      const conditionMet = evaluateCondition(validation.when, context);
      
      if (conditionMet) {
        errors.push({
          field: validation.key,
          severity: validation.severity,
          message: validation.message,
        });
      }
    } catch (e) {
      errors.push({
        field: validation.key,
        severity: 'error',
        message: `Validation error: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  }
}

/**
 * Resolve all template fields against a permit context
 * 
 * @example
 * const result = resolveTemplateFields(template.template_json, context);
 * console.log(result.values); // { property_address: "123 Main St", roof_squares: 30.8, ... }
 * console.log(result.errors); // [{ field: "fl_approval", severity: "error", message: "Missing..." }]
 * console.log(result.missingRequired); // ["legal_description"]
 */
export function resolveTemplateFields(
  template: TemplateDefinition,
  context: PermitContext
): ResolvedFields {
  const values: Record<string, unknown> = {};
  const errors: ValidationError[] = [];
  const missingRequired: string[] = [];

  // Resolve each field
  for (const field of template.fields) {
    const value = resolveFieldValue(field, context, errors);
    values[field.key] = value;

    // Track missing required fields
    if (field.required && (value == null || value === '')) {
      missingRequired.push(field.key);
    }
  }

  // Run validations
  if (template.validations) {
    runValidations(template.validations, context, errors);
  }

  return { values, errors, missingRequired };
}

/**
 * Check if attachments are required based on conditional logic
 */
export function resolveRequiredAttachments(
  template: TemplateDefinition,
  context: PermitContext
): string[] {
  const required = new Set<string>(template.attachments.required);

  // Check conditional attachments
  if (template.attachments.conditional) {
    for (const conditional of template.attachments.conditional) {
      try {
        if (evaluateCondition(conditional.when, context)) {
          required.add(conditional.key);
        }
      } catch (e) {
        console.warn(`Error evaluating conditional attachment ${conditional.key}:`, e);
      }
    }
  }

  return Array.from(required);
}

/**
 * Build a summary of what's missing for a permit case
 */
export interface PermitReadinessSummary {
  isReady: boolean;
  missingFields: string[];
  missingAttachments: string[];
  validationErrors: ValidationError[];
  warnings: ValidationError[];
}

export function checkPermitReadiness(
  template: TemplateDefinition,
  context: PermitContext,
  availableAttachments: string[]
): PermitReadinessSummary {
  const { values, errors, missingRequired } = resolveTemplateFields(template, context);
  const requiredAttachments = resolveRequiredAttachments(template, context);
  
  const missingAttachments = requiredAttachments.filter(
    att => !availableAttachments.includes(att)
  );

  const validationErrors = errors.filter(e => e.severity === 'error');
  const warnings = errors.filter(e => e.severity === 'warning');

  const isReady = 
    missingRequired.length === 0 &&
    missingAttachments.length === 0 &&
    validationErrors.length === 0;

  return {
    isReady,
    missingFields: missingRequired,
    missingAttachments,
    validationErrors,
    warnings,
  };
}

/**
 * Generate a human-readable field label from a field key
 */
export function getFieldLabel(key: string, template: TemplateDefinition): string {
  const field = template.fields.find(f => f.key === key);
  return field?.label ?? key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

/**
 * Get all field values formatted for display
 */
export function getDisplayFields(
  template: TemplateDefinition,
  context: PermitContext
): Array<{ key: string; label: string; value: unknown; type: string }> {
  const { values } = resolveTemplateFields(template, context);
  
  return template.fields.map(field => ({
    key: field.key,
    label: field.label,
    value: values[field.key],
    type: field.type,
  }));
}
