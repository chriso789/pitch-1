// =========================================================
// Checklist PDF Stub
// =========================================================

export async function generateChecklistPdfStub(args: {
  permit_case_id: string;
  missing_items: any[];
  validation_errors: any[];
}): Promise<Uint8Array> {
  const text =
    `SUBMISSION CHECKLIST (STUB)\npermit_case_id: ${args.permit_case_id}\n\nMISSING ITEMS:\n` +
    `${JSON.stringify(args.missing_items, null, 2)}\n\nVALIDATION ERRORS:\n` +
    `${JSON.stringify(args.validation_errors, null, 2)}\n`;
  return new TextEncoder().encode(text);
}
