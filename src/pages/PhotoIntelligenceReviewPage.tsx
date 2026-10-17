import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffectiveTenantId } from '@/hooks/useEffectiveTenantId';
import { useAuth } from '@/contexts/AuthContext';
import { listFindings, listEvidence, reviewFinding, groupByBuilding, saveEvidenceAnnotations, evidencePhotoUrl, type PhotoFinding, type FindingEvidence } from '@/lib/photo-intelligence/findings';
import { PhotoAnnotationEditor } from '@/components/photo-intelligence/PhotoAnnotationEditor';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Pencil } from 'lucide-react';
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
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [annotating, setAnnotating] = useState<{ evidence: FindingEvidence; finding: PhotoFinding } | null>(null);
  const [savingAnn, setSavingAnn] = useState(false);

  const { data: findings = [], isLoading } = useQuery({
    queryKey: ['photo-findings', tenantId],
    queryFn: () => listFindings(tenantId!),
    enabled: !!tenantId,
  });

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

  const grouped = groupByBuilding(findings);

  return (
    <div className="container mx-auto max-w-5xl p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Photo Intelligence — Inspector Review</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Review proposed damage findings. Only approved findings appear in customer reports.
          AI proposals are unverified until you approve them.
        </p>
      </div>

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
    </div>
  );
}
