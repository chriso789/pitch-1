import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TRADE_OPTIONS } from "./BlueprintPageList";

function tradeLabel(value: string) {
  return TRADE_OPTIONS.find((t) => t.value === value)?.label ?? value;
}

type AnyRow = Record<string, any>;

export function BlueprintPerPageBreakdown({
  pages,
  trades,
  dimensions,
  geometry,
  pitchNotes,
  detailRefs,
}: {
  pages: AnyRow[]; // already filtered to selected
  trades: Record<string, string>;
  dimensions: AnyRow[];
  geometry: AnyRow[];
  pitchNotes: AnyRow[];
  detailRefs: AnyRow[];
}) {
  if (pages.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Per-Page Trade Breakdown</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Select one or more pages above and pick a trade for each. Each selected page will get its
          own breakdown card here — trades and measurements stay separated per sheet.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Per-Page Trade Breakdown</h2>
        <p className="text-xs text-muted-foreground">
          One card per selected page. Measurements are scoped to the sheet they came from — nothing
          is merged across pages.
        </p>
      </div>

      {pages.map((page) => {
        const trade = trades[page.id] ?? "none";
        const dims = dimensions.filter((d) => d.page_id === page.id);
        const geom = geometry.filter((g) => g.page_id === page.id);
        const pitches = pitchNotes.filter((p) => p.page_id === page.id);
        const refs = detailRefs.filter((r) => r.source_page_id === page.id);

        // Roll up dimensions by unit
        const byUnit: Record<string, { count: number; total: number }> = {};
        for (const d of dims) {
          const unit = String(d.unit || d.measurement_unit || "unknown").toLowerCase();
          const value = Number(d.value ?? d.measured_value ?? d.length ?? 0) || 0;
          if (!byUnit[unit]) byUnit[unit] = { count: 0, total: 0 };
          byUnit[unit].count += 1;
          byUnit[unit].total += value;
        }

        return (
          <Card key={page.id}>
            <CardHeader className="flex flex-row items-start justify-between gap-3">
              <div>
                <CardTitle className="text-base">
                  Page {page.page_number} ·{" "}
                  {page.sheet_number || page.sheet_name || page.page_title || "Untitled sheet"}
                </CardTitle>
                <p className="text-xs text-muted-foreground mt-1">
                  Detected as <Badge variant="outline">{page.page_type}</Badge>
                </p>
              </div>
              <Badge>{tradeLabel(trade)}</Badge>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              {trade === "none" && (
                <div className="rounded-md border border-dashed p-3 text-muted-foreground">
                  No trade assigned — measurements below are shown for reference only and will not
                  be sent to the quote workbench.
                </div>
              )}

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Stat label="Dimensions" value={dims.length} />
                <Stat label="Geometry features" value={geom.length} />
                <Stat label="Pitch notes" value={pitches.length} />
                <Stat label="Detail callouts" value={refs.length} />
              </div>

              {Object.keys(byUnit).length > 0 && (
                <div>
                  <div className="text-xs font-medium text-muted-foreground mb-1">
                    Measurement roll-up (this page only)
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(byUnit).map(([unit, agg]) => (
                      <Badge key={unit} variant="secondary">
                        {unit}: {agg.total.toFixed(1)} ({agg.count})
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {dims.length > 0 && (
                <details className="text-xs">
                  <summary className="cursor-pointer text-muted-foreground">
                    Show {dims.length} raw dimension(s)
                  </summary>
                  <div className="mt-2 max-h-48 overflow-auto border rounded">
                    <table className="w-full">
                      <thead className="bg-muted">
                        <tr className="text-left">
                          <th className="py-1 px-2">Label</th>
                          <th className="py-1 px-2">Value</th>
                          <th className="py-1 px-2">Unit</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {dims.slice(0, 100).map((d, i) => (
                          <tr key={d.id ?? i}>
                            <td className="py-1 px-2">{d.label ?? d.name ?? "—"}</td>
                            <td className="py-1 px-2">
                              {d.value ?? d.measured_value ?? d.length ?? "—"}
                            </td>
                            <td className="py-1 px-2">
                              {d.unit ?? d.measurement_unit ?? "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border p-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}
