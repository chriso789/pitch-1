import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { useEffectiveTenantId } from "@/hooks/useEffectiveTenantId";
import { useToast } from "@/hooks/use-toast";
import { Loader2, RefreshCw, ShieldCheck, AlertTriangle } from "lucide-react";

interface UpdateRow {
  price_list_item_id: string;
  supplier_sku: string;
  item_description: string | null;
  unit_of_measure: string | null;
  current_agreed_price: number;
  proposed_srs_price: number;
  delta: number;
  delta_pct: number | null;
  changes: boolean;
  error?: string;
}

interface BackfillResult {
  dry_run: boolean;
  suspect_count: number;
  considered: number;
  changed_count: number;
  applied: number;
  branch_code?: string;
  updates: UpdateRow[];
  skipped: { reason: string; supplier_sku?: string; item_description?: string | null }[];
  fetch_errors: { skus: string[]; error: string }[];
}

const fmtCurrency = (n: number | null | undefined) =>
  n == null ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);

export const SRSPricelistBackfill = () => {
  const effectiveTenantId = useEffectiveTenantId();
  const { toast } = useToast();
  const [limit, setLimit] = useState("200");
  const [loading, setLoading] = useState<"none" | "preview" | "apply">("none");
  const [result, setResult] = useState<BackfillResult | null>(null);

  const run = async (action: "preview" | "apply") => {
    if (!effectiveTenantId) return;
    setLoading(action);
    try {
      const { data, error } = await supabase.functions.invoke("srs-pricelist-backfill", {
        body: { action, tenant_id: effectiveTenantId, limit: Number(limit) || 200 },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      setResult(data as BackfillResult);
      toast({
        title: action === "apply" ? "Backfill applied" : "Preview complete",
        description:
          action === "apply"
            ? `Updated ${(data as BackfillResult).applied} of ${(data as BackfillResult).changed_count} items.`
            : `${(data as BackfillResult).changed_count} items would change.`,
      });
    } catch (e: any) {
      console.error("backfill error:", e);
      toast({
        title: "Backfill failed",
        description: e?.message || "Unknown error",
        variant: "destructive",
      });
    } finally {
      setLoading("none");
    }
  };

  const changed = result?.updates.filter((u) => u.changes) ?? [];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5" />
            SRS Pricelist Backfill
          </CardTitle>
          <CardDescription>
            Find pricelist items whose agreed price equals the price you were charged on an invoice
            (suggesting the pricelist was seeded from a bad invoice rather than the SRS catalog),
            then refresh them from SRS's live API.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="bf-limit">Batch limit</Label>
              <Input
                id="bf-limit"
                type="number"
                min={10}
                max={1000}
                step={10}
                value={limit}
                onChange={(e) => setLimit(e.target.value)}
              />
            </div>
            <div className="col-span-2 flex items-end gap-2">
              <Button
                variant="outline"
                disabled={loading !== "none" || !effectiveTenantId}
                onClick={() => run("preview")}
                className="flex-1"
              >
                {loading === "preview" ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4 mr-2" />
                )}
                Preview (dry run)
              </Button>
              <Button
                disabled={loading !== "none" || !changed.length}
                onClick={() => run("apply")}
                className="flex-1"
              >
                {loading === "apply" && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Apply {changed.length ? `(${changed.length})` : ""}
              </Button>
            </div>
          </div>

          {result && (
            <Alert>
              <AlertDescription className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
                <div><Badge variant="secondary">Suspect</Badge> <span className="ml-2">{result.suspect_count}</span></div>
                <div><Badge variant="secondary">Considered</Badge> <span className="ml-2">{result.considered}</span></div>
                <div><Badge variant="secondary">Would change</Badge> <span className="ml-2">{result.changed_count}</span></div>
                <div><Badge variant="secondary">Applied</Badge> <span className="ml-2">{result.applied}</span></div>
                <div><Badge variant="secondary">Branch</Badge> <span className="ml-2 font-mono">{result.branch_code || "—"}</span></div>
              </AlertDescription>
            </Alert>
          )}

          {result?.fetch_errors?.length ? (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                <div className="text-sm font-medium mb-1">{result.fetch_errors.length} batch(es) failed against SRS</div>
                <ul className="text-xs list-disc pl-4 space-y-1">
                  {result.fetch_errors.slice(0, 5).map((f, i) => (
                    <li key={i}>{f.error}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          ) : null}
        </CardContent>
      </Card>

      {result && (
        <Card>
          <CardHeader>
            <CardTitle>Proposed changes</CardTitle>
            <CardDescription>
              Showing items where SRS's live catalog price differs from the current agreed price.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>SKU</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>UOM</TableHead>
                    <TableHead className="text-right">Current</TableHead>
                    <TableHead className="text-right">SRS</TableHead>
                    <TableHead className="text-right">Δ</TableHead>
                    <TableHead className="text-right">Δ %</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {changed.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-6 text-muted-foreground">
                        No price differences detected.
                      </TableCell>
                    </TableRow>
                  ) : (
                    changed.map((u) => (
                      <TableRow key={u.price_list_item_id}>
                        <TableCell className="font-mono text-xs">{u.supplier_sku}</TableCell>
                        <TableCell className="max-w-[320px] truncate">{u.item_description}</TableCell>
                        <TableCell>{u.unit_of_measure}</TableCell>
                        <TableCell className="text-right">{fmtCurrency(u.current_agreed_price)}</TableCell>
                        <TableCell className="text-right font-medium">{fmtCurrency(u.proposed_srs_price)}</TableCell>
                        <TableCell className={`text-right ${u.delta < 0 ? "text-green-600" : "text-destructive"}`}>
                          {u.delta > 0 ? "+" : ""}{fmtCurrency(u.delta)}
                        </TableCell>
                        <TableCell className="text-right">{u.delta_pct == null ? "—" : `${u.delta_pct > 0 ? "+" : ""}${u.delta_pct}%`}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>

            {result.skipped.length > 0 && (
              <div className="mt-4 text-xs text-muted-foreground">
                Skipped {result.skipped.length} item(s) — reasons:{" "}
                {Object.entries(
                  result.skipped.reduce<Record<string, number>>((acc, s) => {
                    acc[s.reason] = (acc[s.reason] || 0) + 1;
                    return acc;
                  }, {}),
                ).map(([k, v]) => `${k}: ${v}`).join(", ")}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
};
