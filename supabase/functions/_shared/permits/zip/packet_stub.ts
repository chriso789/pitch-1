// =========================================================
// Packet ZIP Stub
// Creates a zip-like byte payload (NOT a real ZIP yet)
// =========================================================

export async function generatePacketZipStub(
  _supabase: any,
  args: { tenant_id: string; permit_case_id: string; basePath: string; manifest: any },
): Promise<Uint8Array> {
  const text = `PERMIT PACKET (STUB ZIP)\n\nMANIFEST:\n${JSON.stringify(args.manifest, null, 2)}\n`;
  return new TextEncoder().encode(text);
}
