import { useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useEffectiveTenantId } from '@/hooks/useEffectiveTenantId';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { imagesToPdf, docxToPdf, sniffImage, MAX_FILES, MAX_BYTES, type ImageInput } from '@/lib/pdf-convert/toPdf';
import { isOcrEnabled, usePdfToolGate } from '@/lib/pdf-pages/featureGate';
import { toast } from 'sonner';

/** Re-encode browser-readable images (WebP, GIF, BMP…) to PNG; JPEG/PNG pass through untouched. */
async function toImageInput(f: File): Promise<ImageInput> {
  const bytes = new Uint8Array(await f.arrayBuffer());
  const kind = sniffImage(bytes);
  if (kind) return { name: f.name, bytes, kind };
  const bmp = await createImageBitmap(f).catch(() => { throw new Error(`${f.name} isn't an image this browser can read (HEIC photos need converting to JPG first)`); });
  const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
  c.getContext('2d')!.drawImage(bmp, 0, 0);
  const blob: Blob = await new Promise((res, rej) => c.toBlob(b => (b ? res(b) : rej(new Error('Could not read image'))), 'image/png'));
  return { name: f.name, bytes: new Uint8Array(await blob.arrayBuffer()), kind: 'png' };
}

export default function PdfConvertPage() {
  usePdfToolGate();
  const tenantId = useEffectiveTenantId();
  const [mode, setMode] = useState<'images' | 'word'>('images');
  const [files, setFiles] = useState<File[]>([]);
  const [pageSize, setPageSize] = useState<'letter' | 'image'>('letter');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ bytes: Uint8Array; warnings: string[] } | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  if (!isOcrEnabled()) return <div className="p-6">Convert to PDF isn't turned on here yet.</div>;

  const total = files.reduce((s, f) => s + f.size, 0);
  const tooBig = total > MAX_BYTES || files.length > MAX_FILES;

  async function convert() {
    setBusy(true); setResult(null); setSaved(null);
    try {
      if (mode === 'images') {
        const inputs = []; for (const f of files) inputs.push(await toImageInput(f));
        setResult({ bytes: await imagesToPdf(inputs, { pageSize }), warnings: [] });
      } else {
        const r = await docxToPdf(new Uint8Array(await files[0].arrayBuffer()), name || files[0].name.replace(/\.docx$/i, ''));
        setResult({ bytes: r.bytes, warnings: r.warnings });
      }
    } catch (e: any) { toast.error(e?.message ?? 'Conversion failed'); }
    setBusy(false);
  }

  function preview() {
    if (!result) return;
    window.open(URL.createObjectURL(new Blob([result.bytes as BlobPart], { type: 'application/pdf' })), '_blank');
  }

  async function save() {
    if (!result || !tenantId) return;
    setBusy(true);
    const base = (name || files[0]?.name || 'Converted').replace(/\.(docx|jpe?g|png|webp|gif|bmp)$/i, '').replace(/[^\w .()-]/g, '_').slice(0, 120);
    const path = `${tenantId}/company-docs/converted/${crypto.randomUUID()}.pdf`;
    const db = supabase as any;
    const { error: up } = await supabase.storage.from('smartdoc-assets').upload(path, new Blob([result.bytes as BlobPart], { type: 'application/pdf' }), { contentType: 'application/pdf', upsert: false });
    if (up) { setBusy(false); return toast.error(up.message); }
    const { data, error } = await db.from('documents').insert({
      tenant_id: tenantId, filename: `${base}.pdf`, file_path: path, file_size: result.bytes.byteLength, mime_type: 'application/pdf',
      document_type: 'company_resource', description: `Converted from ${mode === 'images' ? `${files.length} image(s)` : 'a Word file'}`,
      metadata: { converted_from: mode, source_files: files.map(f => f.name).slice(0, MAX_FILES) },
    }).select('id').single();
    if (error) { await supabase.storage.from('smartdoc-assets').remove([path]); setBusy(false); return toast.error(error.message); }
    setSaved(data.id); setBusy(false); toast.success('Saved to company documents');
  }

  return (
    <div className="p-4 max-w-3xl space-y-4">
      <h1 className="text-xl font-semibold">Convert to PDF</h1>
      <Card>
        <CardHeader><CardTitle className="text-base">1. Choose what to convert</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Button variant={mode === 'images' ? 'default' : 'outline'} onClick={() => { setMode('images'); setFiles([]); setResult(null); }}>Photos / images</Button>
            <Button variant={mode === 'word' ? 'default' : 'outline'} onClick={() => { setMode('word'); setFiles([]); setResult(null); }}>Word document</Button>
          </div>
          <Input type="file" multiple={mode === 'images'} accept={mode === 'images' ? 'image/*' : '.docx'} onChange={e => { setFiles(Array.from(e.target.files ?? [])); setResult(null); setSaved(null); }} />
          {mode === 'images' && files.length > 0 && <ol className="text-sm list-decimal pl-5">{files.map((f, i) => <li key={i}>{f.name}</li>)}</ol>}
          {mode === 'images' && <div className="flex items-center gap-2 text-sm">Page size
            <Select value={pageSize} onValueChange={v => setPageSize(v as any)}><SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="letter">Letter, fitted with margins</SelectItem><SelectItem value="image">Same size as each image</SelectItem></SelectContent></Select></div>}
          <p className="text-xs text-muted-foreground">
            {mode === 'images' ? `One page per image, in the order shown. JPG and PNG are placed exactly as they are, without re-compressing. Up to ${MAX_FILES} images.`
              : 'Only .docx files. Headings, paragraphs, bold/italic, lists, tables and pictures are kept, but the layout is re-typeset and won\'t match Word exactly. Old .doc files, headers/footers and special characters outside the standard PDF fonts aren\'t supported — those are reported, never swapped.'}
          </p>
          {tooBig && <p className="text-sm text-destructive">Too many or too large files (max {MAX_FILES} files, 40 MB total).</p>}
          <Input placeholder="Name for the PDF (optional)" value={name} onChange={e => setName(e.target.value)} />
          <Button disabled={busy || !files.length || tooBig} onClick={convert}>{busy ? 'Working…' : 'Convert'}</Button>
        </CardContent>
      </Card>
      {result && <Card>
        <CardHeader><CardTitle className="text-base">2. Check and save</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {result.warnings.length > 0 && <ul className="text-xs text-muted-foreground list-disc pl-5">{result.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>}
          <div className="flex gap-2">
            <Button variant="outline" onClick={preview}>Preview</Button>
            <Button disabled={busy || !tenantId || !!saved} onClick={save}>Save to company documents</Button>
            {saved && <Button variant="outline" asChild><Link to={`/documents/${saved}/markup`}>Open in PDF tools</Link></Button>}
          </div>
        </CardContent>
      </Card>}
    </div>
  );
}
