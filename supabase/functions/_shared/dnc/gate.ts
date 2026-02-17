// supabase/functions/_shared/dnc/gate.ts
// DNC gate — annotate phones with callable/blocked status before UI

import type { PhoneCandidate } from "../types/contracts.ts";

export function applyDncGate(
  phones: PhoneCandidate[],
  dncMap: Record<string, { is_dnc: boolean | null; is_wireless: boolean | null }>,
): PhoneCandidate[] {
  return phones.map((p) => {
    const r = dncMap[p.number_e164];
    const isDnc = r?.is_dnc ?? null;
    const isWireless = r?.is_wireless ?? null;
    const callable = isDnc === true ? false : true;
    const reason = isDnc === true ? "dnc" : null;

    return {
      ...p,
      dnc: isDnc,
      wireless: isWireless,
      callable,
      reason_blocked: reason,
    };
  });
}
