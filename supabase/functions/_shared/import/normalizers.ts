// Normalizers: convert source row + field map into normalized Pitch shape.

export function normalizeRow(
  raw: Record<string, unknown>,
  fieldMap: Record<string, string>, // sourceField -> pitchField
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [src, val] of Object.entries(raw)) {
    const pitch = fieldMap[src];
    if (!pitch) continue;
    if (val == null || val === "") continue;
    out[pitch] = val;
  }
  // Derive full_name if only first/last present
  if (!out.full_name && (out.first_name || out.last_name)) {
    out.full_name = [out.first_name, out.last_name].filter(Boolean).join(" ").trim();
  }
  // Normalize phone digits-only secondary form
  if (typeof out.phone === "string") {
    const digits = (out.phone as string).replace(/\D/g, "");
    if (digits.length >= 10) out.phone_digits = digits.slice(-10);
  }
  return out;
}

export function normalizeAddress(addr?: string): string {
  if (!addr) return "";
  return String(addr).toLowerCase().replace(/[.,#]/g, "").replace(/\s+/g, " ").trim();
}
