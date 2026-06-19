// Sensitive document data scrubber.
// Strips/masks SSN/EIN/TIN values from extracted document fields BEFORE storage.

const SSN_RE = /\b\d{3}-\d{2}-\d{4}\b/g;
const EIN_RE = /\b\d{2}-\d{7}\b/g;
const TAXID9_RE = /\b\d{9}\b/g;

const SENSITIVE_KEYS = new Set([
  "tin",
  "ssn",
  "ein",
  "tax_id",
  "taxid",
  "taxpayer_id",
  "federal_tax_id",
  "social_security_number",
  "employer_identification_number",
]);

function maskFromDigits(digits: string): string | null {
  const d = digits.replace(/\D/g, "");
  if (d.length < 4) return null;
  const last4 = d.slice(-4);
  if (d.length === 9) return `***-**-${last4}`;
  return `****${last4}`;
}

function scrubString(s: string): string {
  return s
    .replace(SSN_RE, "***-**-****")
    .replace(EIN_RE, "**-*******")
    .replace(TAXID9_RE, "*********");
}

export interface ScrubResult<T> {
  scrubbed: T;
  tin_present: boolean;
  tin_masked: string | null;
  removed_keys: string[];
  matched_patterns: string[];
}

export function scrubSensitiveDocumentData<T = any>(input: T): ScrubResult<T> {
  const removed_keys: string[] = [];
  const matched_patterns: string[] = [];
  let tin_present = false;
  let tin_masked: string | null = null;

  const recordMatchedFromString = (s: string) => {
    let m: RegExpMatchArray | null;
    if ((m = s.match(SSN_RE))) {
      tin_present = true;
      matched_patterns.push("ssn");
      if (!tin_masked) tin_masked = maskFromDigits(m[0]);
    }
    if ((m = s.match(EIN_RE))) {
      tin_present = true;
      matched_patterns.push("ein");
      if (!tin_masked) tin_masked = maskFromDigits(m[0]);
    }
    if ((m = s.match(TAXID9_RE))) {
      tin_present = true;
      matched_patterns.push("taxid9");
      if (!tin_masked) tin_masked = maskFromDigits(m[0]);
    }
  };

  const walk = (val: any, parentKey?: string): any => {
    if (val == null) return val;
    if (Array.isArray(val)) return val.map((v) => walk(v, parentKey));
    if (typeof val === "object") {
      const out: Record<string, any> = {};
      for (const [k, v] of Object.entries(val)) {
        const lk = k.toLowerCase();
        if (SENSITIVE_KEYS.has(lk)) {
          removed_keys.push(k);
          if (typeof v === "string") {
            tin_present = true;
            const mask = maskFromDigits(v);
            if (mask && !tin_masked) tin_masked = mask;
          } else if (v === true) {
            tin_present = true;
          }
          continue; // never store the raw value
        }
        out[k] = walk(v, k);
      }
      return out;
    }
    if (typeof val === "string") {
      recordMatchedFromString(val);
      return scrubString(val);
    }
    return val;
  };

  const scrubbed = walk(input);
  return { scrubbed, tin_present, tin_masked, removed_keys, matched_patterns };
}
