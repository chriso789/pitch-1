import React, { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Upload, GitCompare, FileText, Loader2, FileDown, Trash2, ChevronRight, ChevronDown, RefreshCw } from 'lucide-react';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { supabase } from '@/integrations/supabase/client';
import { safeStorageUpload } from '@/lib/storage/safeUpload';
import { useEffectiveTenantId } from '@/hooks/useEffectiveTenantId';
import { useToast } from '@/hooks/use-toast';
import {
  useRunXactComparison,
  useProjectComparisons,
  useComparisonLines,
  useProjectScopeDocuments,
  useGenerateSupplementReport,
  useSupplementReports,
  useDeleteComparison,
} from '@/hooks/useXactComparison';

interface Props {
  projectId: string;
  jobId?: string | null;
}

export function ProjectInsuranceTab({ projectId, jobId }: Props) {
  const tenantId = useEffectiveTenantId();
  const { toast } = useToast();
  const docs = useProjectScopeDocuments(projectId, jobId);
  const comparisons = useProjectComparisons(projectId);
  const runCompare = useRunXactComparison();
  const deleteComparison = useDeleteComparison();
  const [recomputingId, setRecomputingId] = useState<string | null>(null);
  const [recomputingAll, setRecomputingAll] = useState(false);

  const handleRecomputeAll = async () => {
    setRecomputingAll(true);
    try {
      const { data, error } = await supabase.functions.invoke('xact-recompute-comparisons', {
        body: { project_id: projectId },
      });
      if (error) throw error;
      const failed = (data?.results || []).filter((r: any) => !r.ok).length;
      const succeeded = data?.succeeded ?? 0;
      toast({
        title: failed ? 'Recompute partial' : 'All comparisons recomputed',
        description: `${succeeded} succeeded${failed ? `, ${failed} failed` : ''}.`,
        variant: failed ? 'destructive' : 'default',
      });
      comparisons.refetch();
    } catch (e: any) {
      toast({ title: 'Recompute failed', description: e.message, variant: 'destructive' });
    } finally {
      setRecomputingAll(false);
    }
  };

  const handleRecompute = async (comparisonId: string) => {
    setRecomputingId(comparisonId);
    try {
      const { data, error } = await supabase.functions.invoke('xact-recompute-comparisons', {
        body: { comparison_ids: [comparisonId] },
      });
      if (error) throw error;
      const failed = (data?.results || []).filter((r: any) => !r.ok);
      if (failed.length) {
        toast({ title: 'Recompute partial', description: failed[0].reason, variant: 'destructive' });
      } else {
        toast({ title: 'Comparison recomputed', description: 'Prices and quantities refreshed from parsed sources.' });
      }
      comparisons.refetch();
    } catch (e: any) {
      toast({ title: 'Recompute failed', description: e.message, variant: 'destructive' });
    } finally {
      setRecomputingId(null);
    }
  };

  const [carrierId, setCarrierId] = useState<string>('');
  const [companyId, setCompanyId] = useState<string>('');
  const [activeComparison, setActiveComparison] = useState<string | null>(null);
  const [uploading, setUploading] = useState<'carrier' | 'company' | null>(null);

  const carrierDocs = useMemo(
    () => (docs.data || []).filter(d => d.document_type !== 'company_scope'),
    [docs.data]
  );
  const companyDocs = useMemo(
    () => (docs.data || []).filter(d => d.document_type === 'company_scope'),
    [docs.data]
  );

  const handleUpload = async (file: File, kind: 'carrier' | 'company') => {
    if (!tenantId) return;
    setUploading(kind);
    try {
      const path = `${tenantId}/projects/${projectId}/scopes/${Date.now()}_${file.name}`;
      const { error: upErr } = await safeStorageUpload({
        bucket: 'documents',
        path,
        file,
        tenantId,
        contentType: 'application/pdf',
        upsert: true,
      });
      if (upErr) throw upErr;
      const { data, error } = await supabase.functions.invoke('scope-document-ingest', {
        body: {
          storage_path: path,
          file_name: file.name,
          file_size_bytes: file.size,
          job_id: jobId || null,
          document_type: kind === 'company' ? 'company_scope' : 'estimate',
        },
      });
      if (error) throw error;
      toast({ title: 'Uploaded', description: 'Parsing started — refresh in a moment.' });
      docs.refetch();
      if (data?.document_id) {
        if (kind === 'carrier') setCarrierId(data.document_id);
        else setCompanyId(data.document_id);
      }
    } catch (e: any) {
      toast({ title: 'Upload failed', description: e.message, variant: 'destructive' });
    } finally {
      setUploading(null);
    }
  };

  const onRunCompare = async () => {
    if (!carrierId || !companyId) return;
    try {
      const res = await runCompare.mutateAsync({
        carrier_document_id: carrierId,
        company_document_id: companyId,
        project_id: projectId,
        job_id: jobId || null,
      });
      setActiveComparison(res.comparison_id);
      toast({ title: 'Comparison ready', description: `${res.diff_rows} differences found.` });
    } catch (e: any) {
      toast({ title: 'Compare failed', description: e.message, variant: 'destructive' });
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <ScopeUploadCard
          title="Carrier Xactimate"
          subtitle="Insurance company's estimate"
          docs={carrierDocs}
          selectedId={carrierId}
          onSelect={setCarrierId}
          onUpload={(f) => handleUpload(f, 'carrier')}
          uploading={uploading === 'carrier'}
        />
        <ScopeUploadCard
          title="Company Xactimate"
          subtitle="Your estimate / supplement scope"
          docs={companyDocs}
          selectedId={companyId}
          onSelect={setCompanyId}
          onUpload={(f) => handleUpload(f, 'company')}
          uploading={uploading === 'company'}
        />
      </div>

      <div className="flex items-center gap-3">
        <Button
          onClick={onRunCompare}
          disabled={!carrierId || !companyId || runCompare.isPending}
          className="gap-2"
        >
          {runCompare.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <GitCompare className="h-4 w-4" />}
          Run Comparison
        </Button>
        <span className="text-xs text-muted-foreground">
          Generates a line-by-line diff (added, removed, qty, price) for the supplement report.
        </span>
      </div>

      {comparisons.data && comparisons.data.length > 0 && (
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Comparison History</CardTitle>
            <Button
              size="sm"
              variant="outline"
              className="gap-2"
              disabled={recomputingAll}
              onClick={handleRecomputeAll}
            >
              {recomputingAll ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Recompute all
            </Button>
          </CardHeader>
          <CardContent className="space-y-2">
            {comparisons.data.map(c => (
              <div
                key={c.id}
                className={`w-full p-3 rounded-md border transition-colors flex items-center justify-between gap-3 ${activeComparison === c.id ? 'bg-accent border-primary' : 'hover:bg-accent/50'}`}
              >
                <button
                  type="button"
                  onClick={() => setActiveComparison(c.id)}
                  className="flex-1 text-left"
                >
                  <div className="text-sm">
                    <div className="font-medium">
                      Net supplement: ${Number(c.net_supplement_amount || 0).toLocaleString()}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {new Date(c.created_at).toLocaleString()} · {c.added_count} added · {c.removed_count} removed · {c.price_change_count} price · {c.qty_change_count} qty
                    </div>
                  </div>
                </button>
                <div className="flex items-center gap-2 shrink-0">
                  <Badge variant="secondary">{c.status}</Badge>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-primary"
                    disabled={recomputingId === c.id}
                    aria-label="Recompute comparison"
                    onClick={() => handleRecompute(c.id)}
                  >
                    {recomputingId === c.id
                      ? <Loader2 className="h-4 w-4 animate-spin" />
                      : <RefreshCw className="h-4 w-4" />}
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                        disabled={deleteComparison.isPending}
                        aria-label="Delete comparison"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete this comparison?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This permanently removes the comparison along with its diff lines and any generated supplement reports. This cannot be undone.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={async () => {
                            try {
                              await deleteComparison.mutateAsync(c.id);
                              if (activeComparison === c.id) setActiveComparison(null);
                              toast({ title: 'Comparison deleted' });
                            } catch (e: any) {
                              toast({ title: 'Delete failed', description: e.message, variant: 'destructive' });
                            }
                          }}
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                          Delete
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {activeComparison && <ComparisonDetail comparisonId={activeComparison} />}
    </div>
  );
}

function ScopeUploadCard({
  title, subtitle, docs, selectedId, onSelect, onUpload, uploading,
}: {
  title: string; subtitle: string;
  docs: Array<{ id: string; file_name: string; parse_status: string; carrier_normalized?: string | null }>;
  selectedId: string; onSelect: (id: string) => void;
  onUpload: (f: File) => void; uploading: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2"><FileText className="h-4 w-4" /> {title}</CardTitle>
        <p className="text-xs text-muted-foreground">{subtitle}</p>
      </CardHeader>
      <CardContent className="space-y-3">
        {selectedId && (() => {
          const selected = docs.find(d => d.id === selectedId);
          if (!selected) return null;
          return (
            <div className="text-xs p-2 rounded bg-muted/40 truncate">
              <span className="font-medium">{selected.file_name}</span>
              {selected.parse_status !== 'complete' && (
                <span className="text-muted-foreground"> · {selected.parse_status}</span>
              )}
            </div>
          );
        })()}
        <div>
          <input
            id={`upload-${title.replace(/\s+/g, '-')}`}
            type="file"
            accept="application/pdf"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onUpload(f);
              e.target.value = '';
            }}
          />
          <Button
            type="button"
            variant="outline"
            className="w-full gap-2"
            disabled={uploading}
            onClick={() => document.getElementById(`upload-${title.replace(/\s+/g, '-')}`)?.click()}
          >
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            Upload Xactimate PDF
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function ComparisonDetail({ comparisonId }: { comparisonId: string }) {
  const lines = useComparisonLines(comparisonId);
  const reports = useSupplementReports(comparisonId);
  const generate = useGenerateSupplementReport();
  const { toast } = useToast();
  const [filter, setFilter] = useState<string>('all');
  const filtered = useMemo(() => {
    const all = lines.data || [];
    if (filter === 'all') return all;
    return all.filter(l => l.change_type === filter);
  }, [lines.data, filter]);

  const onGenerate = async () => {
    try {
      const res = await generate.mutateAsync(comparisonId);
      toast({ title: 'Supplement report generated', description: `Version ${res.report?.version}` });
    } catch (e: any) {
      toast({ title: 'Generation failed', description: e.message, variant: 'destructive' });
    }
  };

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">Line-by-line Differences</CardTitle>
        <Button size="sm" onClick={onGenerate} disabled={generate.isPending} className="gap-2">
          {generate.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}
          Generate Supplement Report
        </Button>
      </CardHeader>
      <CardContent>
        {reports.data && reports.data.length > 0 && (
          <div className="mb-4 space-y-1">
            {reports.data.map(r => (
              <div key={r.id} className="flex items-center justify-between text-xs p-2 rounded bg-muted/40">
                <span>v{r.version} · {new Date(r.created_at).toLocaleString()} · {r.status}</span>
                {r.pdf_url && (
                  <a href={r.pdf_url} target="_blank" rel="noreferrer" className="text-primary underline">
                    Open PDF
                  </a>
                )}
              </div>
            ))}
          </div>
        )}
        <Tabs value={filter} onValueChange={setFilter}>
          <TabsList>
            <TabsTrigger value="all">All ({lines.data?.length || 0})</TabsTrigger>
            <TabsTrigger value="added">Added</TabsTrigger>
            <TabsTrigger value="removed">Removed</TabsTrigger>
            <TabsTrigger value="qty_change">Qty Δ</TabsTrigger>
            <TabsTrigger value="price_change">Price Δ</TabsTrigger>
          </TabsList>
          <TabsContent value={filter} className="mt-4">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-muted-foreground">
                  <tr className="border-b">
                    <th className="w-6 p-2"></th>
                    <th className="text-left p-2">Type</th>
                    <th className="text-left p-2">Confidence</th>
                    <th className="text-left p-2">Code</th>
                    <th className="text-left p-2">Aligned Evidence</th>
                    <th className="text-right p-2">Carrier Qty × $ = Total</th>
                    <th className="text-right p-2">Company Qty × $ = Total</th>
                    <th className="text-right p-2">Δ RCV</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(l => (
                    <ComparisonRow key={l.id} line={l} />
                  ))}
                  {filtered.length === 0 && (
                    <tr><td colSpan={8} className="p-6 text-center text-muted-foreground">No rows.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

function ComparisonRow({ line: l }: { line: any }) {
  const [expanded, setExpanded] = useState(false);
  const children: Array<{ side: 'carrier' | 'company'; code?: string | null; section: string | null; description: string | null; quantity?: number | null; unit?: string | null; unit_price?: number | null; total_rcv?: number | null; page_number?: number | null }> =
    Array.isArray(l.grouped_children) ? l.grouped_children : [];
  const hasChildren = children.length > 0;
  const confidence = typeof l.match_confidence === 'number' ? l.match_confidence : Number(l.match_confidence ?? 0);

  const fmtSide = (qty: any, unit: any, price: any, total: any) => {
    if (qty == null) return '—';
    const q = Number(qty);
    const p = Number(price || 0);
    const t = total != null ? Number(total) : q * p;
    return (
      <span>
        {q} {unit || ''} × ${p.toFixed(2)}
        <span className="ml-1 text-muted-foreground">= ${t.toFixed(2)}</span>
      </span>
    );
  };

  return (
    <>
      <tr className="border-b align-top">
        <td className="p-2">
          {hasChildren ? (
            <button
              type="button"
              onClick={() => setExpanded(v => !v)}
              className="text-muted-foreground hover:text-foreground"
              aria-label={expanded ? 'Collapse' : 'Expand'}
            >
              {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            </button>
          ) : null}
        </td>
        <td className="p-2">
          <Badge variant={
            l.change_type === 'added' ? 'default' :
            l.change_type === 'removed' ? 'destructive' : 'secondary'
          }>{l.change_type}</Badge>
        </td>
        <td className="p-2">
          <div className="font-medium">{Math.round(confidence * 100)}%</div>
          <div className="text-[10px] text-muted-foreground">{l.match_method || '—'}</div>
        </td>
        <td className="p-2 font-mono">{l.company_code || l.carrier_code || '—'}</td>
        <td className="p-2 max-w-[360px]">
          <div className="space-y-1">
            <div><span className="text-muted-foreground">Carrier:</span> {l.carrier_description || '—'}</div>
            <div><span className="text-muted-foreground">Company:</span> {l.company_description || '—'}</div>
          </div>
          {hasChildren && (
            <div className="text-[10px] text-muted-foreground mt-0.5">
              aggregated from {children.length} line{children.length === 1 ? '' : 's'}
            </div>
          )}
          {l.justification && <div className="mt-1 text-[10px] text-muted-foreground line-clamp-2">{l.justification}</div>}
        </td>
        <td className="p-2 text-right">
          {fmtSide(l.carrier_quantity, l.carrier_unit, l.carrier_unit_price, l.carrier_total_rcv)}
        </td>
        <td className="p-2 text-right">
          {fmtSide(l.company_quantity, l.company_unit, l.company_unit_price, l.company_total_rcv)}
        </td>
        <td className="p-2 text-right font-medium">
          ${Number(l.delta_rcv || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
        </td>
      </tr>
      {expanded && hasChildren && (
        <tr className="bg-muted/30">
          <td></td>
          <td colSpan={7} className="p-2">
            <div className="text-[11px] text-muted-foreground mb-1">Aggregated child lines:</div>
            <table className="w-full text-[11px]">
              <thead className="text-muted-foreground">
                <tr>
                  <th className="text-left p-1">Side</th>
                  <th className="text-left p-1">Code</th>
                  <th className="text-left p-1">Section</th>
                  <th className="text-left p-1">Description</th>
                  <th className="text-right p-1">Qty × $ = Total</th>
                </tr>
              </thead>
              <tbody>
                {children.map((c, i) => (
                  <tr key={i} className="border-t border-border/40">
                    <td className="p-1 capitalize">{c.side}</td>
                    <td className="p-1 font-mono">{c.code || '—'}</td>
                    <td className="p-1">{c.section || '—'}</td>
                    <td className="p-1">{c.description || '—'}</td>
                    <td className="p-1 text-right">{fmtSide(c.quantity, c.unit, c.unit_price, c.total_rcv)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </td>
        </tr>
      )}
    </>
  );
}
