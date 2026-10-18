import { useCallback, useMemo, useRef, useState } from 'react';
import {
  type Annotation,
  type Point,
  type AnnotationHistory,
  ANNOTATION_COLORS,
  DAMAGE_CATEGORIES,
  newAnnotationId,
  createHistory,
  pushHistory,
  undoHistory,
  redoHistory,
  canUndo,
  canRedo,
  clampPoint,
  hitTest,
  validateAnnotation,
  movePolygonVertex,
  insertPolygonVertex,
  deletePolygonVertex,
  translateAnnotation,
  nextCalloutLabel,
  serializeAnnotations,
  parseAnnotationSet,
} from '@/lib/photo-intelligence/annotations';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Undo2,
  Redo2,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Trash2,
  Save,
  MousePointer2,
  Hexagon,
  Square,
  Circle,
  ArrowRight,
  MapPin,
  Hand,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

export type EditorTool = 'select' | 'pan' | 'polygon' | 'bbox' | 'circle' | 'arrow' | 'callout';

export interface PhotoAnnotationEditorProps {
  /** URL of the original photo. It is rendered read-only; never modified. */
  imageUrl: string;
  /** Previously saved annotation JSON (photo_finding_evidence.annotation). */
  initialAnnotations?: unknown;
  /** Available findings on this inspection the user can attach annotations to. */
  findings?: { id: string; finding_ref: string; component: string }[];
  /** Called with geometry-only JSON to persist on the evidence row. */
  onSave: (annotationJson: Record<string, unknown>) => Promise<void>;
  saving?: boolean;
  damageCategories?: readonly string[];
}

/**
 * Photo Intelligence annotation editor (Phase 3).
 *
 * The photograph renders once, read-only. All marks live in a vector overlay
 * in normalized coordinates, saved as JSON separate from the image — so every
 * annotation stays editable and the original evidence is never altered.
 */
export function PhotoAnnotationEditor({
  imageUrl,
  initialAnnotations,
  findings = [],
  onSave,
  saving,
  damageCategories = DAMAGE_CATEGORIES,
}: PhotoAnnotationEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [tool, setTool] = useState<EditorTool>('select');
  const [color, setColor] = useState<string>(ANNOTATION_COLORS[0]);
  const [history, setHistory] = useState<AnnotationHistory>(() =>
    createHistory(parseAnnotationSet(initialAnnotations)),
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<Point>({ x: 0, y: 0 });
  const [draft, setDraft] = useState<Point[]>([]); // in-progress polygon/bbox drag
  const dragRef = useRef<{ mode: 'pan' | 'move' | 'vertex' | 'draw'; start: Point; vertexIndex?: number; annotationId?: string; panStart?: Point } | null>(null);

  const annotations = history.present;
  const selected = useMemo(() => annotations.find((a) => a.id === selectedId) ?? null, [annotations, selectedId]);

  const commit = useCallback((next: Annotation[]) => {
    setHistory((h) => pushHistory(h, next));
  }, []);

  /** Convert a pointer event to normalized image coordinates. */
  const toImagePoint = useCallback((e: React.PointerEvent): Point => {
    const el = containerRef.current;
    if (!el) return { x: 0, y: 0 };
    const rect = el.getBoundingClientRect();
    return clampPoint({
      x: (e.clientX - rect.left - pan.x * rect.width) / (rect.width * zoom),
      y: (e.clientY - rect.top - pan.y * rect.height) / (rect.height * zoom),
    });
  }, [pan, zoom]);

  const finishDraft = useCallback(
    (end: Point) => {
      if (tool === 'polygon') {
        if (draft.length < 3) {
          setDraft([]);
          return;
        }
        const ann: Annotation = { id: newAnnotationId(), kind: 'polygon', color, points: draft, label: nextCalloutLabel(annotations) };
        const problem = validateAnnotation(ann);
        if (problem) {
          toast.error(problem);
          setDraft([]);
          return;
        }
        commit([...annotations, ann]);
        setSelectedId(ann.id);
        setDraft([]);
        return;
      }
      if (draft.length === 0) return;
      const start = draft[0];
      let ann: Annotation | null = null;
      if (tool === 'bbox') {
        ann = {
          id: newAnnotationId(),
          kind: 'bbox',
          color,
          label: nextCalloutLabel(annotations),
          origin: { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y) },
          size: { x: Math.abs(end.x - start.x), y: Math.abs(end.y - start.y) },
        };
      } else if (tool === 'circle') {
        ann = {
          id: newAnnotationId(),
          kind: 'circle',
          color,
          label: nextCalloutLabel(annotations),
          center: start,
          radius: Math.hypot(end.x - start.x, end.y - start.y),
        };
      } else if (tool === 'arrow') {
        ann = { id: newAnnotationId(), kind: 'arrow', color, label: nextCalloutLabel(annotations), from: start, to: end };
      }
      if (ann) {
        const problem = validateAnnotation(ann);
        if (problem) {
          toast.error(problem);
        } else {
          commit([...annotations, ann]);
          setSelectedId(ann.id);
        }
      }
      setDraft([]);
    },
    [tool, draft, color, annotations, commit],
  );

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const p = toImagePoint(e);
    if (tool === 'pan') {
      dragRef.current = { mode: 'pan', start: { x: e.clientX, y: e.clientY }, panStart: pan };
      return;
    }
    if (tool === 'polygon') {
      // click to add vertices; double-click / click near first vertex closes
      if (draft.length >= 3 && Math.hypot(p.x - draft[0].x, p.y - draft[0].y) < 0.03 / zoom) {
        finishDraft(p);
      } else {
        setDraft((d) => [...d, p]);
      }
      return;
    }
    if (tool === 'bbox' || tool === 'circle' || tool === 'arrow') {
      setDraft([p]);
      dragRef.current = { mode: 'draw', start: p };
      return;
    }
    if (tool === 'callout') {
      const ann: Annotation = {
        id: newAnnotationId(),
        kind: 'callout',
        color,
        at: p,
        label: nextCalloutLabel(annotations),
      };
      commit([...annotations, ann]);
      setSelectedId(ann.id);
      return;
    }
    // select tool: vertex grab → annotation drag → hit select
    if (selected?.kind === 'polygon') {
      const idx = selected.points.findIndex((v) => Math.hypot(v.x - p.x, v.y - p.y) < 0.02 / zoom);
      if (idx >= 0) {
        dragRef.current = { mode: 'vertex', start: p, vertexIndex: idx, annotationId: selected.id };
        return;
      }
    }
    const hit = [...annotations].reverse().find((a) => hitTest(a, p, 0.02 / zoom));
    if (hit) {
      setSelectedId(hit.id);
      dragRef.current = { mode: 'move', start: p, annotationId: hit.id };
    } else {
      setSelectedId(null);
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    if (drag.mode === 'pan' && drag.panStart) {
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      setPan({
        x: drag.panStart.x + (e.clientX - drag.start.x) / rect.width,
        y: drag.panStart.y + (e.clientY - drag.start.y) / rect.height,
      });
      return;
    }
    const p = toImagePoint(e);
    if (drag.mode === 'draw') {
      setDraft([drag.start, p]);
      return;
    }
    if (drag.mode === 'vertex' && drag.annotationId != null && drag.vertexIndex != null) {
      commit(
        annotations.map((a) =>
          a.id === drag.annotationId && a.kind === 'polygon' ? movePolygonVertex(a, drag.vertexIndex!, p) : a,
        ),
      );
      return;
    }
    if (drag.mode === 'move' && drag.annotationId) {
      const dx = p.x - drag.start.x;
      const dy = p.y - drag.start.y;
      if (Math.abs(dx) + Math.abs(dy) < 1e-5) return;
      commit(annotations.map((a) => (a.id === drag.annotationId ? translateAnnotation(a, dx, dy) : a)));
      dragRef.current = { ...drag, start: p };
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (drag?.mode === 'draw') finishDraft(toImagePoint(e));
  };

  const updateSelected = (patch: Partial<Annotation>) => {
    if (!selected) return;
    commit(annotations.map((a) => (a.id === selected.id ? ({ ...a, ...patch } as Annotation) : a)));
  };

  const deleteSelected = () => {
    if (!selected) return;
    commit(annotations.filter((a) => a.id !== selected.id));
    setSelectedId(null);
  };

  const handleSave = async () => {
    for (const a of annotations) {
      const problem = validateAnnotation(a);
      if (problem) {
        toast.error(`Annotation ${a.label ?? ''}: ${problem}`);
        return;
      }
    }
    try {
      await onSave(serializeAnnotations(annotations) as unknown as Record<string, unknown>);
      toast.success('Annotations saved — original photo unchanged');
    } catch (err: any) {
      toast.error(err?.message ?? 'Could not save annotations');
    }
  };

  const zoomBy = (factor: number) => setZoom((z) => Math.min(8, Math.max(0.5, z * factor)));

  const svgContent = (a: Annotation, isSelected: boolean) => {
    const stroke = isSelected ? '#ffffff' : a.color;
    const common = { stroke, strokeWidth: isSelected ? 0.006 : 0.004, fill: 'none', vectorEffect: 'non-scaling-stroke' as const };
    switch (a.kind) {
      case 'polygon':
        return (
          <polygon
            {...common}
            fill={a.color + '33'}
            points={a.points.map((p) => `${p.x},${p.y}`).join(' ')}
          />
        );
      case 'bbox':
        return <rect {...common} fill={a.color + '22'} x={a.origin.x} y={a.origin.y} width={a.size.x} height={a.size.y} />;
      case 'circle':
        return <circle {...common} fill={a.color + '22'} cx={a.center.x} cy={a.center.y} r={a.radius} />;
      case 'arrow': {
        return (
          <g>
            <line {...common} x1={a.from.x} y1={a.from.y} x2={a.to.x} y2={a.to.y} />
            <circle cx={a.to.x} cy={a.to.y} r={0.008} fill={stroke} />
          </g>
        );
      }
      case 'callout':
        return (
          <g>
            <circle cx={a.at.x} cy={a.at.y} r={0.018} fill={a.color} stroke="#fff" strokeWidth={0.003} />
            <text x={a.at.x} y={a.at.y + 0.007} textAnchor="middle" fontSize={0.022} fill="#fff" fontWeight="bold">
              {a.label ?? ''}
            </text>
          </g>
        );
    }
  };

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-1.5">
        {(
          [
            ['select', MousePointer2, 'Select / edit'],
            ['pan', Hand, 'Pan'],
            ['polygon', Hexagon, 'Damage polygon'],
            ['bbox', Square, 'Bounding box'],
            ['circle', Circle, 'Circle'],
            ['arrow', ArrowRight, 'Arrow'],
            ['callout', MapPin, 'Numbered callout'],
          ] as const
        ).map(([t, Icon, label]) => (
          <Button key={t} size="sm" variant={tool === t ? 'default' : 'outline'} title={label} onClick={() => { setTool(t); setDraft([]); }}>
            <Icon className="h-4 w-4" />
          </Button>
        ))}
        <span className="mx-1 h-6 w-px bg-border" />
        {ANNOTATION_COLORS.map((c) => (
          <button
            key={c}
            aria-label={`Color ${c}`}
            className={cn('h-6 w-6 rounded-full border-2', color === c ? 'border-foreground' : 'border-transparent')}
            style={{ backgroundColor: c }}
            onClick={() => setColor(c)}
          />
        ))}
        <span className="mx-1 h-6 w-px bg-border" />
        <Button size="sm" variant="outline" disabled={!canUndo(history)} onClick={() => setHistory(undoHistory)} title="Undo">
          <Undo2 className="h-4 w-4" />
        </Button>
        <Button size="sm" variant="outline" disabled={!canRedo(history)} onClick={() => setHistory(redoHistory)} title="Redo">
          <Redo2 className="h-4 w-4" />
        </Button>
        <Button size="sm" variant="outline" onClick={() => zoomBy(1.25)} title="Zoom in"><ZoomIn className="h-4 w-4" /></Button>
        <Button size="sm" variant="outline" onClick={() => zoomBy(0.8)} title="Zoom out"><ZoomOut className="h-4 w-4" /></Button>
        <Button size="sm" variant="outline" onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }} title="Fit"><Maximize2 className="h-4 w-4" /></Button>
        <div className="flex-1" />
        <Button size="sm" onClick={handleSave} disabled={saving}>
          <Save className="h-4 w-4 mr-1" /> {saving ? 'Saving…' : 'Save annotations'}
        </Button>
      </div>

      <div className="grid gap-3 lg:grid-cols-[1fr_260px]">
        {/* Canvas */}
        <div
          ref={containerRef}
          className={cn(
            'relative w-full overflow-hidden rounded-md border bg-black select-none touch-none',
            tool === 'pan' ? 'cursor-grab' : tool === 'select' ? 'cursor-default' : 'cursor-crosshair',
          )}
          style={{ aspectRatio: '4 / 3' }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onDoubleClick={() => tool === 'polygon' && draft.length >= 3 && finishDraft(draft[0])}
        >
          <div
            className="absolute inset-0 origin-top-left"
            style={{ transform: `translate(${pan.x * 100}%, ${pan.y * 100}%) scale(${zoom})` }}
          >
            {/* The original photo — rendered read-only, never modified. */}
            <img src={imageUrl} alt="Inspection photo" className="absolute inset-0 h-full w-full object-contain pointer-events-none" draggable={false} />
            <svg className="absolute inset-0 h-full w-full" viewBox="0 0 1 1" preserveAspectRatio="none">
              {annotations.map((a) => (
                <g key={a.id} opacity={selectedId && selectedId !== a.id ? 0.55 : 1}>
                  {svgContent(a, a.id === selectedId)}
                </g>
              ))}
              {/* in-progress draft */}
              {tool === 'polygon' && draft.length > 0 && (
                <polyline
                  points={draft.map((p) => `${p.x},${p.y}`).join(' ')}
                  stroke={color}
                  strokeWidth={0.004}
                  fill="none"
                  strokeDasharray="0.01 0.008"
                />
              )}
              {tool === 'bbox' && draft.length === 2 && (
                <rect
                  x={Math.min(draft[0].x, draft[1].x)}
                  y={Math.min(draft[0].y, draft[1].y)}
                  width={Math.abs(draft[1].x - draft[0].x)}
                  height={Math.abs(draft[1].y - draft[0].y)}
                  stroke={color}
                  strokeWidth={0.004}
                  fill={color + '22'}
                />
              )}
              {tool === 'circle' && draft.length === 2 && (
                <circle cx={draft[0].x} cy={draft[0].y} r={Math.hypot(draft[1].x - draft[0].x, draft[1].y - draft[0].y)} stroke={color} strokeWidth={0.004} fill={color + '22'} />
              )}
              {tool === 'arrow' && draft.length === 2 && (
                <line x1={draft[0].x} y1={draft[0].y} x2={draft[1].x} y2={draft[1].y} stroke={color} strokeWidth={0.004} />
              )}
            </svg>
          </div>
        </div>

        {/* Selection panel */}
        <div className="space-y-3 rounded-md border p-3 text-sm">
          {!selected && (
            <p className="text-muted-foreground">
              Draw over the photo to mark damage. Select a mark to assign its building, component, damage category and finding.
            </p>
          )}
          {selected && (
            <>
              <div className="flex items-center justify-between">
                <Badge variant="outline">{selected.kind}{selected.label != null ? ` #${selected.label}` : ''}</Badge>
                <Button size="sm" variant="destructive" onClick={deleteSelected}><Trash2 className="h-4 w-4" /></Button>
              </div>
              <label className="block space-y-1">
                <span className="text-muted-foreground">Building</span>
                <Input value={selected.buildingLabel ?? ''} placeholder="e.g. Building A" onChange={(e) => updateSelected({ buildingLabel: e.target.value || null })} />
              </label>
              <label className="block space-y-1">
                <span className="text-muted-foreground">Roof plane / elevation</span>
                <Input value={selected.roofPlane ?? selected.elevation ?? ''} placeholder="e.g. North slope / South elevation" onChange={(e) => updateSelected({ roofPlane: e.target.value || null, elevation: e.target.value || null })} />
              </label>
              <label className="block space-y-1">
                <span className="text-muted-foreground">Component</span>
                <Input value={selected.component ?? ''} placeholder="e.g. Shingles, ridge vent, flashing" onChange={(e) => updateSelected({ component: e.target.value || null })} />
              </label>
              <label className="block space-y-1">
                <span className="text-muted-foreground">Damage category</span>
                <Select value={selected.damageCategory ?? ''} onValueChange={(v) => updateSelected({ damageCategory: v || null })}>
                  <SelectTrigger><SelectValue placeholder="Choose…" /></SelectTrigger>
                  <SelectContent>
                    {damageCategories.map((c) => <SelectItem key={c} value={c}>{c.replaceAll('_', ' ')}</SelectItem>)}
                  </SelectContent>
                </Select>
              </label>
              {findings.length > 0 && (
                <label className="block space-y-1">
                  <span className="text-muted-foreground">Linked finding</span>
                  <Select value={selected.findingId ?? 'none'} onValueChange={(v) => updateSelected({ findingId: v === 'none' ? null : v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Not linked</SelectItem>
                      {findings.map((f) => <SelectItem key={f.id} value={f.id}>{f.finding_ref} — {f.component}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </label>
              )}
              {selected.kind === 'polygon' && (
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => {
                    const mid = selected.points[0];
                    commit(annotations.map((a) => (a.id === selected.id && a.kind === 'polygon' ? insertPolygonVertex(a, { x: mid.x + 0.02, y: mid.y + 0.02 }) : a)));
                  }}>Add vertex</Button>
                  <Button size="sm" variant="outline" disabled={selected.points.length <= 3} onClick={() => {
                    commit(annotations.map((a) => (a.id === selected.id && a.kind === 'polygon' ? deletePolygonVertex(a, 0) : a)));
                  }}>Remove vertex</Button>
                </div>
              )}
              <label className="block space-y-1">
                <span className="text-muted-foreground">Notes</span>
                <Input value={selected.notes ?? ''} onChange={(e) => updateSelected({ notes: e.target.value || null })} />
              </label>
            </>
          )}
          <p className="text-xs text-muted-foreground border-t pt-2">
            Marks are saved as editable coordinates only. The original photo is never altered.
            Findings still require inspector approval before appearing in reports.
          </p>
        </div>
      </div>
    </div>
  );
}
