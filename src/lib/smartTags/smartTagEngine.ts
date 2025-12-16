/**
 * Smart Tags Engine
 * Resolves dynamic placeholders in presentation content with CRM data
 */

export interface SmartTagDefinition {
  tag_key: string;
  category: string;
  description: string;
  data_source: string;
  field_path: string;
  default_value?: string;
  format_type: 'text' | 'currency' | 'date' | 'number' | 'phone';
}

export interface TagContext {
  contact?: Record<string, any>;
  tenant?: Record<string, any>;
  pipeline_entry?: Record<string, any>;
  estimate?: Record<string, any>;
  measurements?: Record<string, any>;
  project?: Record<string, any>;
}

// Format value based on type
function formatValue(value: any, formatType: string): string {
  if (value === null || value === undefined) return '';
  
  switch (formatType) {
    case 'currency':
      return new Intl.NumberFormat('en-US', { 
        style: 'currency', 
        currency: 'USD',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
      }).format(Number(value));
    
    case 'date':
      if (!value) return '';
      return new Date(value).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });
    
    case 'number':
      return new Intl.NumberFormat('en-US').format(Number(value));
    
    case 'phone':
      const cleaned = String(value).replace(/\D/g, '');
      if (cleaned.length === 10) {
        return `(${cleaned.slice(0, 3)}) ${cleaned.slice(3, 6)}-${cleaned.slice(6)}`;
      }
      return String(value);
    
    default:
      return String(value);
  }
}

// Get data source mapping
function getDataSourceKey(dataSource: string): keyof TagContext {
  const sourceMap: Record<string, keyof TagContext> = {
    'contacts': 'contact',
    'tenants': 'tenant',
    'pipeline_entries': 'pipeline_entry',
    'estimates': 'estimate',
    'measurements': 'measurements',
    'projects': 'project'
  };
  return sourceMap[dataSource] || 'project';
}

// Resolve a single tag value from context
export function resolveTagValue(
  tagKey: string,
  context: TagContext,
  tagDefinitions: SmartTagDefinition[]
): string {
  // Find tag definition
  const tagDef = tagDefinitions.find(t => t.tag_key === tagKey);
  
  if (!tagDef) {
    // Check for special tags
    if (tagKey === 'today') {
      return new Date().toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });
    }
    return `{{${tagKey}}}`; // Return unreplaced if not found
  }
  
  const sourceKey = getDataSourceKey(tagDef.data_source);
  const sourceData = context[sourceKey];
  
  if (!sourceData) {
    return tagDef.default_value || '';
  }
  
  // Handle compound field paths like "first_name || ' ' || last_name"
  let value: any;
  if (tagDef.field_path.includes('||')) {
    // SQL concatenation pattern - parse and evaluate
    const parts = tagDef.field_path.split('||').map(p => p.trim());
    value = parts.map(part => {
      if (part.startsWith("'") && part.endsWith("'")) {
        return part.slice(1, -1); // Literal string
      }
      return sourceData[part] || '';
    }).join('');
  } else {
    value = sourceData[tagDef.field_path];
  }
  
  if (value === null || value === undefined) {
    return tagDef.default_value || '';
  }
  
  return formatValue(value, tagDef.format_type);
}

// Replace all tags in content string
export function replaceAllTags(
  content: string,
  context: TagContext,
  tagDefinitions: SmartTagDefinition[]
): string {
  // Match {{tag.key}} pattern
  const tagPattern = /\{\{([^}]+)\}\}/g;
  
  return content.replace(tagPattern, (match, tagKey) => {
    const resolved = resolveTagValue(tagKey.trim(), context, tagDefinitions);
    return resolved || match; // Keep original if not resolved
  });
}

// Replace tags in a JSON object recursively
export function replaceTagsInObject(
  obj: any,
  context: TagContext,
  tagDefinitions: SmartTagDefinition[]
): any {
  if (typeof obj === 'string') {
    return replaceAllTags(obj, context, tagDefinitions);
  }
  
  if (Array.isArray(obj)) {
    return obj.map(item => replaceTagsInObject(item, context, tagDefinitions));
  }
  
  if (typeof obj === 'object' && obj !== null) {
    const result: Record<string, any> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = replaceTagsInObject(value, context, tagDefinitions);
    }
    return result;
  }
  
  return obj;
}

// Get list of unresolved/missing tags in content
export function getMissingTags(
  content: string,
  context: TagContext,
  tagDefinitions: SmartTagDefinition[]
): string[] {
  const tagPattern = /\{\{([^}]+)\}\}/g;
  const missingTags: string[] = [];
  
  let match;
  while ((match = tagPattern.exec(content)) !== null) {
    const tagKey = match[1].trim();
    const resolved = resolveTagValue(tagKey, context, tagDefinitions);
    
    // If it still has {{ }} it wasn't resolved, or if empty
    if (resolved.includes('{{') || resolved === '') {
      if (!missingTags.includes(tagKey)) {
        missingTags.push(tagKey);
      }
    }
  }
  
  return missingTags;
}

// Get all available tags grouped by category
export function getAvailableTagsByCategory(
  tagDefinitions: SmartTagDefinition[]
): Record<string, SmartTagDefinition[]> {
  return tagDefinitions.reduce((acc, tag) => {
    if (!acc[tag.category]) {
      acc[tag.category] = [];
    }
    acc[tag.category].push(tag);
    return acc;
  }, {} as Record<string, SmartTagDefinition[]>);
}
