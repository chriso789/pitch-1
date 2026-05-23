// Reusable field transform utilities shared across adapters.

export const trim = (v: unknown) => (typeof v === "string" ? v.trim() : v);

export const titleCase = (v: unknown) => {
  if (typeof v !== "string") return v;
  return v.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
};

export function normalizePhone(v: unknown): string | null {
  if (v == null) return null;
  const digits = String(v).replace(/\D+/g, "");
  if (!digits) return null;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return `+${digits}`;
}

export function normalizeEmail(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim().toLowerCase();
  return /^\S+@\S+\.\S+$/.test(s) ? s : null;
}

export function normalizeAddress(parts: { line1?: unknown; line2?: unknown; city?: unknown; state?: unknown; zip?: unknown }) {
  const line1 = (parts.line1 ?? "").toString().trim();
  const line2 = (parts.line2 ?? "").toString().trim();
  const city  = (parts.city  ?? "").toString().trim();
  const state = (parts.state ?? "").toString().trim().toUpperCase();
  const zip   = (parts.zip   ?? "").toString().trim();
  return { line1, line2, city, state, zip };
}

export function parseCurrency(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(String(v).replace(/[^\d.\-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

export function parsePercentage(v: unknown): number | null {
  if (v == null || v === "") return null;
  const s = String(v).replace(/[^\d.\-]/g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function parseDate(v: unknown): string | null {
  if (v == null || v === "") return null;
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function splitFullName(v: unknown): { first_name: string; last_name: string } {
  const s = (v ?? "").toString().trim();
  if (!s) return { first_name: "", last_name: "" };
  const parts = s.split(/\s+/);
  return { first_name: parts[0], last_name: parts.slice(1).join(" ") };
}

export function combineName(first: unknown, last: unknown): string {
  return [first, last].map((x) => (x ?? "").toString().trim()).filter(Boolean).join(" ");
}

/** Apply a status map (loaded from import_status_maps) to a source status value. */
export function applyStatusMap(map: Record<string, string>, source: string | undefined | null): string | null {
  if (!source) return null;
  return map[source] ?? map[source.toLowerCase()] ?? source;
}

/** Look up a Pitch user id from import_user_maps payload. */
export function applyUserMap(
  map: Array<{ source_user_name?: string | null; source_user_email?: string | null; pitch_user_id?: string | null }>,
  source: { name?: string; email?: string },
): string | null {
  const hit = map.find((m) =>
    (source.email && m.source_user_email && m.source_user_email.toLowerCase() === source.email.toLowerCase()) ||
    (source.name  && m.source_user_name  && m.source_user_name.toLowerCase()  === source.name.toLowerCase())
  );
  return hit?.pitch_user_id ?? null;
}

export type TransformId =
  | "trim" | "title_case" | "normalize_phone" | "normalize_email"
  | "parse_currency" | "parse_percentage" | "parse_date"
  | "split_full_name" | "combine_name";

export function applyTransform(id: TransformId, v: unknown): unknown {
  switch (id) {
    case "trim": return trim(v);
    case "title_case": return titleCase(v);
    case "normalize_phone": return normalizePhone(v);
    case "normalize_email": return normalizeEmail(v);
    case "parse_currency": return parseCurrency(v);
    case "parse_percentage": return parsePercentage(v);
    case "parse_date": return parseDate(v);
    case "split_full_name": return splitFullName(v);
    default: return v;
  }
}
