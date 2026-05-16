// ============================================================
// Deterministic fingerprint for normalized scope items.
// Pure helper, kept separate so it can be imported by both
// the parser (no canonical mapping available yet) and the
// normalizer (full canonical key available).
// ============================================================

async function sha1Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest('SHA-1', data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

const round = (v: number | null | undefined, digits = 2): string => {
  if (v === null || v === undefined || !Number.isFinite(v)) return '_';
  const p = Math.pow(10, digits);
  return String(Math.round(v * p) / p);
};

export interface FingerprintInput {
  canonical_key: string;
  unit: string | null;
  section_name: string | null;
  line_number: number | null;
  quantity: number | null;
  total_rcv: number | null;
}

export async function fingerprintScopeItem(input: FingerprintInput): Promise<string> {
  const parts = [
    input.canonical_key || '_',
    (input.unit || '_').toUpperCase(),
    (input.section_name || '_').toUpperCase(),
    input.line_number != null ? String(input.line_number) : '_',
    round(input.quantity, 2),
    round(input.total_rcv, 2),
  ];
  return await sha1Hex(parts.join('|'));
}
