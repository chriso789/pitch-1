import { PDFDocument, PDFName } from 'pdf-lib';

/**
 * Phase 2E — PDF protection, done locally with qpdf (WASM). Nothing is uploaded.
 * Every output is re-opened with qpdf to prove the protection actually works before it is returned.
 */
export interface Permissions { print: boolean; copy: boolean; modify: boolean; annotate: boolean; fillForms: boolean }
export const ALL_ALLOWED: Permissions = { print: true, copy: true, modify: true, annotate: true, fillForms: true };

export async function qpdfRun(args: string[], input: Uint8Array, wasmPath?: string): Promise<{ code: number; out?: Uint8Array }> {
  const createModule = (await import('@neslinesli93/qpdf-wasm')).default as unknown as (a: Record<string, unknown>) => Promise<any>;
  const path = wasmPath ?? new URL('/wasm/qpdf.wasm', window.location.origin).href;
  const q = await createModule({ locateFile: () => path, noInitialRun: true, print: () => {}, printErr: () => {} });
  q.FS.writeFile('/in.pdf', input);
  let code: number;
  try { code = q.callMain(args.map(a => a === '$IN' ? '/in.pdf' : a === '$OUT' ? '/out.pdf' : a)); }
  catch (e: any) { code = typeof e?.status === 'number' ? e.status : 2; }
  let out: Uint8Array | undefined;
  try { out = q.FS.readFile('/out.pdf'); } catch { /* none */ }
  return { code, out };
}
const ok = (c: number) => c === 0 || c === 3;

export function validatePasswords(openPw: string, ownerPw: string): string | null {
  if (!ownerPw || ownerPw.length < 8) return 'The permissions password must be at least 8 characters.';
  if (openPw && openPw === ownerPw) return 'Use different passwords for opening and for permissions.';
  if (openPw && openPw.length < 6) return 'The open password must be at least 6 characters.';
  if (/[^\x20-\x7E]/.test(openPw + ownerPw)) return 'Passwords can only use standard keyboard characters.';
  return null;
}

/** AES-256 encryption. Empty openPw = anyone can open, but restrictions still apply. */
export async function protectPdf(src: Uint8Array, openPw: string, ownerPw: string, perms: Permissions, opts: { wasmPath?: string } = {}): Promise<Uint8Array> {
  const bad = validatePasswords(openPw, ownerPw); if (bad) throw new Error(bad);
  const yn = (b: boolean) => (b ? 'y' : 'n');
  const r = await qpdfRun(['--encrypt', openPw, ownerPw, '256',
    `--print=${perms.print ? 'full' : 'none'}`, `--extract=${yn(perms.copy)}`,
    `--modify=${perms.modify ? 'all' : perms.annotate ? 'annotate' : perms.fillForms ? 'form' : 'none'}`,
    `--annotate=${yn(perms.annotate)}`, `--form=${yn(perms.fillForms)}`, '--', '$IN', '$OUT'], src, opts.wasmPath);
  if (!ok(r.code) || !r.out) throw new Error('Protection failed; no file was produced.');
  // Proof: the owner password must unlock it, and (when set) opening without the open password must fail.
  const own = await qpdfRun([`--password=${ownerPw}`, '--decrypt', '$IN', '$OUT'], r.out, opts.wasmPath);
  if (!ok(own.code)) throw new Error('Verification failed: the permissions password does not unlock the result.');
  if (openPw) {
    const none = await qpdfRun(['--password=', '--decrypt', '$IN', '$OUT'], r.out, opts.wasmPath);
    if (ok(none.code)) throw new Error('Verification failed: the file opened without its password.');
  }
  return r.out;
}

/** Removes protection when the user supplies a correct password. Wrong passwords never produce output. */
export async function unprotectPdf(src: Uint8Array, password: string, opts: { wasmPath?: string } = {}): Promise<Uint8Array> {
  const r = await qpdfRun([`--password=${password}`, '--decrypt', '$IN', '$OUT'], src, opts.wasmPath);
  if (!ok(r.code) || !r.out) throw new Error('That password is not correct for this PDF.');
  const d = await PDFDocument.load(r.out.slice(), { updateMetadata: false });
  if (d.isEncrypted) throw new Error('The PDF is still encrypted.');
  return r.out;
}

/** Removes document-info fields and XMP metadata. Page content is untouched. */
export async function stripMetadata(src: Uint8Array): Promise<{ bytes: Uint8Array; removed: string[] }> {
  const d = await PDFDocument.load(src, { updateMetadata: false });
  const removed: string[] = [];
  const pairs: [string, () => unknown, (v: string) => void][] = [
    ['Title', () => d.getTitle(), v => d.setTitle(v)], ['Author', () => d.getAuthor(), v => d.setAuthor(v)],
    ['Subject', () => d.getSubject(), v => d.setSubject(v)], ['Keywords', () => d.getKeywords(), v => d.setKeywords([v])],
    ['Creator', () => d.getCreator(), v => d.setCreator(v)], ['Producer', () => d.getProducer(), v => d.setProducer(v)],
  ];
  for (const [n, get] of pairs) if (get()) removed.push(n);
  const info = d.context.lookup(d.context.trailerInfo.Info);
  if (info) { d.context.delete(d.context.trailerInfo.Info as any); d.context.trailerInfo.Info = undefined as any; }
  if (d.catalog.has(PDFName.of('Metadata'))) { d.catalog.delete(PDFName.of('Metadata')); removed.push('XMP metadata'); }
  void pairs;
  return { bytes: await d.save({ useObjectStreams: false }), removed };
}
