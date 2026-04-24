import { useState, useMemo, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { CheckCircle2, ChevronLeft, ChevronRight, Trash2, Plus, Sparkles, AlertTriangle, RefreshCw, ImageOff } from 'lucide-react';
import { toast } from '@/components/ui/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { DimensionedPlanDrawing, type PlanEdge, type EdgeType, type AerialBackground } from './DimensionedPlanDrawing';

interface EdgeConfirmationWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pipelineEntryId: string;
  initialEdges?: PlanEdge[];
  aerial?: AerialBackground | null;
  footprintGeo?: Array<[number, number]>;
  onSaved?: () => void;
  onRerunMeasurement?: () => void;
}

const EDGE_TYPES: { value: EdgeType; label: string; hint: string }[] = [
  { value: 'eave',   label: 'Eave',   hint: 'Bottom horizontal edge where gutters attach' },
  { value: 'ridge',  label: 'Ridge',  hint: 'Top horizontal peak where two slopes meet' },
  { value: 'hip',    label: 'Hip',    hint: 'External sloping line where two roof faces meet' },
  { value: 'valley', label: 'Valley', hint: 'Internal sloping line where two roof faces meet' },
  { value: 'rake',   label: 'Rake',   hint: 'Sloped edge of a gable end' },
];

function makeEmptyEdge(idx: number): PlanEdge {
  // Default placeholder square footprint
  const positions: [number, number][][] = [
    [[0, 0], [40, 0]],
    [[40, 0], [40, 30]],
    [[40, 30], [0, 30]],
    [[0, 30], [0, 0]],
  ];
  const i = idx % positions.length;
  const [p1, p2] = positions[i];
  const len = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
  return { id: `edge-${Date.now()}-${idx}`, type: 'eave', p1, p2, length_ft: len, confirmed: false };
}

export function EdgeConfirmationWizard({
  open,
  onOpenChange,
  pipelineEntryId,
  initialEdges,
  aerial,
  footprintGeo,
  onSaved,
  onRerunMeasurement,
}: EdgeConfirmationWizardProps) {
  const [edges, setEdges] = useState<PlanEdge[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      const seed = initialEdges && initialEdges.length > 0
        ? initialEdges.map((e, i) => ({ ...e, id: e.id || `edge-${i}`, confirmed: false }))
        : Array.from({ length: 4 }, (_, i) => makeEmptyEdge(i));
      setEdges(seed);
      setCurrentIdx(0);
    }
  }, [open, initialEdges]);

  const totals = useMemo(() => {
    const t: Record<EdgeType, number> = { ridge: 0, hip: 0, valley: 0, eave: 0, rake: 0 };
    edges.forEach(e => { if (e.confirmed) t[e.type] += e.length_ft; });
    return t;
  }, [edges]);

  // Geometry validation — runs on every edit so we can block bad confirms.
  const geometryIssues = useMemo(() => {
    const issues: string[] = [];
    if (edges.length < 3) {
      issues.push('Roof outline needs at least 3 edges to form a closed boundary.');
    }
    // Check for zero-length / impossible edges
    const bad = edges.filter(e => !Number.isFinite(e.length_ft) || e.length_ft <= 0.5);
    if (bad.length > 0) {
      issues.push(`${bad.length} edge(s) have a zero or impossible length (< 0.5 ft).`);
    }
    // Check for disconnected boundary using endpoint coincidence (1 ft tolerance)
    const TOL = 1.0;
    const endpoints = edges.flatMap(e => [e.p1, e.p2]);
    const orphanCount = endpoints.filter(pt => {
      const matches = endpoints.filter(o => o !== pt && Math.hypot(o[0] - pt[0], o[1] - pt[1]) <= TOL).length;
      return matches === 0;
    }).length;
    if (orphanCount > 0 && edges.length >= 3) {
      issues.push(`${orphanCount} edge endpoint(s) don't connect to another edge — boundary has gaps.`);
    }
    // Eaves must exist on a real roof
    const hasEave = edges.some(e => e.type === 'eave');
    if (edges.length >= 3 && !hasEave) {
      issues.push('No eaves marked — every roof needs at least one eave (gutter line).');
    }
    return issues;
  }, [edges]);

  const confirmedCount = edges.filter(e => e.confirmed).length;
  const progress = edges.length > 0 ? (confirmedCount / edges.length) * 100 : 0;
  const current = edges[currentIdx];
  const allConfirmed = confirmedCount === edges.length && edges.length > 0;
  const canSave = allConfirmed && geometryIssues.length === 0;
  const missingAerial = !aerial?.imageUrl;
  const missingTracedNetwork = !initialEdges || initialEdges.length === 0;

  const updateCurrent = (patch: Partial<PlanEdge>) => {
    setEdges(prev => prev.map((e, i) => i === currentIdx ? { ...e, ...patch } : e));
  };

  const handleConfirm = () => {
    updateCurrent({ confirmed: true });
    if (currentIdx < edges.length - 1) {
      setCurrentIdx(currentIdx + 1);
    }
  };

  const handleAddEdge = () => {
    const newEdge = makeEmptyEdge(edges.length);
    setEdges([...edges, newEdge]);
    setCurrentIdx(edges.length);
  };

  const handleRemoveEdge = () => {
    if (edges.length <= 1) return;
    const next = edges.filter((_, i) => i !== currentIdx);
    setEdges(next);
    setCurrentIdx(Math.max(0, currentIdx - 1));
  };

  const handleSave = async () => {
    if (!allConfirmed) {
      toast({ title: 'Confirm all edges first', variant: 'destructive' });
      return;
    }
    if (geometryIssues.length > 0) {
      toast({
        title: 'Geometry checks failed',
        description: geometryIssues[0],
        variant: 'destructive',
      });
      return;
    }
    setSaving(true);
    try {
      const tags = {
        source: 'edge_wizard_verified',
        verified_to_100_percent: true,
        verified_at: new Date().toISOString(),
        edge_count: edges.length,
        totals_lf: totals,
        edges: edges.map(e => ({
          type: e.type,
          length_ft: e.length_ft,
          p1: e.p1,
          p2: e.p2,
        })),
      };

      const { data, error } = await supabase.functions.invoke('measure', {
        body: {
          action: 'manual-verify',
          propertyId: pipelineEntryId,
          measurement: {
            measurements: {
              lengths_ft: {
                ridge: totals.ridge,
                hip: totals.hip,
                valley: totals.valley,
                eave: totals.eave,
                rake: totals.rake,
              },
            },
          },
          tags,
        },
      });

      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || 'Save failed');

      toast({ title: '✓ Verified to 100%', description: 'Dimensioned plan saved as the active measurement.' });
      onSaved?.();
      onOpenChange(false);
    } catch (e: any) {
      toast({ title: 'Save failed', description: e?.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            Edge-by-Edge Verification — 100% Accuracy
          </DialogTitle>
          <DialogDescription>
            Confirm each edge's type and exact length. Once all edges are confirmed, the measurement is locked at 100% accuracy.
          </DialogDescription>
        </DialogHeader>

        {/* Missing-data fallback: explain why aerial / traced network is missing */}
        {(missingAerial || missingTracedNetwork) && (
          <Alert variant="default" className="border-amber-300 bg-amber-50 dark:bg-amber-950/30">
            <ImageOff className="h-4 w-4 text-amber-600" />
             <AlertTitle className="text-amber-900 dark:text-amber-200">
               Latest measurement is incomplete
            </AlertTitle>
            <AlertDescription className="text-amber-800 dark:text-amber-300 space-y-2">
              <ul className="list-disc list-inside text-xs">
                 {missingAerial && <li>Could not build a live aerial background from the property coordinates for this run.</li>}
                 {missingTracedNetwork && <li>No traced edge network was returned by the AI for this measurement.</li>}
              </ul>
              {onRerunMeasurement && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={onRerunMeasurement}
                  className="border-amber-400 text-amber-900 hover:bg-amber-100"
                >
                  <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                  Re-run measurement analysis
                </Button>
              )}
            </AlertDescription>
          </Alert>
        )}

        {/* Geometry validation issues */}
        {geometryIssues.length > 0 && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Geometry issues — fix before confirming</AlertTitle>
            <AlertDescription>
              <ul className="list-disc list-inside text-xs mt-1">
                {geometryIssues.map((iss, i) => <li key={i}>{iss}</li>)}
              </ul>
            </AlertDescription>
          </Alert>
        )}

        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">
              Edge {currentIdx + 1} of {edges.length} · {confirmedCount} confirmed
            </span>
            <Badge variant={allConfirmed ? 'default' : 'secondary'}>
              {progress.toFixed(0)}%
            </Badge>
          </div>
          <Progress value={progress} className="h-2" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 overflow-hidden flex-1">
          {/* Plan drawing */}
          <ScrollArea className="border rounded-lg p-2">
            <DimensionedPlanDrawing
              edges={edges}
              highlightEdgeId={current?.id}
              aerial={aerial ?? null}
              footprintGeo={footprintGeo}
            />
            <div className="grid grid-cols-5 gap-2 mt-3 text-xs">
              {(Object.keys(totals) as EdgeType[]).map(t => (
                <div key={t} className="text-center p-2 bg-muted/40 rounded">
                  <div className="text-muted-foreground capitalize">{t}</div>
                  <div className="font-semibold">{totals[t].toFixed(1)} lf</div>
                </div>
              ))}
            </div>
          </ScrollArea>

          {/* Wizard form */}
          {current && (
            <div className="space-y-4 overflow-y-auto pr-2">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold">
                  Edge #{currentIdx + 1}
                  {current.confirmed && <CheckCircle2 className="inline h-4 w-4 ml-2 text-success" />}
                </h3>
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" onClick={handleRemoveEdge} disabled={edges.length <= 1}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                  <Button size="sm" variant="ghost" onClick={handleAddEdge}>
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Edge type</Label>
                <ToggleGroup
                  type="single"
                  value={current.type}
                  onValueChange={(v) => v && updateCurrent({ type: v as EdgeType })}
                  className="justify-start flex-wrap"
                >
                  {EDGE_TYPES.map(et => (
                    <ToggleGroupItem key={et.value} value={et.value} className="text-xs">
                      {et.label}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
                <p className="text-xs text-muted-foreground">
                  {EDGE_TYPES.find(e => e.value === current.type)?.hint}
                </p>
              </div>

              <div className="space-y-2">
                <Label>Length (linear feet)</Label>
                <Input
                  type="number"
                  step="0.1"
                  min="0"
                  value={current.length_ft}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value) || 0;
                    // Scale geometry to match new length while keeping direction
                    const dx = current.p2[0] - current.p1[0];
                    const dy = current.p2[1] - current.p1[1];
                    const oldLen = Math.hypot(dx, dy) || 1;
                    const ratio = val / oldLen;
                    updateCurrent({
                      length_ft: val,
                      p2: [current.p1[0] + dx * ratio, current.p1[1] + dy * ratio],
                    });
                  }}
                />
                <p className="text-xs text-muted-foreground">
                  Measure from blueprint, EagleView, or field tape. Round to nearest 0.1 ft.
                </p>
              </div>

              <div className="flex items-center justify-between pt-2 border-t">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentIdx(Math.max(0, currentIdx - 1))}
                  disabled={currentIdx === 0}
                >
                  <ChevronLeft className="h-4 w-4 mr-1" /> Previous
                </Button>
                <Button onClick={handleConfirm} size="sm">
                  {currentIdx === edges.length - 1 ? 'Confirm' : 'Confirm & Next'}
                  <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              </div>

              <div className="grid grid-cols-2 gap-1 pt-2">
                {edges.map((e, i) => (
                  <button
                    key={e.id}
                    onClick={() => setCurrentIdx(i)}
                    className={`text-xs px-2 py-1 rounded border text-left flex items-center justify-between ${
                      i === currentIdx ? 'border-primary bg-primary/5' : 'border-border'
                    }`}
                  >
                    <span className="capitalize">#{i + 1} {e.type}</span>
                    {e.confirmed && <CheckCircle2 className="h-3 w-3 text-success" />}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="border-t pt-3">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!canSave || saving}>
            {saving
              ? 'Saving…'
              : geometryIssues.length > 0
                ? `Fix ${geometryIssues.length} geometry issue(s)`
                : allConfirmed
                  ? '✓ Save 100% Verified Plan'
                  : `Confirm ${edges.length - confirmedCount} more edge(s)`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
