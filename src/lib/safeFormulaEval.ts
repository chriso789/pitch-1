/**
 * Safe formula evaluation using expr-eval.
 * Replaces all eval() / new Function() usage for user-controlled formulas.
 * Only allows arithmetic operations and whitelisted math functions.
 */
import { Parser } from 'expr-eval';

const parser = new Parser({
  operators: {
    add: true,
    concatenate: false,
    conditional: true,
    divide: true,
    factorial: false,
    multiply: true,
    power: true,
    remainder: true,
    subtract: true,
    logical: false,
    comparison: true,
    'in': false,
    assignment: false,
  },
});

// Whitelist only safe math functions
const SAFE_FUNCTIONS: Record<string, (...args: number[]) => number> = {
  ceil: Math.ceil,
  floor: Math.floor,
  round: Math.round,
  min: Math.min,
  max: Math.max,
  abs: Math.abs,
  sqrt: Math.sqrt,
};

/**
 * Evaluate a formula string with measurement variables.
 * Supports {{ measure.key }} template syntax and bare variable names.
 * Returns 0 on any error.
 */
export function safeEvalFormula(
  formula: string,
  variables: Record<string, number | undefined>
): number {
  try {
    // Replace {{ measure.key }} template syntax with variable names
    let expr = formula.replace(/\{\{\s*measure\.(\w+)\s*\}\}/g, (_, key) => {
      return `_${key}`;
    });

    // Also handle {{ key }} syntax
    expr = expr.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key) => {
      return `_${key}`;
    });

    // Build variables object with underscore prefix to avoid collisions
    const vars: Record<string, any> = { ...SAFE_FUNCTIONS };
    for (const [key, value] of Object.entries(variables)) {
      vars[`_${key}`] = value ?? 0;
      vars[key] = value ?? 0; // Also allow bare names
    }

    const parsed = parser.parse(expr);
    const result = parsed.evaluate(vars);

    return typeof result === 'number' && !isNaN(result) && isFinite(result)
      ? Math.max(0, result)
      : 0;
  } catch {
    return 0;
  }
}
