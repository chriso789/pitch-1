/**
 * Smart Tags Parser
 * Full-featured template parser with conditionals, loops, pipes, and fallbacks
 */

import { applyPipe, escapeHtml } from './formatPipes';
import { isValidTag, getTagDefinition } from './tagRegistry';

export interface SmartTagContext {
  company?: Record<string, any>;
  user?: Record<string, any>;
  contact?: Record<string, any>;
  lead?: Record<string, any>;
  job?: Record<string, any>;
  property?: Record<string, any>;
  estimate?: Record<string, any>;
  estimates?: Record<string, any>[];
  measurements?: Record<string, any>[];
  packet?: Record<string, any>;
  signature?: Record<string, any>;
  [key: string]: any;
}

interface ParsedPipe {
  name: string;
  arg?: string;
}

interface ParsedTag {
  fullMatch: string;
  path: string;
  fallbacks: string[];
  pipes: ParsedPipe[];
}

// Parse a tag expression like: {contact.name ?? lead.name ?? "Unknown" | title}
function parseTagExpression(expr: string): ParsedTag {
  const result: ParsedTag = {
    fullMatch: expr,
    path: '',
    fallbacks: [],
    pipes: [],
  };

  // Split by pipe operator (but not inside quotes)
  const pipeRegex = /\|(?=(?:[^"]*"[^"]*")*[^"]*$)/;
  const parts = expr.split(pipeRegex).map(p => p.trim());
  
  // First part contains the path and fallbacks
  const pathPart = parts[0];
  
  // Parse fallback chain
  const fallbackRegex = /\?\?/g;
  const pathParts = pathPart.split(fallbackRegex).map(p => p.trim());
  
  result.path = pathParts[0];
  result.fallbacks = pathParts.slice(1);
  
  // Parse pipes
  for (let i = 1; i < parts.length; i++) {
    const pipePart = parts[i].trim();
    const colonIndex = pipePart.indexOf(':');
    
    if (colonIndex > 0) {
      const pipeName = pipePart.slice(0, colonIndex).trim();
      let pipeArg = pipePart.slice(colonIndex + 1).trim();
      // Remove quotes from argument
      if ((pipeArg.startsWith('"') && pipeArg.endsWith('"')) ||
          (pipeArg.startsWith("'") && pipeArg.endsWith("'"))) {
        pipeArg = pipeArg.slice(1, -1);
      }
      result.pipes.push({ name: pipeName, arg: pipeArg });
    } else {
      result.pipes.push({ name: pipePart });
    }
  }
  
  return result;
}

// Resolve a value from context using dot notation path
function resolveValue(context: SmartTagContext, path: string): any {
  // Handle string literals
  if ((path.startsWith('"') && path.endsWith('"')) ||
      (path.startsWith("'") && path.endsWith("'"))) {
    return path.slice(1, -1);
  }
  
  // Handle empty string literal
  if (path === '""' || path === "''") {
    return '';
  }

  // Handle array index notation like measurements[0].vendor
  const arrayMatch = path.match(/^(\w+)\[(\d+)\]\.(.+)$/);
  if (arrayMatch) {
    const [, arrayName, indexStr, propPath] = arrayMatch;
    const index = parseInt(indexStr, 10);
    const array = context[arrayName];
    if (Array.isArray(array) && array[index]) {
      return resolveValue({ item: array[index] }, `item.${propPath}`);
    }
    return undefined;
  }

  // Standard dot notation
  const parts = path.split('.');
  let value: any = context;
  
  for (const part of parts) {
    if (value === null || value === undefined) return undefined;
    value = value[part];
  }
  
  return value;
}

// Resolve a tag with fallbacks
function resolveTagValue(context: SmartTagContext, parsed: ParsedTag): string {
  // Try main path
  let value = resolveValue(context, parsed.path);
  
  // Try fallbacks
  if (value === null || value === undefined || value === '') {
    for (const fallback of parsed.fallbacks) {
      value = resolveValue(context, fallback.trim());
      if (value !== null && value !== undefined && value !== '') break;
    }
  }
  
  // Still no value? Return empty string
  if (value === null || value === undefined) {
    return '';
  }
  
  // Apply pipes or default formatting
  let result = String(value);
  
  if (parsed.pipes.length > 0) {
    for (const pipe of parsed.pipes) {
      result = applyPipe(result, pipe.name, pipe.arg);
    }
  } else {
    // Check for default format from tag definition
    const tagDef = getTagDefinition(parsed.path);
    if (tagDef?.defaultFormat) {
      result = applyPipe(result, tagDef.defaultFormat);
    }
    // Escape HTML by default if no 'raw' pipe
    if (!parsed.pipes.some(p => p.name === 'raw')) {
      result = escapeHtml(result);
    }
  }
  
  return result;
}

// Process conditional blocks: {#if condition}...{/if}
function processConditionals(template: string, context: SmartTagContext): string {
  const conditionalRegex = /\{#if\s+([^}]+)\}([\s\S]*?)\{\/if\}/g;
  
  return template.replace(conditionalRegex, (match, condition, content) => {
    const conditionPath = condition.trim();
    const value = resolveValue(context, conditionPath);
    
    // Truthy check
    if (value && value !== '' && value !== '0' && value !== 'false') {
      return content;
    }
    return '';
  });
}

// Process loop blocks: {#each items as item}...{/each}
function processLoops(template: string, context: SmartTagContext): string {
  const loopRegex = /\{#each\s+(\S+)\s+as\s+(\w+)\}([\s\S]*?)\{\/each\}/g;
  
  return template.replace(loopRegex, (match, arrayPath, itemVar, content) => {
    const array = resolveValue(context, arrayPath.trim());
    
    if (!Array.isArray(array) || array.length === 0) {
      return '';
    }
    
    return array.map((item, index) => {
      // Create a new context with the loop variable
      const loopContext = {
        ...context,
        [itemVar]: item,
        [`${itemVar}_index`]: index,
        [`${itemVar}_first`]: index === 0,
        [`${itemVar}_last`]: index === array.length - 1,
      };
      
      // Replace loop variable references in content
      return processBasicTags(content, loopContext);
    }).join('');
  });
}

// Process basic tags: {tag.path | pipe}
function processBasicTags(template: string, context: SmartTagContext): string {
  const tagRegex = /\{([^#/][^}]*)\}/g;
  
  return template.replace(tagRegex, (match, expr) => {
    const trimmedExpr = expr.trim();
    
    // Skip if it looks like a conditional or loop
    if (trimmedExpr.startsWith('#') || trimmedExpr.startsWith('/')) {
      return match;
    }
    
    try {
      const parsed = parseTagExpression(trimmedExpr);
      return resolveTagValue(context, parsed);
    } catch (error) {
      console.warn(`Failed to resolve tag: ${match}`, error);
      return match; // Return original if failed
    }
  });
}

// Main render function
export function renderTemplate(template: string, context: SmartTagContext): string {
  let result = template;
  
  // Process in order: conditionals → loops → basic tags
  result = processConditionals(result, context);
  result = processLoops(result, context);
  result = processBasicTags(result, context);
  
  return result;
}

// Validate template and find missing/invalid tags
export interface ValidationResult {
  valid: boolean;
  missingTags: string[];
  invalidTags: string[];
  warnings: string[];
}

export function validateTemplate(template: string, context: SmartTagContext): ValidationResult {
  const result: ValidationResult = {
    valid: true,
    missingTags: [],
    invalidTags: [],
    warnings: [],
  };

  // Find all tag expressions
  const tagRegex = /\{([^#/}]+)\}/g;
  let match;

  while ((match = tagRegex.exec(template)) !== null) {
    const expr = match[1].trim();
    const parsed = parseTagExpression(expr);
    
    // Check if tag is in registry
    if (!isValidTag(parsed.path)) {
      // Check if it's a loop variable (skip validation)
      const isLoopVar = /^\w+_index$|^\w+_first$|^\w+_last$/.test(parsed.path);
      if (!isLoopVar && !parsed.path.includes('[') && !parsed.fallbacks.length) {
        result.invalidTags.push(parsed.path);
        result.valid = false;
      }
    }
    
    // Check if value exists in context
    const value = resolveValue(context, parsed.path);
    if (value === undefined && parsed.fallbacks.length === 0) {
      result.missingTags.push(parsed.path);
    }
  }

  // Check conditional paths
  const conditionalRegex = /\{#if\s+([^}]+)\}/g;
  while ((match = conditionalRegex.exec(template)) !== null) {
    const condPath = match[1].trim();
    if (!isValidTag(condPath)) {
      result.warnings.push(`Conditional uses unregistered path: ${condPath}`);
    }
  }

  return result;
}

// Get all tags used in a template
export function extractTags(template: string): string[] {
  const tags: Set<string> = new Set();
  
  // Basic tags
  const tagRegex = /\{([^#/}]+)\}/g;
  let match;
  while ((match = tagRegex.exec(template)) !== null) {
    const parsed = parseTagExpression(match[1].trim());
    tags.add(parsed.path);
    parsed.fallbacks.forEach(f => {
      if (!f.startsWith('"') && !f.startsWith("'")) {
        tags.add(f.trim());
      }
    });
  }
  
  // Conditional paths
  const conditionalRegex = /\{#if\s+([^}]+)\}/g;
  while ((match = conditionalRegex.exec(template)) !== null) {
    tags.add(match[1].trim());
  }
  
  // Loop array paths
  const loopRegex = /\{#each\s+(\S+)\s+as/g;
  while ((match = loopRegex.exec(template)) !== null) {
    tags.add(match[1].trim());
  }
  
  return Array.from(tags);
}

// Preview a single tag value
export function previewTag(tagKey: string, context: SmartTagContext): string {
  const parsed = parseTagExpression(tagKey);
  return resolveTagValue(context, parsed);
}
