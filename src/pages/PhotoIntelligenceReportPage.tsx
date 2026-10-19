/**
 * Photo Intelligence report preview (Phase 6).
 * Renders the composed report from APPROVED findings only. Export requires a
 * recorded inspector approval. Every save creates a new immutable version.
 */
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffectiveTenantId } from '@/hooks/useEffectiveTenantId';
import { useAuth } from '@/contexts/AuthContext';
import { listFindings, listEvidence, evidencePhotoUrl, type PhotoFinding, type FindingEvidence } from '@/lib/photo-intelligence/findings';
import { composeReport, findUntraceableEntries, SEVERITY_ORDER, type PhotoIntelligenceReport, type ReportSiteOverview } from '@/lib/photo-intelligence/reportModel';
import { generatePhotoReportPdf } from '@/lib/photo-intelligence/reportPdf';
import { loadReportImage } from '@/lib/photo-intelligence/reportImages';
import { assertReportExportable } from '@/lib/photo-intelligence/reportExportGuard';
import { SiteOverviewEditor } from '@/components/photo-intelligence/SiteOverviewEditor';
import { supabase } from '@/integrations/supabase/client';
import { formatLicenseLine } from '@/lib/companyLicenses';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { saveReportVersion, listReportVersions } from '@/lib/photo-intelligence/reports';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { Download, Save, ShieldAlert } from 'lucide-react';

export default function PhotoIntelligenceReportPage() {
  const tenantId = useEffectiveTenantId();
  const [searchParams] = useSearchParams();
  const projectId = searchParams.get('projectId');
  const { user } = useAuth();
  const qc = useQueryClient();
  const [inspectorName, setInspectorName] = useState('');
  const [address, setAddress] = useState('');
  const [busy, setBusy] = useState(false);
  const [selectedVersionId, setSelectedVersionId] = useState('');
  const [resolution, setResolution] = useState('1800');
  const [siteOverview, setSiteOverview] = useState<ReportSiteOverview | null>(null);
  const [inspectedAt, setInspectedAt] = useState(new Date().toISOString().slice(0, 10));
  useEffect(() => {
    setSiteOverview(null); setAddress(''); setInspectorName(''); setSelectedVersionId('');
  }, [tenantId, projectId]);

  const { data: branding } = useQuery({
    queryKey: ['photo-report-branding', tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      if (!tenantId) throw new Error('No company selected');
      const { data, error } = await supabase.from('tenants').select('name, logo_url, phone, email, settings').eq('id', tenantId).single();
      if (error) throw error;
      const settings = data.settings as Record<string, unknown> | null;
      return { companyName: data.name, logoUrl: data.logo_url, phone: data.phone, email: data.email, licenseLine: formatLicenseLine(typeof settings?.license_number === 'string' ? settings.license_number : '') };
    },
  });

  const { data: findings = [] } = useQuery({
    queryKey: ['photo-findings', tenantId, projectId],
    queryFn: async () => tenantId ? (await listFindings(tenantId, projectId ? { projectId } : {})).filter((f) => f.project_id === projectId) : [],
    enabled: !!tenantId,
  });

  const { data: evidenceByFinding = new Map<string, FindingEvidence[]>() } = useQuery({
    queryKey: ['photo-finding-evidence-all', tenantId, findings.map((f) => f.id).join(',')],
    queryFn: async () => {
      const m = new Map<string, FindingEvidence[]>();
      for (const f of findings) m.set(f.id, await listEvidence(f.id));
      return m;
    },
    enabled: !!tenantId && findings.length > 0,
  });

  const { data: versions = [] } = useQuery({
    queryKey: ['photo-intel-reports', tenantId, projectId],
    queryFn: () => tenantId ? listReportVersions(tenantId, projectId) : Promise.resolve([]),
    enabled: !!tenantId,
  });

  const approved = useMemo(() => findings.filter((f) => f.review_status === 'approved'), [findings]);
  const unapprovedCount = findings.length - approved.length;

  const report: PhotoIntelligenceReport | null = useMemo(() => {
    if (approved.length === 0 || !branding) return null;
    try {
      return composeReport({
        branding: branding ?? { companyName: 'Company not loaded' },
        property: {
          address: address || 'Address not set',
          inspectedAt,
          inspectorName: inspectorName || 'Inspector not recorded',
        },
        findings: approved,
        evidenceByFinding,
        approval: null,
        siteOverview,
        version: (versions[0]?.version ?? 0) + 1,
      });
    } catch {
      return null;
    }
  }, [approved, evidenceByFinding, address, inspectorName, versions, branding, siteOverview, inspectedAt]);

  const untraceable = report ? findUntraceableEntries(report) : [];

  const save = async (status: 'draft' | 'approved') => {
    if (!report || !tenantId || !user) return;
    if (status === 'approved' && (!inspectorName.trim() || !address.trim() || !inspectedAt)) {
      toast.error('Record the property address, inspection date and inspector name before approval.');
      return;
    }
    setBusy(true);
    try {
      const toSave = status === 'approved'
        ? { ...report, approval: { approvedBy: inspectorName.trim(), approvedAt: new Date().toISOString() } }
        : report;
      if (status === 'approved') assertReportExportable(toSave);
      await saveReportVersion(tenantId, projectId, toSave, status, user.id);
      qc.invalidateQueries({ queryKey: ['photo-intel-reports'] });
      toast.success(`Report version ${toSave.version} saved (${status}).`);
    } catch (e: any) {
      toast.error(e?.message ?? 'Could not save the report.');
    } finally {
      setBusy(false);
    }
  };

  const approvedVersions = versions.filter((v) => v.status === 'approved');
  const selectedVersion = approvedVersions.find((v) => v.id === selectedVersionId) ?? approvedVersions[0];
  const paths = [...new Set([...evidenceByFinding.values()].flat().map((e) => e.storage_path).filter((p): p is string => !!p))];
  const exportPdf = async () => {
    if (!tenantId || !selectedVersion) return;
    setBusy(true);
    try {
      const bytes = await generatePhotoReportPdf(selectedVersion.report, {
        resolveImage: (path) => loadReportImage(tenantId, path, Number(resolution)),
        resolveLogo: async (url) => {
          const response = await fetch(url);
          if (!response.ok) throw new Error('Company logo could not be loaded.');
          return new Uint8Array(await response.arrayBuffer());
        },
      });
      const url = URL.createObjectURL(new Blob([new Uint8Array(bytes).buffer], { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = url; a.download = `inspection-report-v${selectedVersion.version}.pdf`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.success(`Approved version ${selectedVersion.version} exported.`);
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Report export failed.'); }
    finally { setBusy(false); }
  };

  return (
    <div className="p-6 space-y-4 max-w-5xl mx-auto">
      <h1 className="text-2xl font-semibold">Photo Intelligence Report</h1>

      {unapprovedCount > 0 && (
        <Card className="border-destructive">
          <CardContent className="pt-4 flex gap-2 items-center text-sm">
            <ShieldAlert className="h-4 w-4 text-destructive" />
            {unapprovedCount} finding(s) are not inspector-approved and are excluded from this report.
          </CardContent>
        </Card>
      )}

      <div className="flex flex-wrap gap-3 items-end">
        <div>
          <label className="text-xs text-muted-foreground">Property address</label>
          <Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="7552 Navarre Parkway…" className="w-72" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Inspector name (required to approve)</label>
          <Input value={inspectorName} onChange={(e) => setInspectorName(e.target.value)} placeholder="Inspector" className="w-56" />
        </div>
        <div><label className="text-xs text-muted-foreground">Inspection date</label><Input type="date" value={inspectedAt} onChange={(e) => setInspectedAt(e.target.value)} /></div>
        <Button variant="outline" disabled={!report || busy} onClick={() => save('draft')}><Save className="h-4 w-4 mr-1" /> Save draft version</Button>
        <Button disabled={!report || busy || !inspectorName.trim()} onClick={() => save('approved')}>Approve & save version</Button>
        <Select value={selectedVersion?.id ?? ''} onValueChange={setSelectedVersionId}><SelectTrigger className="w-44" aria-label="Approved export version"><SelectValue placeholder="Approved version" /></SelectTrigger><SelectContent>{approvedVersions.map((v) => <SelectItem value={v.id} key={v.id}>Version {v.version}</SelectItem>)}</SelectContent></Select>
        <Select value={resolution} onValueChange={setResolution}><SelectTrigger className="w-44" aria-label="Photo resolution"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="1200">Compact photos</SelectItem><SelectItem value="1800">Standard photos</SelectItem><SelectItem value="2600">Detailed photos</SelectItem></SelectContent></Select>
        <Button variant="secondary" disabled={!selectedVersion || busy} onClick={exportPdf}>
          <Download className="h-4 w-4 mr-1" /> Export PDF
        </Button>
      </div>
      {!selectedVersion && report && (
        <p className="text-xs text-muted-foreground">Export is available after an approved version is saved.</p>
      )}

      {paths.length > 0 && <SiteOverviewEditor key={tenantId} paths={paths} value={siteOverview} onChange={setSiteOverview} />}

      {!report ? (
        <Card><CardContent className="pt-4 text-sm text-muted-foreground">No approved findings yet — approve findings in the review workspace first.</CardContent></Card>
      ) : (
        <Card className="print:shadow-none" id="photo-intel-report">
          <CardHeader>
            <CardTitle>{report.property.reportTitle ?? 'Property Photo Inspection Report'}</CardTitle>
            <p className="text-sm text-muted-foreground">
              {report.branding.companyName} · {report.property.address} · Inspected {report.property.inspectedAt.slice(0, 10)} · Inspector: {report.property.inspectorName} · Version {report.version}
            </p>
          </CardHeader>
          <CardContent className="space-y-6">
            <section>
              <h2 className="font-semibold mb-1">Executive summary</h2>
              <p className="text-sm">{report.executiveSummary}</p>
              <div className="flex flex-wrap gap-2 mt-2">
                {SEVERITY_ORDER.filter((s) => report.priorityCounts[s] > 0).map((s) => (
                  <Badge key={s} variant={s === 'immediate' || s === 'high' ? 'destructive' : 'secondary'}>{s}: {report.priorityCounts[s]}</Badge>
                ))}
              </div>
            </section>

            {untraceable.length > 0 && (
              <p className="text-sm text-destructive">
                {untraceable.length} finding(s) have no original photo linked ({untraceable.map((e) => e.findingRef).join(', ')}) — link evidence before exporting.
              </p>
            )}

            {report.buildings.map((b) => (
              <section key={b.buildingLabel}>
                <h2 className="font-semibold mb-2">{b.buildingLabel}</h2>
                <div className="space-y-3">
                  {b.findings.map((e) => (
                    <div key={e.findingId} className="border rounded p-3 text-sm space-y-1">
                      <div className="flex gap-2 items-center">
                        <Badge variant="outline">{e.findingRef}</Badge>
                        <span className="font-medium">{e.component}</span>
                        <Badge variant={e.severity === 'immediate' || e.severity === 'high' ? 'destructive' : 'secondary'}>{e.severity}</Badge>
                        {e.waterExposureConcern && <Badge variant="destructive">water-entry concern</Badge>}
                      </div>
                      <p>{e.condition}{e.description ? ` — ${e.description}` : ''}</p>
                      {e.limitations && <p className="text-muted-foreground">Limitations: {e.limitations}</p>}
                      {e.recommendedVerification && <p className="text-muted-foreground">Recommended verification: {e.recommendedVerification}</p>}
                      {e.evidencePhotoPaths.length > 0 && (
                        <div className="flex flex-wrap gap-2 pt-1">
                          {e.evidencePhotoPaths.map((p) => (
                            <img key={p} src={evidencePhotoUrl(p)} alt={`Evidence for ${e.findingRef}`} className="h-20 w-20 rounded border object-cover" />
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            ))}

            {report.noDamageAreas.length > 0 && (
              <section>
                <h2 className="font-semibold mb-1">Components appearing visually normal</h2>
                <ul className="list-disc pl-5 text-sm">{report.noDamageAreas.map((a) => <li key={a}>{a}</li>)}</ul>
              </section>
            )}

            {([['Maintenance recommendations', report.maintenanceFindings ?? []], ['Areas not adequately assessed', report.unassessedFindings ?? []]] as const).map(([title, entries]) => entries.length > 0 && <section key={title}><h2 className="font-semibold mb-1">{title}</h2>{entries.map((e) => <div key={e.findingId} className="border-b py-2 text-sm"><p>{e.findingRef} · {e.buildingLabel} · {e.component}: {e.condition.replace(/_/g, ' ')}</p>{e.recommendedVerification && <p>{e.recommendedVerification}</p>}<div className="flex flex-wrap gap-2">{e.evidencePhotoPaths.map((p) => <img key={p} src={evidencePhotoUrl(p)} alt={`Evidence for ${e.findingRef}`} className="h-20 w-20 object-cover" />)}</div></div>)}</section>)}
            {report.limitations.length > 0 && (
              <section>
                <h2 className="font-semibold mb-1">Inspection limitations</h2>
                <ul className="list-disc pl-5 text-sm">{report.limitations.map((l) => <li key={l}>{l}</li>)}</ul>
              </section>
            )}

            <section>
              <h2 className="font-semibold mb-1">Recommended next steps</h2>
              <ul className="list-disc pl-5 text-sm">{report.recommendedNextSteps.map((s) => <li key={s}>{s}</li>)}</ul>
            </section>

            <section className="text-sm border-t pt-3">
              <h2 className="font-semibold mb-1">Inspector approval</h2>
              {report.approval
                ? <p>Approved by {report.approval.approvedBy} on {report.approval.approvedAt.slice(0, 10)}.</p>
                : <p className="text-muted-foreground">Not yet approved — this preview is a draft.</p>}
            </section>
          </CardContent>
        </Card>
      )}

      {versions.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Saved versions</CardTitle></CardHeader>
          <CardContent className="text-sm space-y-1">
            {versions.map((v) => (
              <div key={v.id} className="flex gap-2 items-center">
                <Badge variant={v.status === 'approved' ? 'default' : 'secondary'}>{v.status}</Badge>
                <span>Version {v.version} — {v.created_at.slice(0, 16).replace('T', ' ')}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
