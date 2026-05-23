// Validators for staged import records. Returns array of findings.
// Severity: 'error' blocks live import (Phase 2); 'warning' allowed; 'info' cosmetic.

export type Finding = {
  severity: "error" | "warning" | "info";
  field_name?: string;
  error_code: string;
  message: string;
  suggested_fix?: string;
  raw_value?: string;
};

const PHONE_RE = /^[\d\s\-\(\)\+\.]{7,20}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateContact(rec: Record<string, unknown>): Finding[] {
  const out: Finding[] = [];
  const name = (rec.first_name || rec.last_name || rec.full_name || rec.company_name) as string | undefined;
  if (!name) {
    out.push({ severity: "error", field_name: "name", error_code: "missing_name", message: "Contact has no name" });
  }
  const phone = rec.phone as string | undefined;
  if (!phone && !rec.email) {
    out.push({ severity: "error", field_name: "phone", error_code: "missing_contact_method", message: "No phone or email" });
  }
  if (phone && !PHONE_RE.test(String(phone))) {
    out.push({
      severity: "warning",
      field_name: "phone",
      error_code: "invalid_phone",
      message: `Phone "${phone}" not in expected format`,
      raw_value: String(phone),
      suggested_fix: "Strip non-digit characters and verify length",
    });
  }
  const email = rec.email as string | undefined;
  if (email && !EMAIL_RE.test(String(email))) {
    out.push({
      severity: "warning",
      field_name: "email",
      error_code: "invalid_email",
      message: `Email "${email}" is not valid`,
      raw_value: String(email),
    });
  }
  if (!rec.property_address && !rec.city) {
    out.push({ severity: "warning", field_name: "property_address", error_code: "missing_address", message: "No address provided" });
  }
  return out;
}

export function validateJob(rec: Record<string, unknown>): Finding[] {
  const out: Finding[] = [];
  if (!rec.job_address && !rec.customer_name) {
    out.push({ severity: "error", error_code: "missing_job_identity", message: "Job has no address or customer name" });
  }
  if (rec.contract_amount != null) {
    const n = Number(rec.contract_amount);
    if (Number.isNaN(n)) {
      out.push({ severity: "error", field_name: "contract_amount", error_code: "invalid_amount", message: "contract_amount not numeric" });
    } else if (n < 0) {
      out.push({ severity: "error", field_name: "contract_amount", error_code: "negative_amount", message: "contract_amount is negative" });
    }
  }
  for (const f of ["sold_date", "completed_date"]) {
    const v = rec[f];
    if (v && Number.isNaN(Date.parse(String(v)))) {
      out.push({ severity: "warning", field_name: f, error_code: "invalid_date", message: `${f} not parseable` });
    }
  }
  return out;
}

export function validateInvoice(rec: Record<string, unknown>): Finding[] {
  const out: Finding[] = [];
  if (!rec.invoice_number) {
    out.push({ severity: "error", field_name: "invoice_number", error_code: "missing_invoice_number", message: "No invoice number" });
  }
  const total = Number(rec.total ?? 0);
  if (Number.isNaN(total)) {
    out.push({ severity: "error", field_name: "total", error_code: "invalid_amount", message: "total not numeric" });
  } else if (total < 0) {
    out.push({ severity: "error", field_name: "total", error_code: "negative_amount", message: "total is negative" });
  }
  for (const f of ["invoice_date", "due_date"]) {
    const v = rec[f];
    if (v && Number.isNaN(Date.parse(String(v)))) {
      out.push({ severity: "warning", field_name: f, error_code: "invalid_date", message: `${f} not parseable` });
    }
  }
  return out;
}

export function validateBudget(rec: Record<string, unknown>): Finding[] {
  const out: Finding[] = [];
  for (const f of ["revenue", "material_cost", "labor_cost", "subcontractor_cost", "permit_cost", "commission_cost", "overhead_cost"]) {
    const v = rec[f];
    if (v == null || v === "") continue;
    const n = Number(v);
    if (Number.isNaN(n)) {
      out.push({ severity: "error", field_name: f, error_code: "invalid_amount", message: `${f} not numeric` });
    } else if (n < 0) {
      out.push({ severity: "warning", field_name: f, error_code: "negative_amount", message: `${f} is negative` });
    }
  }
  return out;
}

export function validateRecord(entity_type: string, normalized: Record<string, unknown>): Finding[] {
  switch (entity_type) {
    case "contact":
    case "lead": return validateContact(normalized);
    case "job":
    case "project": return validateJob(normalized);
    case "invoice": return validateInvoice(normalized);
    case "budget": return validateBudget(normalized);
    default: return [];
  }
}
