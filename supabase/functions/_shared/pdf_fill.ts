import { PDFDocument, PDFTextField, PDFCheckBox, PDFDropdown, PDFRadioGroup, StandardFonts } from 'npm:pdf-lib@1.17.1';
import { zipSync } from 'npm:fflate@0.8.3';

/** Fill real AcroForm fields; reject unfillable values rather than exporting a blank template. */
export async function fillPermitPdf(args: {
  supabase: any; template_pdf_bucket: string | null; template_pdf_path: string | null;
  field_values: Record<string, unknown>; field_map: Array<{ pdf_field: string; value_key: string }>;
}): Promise<Uint8Array> {
  if (!args.template_pdf_bucket || !args.template_pdf_path) throw new Error('Configure an authority PDF template before generating an application');
  const { data, error } = await args.supabase.storage.from(args.template_pdf_bucket).download(args.template_pdf_path);
  if (error || !data) throw error || new Error('Template could not be downloaded');
  const pdf = await PDFDocument.load(await data.arrayBuffer());
  const form = pdf.getForm();
  if (!args.field_map?.length) throw new Error('Configure the authority PDF field mapping');
  const resolved = Object.fromEntries(args.field_map.filter(mapping => args.field_values[mapping.value_key] != null).map(mapping => [mapping.pdf_field, args.field_values[mapping.value_key]]));
  if (!Object.keys(resolved).length) throw new Error('No application fields were resolved');
  for (const [key, value] of Object.entries(resolved)) {
    if (value == null) throw new Error(`Application value is missing: ${key}`);
    const field = form.getField(key);
    if (field instanceof PDFTextField) field.setText(String(value));
    else if (field instanceof PDFCheckBox) {
      if (value === true || value === 'true' || value === 'Yes' || value === '1') field.check();
      else if (value === false || value === 'false' || value === 'No' || value === '0' || value === '') field.uncheck();
      else throw new Error(`Invalid checkbox value: ${key}`);
    } else if (field instanceof PDFDropdown || field instanceof PDFRadioGroup) field.select(String(value));
    else throw new Error(`Unsupported application field: ${key}`);
  }
  form.updateFieldAppearances(await pdf.embedFont(StandardFonts.Helvetica));
  const bytes = await pdf.save();
  const verified = (await PDFDocument.load(bytes)).getForm();
  for (const [key, value] of Object.entries(resolved)) {
    const field = verified.getField(key);
    if (field instanceof PDFTextField && field.getText() !== String(value)) throw new Error(`Application field did not save: ${key}`);
    if (field instanceof PDFCheckBox && field.isChecked() !== (value === true || value === 'true' || value === 'Yes' || value === '1')) throw new Error(`Checkbox did not save: ${key}`);
    if (field instanceof PDFDropdown && !field.getSelected().includes(String(value))) throw new Error(`Selection did not save: ${key}`);
    if (field instanceof PDFRadioGroup && field.getSelected() !== String(value)) throw new Error(`Selection did not save: ${key}`);
  }
  return bytes;
}

export async function generateChecklistPdf(args: { permit_case_id: string; authority_name: string; required_attachments: string[]; available_attachments: string[] }): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  let page = pdf.addPage([612, 792]); let y = 744;
  const line = (text: string) => {
    // Wrap at words and bound each line to the usable page width.
    let current = '';
    for (const word of text.split(/\s+/)) {
      if (font.widthOfTextAtSize(word, 11) > 516) throw new Error('Checklist contains an overlong value');
      const next = current ? current + ' ' + word : word;
      if (font.widthOfTextAtSize(next, 11) > 516) { draw(current); current = word; } else current = next;
    }
    if (current) draw(current);
  };
  const draw = (text: string) => { if (y < 48) { page = pdf.addPage([612, 792]); y = 744; } page.drawText(text, { x: 48, y, font, size: 11 }); y -= 18; };
  line('Permit submission checklist'); line(args.authority_name); line(`Case: ${args.permit_case_id}`);
  for (const name of args.required_attachments) line(`${args.available_attachments.includes(name) ? '[Included]' : '[Missing]'} ${name}`);
  return pdf.save();
}

export async function permitAttachments(sb: any, tenantId: string, caseId: string) {
  const { data, error } = await sb.from('permit_documents').select('id, kind, title, storage_bucket, storage_path, created_at')
    .eq('tenant_id', tenantId).eq('permit_case_id', caseId).neq('kind', 'PERMIT_PACKET').order('created_at', { ascending: false });
  if (error) throw error;
  const seen = new Set<string>();
  return (data || []).filter((row: any) => { const key = `${row.kind}:${row.title}`; if (seen.has(key)) return false; seen.add(key); return true; });
}

export async function generatePermitPacket(sb: any, tenantId: string, caseId: string, required: string[]): Promise<Uint8Array> {
  const documents = await permitAttachments(sb, tenantId, caseId);
  for (const name of required) if (!documents.some((d: any) => d.kind === name || d.title === name)) throw new Error(`Required packet attachment missing: ${name}`);
  if (!documents.some((d: any) => d.kind === 'PERMIT_APPLICATION')) throw new Error('Generate the application before assembling the packet');
  const entries: Record<string, Uint8Array> = {}; let size = 0;
  for (const doc of documents) {
    const { data, error } = await sb.storage.from(doc.storage_bucket).download(doc.storage_path);
    if (error || !data) throw error || new Error(`Cannot read attachment: ${doc.title}`);
    const bytes = new Uint8Array(await data.arrayBuffer()); size += bytes.length;
    if (size > 50 * 1024 * 1024) throw new Error('Packet exceeds 50 MB');
    const extension = String(doc.storage_path).split('.').pop()?.replace(/[^a-z0-9]/gi, '') || 'bin';
    if (extension.toLowerCase() === 'pdf') await PDFDocument.load(bytes);
    entries[`${doc.id}-${String(doc.title).replace(/[^a-z0-9_-]/gi, '_')}.${extension}`] = bytes;
  }
  entries['manifest.json'] = new TextEncoder().encode(JSON.stringify({ permit_case_id: caseId, documents: documents.map((d: any) => ({ id: d.id, kind: d.kind, title: d.title })) }, null, 2));
  return zipSync(entries);
}
