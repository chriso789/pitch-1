/**
 * Photo Intelligence report preview (Phase 6).
 * Renders the composed report from APPROVED findings only. Export requires a
 * recorded inspector approval. Every save creates a new immutable version.
 */
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffectiveTenantId } from '@/hooks/useEffectiveTenantId';
import { useAuth } from '@/hooks/useAuth';
import { listFindings, listEvidence, evidencePhotoUrl, type PhotoFinding, type FindingEvidence } from '@/lib/photo-intelligence/findings';
import { composeReport, findUntraceableEntries, SEVERITY_ORDER, type PhotoIntelligenceReport } from '@/lib/photo-intelligence/reportModel';
import { saveReportVersion, listReportVersions } from '@/lib/photo-intelligence/reports';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { Printer, Save, ShieldAlert } from 'lucide-react';

export default function PhotoIntelligenceReportPage() {
  const tenantId = useEffectiveTenantId();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [inspectorName, setInspectorName] = useState('');
  const [address, setAddress] = useState('');
  const [busy, setBusy] = useState(false);

  const { data: findings = [] } = useQuery({
    queryKey: ['photo-findings', tenantId],
    queryFn: () => listFindings(tenantId!),
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
    queryKey: ['photo-intel-reports', tenantId],
    queryFn: () => listReportVersions(tenantId!),
    enabled: !!tenantId,
  });

  const approved = useMemo(() => findings.filter((f) => f.review_status === 'approved'), [findings]);
  const unapprovedCount = findings.length - approved.length;

  const report: PhotoIntelligenceReport | null = useMemo(() => {
    if (approved.length === 0) return null;
    try {
      return composeReport({
        branding: { companyName: 'PITCH CRM' },
        property: {
          address: address || 'Address not set',
          inspectedAt: new Date().toISOString(),
          inspectorName: inspectorName || 'Inspector not recorded',
        },
        findings: approved,
        evidenceByFinding,
        approval: null,
        version: (versions[0]?.version ?? 0) + 1,
      });
    } catch {
      return null;
    }
  }, [approved, evidenceByFinding, address, inspectorName, versions]);

  const untraceable = report ? findUntraceableEntries(report) : [];

  const save = async (status: 'draft' | 'approved') => {
    if (!report || !tenantId || !user) return;
    if (status === 'approved' && !inspectorName.trim()) {
      toast.error('Record the inspector name before approving the report.');
      return;
    }
    setBusy(true);
    try {
      const toSave = status === 'approved'
        ? { ...report, approval: { approvedBy: inspectorName.trim(), approvedAt: new Date().toISOString() } }
        : report;
      await saveReportVersion(tenantId, null, toSave, status, user.id);
      qc.invalidateQueries({ queryKey: ['photo-intel-reports'] });
      toast.success(`Report version ${toSave.version} saved (${status}).`);
    } catch (e: any) {
      toast.error(e?.message ?? 'Could not save the report.');
    } finally {
      setBusy(false);
    }
  };

  const latestApproved = versions.find((v) => v.status === 'approved');

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
        <Button variant="outline" disabled={!report || busy} onClick={() => save('draft')}><Save className="h-4 w-4 mr-1" /> Save draft version</Button>
        <Button disabled={!report || busy || !inspectorName.trim()} onClick={() => save('approved')}>Approve & save version</Button>
        <Button variant="secondary" disabled={!latestApproved} onClick={() => window.print()}>
          <Printer className="h-4 w-4 mr-1" /> Export PDF
        </Button>
      </div>
      {!latestApproved && report && (
        <p className="text-xs text-muted-foreground">Export is available after an approved version is saved.</p>
      )}

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
                <h2 className="font-semibold mb-1">Areas inspected — no visible damage</h2>
                <ul className="list-disc pl-5 text-sm">{report.noDamageAreas.map((a) => <li key={a}>{a}</li>)}</ul>
              </section>
            )}

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
