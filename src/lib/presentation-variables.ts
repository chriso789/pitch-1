/**
 * Dynamic Variable Injection System for Presentations
 * Replaces {{variable.path}} placeholders with actual CRM data
 */

export interface PresentationContext {
  contact?: {
    id?: string;
    first_name?: string;
    last_name?: string;
    full_name?: string;
    email?: string;
    phone?: string;
    address?: string;
    city?: string;
    state?: string;
    zip?: string;
  };
  job?: {
    id?: string;
    job_type?: string;
    roof_type?: string;
    roof_squares?: number;
    estimated_value?: number;
    is_insurance?: boolean;
    status?: string;
    description?: string;
  };
  estimate?: {
    id?: string;
    total?: number;
    materials_total?: number;
    labor_total?: number;
    good_price?: number;
    better_price?: number;
    best_price?: number;
    deposit?: number;
  };
  insurance?: {
    claim_number?: string;
    carrier?: string;
    deductible?: number;
    rcv_amount?: number;
    acv_amount?: number;
  };
  company?: {
    name?: string;
    phone?: string;
    email?: string;
    website?: string;
    license?: string;
    address?: string;
    logo_url?: string;
  };
  project?: {
    id?: string;
    name?: string;
    address?: string;
    start_date?: string;
    end_date?: string;
  };
}

/**
 * Get a nested value from an object using dot notation
 */
function getNestedValue(obj: Record<string, any>, path: string): any {
  const keys = path.split('.');
  let current: any = obj;
  
  for (const key of keys) {
    if (current === null || current === undefined) {
      return undefined;
    }
    current = current[key];
  }
  
  return current;
}

/**
 * Format a value for display
 */
function formatValue(value: any, path: string): string {
  if (value === null || value === undefined) {
    return '';
  }
  
  // Format currency values
  if (
    path.includes('price') || 
    path.includes('total') || 
    path.includes('value') ||
    path.includes('deductible') ||
    path.includes('rcv') ||
    path.includes('acv') ||
    path.includes('deposit')
  ) {
    const num = typeof value === 'number' ? value : parseFloat(value);
    if (!isNaN(num)) {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      }).format(num);
    }
  }
  
  // Format numbers with squares
  if (path.includes('squares')) {
    return `${value} squares`;
  }
  
  return String(value);
}

/**
 * Replace all {{variable.path}} placeholders in a string with actual values
 */
export function replaceVariablesInString(
  text: string,
  context: PresentationContext
): string {
  if (!text || typeof text !== 'string') {
    return text;
  }
  
  return text.replace(/\{\{([^}]+)\}\}/g, (match, path) => {
    const trimmedPath = path.trim();
    const value = getNestedValue(context, trimmedPath);
    
    if (value === undefined || value === null) {
      // Return placeholder if value not found (for admin visibility)
      return match;
    }
    
    return formatValue(value, trimmedPath);
  });
}

/**
 * Recursively replace variables in slide content object
 */
export function injectVariables(
  content: Record<string, any>,
  context: PresentationContext
): Record<string, any> {
  if (!content || typeof content !== 'object') {
    return content;
  }
  
  const result: Record<string, any> = {};
  
  for (const [key, value] of Object.entries(content)) {
    if (typeof value === 'string') {
      result[key] = replaceVariablesInString(value, context);
    } else if (Array.isArray(value)) {
      result[key] = value.map(item => {
        if (typeof item === 'string') {
          return replaceVariablesInString(item, context);
        } else if (typeof item === 'object' && item !== null) {
          return injectVariables(item, context);
        }
        return item;
      });
    } else if (typeof value === 'object' && value !== null) {
      result[key] = injectVariables(value, context);
    } else {
      result[key] = value;
    }
  }
  
  return result;
}

/**
 * Extract all variable placeholders from content
 */
export function extractVariables(content: Record<string, any>): string[] {
  const variables = new Set<string>();
  const stringified = JSON.stringify(content);
  
  const matches = stringified.matchAll(/\{\{([^}]+)\}\}/g);
  for (const match of matches) {
    variables.add(match[1].trim());
  }
  
  return Array.from(variables);
}

/**
 * Check if content has any unresolved variables
 */
export function hasUnresolvedVariables(
  content: Record<string, any>,
  context: PresentationContext
): string[] {
  const variables = extractVariables(content);
  const unresolved: string[] = [];
  
  for (const variable of variables) {
    const value = getNestedValue(context, variable);
    if (value === undefined || value === null) {
      unresolved.push(variable);
    }
  }
  
  return unresolved;
}

/**
 * Available variables for the variable picker
 */
export const AVAILABLE_VARIABLES = [
  // Contact
  { path: 'contact.full_name', label: 'Customer Name', category: 'Contact' },
  { path: 'contact.first_name', label: 'First Name', category: 'Contact' },
  { path: 'contact.last_name', label: 'Last Name', category: 'Contact' },
  { path: 'contact.email', label: 'Email', category: 'Contact' },
  { path: 'contact.phone', label: 'Phone', category: 'Contact' },
  { path: 'contact.address', label: 'Address', category: 'Contact' },
  { path: 'contact.city', label: 'City', category: 'Contact' },
  { path: 'contact.state', label: 'State', category: 'Contact' },
  
  // Job/Project
  { path: 'job.job_type', label: 'Job Type', category: 'Job' },
  { path: 'job.roof_type', label: 'Roof Type', category: 'Job' },
  { path: 'job.roof_squares', label: 'Roof Squares', category: 'Job' },
  { path: 'job.estimated_value', label: 'Estimated Value', category: 'Job' },
  { path: 'job.description', label: 'Job Description', category: 'Job' },
  
  // Estimate/Pricing
  { path: 'estimate.total', label: 'Total Estimate', category: 'Pricing' },
  { path: 'estimate.materials_total', label: 'Materials Total', category: 'Pricing' },
  { path: 'estimate.labor_total', label: 'Labor Total', category: 'Pricing' },
  { path: 'estimate.good_price', label: 'Good Option Price', category: 'Pricing' },
  { path: 'estimate.better_price', label: 'Better Option Price', category: 'Pricing' },
  { path: 'estimate.best_price', label: 'Best Option Price', category: 'Pricing' },
  
  // Insurance
  { path: 'insurance.claim_number', label: 'Claim Number', category: 'Insurance' },
  { path: 'insurance.carrier', label: 'Insurance Carrier', category: 'Insurance' },
  { path: 'insurance.deductible', label: 'Deductible', category: 'Insurance' },
  { path: 'insurance.rcv_amount', label: 'RCV Amount', category: 'Insurance' },
  
  // Company
  { path: 'company.name', label: 'Company Name', category: 'Company' },
  { path: 'company.phone', label: 'Company Phone', category: 'Company' },
  { path: 'company.license', label: 'License Number', category: 'Company' },
  { path: 'company.website', label: 'Website', category: 'Company' },
];
