// =========================================================
// Template Field Resolution
// =========================================================

import { evalExpr } from "./calc/expr.ts";

export function resolveFieldsAndCalcs(templateJson: any, context: any) {
  const fieldValues: Record<string, any> = {};
  const calcResults: Record<string, any> = {};
  const calcErrors: { key?: string; message: string }[] = [];

  const fields = Array.isArray(templateJson?.fields) ? templateJson.fields : [];

  // 1) Resolve source references first
  for (const f of fields) {
    const key = f?.key;
    if (!key) continue;
    if (f?.source?.ref) {
      fieldValues[key] = getByPath(context, String(f.source.ref));
    }
  }

  // 2) Apply calculations (override source values)
  for (const f of fields) {
    const key = f?.key;
    if (!key) continue;

    const expr = f?.calc?.expr;
    if (!expr) continue;

    const r = evalExpr(String(expr), context);
    if (r.errors.length) {
      calcErrors.push(...r.errors.map((e) => ({ key, message: e.message })));
      fieldValues[key] = null;
      continue;
    }
    fieldValues[key] = r.value;
    calcResults[key] = r.value;
  }

  return { fieldValues, calcResults, calcErrors };
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
