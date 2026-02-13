// supabase/functions/_shared/public_data/sources/batchleads/fallback.ts

import { PublicPropertyResult, NormalizedLocation } from "../../types.ts";

/**
 * BatchLeads fallback enrichment.
 * Only called when confidence < 70 or owner/mailing data is missing.
 * Requires BATCHLEADS_API_KEY secret.
 * Never overwrites validated public data (merge handles priority).
 */
export async function batchLeadsFallback(input: {
  loc: NormalizedLocation;
  timeoutMs: number;
}): Promise<Partial<PublicPropertyResult> | null> {
  const apiKey = Deno.env.get("BATCHLEADS_API_KEY");
  if (!apiKey) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs);

  try {
    const res = await fetch("https://api.batchleads.io/v1/property/lookup", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        address: input.loc.normalized_address,
      }),
      signal: controller.signal,
    });

    if (!res.ok) return null;
    const data = await res.json();
    if (!data?.property) return null;

    return {
      owner_name: data.property.owner_name ?? undefined,
      owner_mailing_address: data.property.mailing_address ?? undefined,
      last_sale_date: data.property.last_sale_date ?? undefined,
      last_sale_amount: data.property.last_sale_price ? Number(data.property.last_sale_price) : undefined,
      mortgage_lender: data.property.mortgage_lender ?? undefined,
      parcel_id: data.property.parcel_id ?? undefined,
    };
  } catch (e) {
    console.error("[BatchLeads fallback error]", e);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
