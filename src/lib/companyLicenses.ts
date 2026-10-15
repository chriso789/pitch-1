// Company licenses are stored in the existing `license_number` text column as
// "Type: Number | Type: Number" so every report that already prints the license
// shows all of them. A plain value without a type is a legacy single license.

export interface CompanyLicense {
  type: string;
  number: string;
}

export const LICENSE_TYPES = [
  "Roofing Contractor",
  "Certified General Contractor",
  "Certified Building Contractor",
  "Certified Residential Contractor",
  "Sheet Metal",
  "Solar",
  "Plumbing",
  "Electrical",
  "Mechanical / HVAC",
  "Pool / Spa",
  "Home Improvement",
  "Business / Occupational",
  "Other",
] as const;

export function parseLicenses(raw?: string | null): CompanyLicense[] {
  if (!raw || !raw.trim()) return [];
  return raw
    .split("|")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const idx = part.indexOf(":");
      if (idx === -1) return { type: "", number: part };
      return { type: part.slice(0, idx).trim(), number: part.slice(idx + 1).trim() };
    })
    .filter((l) => l.number);
}

export function serializeLicenses(list: CompanyLicense[]): string {
  return list
    .filter((l) => l.number.trim())
    .map((l) => {
      const num = l.number.replace(/[|]/g, "").trim();
      const type = l.type.replace(/[|:]/g, "").trim();
      return type ? `${type}: ${num}` : num;
    })
    .join(" | ");
}

/** Display line for reports, e.g. "License #CCC1334804" or
 * "Roofing Contractor Lic #CCC1334804 · Solar Lic #CVC57000". */
export function formatLicenseLine(raw?: string | null, prefix = "License #"): string {
  const list = parseLicenses(raw);
  if (list.length === 0) return "";
  if (list.length === 1 && !list[0].type) return `${prefix}${list[0].number}`;
  return list
    .map((l) => (l.type ? `${l.type} Lic #${l.number}` : `${prefix}${l.number}`))
    .join(" · ");
}
