// supabase/functions/_shared/dnc/providers/mockProvider.ts
// Default mock DNC provider — allows all phones (dev mode)
// Replace with httpProvider when real DNC service is configured

export async function scrubPhonesMock(
  phones_e164: string[],
): Promise<Record<string, { is_dnc: boolean | null; is_wireless: boolean | null; source?: string }>> {
  const out: Record<string, { is_dnc: boolean | null; is_wireless: boolean | null; source?: string }> = {};
  for (const p of phones_e164) {
    out[p] = { is_dnc: null, is_wireless: null, source: "mock" };
  }
  return out;
}
