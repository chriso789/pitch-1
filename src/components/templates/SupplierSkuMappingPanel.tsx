// Supplier SKU Mapping Panel
//
// Shows the ABC + SRS mapping state for a single template item and lets the
// user approve / reject a mapping. No cross-supplier price comparison — this
// panel is strictly catalog identity.
//
// Server contracts:
//   GET  supplier-api/abc/mapping/list?template_item_ids=<id>
//   POST supplier-api/abc/mapping/approve  { template_item_id, item_number, item_description, valid_uoms, default_uom, branch_scope, raw_catalog_payload }
//   POST supplier-api/abc/mapping/reject   { template_item_id, reason }
//   GET  srs-api/mapping/list?template_item_ids=<id>
//   POST srs-api/mapping/approve   { template_item_id, product_number, product_id, product_name, valid_uoms, default_uom, branch_scope, raw_catalog_payload }
//   POST srs-api/mapping/reject    { template_item_id, reason }
//
// Catalog browse is delegated to the existing supplier proxies (abc/proxy,
// srs-api-proxy `get_products`). This panel only persists the approved choice.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Loader2, CheckCircle2, AlertTriangle, XCircle, Search } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useEffectiveTenantId } from "@/hooks/useEffectiveTenantId";

type MappingStatus = "unmapped" | "auto_matched" | "needs_review" | "approved" | "rejected";
type Supplier = "abc" | "srs";

interface MappingRow {
  id: string;
  tenant_id: string;
  template_item_id: string;
  supplier: Supplier;
  supplier_item_number: string | null;
  supplier_product_id: string | null;
  supplier_item_description: string | null;
  valid_uoms: string[];
  default_uom: string | null;
  branch_scope: string[];
  mapping_status: MappingStatus;
  last_checked_at: string | null;
}

interface Props {
  templateItemId: string;
  templateItemName?: string;
}

function statusBadge(status: MappingStatus | "missing") {
  const map: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline"; Icon: typeof CheckCircle2 }> = {
    approved:      { label: "Approved",      variant: "default",     Icon: CheckCircle2 },
    auto_matched:  { label: "Auto-matched",  variant: "secondary",   Icon: AlertTriangle },
    needs_review:  { label: "Needs review",  variant: "secondary",   Icon: AlertTriangle },
    unmapped:      { label: "Unmapped",      variant: "outline",     Icon: AlertTriangle },
    rejected:      { label: "Rejected",      variant: "destructive", Icon: XCircle },
    missing:       { label: "No mapping",    variant: "outline",     Icon: AlertTriangle },
  };
  const cfg = map[status] ?? map.missing;
  const { label, variant, Icon } = cfg;
  return (
    <Badge variant={variant} className="flex items-center gap-1 w-fit">
      <Icon className="h-3 w-3" />
      {label}
    </Badge>
  );
}

function SupplierRow({
  supplier,
  mapping,
  loading,
  onApprove,
  onReject,
  templateItemId,
  templateItemName,
}: {
  supplier: Supplier;
  mapping: MappingRow | null;
  loading: boolean;
  onApprove: (payload: Record<string, unknown>) => Promise<void>;
  onReject: () => Promise<void>;
  templateItemId: string;
  templateItemName?: string;
}) {
  const [skuInput, setSkuInput] = useState(mapping?.supplier_item_number ?? "");
  const [descInput, setDescInput] = useState(mapping?.supplier_item_description ?? templateItemName ?? "");
  const [uomsInput, setUomsInput] = useState((mapping?.valid_uoms ?? []).join(","));
  const [branchInput, setBranchInput] = useState((mapping?.branch_scope ?? []).join(","));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setSkuInput(mapping?.supplier_item_number ?? "");
    setDescInput(mapping?.supplier_item_description ?? templateItemName ?? "");
    setUomsInput((mapping?.valid_uoms ?? []).join(","));
    setBranchInput((mapping?.branch_scope ?? []).join(","));
  }, [mapping, templateItemName]);

  const handleApprove = async () => {
    setBusy(true);
    try {
      const uoms = uomsInput.split(",").map((s) => s.trim()).filter(Boolean);
      const branches = branchInput.split(",").map((s) => s.trim()).filter(Boolean);
      const payload =
        supplier === "abc"
          ? {
              template_item_id: templateItemId,
              item_number: skuInput.trim(),
              item_description: descInput.trim(),
              valid_uoms: uoms,
              default_uom: uoms[0] ?? null,
              branch_scope: branches,
              match_reason: "manual_approve_via_panel",
            }
          : {
              template_item_id: templateItemId,
              product_number: skuInput.trim(),
              product_id: mapping?.supplier_product_id ?? null,
              product_name: descInput.trim(),
              valid_uoms: uoms,
              default_uom: uoms[0] ?? null,
              branch_scope: branches,
              match_reason: "manual_approve_via_panel",
            };
      await onApprove(payload);
    } finally {
      setBusy(false);
    }
  };

  const handleReject = async () => {
    setBusy(true);
    try {
      await onReject();
    } finally {
      setBusy(false);
    }
  };

  const status: MappingStatus | "missing" = mapping?.mapping_status ?? "missing";

  return (
    <div className="space-y-3 rounded-md border p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold uppercase">{supplier}</span>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : statusBadge(status)}
        </div>
        {mapping?.last_checked_at && (
          <span className="text-xs text-muted-foreground">
            checked {new Date(mapping.last_checked_at).toLocaleString()}
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label htmlFor={`sku-${supplier}`} className="text-xs">
            {supplier === "abc" ? "itemNumber" : "productNumber (SKU)"}
          </Label>
          <Input
            id={`sku-${supplier}`}
            value={skuInput}
            onChange={(e) => setSkuInput(e.target.value)}
            placeholder={supplier === "abc" ? "ABC itemNumber" : "SRS productNumber"}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`desc-${supplier}`} className="text-xs">Description</Label>
          <Input
            id={`desc-${supplier}`}
            value={descInput}
            onChange={(e) => setDescInput(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`uoms-${supplier}`} className="text-xs">Valid UOMs (comma-separated)</Label>
          <Input
            id={`uoms-${supplier}`}
            value={uomsInput}
            onChange={(e) => setUomsInput(e.target.value)}
            placeholder="EA,BD,SQ"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`branch-${supplier}`} className="text-xs">Branch scope (optional)</Label>
          <Input
            id={`branch-${supplier}`}
            value={branchInput}
            onChange={(e) => setBranchInput(e.target.value)}
            placeholder="SRFTL,SRMIA"
          />
        </div>
      </div>

      {supplier === "srs" && mapping?.supplier_product_id && (
        <p className="text-xs text-muted-foreground">
          internal productId: <code>{mapping.supplier_product_id}</code> (not used for pricing)
        </p>
      )}

      <div className="flex items-center gap-2">
        <Button size="sm" onClick={handleApprove} disabled={busy || !skuInput.trim()}>
          {busy ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : <CheckCircle2 className="mr-2 h-3 w-3" />}
          Approve mapping
        </Button>
        <Button size="sm" variant="outline" onClick={handleReject} disabled={busy}>
          <XCircle className="mr-2 h-3 w-3" />
          Reject
        </Button>
        <a
          className="ml-auto text-xs text-muted-foreground underline-offset-2 hover:underline inline-flex items-center gap-1"
          href={
            supplier === "abc"
              ? "https://developer.abcsupply.com/"
              : "https://developer.srsdistribution.com/"
          }
          target="_blank"
          rel="noreferrer"
        >
          <Search className="h-3 w-3" /> open supplier catalog
        </a>
      </div>
    </div>
  );
}

export function SupplierSkuMappingPanel({ templateItemId, templateItemName }: Props) {
  const tenantId = useEffectiveTenantId();
  const { toast } = useToast();
  const [abc, setAbc] = useState<MappingRow | null>(null);
  const [srs, setSrs] = useState<MappingRow | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!tenantId || !templateItemId) return;
    setLoading(true);
    try {
      const { data } = await supabase
        .from("template_item_supplier_mappings")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("template_item_id", templateItemId);
      const rows = (data ?? []) as unknown as MappingRow[];
      setAbc(rows.find((r) => r.supplier === "abc") ?? null);
      setSrs(rows.find((r) => r.supplier === "srs") ?? null);
    } finally {
      setLoading(false);
    }
  }, [tenantId, templateItemId]);

  useEffect(() => { void load(); }, [load]);

  const callRoute = useCallback(
    async (fn: "supplier-api" | "srs-api", path: string, body: Record<string, unknown>) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("not_authenticated");
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${fn}${path}`;
      const resp = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(body),
      });
      const text = await resp.text();
      let json: any = null;
      try { json = JSON.parse(text); } catch { json = { raw: text }; }
      if (!resp.ok || json?.ok === false) {
        throw new Error(json?.error || json?.code || `HTTP ${resp.status}`);
      }
      return json?.data ?? json;
    },
    [],
  );

  const approve = useCallback(
    async (supplier: Supplier, payload: Record<string, unknown>) => {
      try {
        if (supplier === "abc") {
          await callRoute("supplier-api", "/abc/mapping/approve", payload);
        } else {
          await callRoute("srs-api", "/mapping/approve", payload);
        }
        toast({ title: `${supplier.toUpperCase()} mapping approved` });
        await load();
      } catch (e: any) {
        toast({ title: `${supplier.toUpperCase()} approve failed`, description: e?.message ?? String(e), variant: "destructive" });
      }
    },
    [callRoute, load, toast],
  );

  const reject = useCallback(
    async (supplier: Supplier) => {
      try {
        if (supplier === "abc") {
          await callRoute("supplier-api", "/abc/mapping/reject", { template_item_id: templateItemId, reason: "manual_reject" });
        } else {
          await callRoute("srs-api", "/mapping/reject", { template_item_id: templateItemId, reason: "manual_reject" });
        }
        toast({ title: `${supplier.toUpperCase()} mapping rejected` });
        await load();
      } catch (e: any) {
        toast({ title: `${supplier.toUpperCase()} reject failed`, description: e?.message ?? String(e), variant: "destructive" });
      }
    },
    [callRoute, load, templateItemId, toast],
  );

  const summary = useMemo(() => ({
    abcStatus: abc?.mapping_status ?? "missing",
    srsStatus: srs?.mapping_status ?? "missing",
  }), [abc, srs]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>Supplier SKU mapping</span>
          <div className="flex items-center gap-2 text-xs font-normal">
            <span>ABC:</span>{statusBadge(summary.abcStatus)}
            <span>SRS:</span>{statusBadge(summary.srsStatus)}
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <SupplierRow
          supplier="abc"
          mapping={abc}
          loading={loading}
          onApprove={(p) => approve("abc", p)}
          onReject={() => reject("abc")}
          templateItemId={templateItemId}
          templateItemName={templateItemName}
        />
        <Separator />
        <SupplierRow
          supplier="srs"
          mapping={srs}
          loading={loading}
          onApprove={(p) => approve("srs", p)}
          onReject={() => reject("srs")}
          templateItemId={templateItemId}
          templateItemName={templateItemName}
        />
      </CardContent>
    </Card>
  );
}

export default SupplierSkuMappingPanel;
