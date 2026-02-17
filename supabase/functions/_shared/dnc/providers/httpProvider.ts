// supabase/functions/_shared/dnc/providers/httpProvider.ts
// Real DNC provider stub — configure DNC_PROVIDER_URL + DNC_PROVIDER_API_KEY secrets

export async function scrubPhonesHttp(
  phones_e164: string[],
): Promise<Record<string, { is_dnc: boolean | null; is_wireless: boolean | null; source?: string }>> {
  const url = Deno.env.get("DNC_PROVIDER_URL");
  const key = Deno.env.get("DNC_PROVIDER_API_KEY");
  if (!url || !key) throw new Error("DNC provider not configured");

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ phones: phones_e164 }),
  });

  const json = await res.json();
  if (!res.ok) throw new Error(`DNC provider error: ${res.status}`);

  return json.results as Record<string, { is_dnc: boolean | null; is_wireless: boolean | null; source?: string }>;
}
