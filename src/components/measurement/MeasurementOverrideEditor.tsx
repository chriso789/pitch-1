/**
 * Patent Rule 5 — Admin override editor (v1, table-based).
 *
 * Lets a master/admin:
 *   - change the typed attribute of any roof_line (eave/rake/ridge/hip/valley/...)
 *   - delete a roof_line (mark non-customer-reportable)
 *   - add a new roof_line (manual two-point entry; canvas drag UI deferred to v2)
 *   - override per-plane pitch
 *   - save & call recalculate-measurement-from-overrides which rewrites totals
 *     and flips result_state to customer_report_ready when the gate passes.
 */
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Trash2, Plus, Loader2, ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useToast } from "@/hooks/use-toast";

const ATTRS = [
  "perimeter",
  "eave",
  "rake",
  "ridge",
  "hip",
  "valley",
  "step_flashing",
  "wall_flashing",
  "common",
  "unknown",
] as const;
type Attr = (typeof ATTRS)[number];

interface RoofLineRow {
  id: string;
  layer_id: string;
  non_dimensional_attribute: Attr;
  length_lf: number | null;
  source: string;
  confidence: number | null;
  can_be_customer_reported: boolean;
  geometry_px: any;
}

interface Props {
  measurementId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRecalculated?: (result: any) => void;
}

export function MeasurementOverrideEditor({
  measurementId,
  open,
  onOpenChange,
  onRecalculated,
}: Props) {
  const { user } = useCurrentUser();
  const { toast } = useToast();
  const [lines, setLines] = useState<RoofLineRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pendingOverrides, setPendingOverrides] = useState<any[]>([]);
  const [newAttr, setNewAttr] = useState<Attr>("ridge");
  const [newP1, setNewP1] = useState("");
  const [newP2, setNewP2] = useState("");

  const canEdit = useMemo(() => {
    const role = (user?.role ?? "").toLowerCase();
    return role === "master" || role === "admin" || role === "cob";
  }, [user]);

  useEffect(() => {
    if (!open || !measurementId) return;
    let alive = true;
    setLoading(true);
    setPendingOverrides([]);
    (async () => {
      const { data, error } = await supabase
        .from("roof_lines")
        .select(
          "id, layer_id, non_dimensional_attribute, length_lf, source, confidence, can_be_customer_reported, geometry_px",
        )
        .eq("measurement_id", measurementId);
      if (!alive) return;
      if (error) {
        toast({
          title: "Failed to load roof lines",
          description: error.message,
          variant: "destructive",
        });
      }
      setLines((data ?? []) as RoofLineRow[]);
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [open, measurementId, toast]);

  const stageAttrChange = (line: RoofLineRow, next: Attr) => {
    if (line.non_dimensional_attribute === next) return;
    setLines((prev) =>
      prev.map((l) =>
        l.id === line.id ? { ...l, non_dimensional_attribute: next } : l,
      ),
    );
    setPendingOverrides((prev) => [
      ...prev,
      {
        override_kind: "change_line_attribute",
        target_line_id: line.id,
        before: { non_dimensional_attribute: line.non_dimensional_attribute },
        after: { non_dimensional_attribute: next },
      },
    ]);
  };

  const stageDelete = (line: RoofLineRow) => {
    setLines((prev) =>
      prev.map((l) =>
        l.id === line.id ? { ...l, can_be_customer_reported: false } : l,
      ),
    );
    setPendingOverrides((prev) => [
      ...prev,
      {
        override_kind: "delete_line",
        target_line_id: line.id,
        before: { can_be_customer_reported: line.can_be_customer_reported },
        after: { can_be_customer_reported: false },
      },
    ]);
  };

  const stageAdd = () => {
    const parse = (s: string): [number, number] | null => {
      const m = s.split(",").map((p) => Number(p.trim()));
      return m.length === 2 && m.every(Number.isFinite)
        ? [m[0], m[1]]
        : null;
    };
    const p1 = parse(newP1);
    const p2 = parse(newP2);
    if (!p1 || !p2) {
      toast({
        title: "Invalid points",
        description: "Use 'x,y' (pixel coordinates) for each endpoint.",
        variant: "destructive",
      });
      return;
    }
    const newId = crypto.randomUUID();
    setLines((prev) => [
      ...prev,
      {
        id: newId,
        layer_id: "layer2_structural",
        non_dimensional_attribute: newAttr,
        length_lf: null,
        source: "user_override",
        confidence: 1,
        can_be_customer_reported: true,
        geometry_px: [p1, p2],
      },
    ]);
    setPendingOverrides((prev) => [
      ...prev,
      {
        override_kind: "add_line",
        target_line_id: newId,
        before: null,
        after: {
          geometry_px: [p1, p2],
          non_dimensional_attribute: newAttr,
        },
      },
    ]);
    setNewP1("");
    setNewP2("");
  };

  const handleSaveAndRecalc = async () => {
    if (!user || pendingOverrides.length === 0) {
      onOpenChange(false);
      return;
    }
    setSaving(true);
    try {
      const rows = pendingOverrides.map((ov) => ({
        ...ov,
        measurement_id: measurementId,
        override_source: "admin_editor_v1",
        created_by: user.id,
        tenant_id: user.active_tenant_id ?? user.tenant_id,
      }));
      const { error: insErr } = await supabase
        .from("measurement_overrides")
        .insert(rows);
      if (insErr) throw insErr;

      const { data, error: invErr } = await supabase.functions.invoke(
        "recalculate-measurement-from-overrides",
        { body: { measurement_id: measurementId } },
      );
      if (invErr) throw invErr;

      toast({
        title: "Measurement recalculated",
        description: `result_state: ${data?.result_state ?? "unknown"}`,
      });
      onRecalculated?.(data);
      setPendingOverrides([]);
      onOpenChange(false);
    } catch (e: any) {
      toast({
        title: "Recalculation failed",
        description: e?.message ?? String(e),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            Measurement override editor
          </DialogTitle>
        </DialogHeader>

        {!canEdit ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            Override editing is restricted to master and admin roles.
          </div>
        ) : loading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-md border">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-left">
                  <tr>
                    <th className="px-3 py-2">Layer</th>
                    <th className="px-3 py-2">Attribute</th>
                    <th className="px-3 py-2">Length (lf)</th>
                    <th className="px-3 py-2">Source</th>
                    <th className="px-3 py-2">Conf.</th>
                    <th className="px-3 py-2">Reportable</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {lines.length === 0 ? (
                    <tr>
                      <td
                        colSpan={7}
                        className="px-3 py-6 text-center text-muted-foreground"
                      >
                        No typed roof_lines yet for this measurement.
                      </td>
                    </tr>
                  ) : (
                    lines.map((l) => (
                      <tr
                        key={l.id}
                        className={
                          l.can_be_customer_reported
                            ? "border-t"
                            : "border-t opacity-50 line-through"
                        }
                      >
                        <td className="px-3 py-2 text-xs text-muted-foreground">
                          {l.layer_id}
                        </td>
                        <td className="px-3 py-2">
                          <Select
                            value={l.non_dimensional_attribute}
                            onValueChange={(v) =>
                              stageAttrChange(l, v as Attr)
                            }
                          >
                            <SelectTrigger className="h-8 w-[140px]">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {ATTRS.map((a) => (
                                <SelectItem key={a} value={a}>
                                  {a}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </td>
                        <td className="px-3 py-2">
                          {l.length_lf ?? "—"}
                        </td>
                        <td className="px-3 py-2 text-xs">{l.source}</td>
                        <td className="px-3 py-2 text-xs">
                          {l.confidence?.toFixed?.(2) ?? "—"}
                        </td>
                        <td className="px-3 py-2 text-xs">
                          {l.can_be_customer_reported ? "yes" : "no"}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => stageDelete(l)}
                            disabled={!l.can_be_customer_reported}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="rounded-md border bg-muted/20 p-3">
              <div className="mb-2 text-sm font-medium">Add line</div>
              <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
                <Select
                  value={newAttr}
                  onValueChange={(v) => setNewAttr(v as Attr)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ATTRS.map((a) => (
                      <SelectItem key={a} value={a}>
                        {a}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  placeholder="x1, y1"
                  value={newP1}
                  onChange={(e) => setNewP1(e.target.value)}
                />
                <Input
                  placeholder="x2, y2"
                  value={newP2}
                  onChange={(e) => setNewP2(e.target.value)}
                />
                <Button variant="outline" onClick={stageAdd}>
                  <Plus className="mr-1 h-4 w-4" /> Stage add
                </Button>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Coordinates are pixel-space (x,y) on the source aerial tile.
                Canvas-drag editing ships in v2.
              </p>
            </div>

            <div className="text-xs text-muted-foreground">
              {pendingOverrides.length} pending override
              {pendingOverrides.length === 1 ? "" : "s"}.
            </div>
          </div>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSaveAndRecalc}
            disabled={!canEdit || saving || pendingOverrides.length === 0}
          >
            {saving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Recalculating…
              </>
            ) : (
              "Save & recalculate"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default MeasurementOverrideEditor;
