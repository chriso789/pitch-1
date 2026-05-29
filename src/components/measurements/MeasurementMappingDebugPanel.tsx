// Developer-mode read-only debug panel for the section-aware measurement
// mapping engine. NO edit/lock/split/reassign UI — the only write path remains
// POST /measurement-imports/:id/manual-split (exposed via its own hook).

import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useSupplierDeveloperMode } from "@/lib/supplierAccess";
import {
  useMeasurementImport,
  useTemplateMappingPreview,
} from "@/lib/measurement-mapping/hooks";
import type {
  EstimateMeasurementAssignment,
  MappingPreviewResult,
} from "@/lib/measurement-mapping/types";

interface Props {
  measurementImportId: string;
  calcTemplateId?: string | null;
}

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  assigned: "default",
  assigned_global_fallback: "secondary",
  unresolved: "destructive",
  conflict: "destructive",
  manual: "outline",
  skipped: "outline",
};

function AssignmentRow({ a }: { a: EstimateMeasurementAssignment }) {
  return (
    <TableRow>
      <TableCell className="font-mono text-xs">{a.template_item_id}</TableCell>
      <TableCell>
        <Badge variant={STATUS_VARIANT[a.status] ?? "outline"}>{a.status}</Badge>
      </TableCell>
      <TableCell className="text-xs">{a.reason_code ?? "—"}</TableCell>
      <TableCell className="text-right tabular-nums">
        {a.quantity == null ? "—" : a.quantity}
      </TableCell>
      <TableCell className="text-xs">{a.unit ?? "—"}</TableCell>
      <TableCell className="font-mono text-xs max-w-xs truncate" title={a.formula_evaluated ?? ""}>
        {a.formula_evaluated ?? "—"}
      </TableCell>
      <TableCell className="text-right tabular-nums">{a.confidence.toFixed(2)}</TableCell>
    </TableRow>
  );
}

export function MeasurementMappingDebugPanel({ measurementImportId, calcTemplateId }: Props) {
  const { showAdvanced } = useSupplierDeveloperMode();
  const importQuery = useMeasurementImport(measurementImportId);
  const previewQuery = useTemplateMappingPreview(calcTemplateId ?? null, measurementImportId, {
    enabled: !!calcTemplateId,
  });

  const bundle = importQuery.data;
  const preview: MappingPreviewResult | undefined = previewQuery.data;

  const classTotals = useMemo(() => {
    const totals: Record<string, number> = {};
    for (const s of bundle?.segments ?? []) {
      const k = s.surface_class;
      totals[k] = (totals[k] ?? 0) + (Number(s.area_sqft) || 0);
    }
    return totals;
  }, [bundle?.segments]);

  if (!showAdvanced) return null;

  return (
    <Card variant="glass" className="mt-4">
      <CardHeader>
        <CardTitle className="text-base">Measurement Mapping — Debug</CardTitle>
        <CardDescription>
          Developer-only · read-only · the only write path is the manual-split hook.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Import summary + mode + type */}
        <section>
          <h4 className="text-sm font-semibold mb-2">Import</h4>
          {importQuery.isLoading && <p className="text-xs text-muted-foreground">Loading…</p>}
          {bundle?.import && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs mb-2">
                <div><span className="text-muted-foreground">ID:</span> <span className="font-mono">{bundle.import.id.slice(0, 8)}</span></div>
                <div><span className="text-muted-foreground">Provider:</span> {bundle.import.provider ?? "—"}</div>
                <div><span className="text-muted-foreground">Status:</span> {bundle.import.import_status}</div>
                <div><span className="text-muted-foreground">Segments / Features:</span> {bundle.segments.length} / {bundle.features.length}</div>
              </div>
              <div className="flex flex-wrap gap-2 text-xs">
                <Badge variant="outline">
                  mode: {calcTemplateId ? "section-aware" : "legacy"}
                </Badge>
                <Badge variant="outline">
                  import type: {(() => {
                    const segs = bundle.segments;
                    if (segs.some((s) => s.is_synthetic_split)) return "manual-split";
                    const classes = new Set(segs.map((s) => s.surface_class));
                    if (classes.has("flat") && classes.has("sloped")) return "mixed";
                    if (segs.length === 1 && segs[0].pitch_scope !== "segment") return "aggregate-only";
                    return "segmented";
                  })()}
                </Badge>
              </div>
            </>
          )}
        </section>

        {/* Class totals (detected class measurements) */}
        <section>
          <h4 className="text-sm font-semibold mb-2">Detected class measurements</h4>
          <div className="flex flex-wrap gap-2 text-xs">
            {(["flat", "low_slope", "sloped", "other", "unknown"] as const).map((c) => (
              <Badge key={c} variant={classTotals[c] ? "secondary" : "outline"}>
                {c}: {classTotals[c] ? `${Math.round(classTotals[c])} sqft` : "unavailable"}
              </Badge>
            ))}
          </div>
        </section>

        {/* Segments table */}
        <section>
          <h4 className="text-sm font-semibold mb-2">Segments</h4>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Class</TableHead>
                <TableHead className="text-right">Area (sqft)</TableHead>
                <TableHead className="text-right">Pitch</TableHead>
                <TableHead>Scope</TableHead>
                <TableHead className="text-right">Conf.</TableHead>
                <TableHead>Reason</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(bundle?.segments ?? []).map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="text-xs">{s.name ?? s.id.slice(0, 8)}</TableCell>
                  <TableCell><Badge variant="outline">{s.surface_class}</Badge></TableCell>
                  <TableCell className="text-right tabular-nums">{s.area_sqft ?? "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{s.pitch_rise_over_12 ?? "—"}</TableCell>
                  <TableCell className="text-xs">{s.pitch_scope}</TableCell>
                  <TableCell className="text-right tabular-nums">{s.classification_confidence.toFixed(2)}</TableCell>
                  <TableCell className="text-xs">
                    {s.classification_reason ?? "—"}
                    {s.is_synthetic_split && <Badge variant="secondary" className="ml-1">manual</Badge>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>

        {/* Mapping preview */}
        {calcTemplateId && (
          <section>
            <h4 className="text-sm font-semibold mb-2">Template mapping preview</h4>
            {previewQuery.isLoading && <p className="text-xs text-muted-foreground">Running dry-run…</p>}
            {previewQuery.error && (
              <p className="text-xs text-destructive">Preview error: {String(previewQuery.error)}</p>
            )}
            {preview && (
              <>
                <div className="flex gap-3 text-xs mb-2">
                  <Badge variant="default">Assigned: {preview.summary.assigned}</Badge>
                  <Badge variant="destructive">Unresolved: {preview.summary.unresolved}</Badge>
                  <Badge variant="destructive">Conflicts: {preview.summary.conflicts}</Badge>
                  <Badge variant="outline">Total: {preview.summary.total_items}</Badge>
                </div>

                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Item</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Reason</TableHead>
                      <TableHead className="text-right">Qty</TableHead>
                      <TableHead>Unit</TableHead>
                      <TableHead>Formula</TableHead>
                      <TableHead className="text-right">Conf.</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {[...preview.assignments, ...preview.unresolved, ...preview.conflicts].map((a) => (
                      <AssignmentRow key={a.template_item_id} a={a} />
                    ))}
                  </TableBody>
                </Table>
              </>
            )}
            {!preview && !previewQuery.isLoading && (
              <p className="text-xs text-muted-foreground">No preview yet.</p>
            )}
          </section>
        )}
      </CardContent>
    </Card>
  );
}
