/**
 * Template Engine for Smart Tag Substitution
 * Supports: {{ roof.squares }}, {{ ceil(lf.ridge / 33) }}, {{ roof.squares * 3 }}
 * Safe expression evaluation with limited Math functions
 */

type Context = { tags: Record<string, any> };

const SAFE_FUNCTIONS = {
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
  const vars: Record<string, any> = {};
  
  // Flatten tags into vars
  Object.entries(ctx.tags || {}).forEach(([key, value]) => {
    vars[key] = value;
  });

  // Replace dotted identifiers with vars access
  const rewritten = expr.replace(/[a-zA-Z_][\w\.]*/g, (name) => {
    // Keep safe function names
    if (name in SAFE_FUNCTIONS) return name;
    
    // Keep numeric literals
    if (/^\d+(\.\d+)?$/.test(name)) return name;
    
    // Replace tag references: roof.squares -> vars["roof.squares"]
    return `vars[${JSON.stringify(name)}]`;
  });

  try {
    // Limited eval via Function sandbox
    const fn = new Function(
      'vars', 'ceil', 'floor', 'round', 'min', 'max', 'abs',
      `return (${rewritten});`
    );
    
    const result = fn(
      vars,
      SAFE_FUNCTIONS.ceil,
      SAFE_FUNCTIONS.floor,
      SAFE_FUNCTIONS.round,
      SAFE_FUNCTIONS.min,
      SAFE_FUNCTIONS.max,
      SAFE_FUNCTIONS.abs
    );

    return result;
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
