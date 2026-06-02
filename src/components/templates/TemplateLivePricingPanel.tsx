import React, { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, RefreshCw, AlertCircle, Lock, Settings2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useAbcSetup } from "@/hooks/useAbcSetup";
import { AbcPricingLockedCell } from "@/components/supplier-pricing/AbcPricingLockedCell";
import { AbcSetupWizard } from "@/components/supplier-pricing/AbcSetupWizard";
import { evaluateAbcLock } from "@/lib/templates/supplierPricing";

type Supplier = "srs" | "abc" | "qxo";

interface PriceRow {
  template_item_id: string;
  supplier: Supplier;
  supplier_sku: string | null;
  supplier_item_name: string | null;
  color: string | null;
  branch: string | null;
  account_number: string | null;
  unit_price: number | null;
  uom: string | null;
  availability: string | null;
  status: "ok" | "pending" | "error" | "not_mapped" | "not_connected";
  reason: string | null;
  checked_at: string;
}

interface TemplateItem {
  id: string;
  item_name: string;
  unit: string;
  item_type: string;
  sku_pattern: string | null;
  srs_sku: string | null;
  abc_sku: string | null;
  qxo_sku: string | null;
}

interface Props {
  templateId: string;
}

const SUPPLIERS: Supplier[] = ["srs", "abc", "qxo"];
const SUPPLIER_LABEL: Record<Supplier, string> = {
  srs: "SRS",
  abc: "ABC Supply",
  qxo: "QXO",
};

const fmtMoney = (n: number | null | undefined) =>
  typeof n === "number" && Number.isFinite(n)
    ? `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : "—";

const fmtTime = (s?: string) =>
  s ? new Date(s).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" }) : "—";

const StatusBadge: React.FC<{ row: PriceRow | undefined }> = ({ row }) => {
  if (!row) return <Badge variant="outline">—</Badge>;
  if (row.status === "ok") return null;
  const variantMap: Record<string, "secondary" | "destructive" | "outline"> = {
    pending: "secondary",
    not_mapped: "outline",
    not_connected: "outline",
    error: "destructive",
  };
  const label = {
    pending: "Pending",
    not_mapped: "Not mapped",
    not_connected: "Not connected",
    error: "Error",
  }[row.status];
  return (
    <Badge variant={variantMap[row.status] || "outline"} className="text-xs">
      {label}
    </Badge>
  );
};

export const TemplateLivePricingPanel: React.FC<Props> = ({ templateId }) => {
  const { toast } = useToast();
  const abcSetup = useAbcSetup();
  const [items, setItems] = useState<TemplateItem[]>([]);
  const [rows, setRows] = useState<PriceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);

  const loadAll = async () => {
    setLoading(true);
    try {
      const { data: itemRows } = await supabase
        .from("estimate_calc_template_items")
        .select("id, item_name, unit, item_type, sku_pattern, srs_sku, abc_sku, qxo_sku")
        .eq("calc_template_id", templateId)
        .eq("item_type", "material")
        .order("sort_order");
      setItems((itemRows || []) as TemplateItem[]);

      const { data: priceRows } = await supabase
        .from("template_supplier_prices")
        .select("*")
        .eq("template_id", templateId);
      setRows((priceRows || []) as PriceRow[]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (templateId) void loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateId]);

  const refreshLive = async () => {
    setRefreshing(true);
    try {
      const { data, error } = await supabase.functions.invoke("template-supplier-pricing", {
        body: { action: "refresh", template_id: templateId },
      });
      if (error) throw error;
      const c = (data as any)?.counts;
      setRows(((data as any)?.rows || []) as PriceRow[]);
      toast({
        title: "Pricing refreshed",
        description: c
          ? `${c.items} items · SRS ${c.srs_priced} · ABC ${c.abc_priced} · QXO ${c.qxo_priced}`
          : "Live supplier pricing updated.",
      });
    } catch (e: any) {
      toast({
        title: "Refresh failed",
        description: e?.message || "Could not contact supplier APIs.",
        variant: "destructive",
      });
    } finally {
      setRefreshing(false);
    }
  };

  const byItem = useMemo(() => {
    const m = new Map<string, Map<Supplier, PriceRow>>();
    for (const r of rows) {
      if (!m.has(r.template_item_id)) m.set(r.template_item_id, new Map());
      m.get(r.template_item_id)!.set(r.supplier, r);
    }
    return m;
  }, [rows]);

  const lastChecked = useMemo(() => {
    const times = rows.map((r) => r.checked_at).filter(Boolean);
    if (!times.length) return null;
    return times.reduce((a, b) => (a > b ? a : b));
  }, [rows]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <div>
          <CardTitle className="text-base">Live Supplier Pricing</CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Live prices from your connected SRS, ABC Supply, and QXO accounts. Last checked: {fmtTime(lastChecked || undefined)}
          </p>
        </div>
        <Button size="sm" onClick={refreshLive} disabled={refreshing || loading || items.length === 0}>
          {refreshing ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="mr-2 h-4 w-4" />
          )}
          Refresh Live Pricing
        </Button>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : items.length === 0 ? (
          <div className="py-6 text-center text-sm text-muted-foreground">
            No material line items on this template yet. Add items with supplier SKUs to see live pricing.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs uppercase">
                <tr>
                  <th className="p-2 text-left">Item</th>
                  <th className="p-2 text-left">Unit</th>
                  {SUPPLIERS.map((s) => (
                    <th key={s} className="p-2 text-right">
                      {SUPPLIER_LABEL[s]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map((it) => {
                  const supplierRows = byItem.get(it.id);
                  return (
                    <tr key={it.id} className="border-t align-top">
                      <td className="p-2">
                        <div className="font-medium">{it.item_name}</div>
                        <div className="text-xs text-muted-foreground">
                          {it.sku_pattern || "no SKU"}
                        </div>
                      </td>
                      <td className="p-2 text-xs text-muted-foreground">{it.unit}</td>
                      {SUPPLIERS.map((s) => {
                        const row = supplierRows?.get(s);
                        const priced = row?.status === "ok" && row.unit_price != null;
                        return (
                          <td key={s} className="p-2 text-right">
                            {priced ? (
                              <div>
                                <div className="font-semibold">{fmtMoney(row!.unit_price)}</div>
                                <div className="text-[10px] text-muted-foreground">
                                  {row!.supplier_sku || "—"}
                                  {row!.color ? ` · ${row!.color}` : ""}
                                </div>
                                {row!.branch && (
                                  <div className="text-[10px] text-muted-foreground">
                                    br {row!.branch}
                                    {row!.availability ? ` · ${row!.availability}` : ""}
                                  </div>
                                )}
                              </div>
                            ) : (
                              <div className="flex flex-col items-end gap-1">
                                <StatusBadge row={row} />
                                {row?.reason && (
                                  <div
                                    className="flex items-center gap-1 text-[10px] text-muted-foreground max-w-[180px] text-right"
                                    title={row.reason}
                                  >
                                    <AlertCircle className="h-3 w-3 flex-shrink-0" />
                                    <span className="truncate">{row.reason}</span>
                                  </div>
                                )}
                              </div>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default TemplateLivePricingPanel;
