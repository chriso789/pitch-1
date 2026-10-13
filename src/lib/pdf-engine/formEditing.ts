import { PDFDocument, PDFTextField, PDFCheckBox, PDFDropdown, PDFRadioGroup, PDFSignature } from 'pdf-lib';

export interface EditablePdfField { name: string; kind: 'text' | 'checkbox' | 'choice' | 'unsupported'; value: string | boolean; options?: string[]; readOnly: boolean }
export async function readPdfFields(bytes: Uint8Array): Promise<EditablePdfField[]> {
  const doc = await PDFDocument.load(bytes.slice(), { updateMetadata: false });
  return doc.getForm().getFields().map(field => {
    const name = field.getName(), readOnly = field.isReadOnly();
    if (field instanceof PDFTextField) return { name, kind: 'text', value: field.getText() ?? '', readOnly };
    if (field instanceof PDFCheckBox) return { name, kind: 'checkbox', value: field.isChecked(), readOnly };
    if (field instanceof PDFDropdown) return { name, kind: 'choice', value: field.getSelected()[0] ?? '', options: field.getOptions(), readOnly: readOnly || field.isMultiselect() };
    if (field instanceof PDFRadioGroup) return { name, kind: 'choice', value: field.getSelected() ?? '', options: field.getOptions(), readOnly };
    return { name, kind: 'unsupported', value: field instanceof PDFSignature ? 'Digital signature — signing unavailable' : 'Unsupported field type', readOnly: true };
  });
}

/** Genuine AcroForm values only. Existing page text/fonts are untouched. */
export async function savePdfFields(bytes: Uint8Array, values: Record<string, string | boolean>): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes.slice(), { updateMetadata: false });
  const form = doc.getForm();
  for (const [name, value] of Object.entries(values)) {
    const field = form.getField(name);
    if (field.isReadOnly()) throw new Error(`Field ${name} is read-only`);
    if (field instanceof PDFTextField && typeof value === 'string') field.setText(value);
    else if (field instanceof PDFCheckBox && typeof value === 'boolean') value ? field.check() : field.uncheck();
    else if ((field instanceof PDFDropdown || field instanceof PDFRadioGroup) && typeof value === 'string') {
      if (!field.getOptions().includes(value)) throw new Error(`Invalid choice for ${name}`);
      field.select(value);
    } else throw new Error(`Unsupported value or field: ${name}`);
  }
  // Default form appearance generation is WinAnsi; never silently drop unsupported characters.
  try { form.updateFieldAppearances(); }
  catch { throw new Error('These field values cannot be rendered with the available form font. No file was saved.'); }
  const out = await doc.save();
  const verified = await readPdfFields(out);
  for (const [name, value] of Object.entries(values)) if (verified.find(f => f.name === name)?.value !== value) throw new Error(`Saved field verification failed: ${name}`);
  return out;
}