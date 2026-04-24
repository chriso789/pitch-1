// =========================================================
// Calculation Expression Engine
// Supports: ref(), add(), sub(), mul(), div(), round(), 
//           coalesce(), if(), eq(), gt(), lt(), and(), or(), not(),
//           concat(), upper(), lower(), trim()
// =========================================================

type EvalResult = { value: any; errors: { key?: string; message: string }[] };

type Token =
  | { t: "ident"; v: string }
  | { t: "number"; v: number }
  | { t: "string"; v: string }
  | { t: "lpar" }
  | { t: "rpar" }
  | { t: "comma" };

export function evalExpr(expr: string, context: any): EvalResult {
  try {
    const tokens = tokenize(expr);
    const [node, idx] = parseExpr(tokens, 0);
    if (idx !== tokens.length) {
      return { value: null, errors: [{ message: "Unexpected trailing tokens" }] };
    }
    return { value: evalNode(node, context), errors: [] };
  } catch (e: any) {
    return { value: null, errors: [{ message: e?.message ?? "Expression error" }] };
  }
}

type Node =
  | { k: "lit"; v: any }
  | { k: "ref"; path: string }
  | { k: "call"; name: string; args: Node[] };

function tokenize(input: string): Token[] {
  const s = input.trim();
  const out: Token[] = [];
  let i = 0;

  const isAlpha = (c: string) => /[A-Za-z_]/.test(c);
  const isAlnum = (c: string) => /[A-Za-z0-9_]/.test(c);
  const isDigit = (c: string) => /[0-9]/.test(c);

  while (i < s.length) {
    const c = s[i];
    if (c === " " || c === "\n" || c === "\t" || c === "\r") {
      i++;
      continue;
    }
    if (c === "(") {
      out.push({ t: "lpar" });
      i++;
      continue;
    }
    if (c === ")") {
      out.push({ t: "rpar" });
      i++;
      continue;
    }
    if (c === ",") {
      out.push({ t: "comma" });
      i++;
      continue;
    }
    if (c === "'" || c === '"') {
      const quote = c;
      i++;
      let v = "";
      while (i < s.length && s[i] !== quote) {
        if (s[i] === "\\" && i + 1 < s.length) {
          v += s[i + 1];
          i += 2;
          continue;
        }
        v += s[i++];
      }
      if (s[i] !== quote) throw new Error("Unterminated string");
      i++;
      out.push({ t: "string", v });
      continue;
    }
    if (isDigit(c) || (c === "-" && isDigit(s[i + 1] ?? ""))) {
      let j = i + 1;
      while (j < s.length && /[0-9.]/.test(s[j])) j++;
      const num = Number(s.slice(i, j));
      if (Number.isNaN(num)) throw new Error("Invalid number");
      out.push({ t: "number", v: num });
      i = j;
      continue;
    }
    if (isAlpha(c)) {
      let j = i + 1;
      while (j < s.length && isAlnum(s[j])) j++;
      out.push({ t: "ident", v: s.slice(i, j) });
      i = j;
      continue;
    }
    throw new Error(`Unexpected char: ${c}`);
  }

  return out;
}

function parseExpr(tokens: Token[], i: number): [Node, number] {
  const tok = tokens[i];
  if (!tok) throw new Error("Unexpected end of input");

  if (tok.t === "number") return [{ k: "lit", v: tok.v }, i + 1];
  if (tok.t === "string") return [{ k: "lit", v: tok.v }, i + 1];

  if (tok.t === "ident") {
    const name = tok.v;
    const next = tokens[i + 1];
    if (!next || next.t !== "lpar") throw new Error("Expected '(' after function name");
    const [args, j] = parseArgs(tokens, i + 2);
    if (!tokens[j] || tokens[j].t !== "rpar") throw new Error("Expected ')'");
    if (name === "ref") {
      if (args.length !== 1 || args[0].k !== "lit" || typeof args[0].v !== "string") {
        throw new Error("ref() requires a single string literal");
      }
      return [{ k: "ref", path: args[0].v }, j + 1];
    }
    return [{ k: "call", name, args }, j + 1];
  }

  throw new Error("Invalid expression");
}

function parseArgs(tokens: Token[], i: number): [Node[], number] {
  const args: Node[] = [];
  let j = i;

  if (tokens[j] && tokens[j].t === "rpar") return [args, j];

  while (true) {
    const [node, k] = parseExpr(tokens, j);
    args.push(node);
    j = k;
    const t = tokens[j];
    if (!t) throw new Error("Unexpected end in args");
    if (t.t === "comma") {
      j++;
      continue;
    }
    if (t.t === "rpar") break;
    throw new Error("Expected ',' or ')'");
  }

  return [args, j];
}

function evalNode(node: Node, ctx: any): any {
  switch (node.k) {
    case "lit":
      return node.v;
    case "ref":
      return getByPath(ctx, node.path);
    case "call":
      return evalCall(node.name, node.args.map((a) => evalNode(a, ctx)));
  }
}

function getByPath(obj: any, path: string): any {
  const parts = path.split(".").map((p) => p.trim()).filter(Boolean);
  let cur = obj;
  for (const p of parts) {
    if (cur == null) return null;
    cur = cur[p];
  }
  return cur ?? null;
}

function evalCall(name: string, args: any[]): any {
  const fn = FUNCTIONS[name];
  if (!fn) throw new Error(`Unknown function: ${name}`);
  return fn(args);
}

const FUNCTIONS: Record<string, (args: any[]) => any> = {
  // Math
  add: (a) => a.reduce((s, v) => s + num(v), 0),
  sub: (a) => num(a[0]) - num(a[1]),
  mul: (a) => a.reduce((s, v) => s * num(v), 1),
  div: (a) => {
    const den = num(a[1]);
    if (den === 0) throw new Error("Divide by zero");
    return num(a[0]) / den;
  },
  round: (a) => {
    const x = num(a[0]);
    const d = a.length > 1 ? num(a[1]) : 0;
    const p = 10 ** d;
    return Math.round(x * p) / p;
  },
  ceil: (a) => Math.ceil(num(a[0])),
  floor: (a) => Math.floor(num(a[0])),
  abs: (a) => Math.abs(num(a[0])),

  // Utility
  coalesce: (a) => {
    for (const v of a) {
      if (v == null) continue;
      if (typeof v === "string" && v.trim() === "") continue;
      if (Array.isArray(v) && v.length === 0) continue;
      if (typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 0) continue;
      return v;
    }
    return null;
  },

  is_empty: (a) => {
    const v = a[0];
    if (v == null) return true;
    if (typeof v === "string") return v.trim() === "";
    if (Array.isArray(v)) return v.length === 0;
    if (typeof v === "object") return Object.keys(v).length === 0;
    return false;
  },

  // String
  concat: (a) => a.map((v) => (v == null ? "" : String(v))).join(""),
  upper: (a) => (a[0] == null ? null : String(a[0]).toUpperCase()),
  lower: (a) => (a[0] == null ? null : String(a[0]).toLowerCase()),
  trim: (a) => (a[0] == null ? null : String(a[0]).trim()),

  // Logic
  if: (a) => (truthy(a[0]) ? a[1] : a[2]),
  eq: (a) => a[0] === a[1],
  ne: (a) => a[0] !== a[1],
  gt: (a) => num(a[0]) > num(a[1]),
  gte: (a) => num(a[0]) >= num(a[1]),
  lt: (a) => num(a[0]) < num(a[1]),
  lte: (a) => num(a[0]) <= num(a[1]),
  and: (a) => a.every(truthy),
  or: (a) => a.some(truthy),
  not: (a) => !truthy(a[0]),
};

function num(v: any): number {
  if (v == null || v === "") return 0;
  const n = Number(v);
  if (Number.isNaN(n)) throw new Error("Expected number");
  return n;
}

function truthy(v: any): boolean {
  return !!v;
}
