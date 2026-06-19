// Shared CRM matching helpers for AI document extractions.
// Tenant-scoped: all queries MUST be invoked with admin client and we filter
// by tenant_id explicitly.

export type MatchTargetType = "contact" | "lead" | "pipeline_entry" | "job";

export interface MatchCandidate {
  target_type: MatchTargetType;
  target_id: string;
  score: number;
  matched_on: string[];
  display_label: string;
  current_values: Record<string, unknown>;
}

export interface MatchInputs {
  customer_name?: string | null;
  customer_email?: string | null;
  customer_phone?: string | null;
  property_address?: string | null;
  job_address?: string | null;
  owner_name?: string | null;
  // Pre-known links (high-weight)
  contact_id?: string | null;
  lead_id?: string | null;
  pipeline_entry_id?: string | null;
  job_id?: string | null;
}

export function normalizeEmail(v?: string | null): string | null {
  if (!v) return null;
  const s = String(v).trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? s : null;
}

export function normalizePhone(v?: string | null): string | null {
  if (!v) return null;
  const digits = String(v).replace(/\D/g, "");
  if (digits.length < 7) return null;
  // Strip US +1
  return digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
}

export function normalizeName(v?: string | null): string | null {
  if (!v) return null;
  return String(v)
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim() || null;
}

export function normalizeAddress(v?: string | null): string | null {
  if (!v) return null;
  return String(v)
    .toLowerCase()
    .replace(/\b(street|str\.?)\b/g, "st")
    .replace(/\b(avenue|ave\.?)\b/g, "ave")
    .replace(/\b(road|rd\.?)\b/g, "rd")
    .replace(/\b(drive|dr\.?)\b/g, "dr")
    .replace(/\b(boulevard|blvd\.?)\b/g, "blvd")
    .replace(/\b(suite|ste\.?|unit|apt\.?)\s*[\w-]+/g, "")
    .replace(/[.,#]/g, " ")
    .replace(/\s+/g, " ")
    .trim() || null;
}

function nameMatch(a?: string | null, b?: string | null): boolean {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const aw = new Set(na.split(" ").filter((w) => w.length > 1));
  const bw = new Set(nb.split(" ").filter((w) => w.length > 1));
  if (!aw.size || !bw.size) return false;
  let overlap = 0;
  for (const w of aw) if (bw.has(w)) overlap++;
  return overlap >= 2; // first + last
}

interface ContactRow {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  address_street: string | null;
  address_city: string | null;
  address_state: string | null;
  address_zip: string | null;
}

function contactName(c: ContactRow): string {
  return [c.first_name, c.last_name].filter(Boolean).join(" ").trim() || "(no name)";
}

function contactAddress(c: ContactRow): string {
  return [c.address_street, c.address_city, c.address_state, c.address_zip]
    .filter(Boolean).join(", ");
}

export async function findContactCandidates(
  admin: any,
  tenantId: string,
  inputs: MatchInputs,
): Promise<MatchCandidate[]> {
  const email = normalizeEmail(inputs.customer_email);
  const phone = normalizePhone(inputs.customer_phone);
  const nameQ = normalizeName(inputs.customer_name) ?? normalizeName(inputs.owner_name);
  const addrQ = normalizeAddress(inputs.property_address) ?? normalizeAddress(inputs.job_address);

  const ids = new Map<string, ContactRow>();
  const collect = (rows: ContactRow[] | null) => {
    for (const r of rows ?? []) if (!ids.has(r.id)) ids.set(r.id, r);
  };

  if (inputs.contact_id) {
    const { data } = await admin.from("contacts")
      .select("id,first_name,last_name,email,phone,address_street,address_city,address_state,address_zip")
      .eq("tenant_id", tenantId).eq("id", inputs.contact_id).limit(1);
    collect(data);
  }
  if (email) {
    const { data } = await admin.from("contacts")
      .select("id,first_name,last_name,email,phone,address_street,address_city,address_state,address_zip")
      .eq("tenant_id", tenantId).ilike("email", email).limit(10);
    collect(data);
  }
  if (phone) {
    const { data } = await admin.from("contacts")
      .select("id,first_name,last_name,email,phone,address_street,address_city,address_state,address_zip")
      .eq("tenant_id", tenantId).ilike("phone", `%${phone.slice(-7)}%`).limit(10);
    collect(data);
  }
  if (nameQ) {
    const lastWord = nameQ.split(" ").slice(-1)[0];
    if (lastWord && lastWord.length > 1) {
      const { data } = await admin.from("contacts")
        .select("id,first_name,last_name,email,phone,address_street,address_city,address_state,address_zip")
        .eq("tenant_id", tenantId).ilike("last_name", `%${lastWord}%`).limit(10);
      collect(data);
    }
  }
  if (addrQ) {
    const first = addrQ.split(" ").slice(0, 2).join(" ");
    if (first) {
      const { data } = await admin.from("contacts")
        .select("id,first_name,last_name,email,phone,address_street,address_city,address_state,address_zip")
        .eq("tenant_id", tenantId).ilike("address_street", `%${first}%`).limit(10);
      collect(data);
    }
  }

  const candidates: MatchCandidate[] = [];
  for (const c of ids.values()) {
    let score = 0;
    const matched: string[] = [];
    if (inputs.contact_id && inputs.contact_id === c.id) { score += 0.80; matched.push("contact_id"); }
    if (email && normalizeEmail(c.email) === email) { score += 0.40; matched.push("email"); }
    if (phone && normalizePhone(c.phone) === phone) { score += 0.35; matched.push("phone"); }
    if (addrQ && normalizeAddress(c.address_street) && normalizeAddress(c.address_street) === addrQ) {
      score += 0.50; matched.push("address");
    } else if (addrQ && c.address_street && normalizeAddress(c.address_street)?.startsWith(addrQ.split(" ").slice(0, 2).join(" "))) {
      score += 0.20; matched.push("address_partial");
    }
    if (nameQ && nameMatch(nameQ, contactName(c))) { score += 0.20; matched.push("name"); }
    if (score <= 0) continue;
    candidates.push({
      target_type: "contact",
      target_id: c.id,
      score: Math.min(1, score),
      matched_on: matched,
      display_label: `${contactName(c)} — ${contactAddress(c) || c.email || c.phone || ""}`.trim(),
      current_values: {
        name: contactName(c),
        email: c.email,
        phone: c.phone,
        address: contactAddress(c),
      },
    });
  }
  return candidates.sort((a, b) => b.score - a.score);
}

export async function findPipelineCandidates(
  admin: any,
  tenantId: string,
  inputs: MatchInputs,
  contactIds: string[],
): Promise<MatchCandidate[]> {
  const ids = new Map<string, any>();
  const collect = (rows: any[] | null) => {
    for (const r of rows ?? []) if (!ids.has(r.id)) ids.set(r.id, r);
  };

  const sel = "id,contact_id,lead_name,status,clj_formatted_number,contacts:contacts!pipeline_entries_contact_id_fkey(id,first_name,last_name,email,phone,address_street,address_city)";

  if (inputs.pipeline_entry_id) {
    const { data } = await admin.from("pipeline_entries").select(sel)
      .eq("tenant_id", tenantId).eq("id", inputs.pipeline_entry_id).limit(1);
    collect(data);
  }
  if (contactIds.length) {
    const { data } = await admin.from("pipeline_entries").select(sel)
      .eq("tenant_id", tenantId).in("contact_id", contactIds).limit(20);
    collect(data);
  }

  const candidates: MatchCandidate[] = [];
  for (const pe of ids.values()) {
    let score = 0;
    const matched: string[] = [];
    if (inputs.pipeline_entry_id === pe.id) { score += 0.80; matched.push("pipeline_entry_id"); }
    if (pe.contact_id && contactIds.includes(pe.contact_id)) { score += 0.40; matched.push("linked_contact"); }
    if (score <= 0) continue;
    const c = pe.contacts;
    candidates.push({
      target_type: "pipeline_entry",
      target_id: pe.id,
      score: Math.min(1, score),
      matched_on: matched,
      display_label: `${pe.lead_name || pe.clj_formatted_number || "Pipeline entry"}${c ? " — " + [c.first_name, c.last_name].filter(Boolean).join(" ") : ""}`,
      current_values: {
        status: pe.status,
        lead_name: pe.lead_name,
        contact_id: pe.contact_id,
      },
    });
  }
  return candidates.sort((a, b) => b.score - a.score);
}

export async function findJobCandidates(
  admin: any,
  tenantId: string,
  inputs: MatchInputs,
  contactIds: string[],
): Promise<MatchCandidate[]> {
  const candidates: MatchCandidate[] = [];
  if (inputs.job_id) {
    const { data } = await admin.from("jobs").select("id,name,job_number,contact_id,pipeline_entry_id,address_street")
      .eq("tenant_id", tenantId).eq("id", inputs.job_id).limit(1);
    for (const j of data ?? []) {
      candidates.push({
        target_type: "job", target_id: j.id, score: 0.80, matched_on: ["job_id"],
        display_label: `${j.name || j.job_number || "Job"}`,
        current_values: { contact_id: j.contact_id, pipeline_entry_id: j.pipeline_entry_id, address: j.address_street },
      });
    }
  }
  if (contactIds.length) {
    const { data } = await admin.from("jobs").select("id,name,job_number,contact_id,pipeline_entry_id,address_street")
      .eq("tenant_id", tenantId).in("contact_id", contactIds).limit(10);
    for (const j of data ?? []) {
      if (candidates.some((c) => c.target_id === j.id)) continue;
      candidates.push({
        target_type: "job", target_id: j.id, score: 0.40, matched_on: ["linked_contact"],
        display_label: `${j.name || j.job_number || "Job"}`,
        current_values: { contact_id: j.contact_id, pipeline_entry_id: j.pipeline_entry_id, address: j.address_street },
      });
    }
  }
  return candidates.sort((a, b) => b.score - a.score);
}

export function confidenceBand(score: number): "strong" | "possible" | "weak" {
  if (score >= 0.85) return "strong";
  if (score >= 0.65) return "possible";
  return "weak";
}

export async function resolveTenantAccess(admin: any, userId: string, tenantId: string): Promise<boolean> {
  const { data: profile } = await admin.from("profiles")
    .select("tenant_id, active_tenant_id").eq("id", userId).maybeSingle();
  if (profile?.active_tenant_id === tenantId || profile?.tenant_id === tenantId) return true;
  const { data: isMaster } = await admin.rpc("has_role", { _user_id: userId, _role: "master" as any });
  return !!isMaster;
}
