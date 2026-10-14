import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from 'sonner';
import { protectPdf, unprotectPdf, stripMetadata, validatePasswords, ALL_ALLOWED, type Permissions } from '@/lib/pdf-protect/protect';
import { isEncryptedPdf } from '@/lib/pdf-engine/decrypt';

const LABELS: Record<keyof Permissions, string> = { print: 'Printing', copy: 'Copying text', modify: 'Changing the document', annotate: 'Comments & markup', fillForms: 'Filling forms' };
const download = (b: Uint8Array, name: string) => { const u = URL.createObjectURL(new Blob([b.slice().buffer], { type: 'application/pdf' })); const a = document.createElement('a'); a.href = u; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(u), 60000); };

/**
 * Phase 2E. Password-protected copies are DOWNLOADED, not stored: PITCH's own tools must keep
 * opening company files, and we never store PDF passwords. Metadata removal / unlocking save new versions.
 */
export function PdfProtectPanel({ bytes, name, onSaveVersion }: { bytes: Uint8Array; name: string; onSaveVersion: (out: Uint8Array, summary: string) => Promise<void> }) {
  const [openPw, setOpenPw] = useState(''), [ownerPw, setOwnerPw] = useState(''), [unlockPw, setUnlockPw] = useState('');
  const [perms, setPerms] = useState<Permissions>({ ...ALL_ALLOWED, modify: false });
  const [busy, setBusy] = useState(false);
  const base = name.replace(/\.pdf$/i, '');
  const run = async (f: () => Promise<void>) => { setBusy(true); try { await f(); } catch (e: any) { toast.error(e.message ?? String(e)); } setBusy(false); };
  const issue = validatePasswords(openPw, ownerPw);

  return <div className="space-y-6 max-w-2xl">
    <section className="space-y-3 border rounded-md p-4">
      <h2 className="font-medium">Download a protected copy</h2>
      <p className="text-xs text-muted-foreground">Makes a copy with strong (AES-256) encryption on this computer and downloads it. The file saved in PITCH is not changed, and passwords are never stored — if you lose them, the copy can't be recovered.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1"><Label htmlFor="pw-open">Password to open (optional)</Label><Input id="pw-open" type="password" value={openPw} onChange={e => setOpenPw(e.target.value)} autoComplete="new-password" /></div>
        <div className="space-y-1"><Label htmlFor="pw-owner">Password to change permissions</Label><Input id="pw-owner" type="password" value={ownerPw} onChange={e => setOwnerPw(e.target.value)} autoComplete="new-password" /></div>
      </div>
      <div className="flex flex-wrap gap-4">{(Object.keys(LABELS) as (keyof Permissions)[]).map(k =>
        <label key={k} className="flex items-center gap-2 text-sm"><Checkbox checked={perms[k]} onCheckedChange={v => setPerms(p => ({ ...p, [k]: !!v }))} />Allow {LABELS[k].toLowerCase()}</label>)}</div>
      <p className="text-xs text-muted-foreground">Permission limits are honored by standard PDF readers but are not a guarantee against determined copying. The open password is real protection.</p>
      {ownerPw && issue && <p className="text-sm text-destructive">{issue}</p>}
      <Button disabled={busy || !!issue} onClick={() => run(async () => { download(await protectPdf(bytes, openPw, ownerPw, perms), `${base}-protected.pdf`); toast.success('Protected copy downloaded and checked: it only opens with the right password.'); })}>Create protected copy</Button>
    </section>

    <section className="space-y-3 border rounded-md p-4">
      <h2 className="font-medium">Remove hidden document details</h2>
      <p className="text-xs text-muted-foreground">Removes title, author, software and other hidden details before you share. Saves a new version; pages are not changed.</p>
      <Button variant="outline" disabled={busy} onClick={() => run(async () => { const r = await stripMetadata(bytes); await onSaveVersion(r.bytes, `Removed details: ${r.removed.join(', ') || 'none found'}`); })}>Remove details (new version)</Button>
    </section>

    <section className="space-y-3 border rounded-md p-4">
      <h2 className="font-medium">Remove a password</h2>
      <p className="text-xs text-muted-foreground">For a file you have the password to. Saves an unlocked new version; the protected original stays.</p>
      <div className="flex gap-2"><Input type="password" aria-label="Current password" placeholder="Current password" value={unlockPw} onChange={e => setUnlockPw(e.target.value)} />
        <Button variant="outline" disabled={busy || !unlockPw} onClick={() => run(async () => {
          if (!(await isEncryptedPdf(bytes))) { toast.info('This PDF has no password.'); return; }
          await onSaveVersion(await unprotectPdf(bytes, unlockPw), 'Password removed'); setUnlockPw('');
        })}>Unlock</Button></div>
    </section>
  </div>;
}
