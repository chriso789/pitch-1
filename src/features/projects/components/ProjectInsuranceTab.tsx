import React, { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Upload, GitCompare, FileText, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useEffectiveTenantId } from '@/hooks/useEffectiveTenantId';
import { useToast } from '@/hooks/use-toast';
import {
  useRunXactComparison,
  useProjectComparisons,
  useComparisonLines,
  useProjectScopeDocuments,
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
      const { error: upErr } = await supabase.storage.from('insurance-scopes').upload(path, file);
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
          <CardHeader><CardTitle className="text-base">Comparison History</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {comparisons.data.map(c => (
              <button
                key={c.id}
                onClick={() => setActiveComparison(c.id)}
                className={`w-full text-left p-3 rounded-md border transition-colors ${activeComparison === c.id ? 'bg-accent border-primary' : 'hover:bg-accent/50'}`}
              >
                <div className="flex items-center justify-between">
                  <div className="text-sm">
                    <div className="font-medium">
                      Net supplement: ${Number(c.net_supplement_amount || 0).toLocaleString()}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {new Date(c.created_at).toLocaleString()} · {c.added_count} added · {c.removed_count} removed · {c.price_change_count} price · {c.qty_change_count} qty
                    </div>
                  </div>
                  <Badge variant="secondary">{c.status}</Badge>
                </div>
              </button>
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
        <div>
          <Select value={selectedId} onValueChange={onSelect}>
            <SelectTrigger><SelectValue placeholder="Select an existing scope…" /></SelectTrigger>
            <SelectContent>
              {docs.map(d => (
                <SelectItem key={d.id} value={d.id}>
                  {d.file_name} {d.parse_status !== 'complete' && `· ${d.parse_status}`}
                </SelectItem>
              ))}
              {docs.length === 0 && <div className="px-2 py-1 text-xs text-muted-foreground">No scopes yet</div>}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="block">
            <input
              type="file"
              accept="application/pdf"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && onUpload(e.target.files[0])}
            />
            <Button asChild variant="outline" className="w-full gap-2" disabled={uploading}>
              <span>
                {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                Upload Xactimate PDF
              </span>
            </Button>
          </label>
        </div>
      </CardContent>
    </Card>
  );
}

function ComparisonDetail({ comparisonId }: { comparisonId: string }) {
  const lines = useComparisonLines(comparisonId);
  const [filter, setFilter] = useState<string>('all');
  const filtered = useMemo(() => {
    const all = lines.data || [];
    if (filter === 'all') return all;
    return all.filter(l => l.change_type === filter);
  }, [lines.data, filter]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Line-by-line Differences</CardTitle>
      </CardHeader>
      <CardContent>
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
                    <th className="text-left p-2">Type</th>
                    <th className="text-left p-2">Code</th>
                    <th className="text-left p-2">Description</th>
                    <th className="text-right p-2">Carrier Qty × $</th>
                    <th className="text-right p-2">Company Qty × $</th>
                    <th className="text-right p-2">Δ RCV</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(l => (
                    <tr key={l.id} className="border-b">
                      <td className="p-2">
                        <Badge variant={
                          l.change_type === 'added' ? 'default' :
                          l.change_type === 'removed' ? 'destructive' : 'secondary'
                        }>{l.change_type}</Badge>
                      </td>
                      <td className="p-2 font-mono">{l.company_code || l.carrier_code || '—'}</td>
                      <td className="p-2 max-w-[280px] truncate">{l.company_description || l.carrier_description}</td>
                      <td className="p-2 text-right">
                        {l.carrier_quantity ? `${Number(l.carrier_quantity)} ${l.carrier_unit || ''} × $${Number(l.carrier_unit_price || 0).toFixed(2)}` : '—'}
                      </td>
                      <td className="p-2 text-right">
                        {l.company_quantity ? `${Number(l.company_quantity)} ${l.company_unit || ''} × $${Number(l.company_unit_price || 0).toFixed(2)}` : '—'}
                      </td>
                      <td className="p-2 text-right font-medium">
                        ${Number(l.delta_rcv || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </td>
                    </tr>
                  ))}
                  {filtered.length === 0 && (
                    <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">No rows.</td></tr>
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
