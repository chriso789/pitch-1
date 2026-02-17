// supabase/functions/_shared/public_data/sources/batchdata/skipTrace.ts
// BatchData Skip Trace adapter — returns unmasked emails, verified phones, structured names

import { retry } from "../../../utils/retry.ts";

export interface BatchDataPhone {
  number: string;
  type: string; // "Mobile", "Landline", "VoIP"
  dnc: boolean;
}

export interface BatchDataResult {
  firstName: string | null;
  lastName: string | null;
  phones: BatchDataPhone[];
  emails: string[];
  age: number | null;
  relatives: string[];
  raw: Record<string, unknown>;
}

/**
 * Call BatchData Skip Trace API by property address.
 * Uses BATCHDATA_API_KEY secret. Returns null if key missing or no results.
 */
export async function batchDataSkipTrace(input: {
  street: string;
  city: string;
  state: string;
  zip: string;
  timeoutMs?: number;
}): Promise<BatchDataResult | null> {
  const apiKey = Deno.env.get("BATCHDATA_API_KEY");
  if (!apiKey) {
    console.warn("[batchdata] BATCHDATA_API_KEY not configured");
    return null;
  }

  return retry(
    () => fetchBatchData(apiKey, input),
    { retries: 2, baseDelay: 800 },
  );
}

async function fetchBatchData(
  apiKey: string,
  input: { street: string; city: string; state: string; zip: string; timeoutMs?: number },
): Promise<BatchDataResult | null> {
  const controller = new AbortController();
  const timeoutMs = input.timeoutMs || 15000;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch("https://api.batchdata.com/api/v1/property/skip-trace", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        requests: [{
          propertyAddress: {
            street: input.street,
            city: input.city,
            state: input.state,
            zip: input.zip,
          },
        }],
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text();
      console.error(`[batchdata] API error ${res.status}: ${text.slice(0, 300)}`);
      throw new Error(`BatchData API error: ${res.status}`);
    }

    const data = await res.json();
    const results = data?.results?.persons || data?.results?.[0]?.persons || [];
    
    if (results.length === 0) {
      console.log("[batchdata] No persons found in response");
      return null;
    }

    const person = results[0];
    const name = person?.name || {};
    const phoneNumbers = person?.phoneNumbers || [];
    const emailAddresses = person?.emails || person?.emailAddresses || [];
    const associates = person?.associates || person?.relatives || [];

    const phones: BatchDataPhone[] = phoneNumbers
      .filter((p: any) => p?.number || p?.phoneNumber)
      .map((p: any) => ({
        number: p.number || p.phoneNumber,
        type: p.type || p.phoneType || "Unknown",
        dnc: p.dnc === true || p.doNotCall === true,
      }))
      .slice(0, 5);

    const emails: string[] = emailAddresses
      .map((e: any) => e.email || e.emailAddress || e)
      .filter((e: string) => typeof e === "string" && e.includes("@"))
      .slice(0, 5);

    const age = typeof person?.age === "number" ? person.age : null;

    const relatives: string[] = associates
      .map((a: any) => {
        if (typeof a === "string") return a;
        const n = a?.name || {};
        return [n.first, n.last].filter(Boolean).join(" ");
      })
      .filter((r: string) => r && r.length > 1)
      .slice(0, 10);

    console.log(`[batchdata] Found: ${name.first} ${name.last}, ${phones.length} phones, ${emails.length} emails, age=${age}`);

    return {
      firstName: name.first || null,
      lastName: name.last || null,
      phones,
      emails,
      age,
      relatives,
      raw: data,
    };
  } catch (e) {
    console.error("[batchdata] Error:", e);
    throw e; // let retry handle
  } finally {
    clearTimeout(timeout);
  }
}
