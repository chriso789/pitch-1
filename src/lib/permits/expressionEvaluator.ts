/**
 * Permit Template Expression Evaluator
 * 
 * A safe, sandboxed expression evaluator for permit template calculations.
 * Supports only whitelisted functions with no access to external code.
 * 
 * Grammar:
 * expr        := literal | ref_call | func_call
 * literal     := number | string | boolean | null
 * ref_call    := "ref" "(" string ")"
 * func_call   := ident "(" [expr ("," expr)*] ")"
 */

import type { EvalResult, PermitContext } from './types';

// ========================================
// TOKENIZER
// ========================================

type TokenType = 'ident' | 'string' | 'number' | 'lparen' | 'rparen' | 'comma' | 'boolean' | 'null';

interface Token {
  type: TokenType;
  value: string | number | boolean | null;
  position: number;
}

export function tokenize(expr: string): Token[] {
  const tokens: Token[] = [];
  let pos = 0;

  const skipWhitespace = () => {
    while (pos < expr.length && /\s/.test(expr[pos])) {
      pos++;
    }
  };

  const readString = (quote: string): string => {
    pos++; // Skip opening quote
    let value = '';
    while (pos < expr.length && expr[pos] !== quote) {
      if (expr[pos] === '\\' && pos + 1 < expr.length) {
        pos++;
        const escapeChar = expr[pos];
        if (escapeChar === 'n') value += '\n';
        else if (escapeChar === 't') value += '\t';
        else if (escapeChar === 'r') value += '\r';
        else value += escapeChar;
      } else {
        value += expr[pos];
      }
      pos++;
    }
    if (pos >= expr.length) {
      throw new Error(`Unterminated string at position ${pos}`);
    }
    pos++; // Skip closing quote
    return value;
  };

  const readNumber = (): number => {
    let numStr = '';
    const startPos = pos;
    
    if (expr[pos] === '-') {
      numStr += '-';
      pos++;
    }
    
    while (pos < expr.length && /[\d.]/.test(expr[pos])) {
      numStr += expr[pos];
      pos++;
    }
    
    const num = parseFloat(numStr);
    if (isNaN(num)) {
      throw new Error(`Invalid number at position ${startPos}`);
    }
    return num;
  };

  const readIdent = (): string => {
    let ident = '';
    while (pos < expr.length && /[a-zA-Z0-9_]/.test(expr[pos])) {
      ident += expr[pos];
      pos++;
    }
    return ident;
  };

  while (pos < expr.length) {
    skipWhitespace();
    if (pos >= expr.length) break;

    const char = expr[pos];
    const startPos = pos;

    if (char === '(') {
      tokens.push({ type: 'lparen', value: '(', position: startPos });
      pos++;
    } else if (char === ')') {
      tokens.push({ type: 'rparen', value: ')', position: startPos });
      pos++;
    } else if (char === ',') {
      tokens.push({ type: 'comma', value: ',', position: startPos });
      pos++;
    } else if (char === "'" || char === '"') {
      const value = readString(char);
      tokens.push({ type: 'string', value, position: startPos });
    } else if (/[\d]/.test(char) || (char === '-' && pos + 1 < expr.length && /[\d]/.test(expr[pos + 1]))) {
      const value = readNumber();
      tokens.push({ type: 'number', value, position: startPos });
    } else if (/[a-zA-Z_]/.test(char)) {
      const ident = readIdent();
      // Check for boolean/null literals
      if (ident === 'true') {
        tokens.push({ type: 'boolean', value: true, position: startPos });
      } else if (ident === 'false') {
        tokens.push({ type: 'boolean', value: false, position: startPos });
      } else if (ident === 'null') {
        tokens.push({ type: 'null', value: null, position: startPos });
      } else {
        tokens.push({ type: 'ident', value: ident, position: startPos });
      }
    } else {
      throw new Error(`Unexpected character '${char}' at position ${pos}`);
    }
  }

  return tokens;
}

// ========================================
// AST TYPES
// ========================================

type ASTNode =
  | { type: 'literal'; value: string | number | boolean | null }
  | { type: 'ref'; path: string }
  | { type: 'call'; fn: string; args: ASTNode[] };

// ========================================
// PARSER
// ========================================

export function parse(tokens: Token[]): ASTNode {
  let pos = 0;

  const peek = (): Token | undefined => tokens[pos];
  const consume = (): Token => tokens[pos++];

  const parseExpr = (): ASTNode => {
    const token = peek();
    
    if (!token) {
      throw new Error('Unexpected end of expression');
    }

    // Literals
    if (token.type === 'string' || token.type === 'number' || token.type === 'boolean' || token.type === 'null') {
      consume();
      return { type: 'literal', value: token.value };
    }

    // Function call or identifier
    if (token.type === 'ident') {
      const fnName = consume().value as string;
      
      // Expect '('
      const nextToken = peek();
      if (!nextToken || nextToken.type !== 'lparen') {
        throw new Error(`Expected '(' after function name '${fnName}'`);
      }
      consume(); // consume '('

      const args: ASTNode[] = [];
      
      // Parse arguments
      while (peek() && peek()!.type !== 'rparen') {
        args.push(parseExpr());
        
        // Check for comma or end
        const next = peek();
        if (next && next.type === 'comma') {
          consume(); // consume ','
        } else if (next && next.type !== 'rparen') {
          throw new Error(`Expected ',' or ')' but got '${next.type}'`);
        }
      }

      // Expect ')'
      if (!peek() || peek()!.type !== 'rparen') {
        throw new Error(`Expected ')' to close function '${fnName}'`);
      }
      consume(); // consume ')'

      // Special handling for ref() function
      if (fnName === 'ref') {
        if (args.length !== 1 || args[0].type !== 'literal' || typeof args[0].value !== 'string') {
          throw new Error("ref() requires exactly one string argument");
        }
        return { type: 'ref', path: args[0].value };
      }

      return { type: 'call', fn: fnName, args };
    }

    throw new Error(`Unexpected token type '${token.type}'`);
  };

  const ast = parseExpr();
  
  if (pos < tokens.length) {
    throw new Error(`Unexpected token after expression: ${tokens[pos].type}`);
  }

  return ast;
}

// ========================================
// REFERENCE RESOLVER
// ========================================

export function resolveRef(path: string, context: PermitContext): unknown {
  const parts = path.split('.');
  let value: unknown = context;

  for (const part of parts) {
    if (value == null) {
      return null;
    }
    if (typeof value !== 'object') {
      return null;
    }
    value = (value as Record<string, unknown>)[part];
  }

  return value;
}

// ========================================
// WHITELISTED FUNCTIONS
// ========================================

type FunctionImpl = (...args: unknown[]) => unknown;

const FUNCTION_MAP: Record<string, FunctionImpl> = {
  // ========== MATH ==========
  add: (...args: unknown[]): number | null => {
    const nums = args.filter((a): a is number => typeof a === 'number');
    if (nums.length === 0) return null;
    return nums.reduce((a, b) => a + b, 0);
  },

  sub: (a: unknown, b: unknown): number | null => {
    if (typeof a !== 'number' || typeof b !== 'number') return null;
    return a - b;
  },

  mul: (...args: unknown[]): number | null => {
    const nums = args.filter((a): a is number => typeof a === 'number');
    if (nums.length === 0) return null;
    return nums.reduce((a, b) => a * b, 1);
  },

  div: (a: unknown, b: unknown): number | null => {
    if (typeof a !== 'number' || typeof b !== 'number') return null;
    if (b === 0) return null; // Division by zero returns null
    return a / b;
  },

  round: (x: unknown, decimals: unknown = 0): number | null => {
    if (typeof x !== 'number') return null;
    const d = typeof decimals === 'number' ? decimals : 0;
    const multiplier = Math.pow(10, d);
    return Math.round(x * multiplier) / multiplier;
  },

  ceil: (x: unknown): number | null => {
    if (typeof x !== 'number') return null;
    return Math.ceil(x);
  },

  floor: (x: unknown): number | null => {
    if (typeof x !== 'number') return null;
    return Math.floor(x);
  },

  abs: (x: unknown): number | null => {
    if (typeof x !== 'number') return null;
    return Math.abs(x);
  },

  min: (...args: unknown[]): number | null => {
    const nums = args.filter((a): a is number => typeof a === 'number');
    if (nums.length === 0) return null;
    return Math.min(...nums);
  },

  max: (...args: unknown[]): number | null => {
    const nums = args.filter((a): a is number => typeof a === 'number');
    if (nums.length === 0) return null;
    return Math.max(...nums);
  },

  // ========== NULL/DEFAULT HANDLING ==========
  coalesce: (...args: unknown[]): unknown => {
    for (const arg of args) {
      if (arg != null && arg !== '') {
        return arg;
      }
    }
    return null;
  },

  is_null: (x: unknown): boolean => {
    return x == null;
  },

  is_empty: (x: unknown): boolean => {
    if (x == null) return true;
    if (x === '') return true;
    if (Array.isArray(x) && x.length === 0) return true;
    if (typeof x === 'object' && Object.keys(x).length === 0) return true;
    return false;
  },

  // ========== STRINGS ==========
  concat: (...args: unknown[]): string => {
    return args.map(a => String(a ?? '')).join('');
  },

  upper: (s: unknown): string | null => {
    if (s == null) return null;
    return String(s).toUpperCase();
  },

  lower: (s: unknown): string | null => {
    if (s == null) return null;
    return String(s).toLowerCase();
  },

  trim: (s: unknown): string | null => {
    if (s == null) return null;
    return String(s).trim();
  },

  // ========== PARSING ==========
  to_number: (x: unknown): number | null => {
    if (x == null) return null;
    const num = Number(x);
    return isNaN(num) ? null : num;
  },

  to_string: (x: unknown): string => {
    if (x == null) return '';
    return String(x);
  },

  // ========== CONDITIONALS ==========
  if: (cond: unknown, thenVal: unknown, elseVal: unknown): unknown => {
    return Boolean(cond) ? thenVal : elseVal;
  },

  // ========== COMPARISONS ==========
  eq: (a: unknown, b: unknown): boolean => a === b,
  ne: (a: unknown, b: unknown): boolean => a !== b,

  gt: (a: unknown, b: unknown): boolean => {
    if (typeof a !== 'number' || typeof b !== 'number') return false;
    return a > b;
  },

  gte: (a: unknown, b: unknown): boolean => {
    if (typeof a !== 'number' || typeof b !== 'number') return false;
    return a >= b;
  },

  lt: (a: unknown, b: unknown): boolean => {
    if (typeof a !== 'number' || typeof b !== 'number') return false;
    return a < b;
  },

  lte: (a: unknown, b: unknown): boolean => {
    if (typeof a !== 'number' || typeof b !== 'number') return false;
    return a <= b;
  },

  // ========== BOOLEAN ==========
  and: (...args: unknown[]): boolean => args.every(Boolean),
  or: (...args: unknown[]): boolean => args.some(Boolean),
  not: (a: unknown): boolean => !Boolean(a),
};

// ========================================
// EVALUATOR
// ========================================

function evaluate(
  node: ASTNode,
  context: PermitContext,
  errors: string[]
): unknown {
  switch (node.type) {
    case 'literal':
      return node.value;

    case 'ref':
      return resolveRef(node.path, context);

    case 'call': {
      const fn = FUNCTION_MAP[node.fn];
      if (!fn) {
        errors.push(`Unknown function: ${node.fn}`);
        return null;
      }

      // Evaluate all arguments first
      const args = node.args.map(arg => evaluate(arg, context, errors));

      try {
        const result = fn(...args);
        
        // Special error handling for div by zero
        if (node.fn === 'div' && result === null && args[1] === 0) {
          errors.push('Division by zero');
        }
        
        return result;
      } catch (e) {
        errors.push(`Error in function ${node.fn}: ${e instanceof Error ? e.message : String(e)}`);
        return null;
      }
    }

    default:
      errors.push(`Unknown node type`);
      return null;
  }
}

// ========================================
// MAIN EXPORT
// ========================================

/**
 * Evaluates a template expression against a permit context.
 * 
 * @example
 * // Simple math
 * evaluateExpression("round(div(ref('measurements.total_roof_area_sqft'), 100), 1)", context)
 * 
 * // Coalesce with fallback
 * evaluateExpression("coalesce(ref('parcel.owner_name'), ref('contact_owner.full_name'))", context)
 * 
 * // Conditional
 * evaluateExpression("if(gte(ref('estimate.contract_total'), 2500), 'REQUIRED', 'NOT_REQUIRED')", context)
 */
export function evaluateExpression(
  expr: string,
  context: PermitContext
): EvalResult {
  const errors: string[] = [];

  try {
    // Handle empty expressions
    if (!expr || expr.trim() === '') {
      return { value: null, errors: ['Empty expression'] };
    }

    const tokens = tokenize(expr);
    const ast = parse(tokens);
    const value = evaluate(ast, context, errors);

    return { value, errors };
  } catch (e) {
    return {
      value: null,
      errors: [e instanceof Error ? e.message : String(e)],
    };
  }
}

/**
 * Validates an expression without evaluating it.
 * Returns any syntax errors found.
 */
export function validateExpression(expr: string): string[] {
  const errors: string[] = [];

  try {
    if (!expr || expr.trim() === '') {
      return ['Empty expression'];
    }

    const tokens = tokenize(expr);
    parse(tokens);

    // Check for unknown functions
    const checkNode = (tokens: Token[]) => {
      for (const token of tokens) {
        if (token.type === 'ident' && typeof token.value === 'string') {
          const fnName = token.value;
          if (fnName !== 'ref' && !FUNCTION_MAP[fnName]) {
            errors.push(`Unknown function: ${fnName}`);
          }
        }
      }
    };
    checkNode(tokens);

  } catch (e) {
    errors.push(e instanceof Error ? e.message : String(e));
  }

  return errors;
}

/**
 * Get list of available functions for documentation
 */
export function getAvailableFunctions(): string[] {
  return Object.keys(FUNCTION_MAP);
}
