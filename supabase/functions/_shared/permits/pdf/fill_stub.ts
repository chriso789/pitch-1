// =========================================================
// PDF Fill Stub
// Returns a PDF byte buffer (stub for now)
// =========================================================

export async function generateApplicationPdfStub(
  supabase: any,
  args: { tenant_id: string; template_json: any; field_values: Record<string, any> },
): Promise<Uint8Array> {
  const input = args.template_json?.outputs?.application_pdf?.input_pdf_storage;
  if (input?.bucket && input?.path) {
    // Try to download the PDF template from storage
    const { data, error } = await supabase.storage.from(input.bucket).download(input.path);
    if (!error && data) {
      const bytes = new Uint8Array(await data.arrayBuffer());
      // NOTE: Real implementation would fill PDF form fields
      // Stub: return template bytes as-is
      return bytes;
    }
  }

  // Fallback: create a "fake pdf" for pipeline testing
  const text = `PERMIT APPLICATION (STUB)\n\nFIELDS:\n${JSON.stringify(args.field_values, null, 2)}\n`;
  return new TextEncoder().encode(text);
}
