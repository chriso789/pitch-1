// Field alias map for auto-mapping source fields to Pitch fields.
// Lowercased, whitespace-collapsed comparison.

export const FIELD_ALIASES: Record<string, string[]> = {
  // Contact
  first_name: ["first name", "firstname", "first", "customer first name", "fname"],
  last_name: ["last name", "lastname", "last", "customer last name", "lname"],
  full_name: ["name", "customer name", "contact name", "homeowner", "client name", "owner name"],
  company_name: ["company", "company name", "organization", "business name"],
  phone: ["phone", "mobile", "cell", "phone number", "primary phone", "telephone", "cell phone"],
  secondary_phone: ["secondary phone", "alt phone", "alternate phone", "phone 2"],
  email: ["email", "email address", "primary email", "e-mail"],
  property_address: ["address", "job address", "property address", "site address", "service address", "street"],
  mailing_address: ["mailing address", "billing address"],
  city: ["city", "town"],
  state: ["state", "province", "region"],
  zip: ["zip", "zipcode", "zip code", "postal code", "postcode"],
  lead_source: ["source", "lead source", "campaign", "marketing source", "referral source"],
  pipeline_stage: ["stage", "status", "pipeline", "lead status", "pipeline stage"],
  assigned_user: ["assigned to", "owner", "sales rep", "rep", "assigned user"],
  tags: ["tags", "labels"],
  notes: ["notes", "comments", "description", "memo"],

  // Job / Project
  job_address: ["job address", "project address", "site address"],
  job_status: ["job status", "project status", "status"],
  project_type: ["project type", "job type", "type of work", "service"],
  roof_type: ["roof type", "roofing material", "material"],
  trade_type: ["trade", "trade type"],
  sales_rep: ["sales rep", "salesperson", "rep"],
  production_manager: ["production manager", "pm", "project manager"],
  sold_date: ["sold date", "date sold", "contract date"],
  completed_date: ["completed date", "completion date", "date completed"],
  contract_amount: ["contract amount", "sold price", "job total", "estimate total", "total contract"],
  claim_number: ["claim number", "claim #", "claim no"],
  insurance_carrier: ["insurance carrier", "insurance company", "carrier"],
  adjuster_name: ["adjuster", "adjuster name"],

  // Invoice
  invoice_number: ["invoice", "invoice number", "inv #", "invoice #", "inv number"],
  invoice_date: ["invoice date", "date invoiced", "date"],
  due_date: ["due date", "payment due"],
  subtotal: ["subtotal", "sub total"],
  tax: ["tax", "tax amount", "sales tax"],
  total: ["total", "invoice total", "amount", "amount due", "grand total"],
  amount_paid: ["amount paid", "paid", "payments"],
  balance_due: ["balance due", "balance", "outstanding"],

  // Budget
  material_cost: ["material cost", "materials", "material expense", "materials cost"],
  labor_cost: ["labor cost", "labor", "crew cost", "labor expense"],
  subcontractor_cost: ["subcontractor", "sub cost", "subcontractor cost", "subs"],
  permit_cost: ["permit", "permit cost", "permits"],
  commission_cost: ["commission", "commissions", "commission cost"],
  overhead_cost: ["overhead", "overhead cost"],
  gross_profit: ["gross profit", "profit", "net profit"],
  gross_margin_percent: ["gross margin", "margin", "margin percent", "gross margin %"],
};

const normalize = (s: string) =>
  s.toLowerCase().replace(/[_\-]+/g, " ").replace(/\s+/g, " ").trim();

/**
 * Given a list of source column headers, return a suggested mapping
 * { sourceField: pitchField } with confidence scores.
 */
export function suggestMapping(headers: string[]): Record<string, { pitch_field: string; confidence: number }> {
  const out: Record<string, { pitch_field: string; confidence: number }> = {};
  for (const h of headers) {
    const n = normalize(h);
    let best: { field: string; conf: number } | null = null;
    for (const [pitchField, aliases] of Object.entries(FIELD_ALIASES)) {
      for (const a of aliases) {
        const na = normalize(a);
        if (n === na) {
          best = { field: pitchField, conf: 1.0 };
          break;
        }
        if (n.includes(na) || na.includes(n)) {
          const conf = Math.min(na.length, n.length) / Math.max(na.length, n.length);
          if (!best || conf > best.conf) best = { field: pitchField, conf: conf * 0.8 };
        }
      }
      if (best?.conf === 1.0) break;
    }
    if (best && best.conf >= 0.5) {
      out[h] = { pitch_field: best.field, confidence: best.conf };
    }
  }
  return out;
}

/**
 * Heuristic guess of the entity type for a file based on its detected fields.
 */
export function guessEntityType(headers: string[]): string {
  const n = headers.map((h) => h.toLowerCase());
  const has = (kw: string) => n.some((h) => h.includes(kw));
  if (has("invoice")) return "invoice";
  if (has("material cost") || has("labor cost") || has("gross profit")) return "budget";
  if (has("job address") || has("project") || has("contract")) return "job";
  if (has("claim")) return "job";
  if (has("phone") || has("email") || has("first name") || has("last name")) return "contact";
  return "contact";
}
