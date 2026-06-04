// Deterministic content hash for blueprint import sessions.
// Used to detect re-runs of the same source so we can supersede rather than
// duplicate. Hashes the normalized parser output, NOT raw OCR (which may be
// non-deterministic on image-based PDFs).

export async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function canonicalJsonString(obj: unknown): string {
  // Deterministic JSON: sort object keys recursively, omit undefined.
  function walk(v: unknown): unknown {
    if (v === null || typeof v !== "object") return v;
    if (Array.isArray(v)) return v.map(walk);
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      const val = (v as Record<string, unknown>)[k];
      if (val !== undefined) out[k] = walk(val);
    }
    return out;
  }
  return JSON.stringify(walk(obj));
}

export async function deterministicSessionHash(parts: {
  tenant_id: string;
  document_type: string;
  provider: string;
  normalized_extraction: unknown;
}): Promise<string> {
  const blob = canonicalJsonString({
    tenant_id: parts.tenant_id,
    document_type: parts.document_type,
    provider: parts.provider,
    normalized_extraction: parts.normalized_extraction,
  });
  return await sha256Hex(blob);
}
