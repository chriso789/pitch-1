// =========================================================
// Template Validation
// =========================================================

import { ValidationError } from "./types.ts";

export function validateTemplate(
  templateJson: any, 
  context: any, 
  resolved: { fieldValues: Record<string, any> }
): { errors: ValidationError[] } {
  const errors: ValidationError[] = [];
  const validations = Array.isArray(templateJson?.validations) ? templateJson.validations : [];

  // Process validation rules
  for (const v of validations) {
    if (!v?.key || !v?.message) continue;
    
    if (v?.when?.op === "is_empty" && v?.when?.value?.ref) {
      const val = getByPath(context, String(v.when.value.ref));
      const empty = val == null || (typeof val === "string" && val.trim() === "");
      if (empty) {
        errors.push({ 
          key: v.key, 
          severity: v.severity ?? "error", 
          message: v.message 
        });
      }
    }
  }

  // Check required fields
  const fields = Array.isArray(templateJson?.fields) ? templateJson.fields : [];
  for (const f of fields) {
    if (!f?.key || !f?.required) continue;
    const val = resolved?.fieldValues?.[f.key];
    const empty = val == null || (typeof val === "string" && val.trim() === "");
    if (empty) {
      errors.push({ 
        key: `required.${f.key}`, 
        severity: "error", 
        message: `${f.label ?? f.key} is required.` 
      });
    }
  }

  return { errors };
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
