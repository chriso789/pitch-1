// supabase/functions/_shared/dnc/normalize.ts
// Phone number normalization for DNC scrubbing

export function toE164US(raw: string): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}
