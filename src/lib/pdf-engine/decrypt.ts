import { PDFDocument } from 'pdf-lib';

/**
 * Opening protected PDFs for editing.
 * Many issued forms (e.g. ACORD certificates) are encrypted with an EMPTY open password and an
 * owner password that only sets permission flags. pdf-lib cannot parse their encrypted object
 * streams, so we decrypt locally with qpdf (WASM, free, Apache-2.0 core) — but only when the
 * document opens without a password. Password-protected files stay blocked. Nothing is uploaded.
 */
export interface EditableBytes { bytes: Uint8Array; decrypted: boolean }

let wasmUrlPromise: Promise<string> | null = null;
async function defaultWasmUrl(): Promise<string> {
  wasmUrlPromise ??= import('@neslinesli93/qpdf-wasm/dist/qpdf.wasm?url').then(m => m.default as string);
  return wasmUrlPromise;
}

export async function isEncryptedPdf(bytes: Uint8Array): Promise<boolean> {
  try { return (await PDFDocument.load(bytes.slice(), { ignoreEncryption: true, updateMetadata: false })).isEncrypted; }
  catch { // pdf-lib may fail before reporting; fall back to the trailer marker
    const tail = new TextDecoder('latin1').decode(bytes.subarray(Math.max(0, bytes.length - 4096)));
    const head = new TextDecoder('latin1').decode(bytes.subarray(0, Math.min(bytes.length, 4096)));
    return /\/Encrypt\s+\d+\s+\d+\s+R/.test(tail + head);
  }
}

export async function decryptPdf(bytes: Uint8Array, opts: { wasmPath?: string } = {}): Promise<Uint8Array> {
  const createModule = (await import('@neslinesli93/qpdf-wasm')).default as unknown as (a: Record<string, unknown>) => Promise<any>;
  const path = opts.wasmPath ?? await defaultWasmUrl();
  const qpdf = await createModule({ locateFile: () => path, noInitialRun: true, print: () => {}, printErr: () => {} });
  qpdf.FS.writeFile('/in.pdf', bytes);
  let code: number;
  try { code = qpdf.callMain(['--password=', '--decrypt', '/in.pdf', '/out.pdf']); }
  catch (e: any) { code = typeof e?.status === 'number' ? e.status : 2; }
  // qpdf: 0 = ok, 3 = ok with warnings (damaged xref repaired), 2 = error (e.g. password required)
  if (code !== 0 && code !== 3) throw new Error('This PDF needs a password to open, so it cannot be unlocked for editing.');
  const out = qpdf.FS.readFile('/out.pdf') as Uint8Array;
  const doc = await PDFDocument.load(out.slice(), { updateMetadata: false });
  if (doc.isEncrypted) throw new Error('The PDF is still encrypted after unlocking; editing is blocked.');
  doc.getPages(); // must now parse
  return out;
}

/** Return bytes that pdf-lib can genuinely parse and rewrite. Unencrypted input is returned untouched. */
export async function openForEditing(bytes: Uint8Array, opts: { wasmPath?: string } = {}): Promise<EditableBytes> {
  if (!(await isEncryptedPdf(bytes))) return { bytes, decrypted: false };
  return { bytes: await decryptPdf(bytes, opts), decrypted: true };
}
