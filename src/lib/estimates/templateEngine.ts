/**
 * Template Engine for Smart Tag Substitution
 * Supports: {{ roof.squares }}, {{ ceil(lf.ridge / 33) }}, {{ roof.squares * 3 }}
 * Uses expr-eval for safe expression evaluation (no eval/Function)
 */
import { Parser } from 'expr-eval';

type Context = { tags: Record<string, any> };

const parser = new Parser();

const SAFE_FUNCTIONS: Record<string, any> = {
  ceil: Math.ceil,
  floor: Math.floor,
  round: Math.round,
  min: Math.min,
  max: Math.max,
  abs: Math.abs,
};

export function renderTemplate(str: string, ctx: Context): string {
  return str.replace(/\{{\s*([^}]+)\s*\}\}/g, (_match, expr) => {
    try {
      const result = evalExpr(expr.trim(), ctx);
      return String(result);
    } catch (err) {
      console.error(`Template eval error for "${expr}":`, err);
      return `{{${expr}}}`;
    }
  });
}

function evalExpr(expr: string, ctx: Context): number | string {
  const vars: Record<string, any> = { ...SAFE_FUNCTIONS };
  
  // Flatten tags into vars, supporting both dotted and underscored keys
  Object.entries(ctx.tags || {}).forEach(([key, value]) => {
    vars[key] = value;
    vars[key.replace(/\./g, '_')] = value;
  });

  // Replace dotted identifiers with underscored versions for parser compatibility
  let rewritten = expr;
  const sortedKeys = Object.keys(ctx.tags || {}).sort((a, b) => b.length - a.length);
  for (const key of sortedKeys) {
    if (key.includes('.')) {
      const escaped = key.replace(/\./g, '\\.');
      rewritten = rewritten.replace(new RegExp(escaped, 'g'), key.replace(/\./g, '_'));
    }
  }

  try {
    const parsed = parser.parse(rewritten);
    return parsed.evaluate(vars);
  } catch (err) {
    throw new Error(`Evaluation failed: ${err}`);
  }
}

/**
 * Apply template to estimate line items
 * Replaces {{ }} tokens in qty fields with computed values
 */
export function applyTemplateItems(
  items: Array<{ name: string; qty: string | number; unit?: string }>,
  tags: Record<string, any>
): Array<{ name: string; qty: number; unit?: string }> {
  return items.map(item => {
    const qtyStr = String(item.qty);
    
    // If it's already a number, keep it
    if (!isNaN(Number(qtyStr)) && !qtyStr.includes('{{')) {
      return { ...item, qty: Number(qtyStr) };
    }

    // Otherwise, render the template
    const rendered = renderTemplate(qtyStr, { tags });
    const qty = Number(rendered);

    return {
      ...item,
      qty: isNaN(qty) ? 0 : qty
    };
  });
}
