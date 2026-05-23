// Duplicate detection against live Pitch tables. Tenant-scoped.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { normalizeAddress } from "./normalizers.ts";

export type DupCandidate = {
  candidate_table: string;
  candidate_record_id: string;
  confidence: number;
  match_reasons: string[];
};

export async function findContactDuplicates(
  sb: SupabaseClient,
  tenant_id: string,
  normalized: Record<string, unknown>,
): Promise<DupCandidate[]> {
  const phone = (normalized.phone_digits as string) || null;
  const email = (normalized.email as string)?.toLowerCase() || null;
  const fullName = (normalized.full_name as string)?.toLowerCase() || null;
  const addr = normalizeAddress(normalized.property_address as string);

  const out: DupCandidate[] = [];
  const seen = new Map<string, DupCandidate>();

  const push = (id: string, reason: string, weight: number) => {
    const existing = seen.get(id);
    if (existing) {
      existing.match_reasons.push(reason);
      existing.confidence = Math.min(1, existing.confidence + weight);
    } else {
      const c = { candidate_table: "contacts", candidate_record_id: id, confidence: weight, match_reasons: [reason] };
      seen.set(id, c);
      out.push(c);
    }
  };

  try {
    if (phone) {
      const { data } = await sb
        .from("contacts")
        .select("id, phone, email, full_name, address")
        .eq("tenant_id", tenant_id)
        .ilike("phone", `%${phone}%`)
        .limit(5);
      (data ?? []).forEach((r: any) => push(r.id, "phone_match", 0.6));
    }
    if (email) {
      const { data } = await sb
        .from("contacts")
        .select("id")
        .eq("tenant_id", tenant_id)
        .ilike("email", email)
        .limit(5);
      (data ?? []).forEach((r: any) => push(r.id, "email_match", 0.5));
    }
    if (fullName && addr) {
      const { data } = await sb
        .from("contacts")
        .select("id, full_name, address")
        .eq("tenant_id", tenant_id)
        .ilike("full_name", fullName)
        .limit(10);
      (data ?? []).forEach((r: any) => {
        if (normalizeAddress(r.address) === addr) push(r.id, "name_and_address_match", 0.7);
      });
    }
  } catch (_e) {
    // Schema differences across tenants — soft fail and return what we have.
  }
  return out.filter((c) => c.confidence >= 0.5).sort((a, b) => b.confidence - a.confidence).slice(0, 5);
}

export async function findDuplicates(
  sb: SupabaseClient,
  tenant_id: string,
  entity_type: string,
  normalized: Record<string, unknown>,
): Promise<DupCandidate[]> {
  switch (entity_type) {
    case "contact":
    case "lead": return findContactDuplicates(sb, tenant_id, normalized);
    // Job/invoice duplicate detection deferred to Phase 2 (need to know target schema).
    default: return [];
  }
}
