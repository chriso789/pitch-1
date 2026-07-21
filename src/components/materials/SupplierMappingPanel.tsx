// Supplier mapping panel — per-supplier tabs (ABC / SRS / QXO) that let users
// verify each material's supplier SKU + UOM mapping and run a live price lookup.
// Mappings are stored on `materials.attributes.supplier_mappings.<supplier>`.
// UI-only: never renders "$0.00" or "Call for pricing" — falls back to the
// canonical pending/locked messaging.

import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Search, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getAbcPrice } from "@/lib/abc/abcApi";
import {
  toSupplierPriceState,
  describeSupplierPriceState,
  type SupplierPriceState,
  type SupplierKind,
} from "@/lib/templates/supplierPricing";

type MaterialRow = {
  id: string;
  code: string;
  name: string;
  uom: string;
  supplier_sku: string | null;
  attributes: Record<string, any> | null;
};

type Mapping = { sku: string; uom: string };

const SUPPLIER_LABEL: Record<SupplierKind, string> = {
  abc: "ABC Supply",
  srs: "SRS Distribution",
  qxo: "QXO / Beacon",
};

function readMapping(row: MaterialRow, supplier: SupplierKind): Mapping {
  const attr = row.attributes || {};
  const m = attr.supplier_mappings?.[supplier] || {};
  return {
    sku: m.sku ?? (supplier === "abc" ? row.supplier_sku ?? "" : ""),
    uom: m.uom ?? "",
  };
}

export function SupplierMappingPanel() {
  const [supplier, setSupplier] = useState<SupplierKind>("abc");

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold">Supplier Mapping</h3>
        <p className="text-sm text-muted-foreground">
          Verify each material's SKU and UOM for the connected supplier, then
          run a live price lookup. Switch between suppliers using the tabs —
          only one supplier is active at a time.
        </p>
      </div>

      <Tabs value={supplier} onValueChange={(v) => setSupplier(v as SupplierKind)}>
        <TabsList>
          <TabsTrigger value="abc">ABC Supply</TabsTrigger>
          <TabsTrigger value="srs">SRS Distribution</TabsTrigger>
          <TabsTrigger value="qxo">QXO / Beacon</TabsTrigger>
        </TabsList>
        <TabsContent value="abc" className="pt-4">
          <SupplierMappingTable supplier="abc" />
        </TabsContent>
        <TabsContent value="srs" className="pt-4">
          <SupplierMappingTable supplier="srs" />
        </TabsContent>
        <TabsContent value="qxo" className="pt-4">
          <SupplierMappingTable supplier="qxo" />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function SupplierMappingTable({ supplier }: { supplier: SupplierKind }) {
  const qc = useQueryClient();
  const [query, setQuery] = useState("");
  const [edits, setEdits] = useState<Record<string, Mapping>>({});
  const [prices, setPrices] = useState<Record<string, SupplierPriceState>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  const { data, isLoading } = useQuery({
    queryKey: ["supplier-mapping-materials"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("materials" as any)
        .select("id, code, name, uom, supplier_sku, attributes")
        .eq("active", true)
        .order("code");
      if (error) throw error;
      return (data || []) as MaterialRow[];
    },
    staleTime: 60_000,
  });

  const rows = useMemo(() => {
    const list = data || [];
    if (!query) return list;
    const q = query.toLowerCase();
    return list.filter(
      (m) =>
        m.name.toLowerCase().includes(q) ||
        m.code.toLowerCase().includes(q) ||
        (m.supplier_sku || "").toLowerCase().includes(q),
    );
  }, [data, query]);

  const getEdited = (row: MaterialRow): Mapping =>
    edits[row.id] ?? readMapping(row, supplier);

  const patch = (id: string, next: Partial<Mapping>, base: Mapping) => {
    setEdits((prev) => ({ ...prev, [id]: { ...base, ...prev[id], ...next } }));
  };

  const isDirty = (row: MaterialRow) => {
    const current = readMapping(row, supplier);
    const edited = edits[row.id];
    if (!edited) return false;
    return edited.sku !== current.sku || edited.uom !== current.uom;
  };

  const mappedCount = (data || []).filter((r) => {
    const m = readMapping(r, supplier);
    return !!m.sku;
  }).length;

  const saveRow = async (row: MaterialRow) => {
    const edited = getEdited(row);
    const nextAttrs = {
      ...(row.attributes || {}),
      supplier_mappings: {
        ...((row.attributes || {}).supplier_mappings || {}),
        [supplier]: {
          sku: edited.sku.trim() || null,
          uom: edited.uom.trim() || null,
          updated_at: new Date().toISOString(),
        },
      },
    };
    setBusy((b) => ({ ...b, [row.id]: true }));
    const { error } = await supabase
      .from("materials" as any)
      .update({ attributes: nextAttrs })
      .eq("id", row.id);
    setBusy((b) => ({ ...b, [row.id]: false }));
    if (error) {
      toast.error(`Save failed: ${error.message}`);
      return;
    }
    toast.success("Mapping saved");
    setEdits((prev) => {
      const { [row.id]: _, ...rest } = prev;
      return rest;
    });
    qc.invalidateQueries({ queryKey: ["supplier-mapping-materials"] });
  };

  const verifyPrice = async (row: MaterialRow) => {
    const edited = getEdited(row);
    if (!edited.sku) {
      setPrices((p) => ({
        ...p,
        [row.id]: { kind: "unmapped", reason: "No SKU mapped" },
      }));
      return;
    }
    setBusy((b) => ({ ...b, [row.id]: true }));
    try {
      let state: SupplierPriceState = { kind: "pending" };
      if (supplier === "abc") {
        const resp = await getAbcPrice({
          purpose: "estimating",
          items: [{ item_number: edited.sku, uom: edited.uom || undefined }],
        });
        const line = resp?.items?.[0] as any;
        state = toSupplierPriceState({
          unit_price: line?.unit_price ?? null,
          uom: line?.uom ?? edited.uom ?? null,
          currency: line?.currency ?? "USD",
          price_pending: line?.price_pending ?? false,
          reason: line?.reason ?? null,
        });
      } else if (supplier === "srs") {
        const { data, error } = await supabase.functions.invoke("srs-pricing", {
          body: { items: [{ sku: edited.sku, uom: edited.uom || undefined }] },
        });
        if (error) throw error;
        const line = (data as any)?.items?.[0] ?? (data as any)?.[0] ?? {};
        state = toSupplierPriceState({
          unit_price: line?.unit_price ?? line?.price ?? null,
          uom: line?.uom ?? edited.uom ?? null,
          currency: line?.currency ?? "USD",
          price_pending: line?.price_pending ?? false,
          reason: line?.reason ?? null,
        });
      } else {
        const { data, error } = await supabase.functions.invoke("qxo-pricing", {
          body: { items: [{ sku: edited.sku, uom: edited.uom || undefined }] },
        });
        if (error) throw error;
        const line = (data as any)?.items?.[0] ?? (data as any)?.[0] ?? {};
        state = toSupplierPriceState({
          unit_price: line?.unit_price ?? line?.price ?? null,
          uom: line?.uom ?? edited.uom ?? null,
          currency: line?.currency ?? "USD",
          price_pending: line?.price_pending ?? false,
          reason: line?.reason ?? null,
        });
      }
      setPrices((p) => ({ ...p, [row.id]: state }));
    } catch (e: any) {
      setPrices((p) => ({
        ...p,
        [row.id]: { kind: "error", reason: e?.message || "Lookup failed" },
      }));
    } finally {
      setBusy((b) => ({ ...b, [row.id]: false }));
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by name, code, or SKU..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-10"
          />
        </div>
        <div className="text-sm text-muted-foreground">
          <Badge variant="outline" className="mr-2">
            {mappedCount}/{data?.length ?? 0} mapped
          </Badge>
          <span>{SUPPLIER_LABEL[supplier]}</span>
        </div>
      </div>

      <div className="border rounded-lg">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[140px]">Code</TableHead>
              <TableHead>Material</TableHead>
              <TableHead className="w-[80px]">Cat. UOM</TableHead>
              <TableHead className="w-[180px]">Supplier SKU</TableHead>
              <TableHead className="w-[100px]">Supplier UOM</TableHead>
              <TableHead className="w-[180px]">Live Price</TableHead>
              <TableHead className="w-[200px] text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                  Loading materials…
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                  No materials match this filter.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => {
                const edited = getEdited(row);
                const dirty = isDirty(row);
                const price = prices[row.id];
                const rowBusy = !!busy[row.id];
                return (
                  <TableRow key={row.id}>
                    <TableCell className="font-mono text-xs">{row.code}</TableCell>
                    <TableCell>
                      <div className="font-medium">{row.name}</div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{row.uom}</TableCell>
                    <TableCell>
                      <Input
                        value={edited.sku}
                        onChange={(e) =>
                          patch(row.id, { sku: e.target.value }, readMapping(row, supplier))
                        }
                        placeholder="—"
                        className="h-8 font-mono text-xs"
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        value={edited.uom}
                        onChange={(e) =>
                          patch(row.id, { uom: e.target.value.toUpperCase() }, readMapping(row, supplier))
                        }
                        placeholder="EA"
                        className="h-8 text-xs"
                      />
                    </TableCell>
                    <TableCell>
                      {price ? <PriceBadge state={price} /> : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => verifyPrice(row)}
                          disabled={rowBusy || !edited.sku}
                        >
                          {rowBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : "Verify"}
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => saveRow(row)}
                          disabled={!dirty || rowBusy}
                        >
                          Save
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function PriceBadge({ state }: { state: SupplierPriceState }) {
  const label = describeSupplierPriceState(state);
  if (state.kind === "priced") {
    return (
      <span className="inline-flex items-center gap-1 text-sm font-medium text-emerald-600">
        <CheckCircle2 className="h-3.5 w-3.5" />
        {label}
      </span>
    );
  }
  if (state.kind === "pending" || state.kind === "locked" || state.kind === "unmapped") {
    return (
      <span className="text-xs text-muted-foreground">{label}</span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs text-amber-600">
      <AlertCircle className="h-3.5 w-3.5" />
      {label}
    </span>
  );
}

export default SupplierMappingPanel;
