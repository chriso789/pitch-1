import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ScanLine, Download, ExternalLink, FileText, Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { useEffectiveTenantId } from '@/hooks/useEffectiveTenantId';
import { DocumentScannerDialog } from '@/components/documents/DocumentScannerDialog';
import { recordDocumentFilter, SCAN_CATEGORIES, type ScanRecordType } from '@/lib/scan-records/recordLink';

interface Props {
  recordType: ScanRecordType;
  recordId: string;
  /** Lead the record belongs to, when known. */
  pipelineEntryId?: string;
  title?: string;
  /** Hide the saved-document list (when the page already lists documents). */
  buttonOnly?: boolean;
  onSaved?: () => void;
}

/** One shared "Scan Document" entry point: opens the existing UltraScan scanner bound to this record and company. */
export function RecordScanDocuments({ recordType, recordId, pipelineEntryId, title = 'Scanned documents', buttonOnly, onSaved }: Props) {
  const tenantId = useEffectiveTenantId();
  const [setupOpen, setSetupOpen] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [name, setName] = useState('');
  const [category, setCategory] = useState('other');
  const [docs, setDocs] = useState<any[]>([]);

  const load = useCallback(async () => {
    if (!tenantId || buttonOnly) return;
    const f = recordDocumentFilter(recordType, recordId);
    let q: any = (supabase as any).from('documents')
      .select('id, filename, file_path, document_type, created_at, ocr_status, page_count, scan_source')
      .eq('tenant_id', tenantId);
    q = f.kind === 'column' ? q.eq(f.column, f.value) : q.contains('metadata', f.value);
    const { data } = await q.order('created_at', { ascending: false }).limit(200);
    setDocs(data || []);
  }, [tenantId, recordType, recordId, buttonOnly]);
  useEffect(() => { load(); }, [load]);

  const signed = async (d: any, download = false) => {
    const { data } = await supabase.storage.from('documents').createSignedUrl(d.file_path, 600, download ? { download: d.filename } : undefined);
    if (data) window.open(data.signedUrl, '_blank');
  };
  const label = SCAN_CATEGORIES.find(c => c.value === category)?.label ?? 'Document';

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        {!buttonOnly && <h3 className="text-sm font-semibold">{title}</h3>}
        <Button size="sm" onClick={() => setSetupOpen(true)} disabled={!tenantId} aria-label="Scan Document">
          <ScanLine className="h-4 w-4 mr-1" />Scan Document
        </Button>
      </div>

      {!buttonOnly && (docs.length === 0
        ? <p className="text-sm text-muted-foreground">No documents yet. Tap Scan Document to capture one.</p>
        : <ul className="divide-y rounded-md border">
            {docs.map(d => (
              <li key={d.id} className="flex flex-wrap items-center gap-2 p-2">
                <FileText className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm flex-1 min-w-0 truncate">{d.filename}</span>
                {d.page_count ? <Badge variant="outline">{d.page_count} pg</Badge> : null}
                {d.ocr_status === 'completed' && <Badge variant="secondary">Searchable</Badge>}
                <Button size="sm" variant="ghost" onClick={() => signed(d)} aria-label="Preview"><ExternalLink className="h-4 w-4" /></Button>
                <Button size="sm" variant="ghost" onClick={() => signed(d, true)} aria-label="Download"><Download className="h-4 w-4" /></Button>
                {/\.pdf$/i.test(d.file_path) && (
                  <Button size="sm" variant="ghost" asChild aria-label="Edit in PDF Studio">
                    <Link to={`/documents/pdf-workspace/${d.id}`}><Pencil className="h-4 w-4" /></Link>
                  </Button>
                )}
              </li>
            ))}
          </ul>)}

      <Dialog open={setupOpen} onOpenChange={setSetupOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Scan New Document</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Input placeholder="Document name (optional)" value={name} onChange={e => setName(e.target.value)} maxLength={120} />
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{SCAN_CATEGORIES.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}</SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">Use the camera or import photos. The scan is saved to this record in the current company.</p>
          </div>
          <DialogFooter><Button onClick={() => { setSetupOpen(false); setScanOpen(true); }}>Open scanner</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {scanOpen && (
        <DocumentScannerDialog
          open={scanOpen}
          onOpenChange={setScanOpen}
          documentType={category}
          documentLabel={label}
          documentName={name || undefined}
          documentCategory={category}
          recordType={recordType}
          recordId={recordId}
          pipelineEntryId={pipelineEntryId}
          onUploadComplete={() => { setName(''); load(); onSaved?.(); }}
        />
      )}
    </div>
  );
}
