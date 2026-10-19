import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { useEffectiveTenantId } from '@/hooks/useEffectiveTenantId';
import { useHasTrainingAccess } from '@/hooks/useHasTrainingAccess';
import { useAuth } from '@/contexts/AuthContext';
import { listFindings, listEvidence, reviewFinding, groupByBuilding, saveEvidenceAnnotations, evidencePhotoUrl, type PhotoFinding, type FindingEvidence } from '@/lib/photo-intelligence/findings';
import { loadRecordPhotos, analyzeRecordPhotos, type RecordPhoto, type AnalysisProgress } from '@/lib/photo-intelligence/analyzePhotos';
import { PhotoAnnotationEditor } from '@/components/photo-intelligence/PhotoAnnotationEditor';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Pencil } from 'lucide-react';
import { BackButton } from '@/shared/components/BackButton';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { Check, X, Camera, AlertTriangle } from 'lucide-react';

/**
 * Inspector review workspace (Photo Intelligence Phase 4, first cut).
 * AI-detected findings always start as "Needs review"; only human-approved
 * findings may appear in client reports (enforced in the database).
 */
export default function PhotoIntelligenceReviewPage() {
  const tenantId = useEffectiveTenantId();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [searchParams] = useSearchParams();
  const leadId = searchParams.get('leadId') ?? undefined;
  const projectId = searchParams.get('projectId') ?? undefined;
  const contactId = searchParams.get('contactId') ?? undefined;
  const recordScope = leadId || projectId || contactId ? { leadId, projectId, contactId } : null;
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [annotating, setAnnotating] = useState<{ evidence: FindingEvidence; finding: PhotoFinding } | null>(null);
  const [savingAnn, setSavingAnn] = useState(false);
  const [selectedPhotos, setSelectedPhotos] = useState<Set<string>>(new Set());
  const [analyzing, setAnalyzing] = useState(false);
  const [progress, setProgress] = useState<AnalysisProgress | null>(null);

  const { data: findings = [], isLoading } = useQuery({
    queryKey: ['photo-findings', tenantId, projectId ?? 'all'],
    queryFn: () => listFindings(tenantId!, projectId ? { projectId } : {}),
    enabled: !!tenantId,
  });

  const { data: recordPhotos = [] } = useQuery<RecordPhoto[]>({
    queryKey: ['photo-intel-record-photos', tenantId, leadId, projectId, contactId],
    queryFn: () => loadRecordPhotos(tenantId!, recordScope!),
    enabled: !!tenantId && !!recordScope,
  });

  const runAnalysis = async (photos: RecordPhoto[]) => {
    if (!tenantId || !user || photos.length === 0 || analyzing) return;
    setAnalyzing(true);
    setProgress(null);
    try {
      const outcome = await analyzeRecordPhotos(tenantId, user.id, photos, {
        projectId: projectId ?? null,
        onProgress: setProgress,
      });
      if (outcome.findingsCreated > 0) {
        toast.success(`${outcome.findingsCreated} possible anomal${outcome.findingsCreated === 1 ? 'y' : 'ies'} marked for inspector review (not confirmed damage)`);
      }
      if (outcome.noUnusualRegions) toast.info(`${outcome.noUnusualRegions} photo${outcome.noUnusualRegions === 1 ? '' : 's'} analyzed — no unusual regions found`);
      if (outcome.notAssessable) toast.warning(`${outcome.notAssessable} photo${outcome.notAssessable === 1 ? '' : 's'} could not be assessed (blurry, dark or overexposed)`);
      for (const err of outcome.errors) toast.error(`${err.fileName}: ${err.message}`);
      if (outcome.skippedDuplicates > 0) toast.info(`${outcome.skippedDuplicates} photo${outcome.skippedDuplicates === 1 ? '' : 's'} skipped (already analyzed)`);
      qc.invalidateQueries({ queryKey: ['photo-findings', tenantId] });
    } catch (e: any) {
      toast.error(e?.message ?? 'Analysis failed');
    } finally {
      setAnalyzing(false);
    }
  };

  const act = async (f: PhotoFinding, action: 'approve' | 'reject' | 'needs_closeup') => {
    if (!user) return;
    setBusy(f.id + action);
    try {
      await reviewFinding(f, action, user.id, notes[f.id]);
      toast.success(action === 'approve' ? 'Finding approved' : action === 'reject' ? 'Finding rejected' : 'Marked for close-up inspection');
      qc.invalidateQueries({ queryKey: ['photo-findings', tenantId] });
    } catch (e: any) {
      toast.error(e?.message ?? 'Review failed');
    } finally {
      setBusy(null);
    }
  };

  const { data: evidenceByFinding = {} } = useQuery({
    queryKey: ['photo-finding-evidence', tenantId, findings.map((f) => f.id).join(',')],
    queryFn: async () => {
      const out: Record<string, FindingEvidence[]> = {};
      for (const f of findings) out[f.id] = await listEvidence(f.id);
      return out;
    },
    enabled: !!tenantId && findings.length > 0,
  });

  const saveAnnotations = async (json: Record<string, unknown>) => {
    if (!annotating) return;
    setSavingAnn(true);
    try {
      await saveEvidenceAnnotations(annotating.evidence.id, json, 'manual');
      setAnnotating(null);
      qc.invalidateQueries({ queryKey: ['photo-finding-evidence'] });
    } finally {
      setSavingAnn(false);
    }
  };

  const grouped = groupByBuilding(findings);

  return (
    <div className="container mx-auto max-w-5xl p-6 space-y-6">
      <div>
        <BackButton fallbackPath="/dashboard" label="Back" />
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Photo Intelligence — Inspector Review</h1>
          <div className="flex flex-wrap gap-2">
          {canAccessTrainer.data === true && <Button variant="outline" size="sm" asChild><a href="/photo-intelligence/training">Labeling &amp; model training</a></Button>}
          <Button variant="outline" size="sm" asChild>
            <a href={`/photo-intelligence/report${projectId ? `?projectId=${projectId}` : ''}`}>View report</a>
          </Button>
          </div>
        </div>
        <p className="text-muted-foreground text-sm mt-1">
          Review proposed damage findings. Only approved findings appear in customer reports.
          AI proposals are unverified until you approve them.
        </p>
      </div>

      {recordScope && (
        <Card>
          <CardHeader><CardTitle className="text-lg">Analyze this record's photos</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {recordPhotos.length === 0 ? (
              <p className="text-sm text-muted-foreground">No photos found for this record yet. Upload photos on the record's Photos tab first.</p>
            ) : (
              <>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" disabled={analyzing} onClick={() => runAnalysis(recordPhotos)}>
                    {analyzing ? 'Analyzing…' : `Analyze All (${recordPhotos.length})`}
                  </Button>
                  <Button
                    size="sm" variant="outline" disabled={analyzing || selectedPhotos.size === 0}
                    onClick={() => runAnalysis(recordPhotos.filter((p) => selectedPhotos.has(p.id)))}
                  >
                    Analyze Selected ({selectedPhotos.size})
                  </Button>
                </div>
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                  {recordPhotos.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setSelectedPhotos((prev) => {
                        const next = new Set(prev);
                        if (next.has(p.id)) next.delete(p.id); else next.add(p.id);
                        return next;
                      })}
                      className={`relative border rounded overflow-hidden aspect-square ${selectedPhotos.has(p.id) ? 'ring-2 ring-primary' : ''}`}
                      title={p.file_name ?? 'Photo'}
                    >
                      {p.file_url && <img src={p.file_url} alt={p.file_name ?? 'Photo'} className="object-cover w-full h-full" />}
                      {selectedPhotos.has(p.id) && (
                        <span className="absolute top-1 right-1 bg-primary text-primary-foreground rounded-full p-0.5"><Check className="h-3 w-3" /></span>
                      )}
                    </button>
                  ))}
                </div>
                {progress && (
                  <p className="text-sm text-muted-foreground">
                    Analyzed {progress.done}/{progress.total}
                    {progress.currentFile ? ` — ${progress.currentFile}` : ''}
                    {progress.proposals > 0 ? ` · ${progress.proposals} candidate${progress.proposals === 1 ? '' : 's'}` : ''}
                    {progress.errors.length > 0 ? ` · ${progress.errors.length} failed` : ''}
                  </p>
                )}
              </>
            )}
          </CardContent>
        </Card>
      )}

      {isLoading && <p className="text-muted-foreground">Loading findings…</p>}
      {!isLoading && findings.length === 0 && (
        <Card><CardContent className="py-8 text-center text-muted-foreground">
          No findings yet. Findings are created by the recognition engine or added manually during an inspection.
        </CardContent></Card>
      )}

      {[...grouped.entries()].map(([building, items]) => (
        <Card key={building}>
          <CardHeader><CardTitle className="text-lg">{building}</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {items.map((f) => (
              <div key={f.id} className="border rounded-md p-4 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono font-semibold">{f.finding_ref}</span>
                  <Badge variant={f.review_status === 'approved' ? 'default' : f.review_status === 'rejected' ? 'destructive' : 'secondary'}>
                    {f.review_status === 'pending' ? 'Needs review' : f.review_status}
                  </Badge>
                  {f.detection_source === 'ai' && (
                    <Badge variant="outline" className="gap-1">
                      <AlertTriangle className="h-3 w-3" />
                      AI proposal{f.ai_confidence != null ? ` · ${(f.ai_confidence * 100).toFixed(0)}%` : ''} — unverified
                    </Badge>
                  )}
                  {f.water_exposure_concern && <Badge variant="outline">Water-exposure concern</Badge>}
                </div>
                <p className="text-sm"><span className="font-medium">{f.component}</span>{f.material ? ` · ${f.material}` : ''} — {f.visible_condition}</p>
                {f.condition_description && <p className="text-sm text-muted-foreground">{f.condition_description}</p>}
                {f.limitations && <p className="text-xs text-muted-foreground">Limitations: {f.limitations}</p>}
                {(evidenceByFinding[f.id] ?? []).length > 0 && (
                  <div className="flex flex-wrap gap-2 pt-1">
                    {(evidenceByFinding[f.id] ?? []).map((ev) => (
                      <div key={ev.id} className="flex items-center gap-1">
                        {ev.storage_path && (
                          <img src={evidencePhotoUrl(ev.storage_path)} alt="" className="h-14 w-14 rounded border object-cover" />
                        )}
                        <Button size="sm" variant="outline" onClick={() => setAnnotating({ evidence: ev, finding: f })} disabled={!ev.storage_path}>
                          <Pencil className="h-3 w-3 mr-1" /> Annotate
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
                {f.recommended_verification && <p className="text-xs">Verify: {f.recommended_verification}</p>}
                {f.measured_quantity != null && (
                  <p className="text-xs">Quantity: {f.measured_quantity} {f.measured_unit ?? ''} (source: {f.measurement_source})</p>
                )}
                {f.review_status === 'pending' && (
                  <div className="space-y-2 pt-1">
                    <Textarea
                      placeholder="Review notes (optional)"
                      value={notes[f.id] ?? ''}
                      onChange={(e) => setNotes((n) => ({ ...n, [f.id]: e.target.value }))}
                      rows={2}
                    />
                    <div className="flex gap-2">
                      <Button size="sm" disabled={busy !== null} onClick={() => act(f, 'approve')}>
                        <Check className="h-4 w-4 mr-1" /> Approve
                      </Button>
                      <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => act(f, 'needs_closeup')}>
                        <Camera className="h-4 w-4 mr-1" /> Needs close-up
                      </Button>
                      <Button size="sm" variant="destructive" disabled={busy !== null} onClick={() => act(f, 'reject')}>
                        <X className="h-4 w-4 mr-1" /> Reject
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      ))}
      <Dialog open={!!annotating} onOpenChange={(o) => !o && setAnnotating(null)}>
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <DialogTitle>
              Annotate evidence — {annotating?.finding.finding_ref}
            </DialogTitle>
          </DialogHeader>
          {annotating?.evidence.storage_path && (
            <PhotoAnnotationEditor
              imageUrl={evidencePhotoUrl(annotating.evidence.storage_path)}
              initialAnnotations={annotating.evidence.annotation}
              findings={findings.map((f) => ({ id: f.id, finding_ref: f.finding_ref, component: f.component }))}
              onSave={saveAnnotations}
              saving={savingAnn}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
