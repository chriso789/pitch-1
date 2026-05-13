import React, { useState } from "react";
import { useEffectiveTenantId } from "@/hooks/useEffectiveTenantId";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Search, Upload, Play, FileText, Download, AlertTriangle, CheckCircle, XCircle, DollarSign, TrendingUp, Copy, Package } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { GlobalLayout } from "@/shared/components/layout/GlobalLayout";
import { BulkInvoiceImportDialog } from "@/components/materials/BulkInvoiceImportDialog";

// Canonicalize vendor names so aliases (SRS / SRS Building Products / Suncoast Roofers Supply,
// ABC / ABC Supply, etc.) merge into a single bucket across charts and tables.
export function canonicalizeVendorName(raw: string | null | undefined): { key: string; display: string } {
  const v = (raw || "").trim();
  if (!v) return { key: "__unknown__", display: "Unknown vendor" };
  if (/permit|county|township|\btwp\b|city of|riviera beach|ridley|planning,? zoning|zoning ?& ?building/i.test(v))
    return { key: "__permits__", display: "Permits (city / county / township)" };
  if (/dump|dumpster/i.test(v))
    return { key: "__dumpfees__", display: "Dump / Dumpster Fees" };
  if (/^abc\b|abc supply/i.test(v)) return { key: "abc-supply", display: "ABC Supply" };
  if (/^srs\b|srs building|suncoast roofers/i.test(v))
    return { key: "srs", display: "SRS / Suncoast Roofers Supply" };
  if (/standing metal/i.test(v)) return { key: "standing-metals", display: "Standing Metals" };
  if (/dynamic metal/i.test(v)) return { key: "dynamic-metals", display: "Dynamic Metals" };
  if (/home depot/i.test(v)) return { key: "home-depot", display: "Home Depot" };
  if (/\bqxo\b/i.test(v)) return { key: "qxo", display: "QXO" };
  if (/beacon/i.test(v)) return { key: "beacon", display: "Beacon" };
  if (/premier metal/i.test(v)) return { key: "premier-metal", display: "Premier Metal Roof Mfg" };
  return { key: v.toLowerCase(), display: v };
}

function normalizeInvoiceText(raw: string | null | undefined): string {
  return (raw || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}

// A vendor is treated as a labor crew / subcontractor (not a material supplier) when
// (a) any of its invoices is typed 'labor', or (b) the name reads like a service company.
export function isCrewVendor(supplier: { supplier_name?: string; invoice_types?: string[] }): boolean {
  if (supplier.invoice_types?.includes("labor")) return true;
  const n = String(supplier.supplier_name || "").toLowerCase();
  if (!n) return false;
  if (n.startsWith("permits") || n.includes("dump")) return false;
  return /\b(roofing|construction|flooring|services?|contractors?|installer|installation|labor|sub)\b/.test(n);
}

// --- Summary Cards ---
function SummaryCards({ pricebookGroups, totalPricebookItems, materialInvoices, totalInvoiceAmount, unmatchedLines }: any) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
      <Card>
        <CardContent className="pt-4">
          <div className="flex items-center gap-2">
            <Package className="h-5 w-5 text-muted-foreground" />
            <div>
              <p className="text-sm text-muted-foreground">Price Lists</p>
              <p className="text-2xl font-bold">{pricebookGroups.length}</p>
              <p className="text-xs text-muted-foreground">{totalPricebookItems} items</p>
            </div>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-4">
          <div className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-muted-foreground" />
            <div>
              <p className="text-sm text-muted-foreground">Material Invoices</p>
              <p className="text-2xl font-bold">{materialInvoices.length}</p>
            </div>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-4">
          <div className="flex items-center gap-2">
            <DollarSign className="h-5 w-5 text-destructive" />
            <div>
              <p className="text-sm text-muted-foreground">Total Material Spend</p>
              <p className="text-2xl font-bold">${totalInvoiceAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
            </div>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-4">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-yellow-500" />
            <div>
              <p className="text-sm text-muted-foreground">Unmatched Items</p>
              <p className="text-2xl font-bold">{unmatchedLines.length}</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// --- Spend Chart ---
function SpendChart({ chartData }: { chartData: Array<{ name: string; total: number }> }) {
  if (chartData.length === 0) return null;
  const formatY = (v: number) => "$" + (v / 1000).toFixed(1) + "k";
  const formatTooltip = (v: number) => "$" + v.toLocaleString(undefined, { minimumFractionDigits: 2 });
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Material Spend by Vendor</CardTitle></CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={340}>
          <BarChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 110 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis
              dataKey="name"
              interval={0}
              angle={-40}
              textAnchor="end"
              height={120}
              fontSize={11}
              tick={{ fill: "hsl(var(--foreground))" }}
              tickFormatter={(v: string) => (v && v.length > 22 ? v.slice(0, 20) + "\u2026" : v)}
            />
            <YAxis tickFormatter={formatY} />
            <Tooltip formatter={formatTooltip} labelFormatter={(l: string) => l} />
            <Bar dataKey="total" fill="hsl(var(--primary))" name="Spend" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

// --- Price Lists Tab ---
function PriceListsTab({ pricebookGroups, legacyPriceLists, templatePriceLists = [], importBatches = [], invoiceSuppliers = [], tenantId, legacySuppliers, queryClient }: any) {
  const [drilldownSupplier, setDrilldownSupplier] = useState<any | null>(null);

  // A supplier is considered "standardized" only when its name appears in
  // a CSV/PDF import batch OR in pricebookGroups/legacyPriceLists.
  const standardizedSupplierNames = React.useMemo(() => {
    const names = new Set<string>();
    importBatches.forEach((b: any) => {
      if (b.supplier_name) names.add(String(b.supplier_name).toLowerCase().trim());
    });
    pricebookGroups.forEach((g: any) => {
      if (g.supplier_name) names.add(String(g.supplier_name).toLowerCase().trim());
    });
    legacyPriceLists.forEach((pl: any) => {
      const n = pl?.material_suppliers?.supplier_name;
      if (n) names.add(String(n).toLowerCase().trim());
    });
    return names;
  }, [importBatches, pricebookGroups, legacyPriceLists]);

  // Normalize supplier names so aliases like "SRS" match "SRS / Suncoast Roofers Supply".
  // Splits on common separators (/, -, |) and also does substring containment check.
  const matchesStandardized = React.useCallback((rawName: string) => {
    const name = String(rawName || "").toLowerCase().trim();
    if (!name) return false;
    if (standardizedSupplierNames.has(name)) return true;
    const parts = name.split(/[\/\|\-–]+/).map((p) => p.trim()).filter(Boolean);
    for (const p of parts) {
      if (standardizedSupplierNames.has(p)) return true;
    }
    for (const std of standardizedSupplierNames) {
      if (!std) continue;
      if (name.includes(std) || std.includes(name)) return true;
    }
    return false;
  }, [standardizedSupplierNames]);

  const invoiceOnlySuppliers = React.useMemo(
    () => invoiceSuppliers.filter((s: any) => !matchesStandardized(s.supplier_name)),
    [invoiceSuppliers, matchesStandardized]
  );
  const invoiceOnlyMaterialSuppliers = React.useMemo(
    () => invoiceOnlySuppliers.filter((s: any) => !isCrewVendor(s)),
    [invoiceOnlySuppliers]
  );
  const crewSuppliers = React.useMemo(
    () => invoiceOnlySuppliers.filter((s: any) => isCrewVendor(s)),
    [invoiceOnlySuppliers]
  );
  return (
    <TabsContent value="price-lists">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base">Price Agreements</CardTitle>
            <CardDescription>Active supplier price lists and imported agreements</CardDescription>
          </div>
          <ImportPriceListDialog tenantId={tenantId} suppliers={legacySuppliers} onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ["pricebook-groups"] });
            queryClient.invalidateQueries({ queryKey: ["supplier-price-lists"] });
            queryClient.invalidateQueries({ queryKey: ["template-manufacturer-price-lists"] });
          }} />
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Supplier / Manufacturer</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Items</TableHead>
                <TableHead>Categories</TableHead>
                <TableHead>Imported</TableHead>
                <TableHead>Last Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pricebookGroups.map((g: any, i: number) => (
                <TableRow key={"pb-" + i}>
                  <TableCell className="font-medium">{g.supplier_name}</TableCell>
                  <TableCell><Badge variant="outline" className="text-xs">Pricebook</Badge></TableCell>
                  <TableCell>
                    <Badge variant={g.is_active ? "default" : "outline"} className={g.is_active ? "bg-emerald-600" : ""}>
                      {g.is_active ? "Active" : "Inactive"}
                    </Badge>
                  </TableCell>
                  <TableCell>{g.item_count}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {g.categories.slice(0, 3).map((c: string) => (
                        <Badge key={c} variant="outline" className="text-xs">{c}</Badge>
                      ))}
                      {g.categories.length > 3 && <Badge variant="outline" className="text-xs">+{g.categories.length - 3}</Badge>}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {g.imported_at ? new Date(g.imported_at).toLocaleDateString() : "\u2014"}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {g.imported_at ? new Date(g.imported_at).toLocaleDateString() : "\u2014"}
                  </TableCell>
                </TableRow>
              ))}
              {/* Material Catalog (CSV) category rows intentionally hidden — only real uploaded price agreements are shown here. */}
              {legacyPriceLists.map((pl: any) => (
                <TableRow key={pl.id}>
                  <TableCell className="font-medium">{(pl as any).material_suppliers?.supplier_name}</TableCell>
                  <TableCell><Badge variant="outline" className="text-xs">Imported List</Badge></TableCell>
                  <TableCell>
                    <Badge variant={pl.status === "active" ? "default" : "outline"} className={pl.status === "active" ? "bg-emerald-600" : ""}>{pl.status}</Badge>
                  </TableCell>
                  <TableCell>{pl.items_count || "\u2014"}</TableCell>
                  <TableCell>{pl.effective_start_date} {"\u2014"} {pl.effective_end_date || "\u221E"}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {new Date(pl.created_at).toLocaleDateString()}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {pl.updated_at ? new Date(pl.updated_at).toLocaleDateString() : "\u2014"}
                  </TableCell>
                </TableRow>
              ))}
              {invoiceOnlyMaterialSuppliers.map((s: any) => {
                const isPermits = s.supplier_name?.toLowerCase().startsWith("permits");
                return (
                  <TableRow
                    key={"inv-" + s.supplier_name}
                    className="cursor-pointer hover:bg-muted/40"
                    onClick={() => setDrilldownSupplier(s)}
                  >
                    <TableCell className="font-medium">{s.supplier_name}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={"text-xs " + (isPermits ? "bg-blue-500/10 text-blue-700 border-blue-500/30" : "bg-amber-500/10 text-amber-700 border-amber-500/30")}>
                        {isPermits ? "Permit Fees" : "From Invoices"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">{s.item_count > 0 ? "Observed only" : "No line items"}</Badge>
                    </TableCell>
                    <TableCell>{s.item_count || "\u2014"}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {s.invoice_count} invoice{s.invoice_count === 1 ? "" : "s"}{s.line_count > 0 ? " \u00b7 " + s.line_count + " lines" : ""}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{"\u2014"}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {s.last_invoice_at ? new Date(s.last_invoice_at).toLocaleDateString() : "\u2014"}
                    </TableCell>
                  </TableRow>
                );
              })}
              {pricebookGroups.length === 0 && legacyPriceLists.length === 0 && templatePriceLists.length === 0 && invoiceOnlyMaterialSuppliers.length === 0 && (
                <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">No material price lists imported yet</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {crewSuppliers.length > 0 && (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle className="text-base">Crews / Subcontractors</CardTitle>
            <CardDescription>Labor vendors observed from invoices — not material suppliers</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Crew / Subcontractor</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Invoices</TableHead>
                  <TableHead>Last Invoice</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {crewSuppliers.map((s: any) => (
                  <TableRow
                    key={"crew-" + s.supplier_name}
                    className="cursor-pointer hover:bg-muted/40"
                    onClick={() => setDrilldownSupplier(s)}
                  >
                    <TableCell className="font-medium">{s.supplier_name}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs bg-purple-500/10 text-purple-700 border-purple-500/30">Labor</Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {s.invoice_count} invoice{s.invoice_count === 1 ? "" : "s"}{s.line_count > 0 ? " \u00b7 " + s.line_count + " lines" : ""}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {s.last_invoice_at ? new Date(s.last_invoice_at).toLocaleDateString() : "\u2014"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Card className="mt-4">
        <CardHeader>
          <CardTitle className="text-base">Import History</CardTitle>
          <CardDescription>
            Every price list loaded through the "Import Materials" button ({importBatches.length} run{importBatches.length === 1 ? "" : "s"})
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>File / Source</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Items</TableHead>
                <TableHead>Notes</TableHead>
                <TableHead>Imported</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {importBatches.map((b: any) => (
                <TableRow key={b.id}>
                  <TableCell className="font-medium">{b.source_filename || b.supplier_name || "Untitled import"}</TableCell>
                  <TableCell><Badge variant="outline" className="text-xs uppercase">{b.source_type || "csv"}</Badge></TableCell>
                  <TableCell>{b.items_count}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{b.notes || "\u2014"}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {b.created_at ? new Date(b.created_at).toLocaleString() : "\u2014"}
                  </TableCell>
                </TableRow>
              ))}
              {importBatches.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground py-6">
                    No imports have been logged yet. New imports run through the "Import Materials" button will appear here.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={!!drilldownSupplier} onOpenChange={(o) => !o && setDrilldownSupplier(null)}>
        <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {drilldownSupplier?.supplier_name}
              <Badge variant="outline" className="text-xs bg-amber-500/10 text-amber-700 border-amber-500/30">From Invoices</Badge>
            </DialogTitle>
            <CardDescription>
              No CSV/PDF price list imported for this supplier yet. Pricing below is observed from
              {" "}{drilldownSupplier?.invoice_count} invoice{drilldownSupplier?.invoice_count === 1 ? "" : "s"}.
              The lowest observed price is held as the working benchmark until an official price list is imported.
            </CardDescription>
          </DialogHeader>
          {drilldownSupplier && (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <Card><CardContent className="pt-4">
                  <p className="text-xs text-muted-foreground">Distinct Items</p>
                  <p className="text-2xl font-bold">{drilldownSupplier.item_count}</p>
                </CardContent></Card>
                <Card><CardContent className="pt-4">
                  <p className="text-xs text-muted-foreground">Invoice Lines</p>
                  <p className="text-2xl font-bold">{drilldownSupplier.line_count}</p>
                </CardContent></Card>
                <Card><CardContent className="pt-4">
                  <p className="text-xs text-muted-foreground">Items With Variance</p>
                  <p className="text-2xl font-bold text-amber-600">
                    {drilldownSupplier.items.filter((i: any) => i.variance_pct > 5).length}
                  </p>
                </CardContent></Card>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead>UOM</TableHead>
                    <TableHead className="text-right">Lowest (benchmark)</TableHead>
                    <TableHead className="text-right">Avg</TableHead>
                    <TableHead className="text-right">Highest</TableHead>
                    <TableHead className="text-right">Variance</TableHead>
                    <TableHead className="text-right">Seen</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {drilldownSupplier.items.map((it: any) => (
                    <TableRow key={it.key}>
                      <TableCell className="font-medium">
                        {it.description}
                        {it.sku && <span className="text-xs text-muted-foreground ml-1">({it.sku})</span>}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{it.uom || "\u2014"}</TableCell>
                      <TableCell className="text-right font-semibold text-emerald-700">${it.min_price.toFixed(2)}</TableCell>
                      <TableCell className="text-right">${it.avg_price.toFixed(2)}</TableCell>
                      <TableCell className={"text-right " + (it.variance_pct > 5 ? "text-destructive font-semibold" : "")}>
                        ${it.max_price.toFixed(2)}
                      </TableCell>
                      <TableCell className="text-right">
                        {it.variance_pct > 0 ? (
                          <Badge variant={it.variance_pct > 10 ? "destructive" : "outline"} className="text-xs">
                            {it.variance_pct.toFixed(1)}%
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">{"\u2014"}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right text-sm text-muted-foreground">{it.observation_count}x</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </TabsContent>
  );
}

// --- Invoice Queue Tab ---
function InvoiceQueueTab({ filteredInvoices, getInvoiceStatusBadge }: any) {
  const [bulkOpen, setBulkOpen] = useState(false);
  const queryClient = useQueryClient();
  return (
    <TabsContent value="invoice-queue">
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle className="text-base">Material Invoice Queue</CardTitle>
              <CardDescription>Material invoices uploaded to projects {"\u2014"} compare against price lists</CardDescription>
            </div>
            <Button size="sm" onClick={() => setBulkOpen(true)}>
              <Upload className="h-4 w-4 mr-2" />
              Bulk Import Invoices
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Job</TableHead>
                <TableHead>Vendor</TableHead>
                <TableHead>Invoice #</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredInvoices.map((inv: any) => {
                const contactName =
                  inv.pipeline_entries?.lead_name ||
                  (inv.pipeline_entries?.contacts ? inv.pipeline_entries.contacts.first_name + " " + inv.pipeline_entries.contacts.last_name : null) ||
                  "Unknown";
                return (
                  <TableRow key={inv.id}>
                    <TableCell className="font-medium">{contactName}</TableCell>
                    <TableCell>{inv.vendor_name || "\u2014"}</TableCell>
                    <TableCell>{inv.invoice_number || "\u2014"}</TableCell>
                    <TableCell>${Number(inv.invoice_amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</TableCell>
                    <TableCell>{getInvoiceStatusBadge(inv.status || "pending")}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {inv.invoice_date ? new Date(inv.invoice_date).toLocaleDateString() : new Date(inv.created_at).toLocaleDateString()}
                    </TableCell>
                  </TableRow>
                );
              })}
              {filteredInvoices.length === 0 && (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">No material invoices found</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <BulkInvoiceImportDialog
        open={bulkOpen}
        onOpenChange={setBulkOpen}
        onComplete={() => {
          queryClient.invalidateQueries({ queryKey: ["material-invoices"] });
          queryClient.invalidateQueries({ queryKey: ["project-cost-invoices"] });
        }}
      />
    </TabsContent>
  );
}

// --- Audit Results Tab ---
function AuditLineDetails({ auditId, supplierId, tenantId }: { auditId: string; supplierId?: string | null; tenantId?: string | null }) {
  const queryClient = useQueryClient();
  const [mapLine, setMapLine] = useState<any>(null);
  const [pickItem, setPickItem] = useState("");
  const [search, setSearch] = useState("");

  const { data: lines = [], isLoading } = useQuery({
    queryKey: ["audit-lines", auditId],
    queryFn: async () => {
      const { data } = await supabase
        .from("material_invoice_audit_lines")
        .select("id, supplier_id, invoice_description, agreed_description, quantity, charged_unit_price, agreed_unit_price, charged_extended_price, expected_extended_price, total_difference, discrepancy_type, match_type, supplier_sku, agreed_supplier_sku, price_list_item_id")
        .eq("audit_id", auditId)
        .order("total_difference", { ascending: false, nullsFirst: false });
      return data || [];
    },
  });

  const { data: priceItems = [] } = useQuery({
    queryKey: ["map-price-items", mapLine?.supplier_id || supplierId],
    queryFn: async () => {
      const sid = mapLine?.supplier_id || supplierId;
      if (!sid) return [];
      const { data } = await supabase
        .from("supplier_price_list_items")
        .select("id, item_description, supplier_sku, agreed_unit_price, unit_of_measure")
        .eq("supplier_id", sid)
        .order("item_description")
        .limit(1000);
      return data || [];
    },
    enabled: !!mapLine,
  });

  const filteredItems = React.useMemo(() => {
    if (!search) return (priceItems as any[]).slice(0, 200);
    // Broad fuzzy: split query into tokens, normalize (strip punctuation/quotes/units),
    // and require each token to appear in any searchable field. Also score by hits
    // so closer matches surface first.
    const normalize = (s: string) =>
      String(s || "")
        .toLowerCase()
        .replace(/[^a-z0-9 ]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    const tokens = normalize(search).split(" ").filter((t) => t.length >= 2);
    if (tokens.length === 0) return (priceItems as any[]).slice(0, 200);
    const scored = (priceItems as any[])
      .map((p) => {
        const haystack = normalize(
          [p.item_description, p.supplier_sku, p.manufacturer_sku, p.brand, p.category, p.unit_of_measure]
            .filter(Boolean)
            .join(" ")
        );
        const hits = tokens.filter((t) => haystack.includes(t)).length;
        return { p, hits };
      })
      .filter((x) => x.hits > 0)
      .sort((a, b) => b.hits - a.hits);
    return scored.slice(0, 200).map((x) => x.p);
  }, [priceItems, search]);

  const [cataloging, setCataloging] = React.useState(false);
  const [catalogName, setCatalogName] = React.useState("");

  React.useEffect(() => {
    const raw = mapLine?.invoice_description || "";
    setCatalogName(raw.replace(/\\(["'\\])/g, "$1"));
  }, [mapLine?.id, mapLine?.invoice_description]);

  const catalogNewItem = async () => {
    if (!mapLine || !tenantId) return;
    const sid = mapLine.supplier_id || supplierId;
    if (!sid) { toast.error("No supplier on this line"); return; }
    const chargedUnit = Number(mapLine.charged_unit_price || 0);
    if (!chargedUnit) { toast.error("Cannot catalog – charged unit price is 0"); return; }
    const desc = (catalogName || "").trim();
    if (!desc) { toast.error("Please enter a name for the new catalog item"); return; }
    setCataloging(true);
    try {
      // Find or create an active price list for this supplier
      let { data: pl } = await supabase
        .from("supplier_price_lists")
        .select("id")
        .eq("supplier_id", sid)
        .eq("status", "active")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      let priceListId = pl?.id;
      if (!priceListId) {
        const { data: created, error: plErr } = await supabase
          .from("supplier_price_lists")
          .insert({ company_id: tenantId, supplier_id: sid, list_name: "Cataloged from invoices", status: "active", effective_start_date: new Date().toISOString().slice(0, 10) })
          .select("id")
          .single();
        if (plErr) throw plErr;
        priceListId = created.id;
      }
      const { data: newItem, error: itemErr } = await supabase
        .from("supplier_price_list_items")
        .insert({
          company_id: tenantId,
          supplier_id: sid,
          price_list_id: priceListId,
          item_description: desc,
          normalized_description: normalizeInvoiceText(desc),
          supplier_sku: mapLine.supplier_sku || null,
          unit_of_measure: mapLine.invoice_uom || "ea",
          agreed_unit_price: chargedUnit,
        })
        .select("id, item_description, supplier_sku, agreed_unit_price, unit_of_measure")
        .single();
      if (itemErr) throw itemErr;

      // Mirror into the global materials catalog so it appears in materials search
      // across estimates and the rest of the app (not just inside the audit mapper).
      try {
        const code = `SPLI-${newItem.id}`;
        await supabase.from("materials" as any).insert({
          tenant_id: tenantId,
          code,
          name: desc,
          description: desc,
          uom: mapLine.invoice_uom || "ea",
          base_cost: chargedUnit,
          supplier_sku: mapLine.supplier_sku || null,
          active: true,
        });
      } catch (mirrorErr) {
        // Non-fatal: price list item is the source of truth for the audit
        console.warn("[catalogNewItem] materials mirror failed", mirrorErr);
      }

      setPickItem(newItem.id);
      // Refresh the price items list so the new item appears
      await queryClient.invalidateQueries({ queryKey: ["map-price-items", sid] });
      toast.success(`"${desc.slice(0, 40)}" added to catalog at $${chargedUnit.toFixed(2)}`);
      // Auto-save the mapping immediately using the freshly cataloged item
      await saveMappingWithItem(newItem);
    } catch (e: any) {
      toast.error(`Catalog failed: ${e.message}`);
    } finally {
      setCataloging(false);
    }
  };

  const saveMappingWithItem = async (selectedItem: any) => {
    if (!mapLine || !tenantId) return;
    const sid = mapLine.supplier_id || supplierId;
    const qty = Number(mapLine.quantity || 0);
    const chargedUnit = Number(mapLine.charged_unit_price || 0);
    const chargedExt = Number(mapLine.charged_extended_price ?? chargedUnit * qty);
    const agreedUnit = selectedItem?.agreed_unit_price != null ? Number(selectedItem.agreed_unit_price) : null;
    const expectedExt = agreedUnit != null ? agreedUnit * qty : null;
    const totalDiff = expectedExt != null ? chargedExt - expectedExt : null;
    const discrepancy = totalDiff == null ? "needs_review" : totalDiff > 0.01 ? "overcharge" : totalDiff < -0.01 ? "undercharge" : "no_issue";
    const { error } = await supabase.from("material_item_match_rules").insert({
      company_id: tenantId,
      supplier_id: sid,
      normalized_invoice_description: normalizeInvoiceText(mapLine.invoice_description),
      supplier_sku: mapLine.supplier_sku || null,
      price_list_item_id: selectedItem.id,
      created_by: (await supabase.auth.getUser()).data?.user?.id,
    });
    if (error) { toast.error(error.message); return; }
    const { error: lineError } = await supabase.from("material_invoice_audit_lines").update({
      price_list_item_id: selectedItem.id,
      match_type: "manual_rule",
      match_confidence: 1,
      agreed_description: selectedItem?.item_description || null,
      agreed_supplier_sku: selectedItem?.supplier_sku || null,
      agreed_uom: selectedItem?.unit_of_measure || null,
      agreed_unit_price: agreedUnit,
      expected_extended_price: expectedExt,
      price_difference_per_unit: agreedUnit != null ? chargedUnit - agreedUnit : null,
      total_difference: totalDiff,
      discrepancy_type: discrepancy,
      discrepancy_status: discrepancy === "no_issue" ? "resolved" : "open",
    }).eq("id", mapLine.id);
    if (lineError) { toast.error(lineError.message); return; }

    const { data: refreshedLines } = await supabase
      .from("material_invoice_audit_lines")
      .select("discrepancy_type,total_difference,expected_extended_price,charged_extended_price")
      .eq("audit_id", auditId);
    const allLines = refreshedLines || [];
    const matchedLines = allLines.filter((l: any) => l.discrepancy_type !== "unmatched_item" && l.expected_extended_price != null).length;
    const unmatchedLines = allLines.length - matchedLines;
    const overchargedLines = allLines.filter((l: any) => l.discrepancy_type === "overcharge").length;
    const underchargedLines = allLines.filter((l: any) => l.discrepancy_type === "undercharge").length;
    const totalExpected = allLines.reduce((sum: number, l: any) => sum + Number(l.expected_extended_price || 0), 0);
    const totalActual = allLines.reduce((sum: number, l: any) => sum + Number(l.charged_extended_price || 0), 0);
    const totalOver = allLines.reduce((sum: number, l: any) => sum + Math.max(Number(l.total_difference || 0), 0), 0);
    const totalUnder = allLines.reduce((sum: number, l: any) => sum + Math.max(-Number(l.total_difference || 0), 0), 0);
    await supabase.from("material_invoice_audits").update({
      matched_lines: matchedLines,
      unmatched_lines: unmatchedLines,
      overcharged_lines: overchargedLines,
      undercharged_lines: underchargedLines,
      total_expected_amount: totalExpected,
      total_actual_amount: totalActual,
      total_overcharge_amount: totalOver,
      total_undercharge_amount: totalUnder,
      audit_status: unmatchedLines === 0 ? "audited" : matchedLines > 0 ? "partial_match" : "needs_review",
    }).eq("id", auditId);

    toast.success("Mapped and match % updated.");
    setMapLine(null);
    setPickItem("");
    setSearch("");
    queryClient.invalidateQueries({ queryKey: ["audit-lines", auditId] });
    queryClient.invalidateQueries({ queryKey: ["material-audits"] });
    queryClient.invalidateQueries({ queryKey: ["unmatched-audit-lines"] });
  };

  const saveMapping = async () => {
    if (!pickItem) return;
    const selectedItem = (priceItems as any[]).find((p) => p.id === pickItem);
    if (!selectedItem) { toast.error("Pick a price-list item first"); return; }
    await saveMappingWithItem(selectedItem);
  };

  if (isLoading) return <div className="text-xs text-muted-foreground p-3">Loading lines...</div>;
  if (!lines.length) return <div className="text-xs text-muted-foreground p-3">No line items recorded.</div>;

  return (
    <div className="bg-muted/30 p-3 rounded-md">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="text-xs">Invoice Item</TableHead>
            <TableHead className="text-xs">Matched To</TableHead>
            <TableHead className="text-xs text-right">Qty</TableHead>
            <TableHead className="text-xs text-right">Charged</TableHead>
            <TableHead className="text-xs text-right">Agreed</TableHead>
            <TableHead className="text-xs text-right">Difference</TableHead>
            <TableHead className="text-xs">Status</TableHead>
            <TableHead className="text-xs"></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {lines.map((l: any) => {
            const diff = Number(l.total_difference || 0);
            const isOver = l.discrepancy_type === "overcharge";
            const isUnder = l.discrepancy_type === "undercharge";
            const isUnmatched = l.discrepancy_type === "unmatched_item";
            return (
              <TableRow key={l.id}>
                <TableCell className="text-xs max-w-[260px]">
                  <div className="font-medium truncate">{l.invoice_description || "—"}</div>
                  {l.supplier_sku && <div className="text-[10px] text-muted-foreground">SKU {l.supplier_sku}</div>}
                </TableCell>
                <TableCell className="text-xs max-w-[240px]">
                  {l.agreed_description ? (
                    <>
                      <div className="truncate">{l.agreed_description}</div>
                      <div className="text-[10px] text-muted-foreground">{l.match_type}</div>
                    </>
                  ) : (
                    <span className="text-muted-foreground">No price-list match</span>
                  )}
                </TableCell>
                <TableCell className="text-xs text-right">{Number(l.quantity || 0)}</TableCell>
                <TableCell className="text-xs text-right">${Number(l.charged_unit_price || 0).toFixed(2)}</TableCell>
                <TableCell className="text-xs text-right">{l.agreed_unit_price != null ? `$${Number(l.agreed_unit_price).toFixed(2)}` : "—"}</TableCell>
                <TableCell className={`text-xs text-right font-medium ${isOver ? "text-destructive" : isUnder ? "text-emerald-600" : ""}`}>
                  {l.total_difference != null ? `${diff > 0 ? "+" : ""}$${diff.toFixed(2)}` : "—"}
                </TableCell>
                <TableCell>
                  {isOver && <Badge variant="destructive" className="text-[10px]">Overcharge</Badge>}
                  {isUnder && <Badge className="bg-emerald-600 text-[10px]">Undercharge</Badge>}
                  {isUnmatched && <Badge variant="outline" className="text-[10px] border-yellow-500 text-yellow-600">Unmatched</Badge>}
                  {!isOver && !isUnder && !isUnmatched && <Badge variant="outline" className="text-[10px]">OK</Badge>}
                </TableCell>
                <TableCell>
                  <Button size="sm" variant="outline" className="h-7 text-[10px]" onClick={() => { setMapLine(l); setPickItem(""); setSearch(""); }}>
                    {isUnmatched ? "Map" : "Remap"}
                  </Button>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      <Dialog open={!!mapLine} onOpenChange={(o) => { if (!o) { setMapLine(null); setPickItem(""); setSearch(""); } }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Map invoice line to price-list item</DialogTitle>
          </DialogHeader>
          {mapLine && (
            <div className="space-y-3">
              <div className="text-sm">
                <div className="font-medium">{mapLine.invoice_description}</div>
                <div className="text-xs text-muted-foreground">SKU: {mapLine.supplier_sku || "—"} · Charged ${Number(mapLine.charged_unit_price || 0).toFixed(2)}</div>
              </div>
              <Input placeholder="Search price list..." value={search} onChange={(e) => setSearch(e.target.value)} />
              <div className="border rounded-md max-h-[320px] overflow-y-auto divide-y">
                {filteredItems.map((p: any) => (
                  <button
                    key={p.id}
                    type="button"
                    className={`w-full text-left px-3 py-2 text-xs hover:bg-accent ${pickItem === p.id ? "bg-accent" : ""}`}
                    onClick={() => setPickItem(p.id)}
                  >
                    <div className="font-medium">{p.item_description}</div>
                    <div className="text-[10px] text-muted-foreground">
                      ${Number(p.agreed_unit_price || 0).toFixed(2)}/{p.unit_of_measure || "ea"} {p.supplier_sku ? `· ${p.supplier_sku}` : ""}
                    </div>
                  </button>
                ))}
                {filteredItems.length === 0 && (
                  <div className="px-3 py-6 text-center text-xs text-muted-foreground">No items found</div>
                )}
              </div>
              <div className="space-y-1.5 pt-1 border-t">
                <label className="text-xs font-medium text-muted-foreground">New catalog item name</label>
                <Input
                  placeholder="Name this item as it should appear in the catalog"
                  value={catalogName}
                  onChange={(e) => setCatalogName(e.target.value)}
                />
              </div>
              <div className="flex items-center justify-between gap-2 pt-1">
                <Button
                  variant="secondary"
                  onClick={catalogNewItem}
                  disabled={cataloging || !catalogName.trim() || !Number(mapLine?.charged_unit_price || 0)}
                  title="Add this invoice line as a new item in the supplier price list at the charged price"
                >
                  <Package className="h-4 w-4 mr-2" />
                  {cataloging ? "Cataloging..." : "Catalog this item"}
                </Button>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => setMapLine(null)}>Cancel</Button>
                  <Button onClick={saveMapping} disabled={!pickItem}>Save mapping</Button>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

type SkippedAuditInvoice = {
  invoiceId: string;
  invoiceNumber?: string | null;
  vendorName?: string | null;
  documentName?: string | null;
  projectId?: string | null;
  pipelineEntryId?: string | null;
  jobLabel?: string | null;
  reason: string;
};

function getInvoiceJobLabel(inv: any): string {
  const pe = inv?.pipeline_entries;
  const contact = pe?.contacts;
  const contactName = contact ? `${contact.first_name || ""} ${contact.last_name || ""}`.trim() : "";
  const project = inv?.projects;
  const projectNumber = project?.project_number || (project?.job_number != null ? `Job ${project.job_number}` : "");
  return pe?.lead_name || project?.name || projectNumber || contactName || "—";
}

function AuditResultsTab({ audits, getAuditStatusBadge, tenantId, queryClient, materialInvoices }: any) {
  const [running, setRunning] = React.useState(false);
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set());
  const [skipped, setSkipped] = React.useState<SkippedAuditInvoice[]>([]);
  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const runAuditAll = async () => {
    if (!tenantId) return;
    setRunning(true);
    try {
      const { data, error } = await supabase.functions.invoke("audit-cost-invoice", { body: { tenantId } });
      if (error) throw error;
      const skippedArr = (data as any)?.skipped || [];
      setSkipped(skippedArr);
      toast.success(`Audited ${(data as any)?.audited || 0} invoices · $${(data as any)?.total_overcharge || 0} overcharge${skippedArr.length ? ` · ${skippedArr.length} skipped` : ""}`);
      queryClient.invalidateQueries({ queryKey: ["material-audits", tenantId] });
      queryClient.invalidateQueries({ queryKey: ["unmatched-audit-lines", tenantId] });
    } catch (e: any) {
      toast.error(`Audit failed: ${e.message}`);
    } finally {
      setRunning(false);
    }
  };

  const invoiceById = React.useMemo(() => {
    const m = new Map<string, any>();
    (materialInvoices || []).forEach((i: any) => m.set(i.id, i));
    return m;
  }, [materialInvoices]);

  return (
    <TabsContent value="audit-results">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div>
              <CardTitle className="text-base">Audit History</CardTitle>
              <CardDescription>Results from automated price verification runs · click a row to see line-by-line discrepancies</CardDescription>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={running}
                onClick={async () => {
                  if (!tenantId) return;
                  setRunning(true);
                  try {
                    const { data, error } = await supabase.functions.invoke("build-derived-pricelists", { body: { tenantId } });
                    if (error) throw error;
                    toast.success(`Built derived pricelists: ${(data as any)?.items || 0} items across ${(data as any)?.suppliers || 0} suppliers`);
                  } catch (e: any) {
                    toast.error(`Build failed: ${e.message}`);
                  } finally {
                    setRunning(false);
                  }
                }}
              >
                <Package className="h-4 w-4 mr-2" />
                Build Derived Pricelists
              </Button>
              <Button onClick={runAuditAll} disabled={running} size="sm">
                <Play className="h-4 w-4 mr-2" />
                {running ? "Auditing..." : "Run Audit on All Invoices"}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Supplier</TableHead>
                <TableHead>Invoice</TableHead>
                <TableHead>Job / Lead</TableHead>
                <TableHead>Lines</TableHead>
                <TableHead>Match %</TableHead>
                <TableHead>Overcharge</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {audits.map((a: any) => {
                const matchPct = a.total_invoice_lines > 0 ? Math.round((a.matched_lines / a.total_invoice_lines) * 100) : 0;
                const supplierName = a.supplier?.supplier_name || a.invoice?.vendor_name || "—";
                const invoiceNumber = a.invoice?.invoice_number || "—";
                const jobLabel = getInvoiceJobLabel(a.invoice);
                const isOpen = expanded.has(a.id);
                return (
                  <React.Fragment key={a.id}>
                    <TableRow className="cursor-pointer hover:bg-muted/40" onClick={() => toggle(a.id)}>
                      <TableCell className="font-medium">{supplierName}</TableCell>
                      <TableCell>{invoiceNumber}</TableCell>
                      <TableCell className="text-sm">{jobLabel}</TableCell>
                      <TableCell>{a.total_invoice_lines}</TableCell>
                      <TableCell>
                        <Badge variant={matchPct >= 90 ? "default" : "outline"} className={matchPct >= 90 ? "bg-emerald-600" : matchPct >= 70 ? "border-yellow-500 text-yellow-600" : "border-destructive text-destructive"}>
                          {matchPct}%
                        </Badge>
                      </TableCell>
                      <TableCell className={Number(a.total_overcharge_amount || 0) > 0 ? "text-destructive font-medium" : ""}>
                        ${Number(a.total_overcharge_amount || 0).toFixed(2)}
                      </TableCell>
                      <TableCell>
                        {Number(a.total_overcharge_amount || 0) > 0 ? (
                          <Badge className="bg-amber-600 hover:bg-amber-700">Credit Claim Ready</Badge>
                        ) : (
                          getAuditStatusBadge(a.audit_status)
                        )}
                      </TableCell>
                    </TableRow>
                    {isOpen && (
                      <TableRow>
                        <TableCell colSpan={7} className="p-0">
                          <AuditLineDetails auditId={a.id} supplierId={a.supplier_id} tenantId={tenantId} />
                        </TableCell>
                      </TableRow>
                    )}
                  </React.Fragment>
                );
              })}
              {audits.length === 0 && (
                <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">No audits run yet</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {skipped.length > 0 && (
        <Card className="mt-4 border-yellow-500/40">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-yellow-600" />
              Skipped Invoices ({skipped.length})
            </CardTitle>
            <CardDescription>
              These invoices were not audited on the last run. Most common causes: vendor name doesn't match a supplier in your directory, no active price list for that supplier, or no line items extracted.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Vendor</TableHead>
                  <TableHead>Invoice #</TableHead>
                  <TableHead>Job / Lead</TableHead>
                  <TableHead>Reason</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {skipped.map((s) => {
                  const inv = invoiceById.get(s.invoiceId);
                  return (
                    <TableRow key={s.invoiceId}>
                      <TableCell>{s.vendorName || inv?.vendor_name || "—"}</TableCell>
                      <TableCell>{s.invoiceNumber || inv?.invoice_number || s.documentName || inv?.document_name || "—"}</TableCell>
                      <TableCell>{s.jobLabel || getInvoiceJobLabel(inv)}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{s.reason}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </TabsContent>
  );
}

// --- Unmatched Tab ---
function UnmatchedTabContent({ tenantId, unmatchedLines, queryClient }: any) {
  return (
    <TabsContent value="unmatched">
      <UnmatchedMappingTab tenantId={tenantId} unmatchedLines={unmatchedLines} suppliers={[]} queryClient={queryClient} />
    </TabsContent>
  );
}

// --- Credit Claims Tab ---
type ClaimableLine = {
  id: string;
  audit_id: string;
  invoice_document_id: string;
  supplier_id: string | null;
  supplier_name: string;
  invoice_number: string;
  invoice_date: string | null;
  service_address: string | null;
  job_label: string;
  description: string;
  supplier_sku: string | null;
  quantity: number;
  charged_unit_price: number;
  agreed_unit_price: number | null;
  charged_extended_price: number;
  expected_extended_price: number | null;
  total_difference: number;
};

function buildClaimDocumentHtml(supplierName: string, lines: ClaimableLine[]): string {
  const totalCredit = lines.reduce((s, l) => s + Number(l.total_difference || 0), 0);
  const today = new Date().toLocaleDateString();
  const byInvoice = new Map<string, ClaimableLine[]>();
  lines.forEach((l) => {
    const k = l.invoice_number || l.invoice_document_id;
    if (!byInvoice.has(k)) byInvoice.set(k, []);
    byInvoice.get(k)!.push(l);
  });
  const invoiceBlocks = Array.from(byInvoice.entries()).map(([invNo, ls]) => {
    const invTotal = ls.reduce((s, l) => s + Number(l.total_difference || 0), 0);
    const addr = ls.find((l) => l.service_address)?.service_address || "—";
    const date = ls.find((l) => l.invoice_date)?.invoice_date || "";
    const job = ls.find((l) => l.job_label)?.job_label || "";
    const rows = ls.map((l) => `
      <tr>
        <td>${escapeHtml(l.description || "")}${l.supplier_sku ? `<div style="color:#666;font-size:11px">SKU: ${escapeHtml(l.supplier_sku)}</div>` : ""}</td>
        <td style="text-align:right">${Number(l.quantity || 0)}</td>
        <td style="text-align:right">$${Number(l.charged_unit_price || 0).toFixed(2)}</td>
        <td style="text-align:right">${l.agreed_unit_price != null ? "$" + Number(l.agreed_unit_price).toFixed(2) : "—"}</td>
        <td style="text-align:right">$${Number(l.charged_extended_price || 0).toFixed(2)}</td>
        <td style="text-align:right">${l.expected_extended_price != null ? "$" + Number(l.expected_extended_price).toFixed(2) : "—"}</td>
        <td style="text-align:right;color:#b91c1c;font-weight:600">$${Number(l.total_difference || 0).toFixed(2)}</td>
      </tr>`).join("");
    return `
      <div style="margin-top:24px;padding:16px;border:1px solid #e5e7eb;border-radius:8px;page-break-inside:avoid">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px">
          <div>
            <div style="font-size:13px;color:#666">Invoice #</div>
            <div style="font-size:18px;font-weight:600">${escapeHtml(invNo)}</div>
            ${date ? `<div style="font-size:12px;color:#666;margin-top:2px">Dated ${escapeHtml(date)}</div>` : ""}
          </div>
          <div style="text-align:right">
            <div style="font-size:13px;color:#666">Service address</div>
            <div style="font-size:14px">${escapeHtml(addr)}</div>
            ${job ? `<div style="font-size:12px;color:#666;margin-top:2px">Job: ${escapeHtml(job)}</div>` : ""}
          </div>
        </div>
        <table style="width:100%;border-collapse:collapse;font-size:12px">
          <thead>
            <tr style="background:#f3f4f6;text-align:left">
              <th style="padding:8px">Item</th>
              <th style="padding:8px;text-align:right">Qty</th>
              <th style="padding:8px;text-align:right">Charged Unit</th>
              <th style="padding:8px;text-align:right">Agreed Unit</th>
              <th style="padding:8px;text-align:right">Charged Total</th>
              <th style="padding:8px;text-align:right">Agreed Total</th>
              <th style="padding:8px;text-align:right">Overcharge</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
        <div style="text-align:right;margin-top:8px;font-size:13px"><strong>Invoice credit due: <span style="color:#b91c1c">$${invTotal.toFixed(2)}</span></strong></div>
      </div>`;
  }).join("");

  return `<!doctype html><html><head><meta charset="utf-8"><title>Credit Claim — ${escapeHtml(supplierName)}</title>
    <style>body{font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111;max-width:900px;margin:32px auto;padding:0 24px}
    h1{font-size:24px;margin:0}@media print{.noprint{display:none}}</style></head><body>
    <div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #111;padding-bottom:12px">
      <div><h1>Supplier Credit Claim</h1><div style="color:#666;margin-top:4px">Generated ${escapeHtml(today)}</div></div>
      <div style="text-align:right"><div style="font-size:13px;color:#666">Supplier</div><div style="font-size:18px;font-weight:600">${escapeHtml(supplierName)}</div></div>
    </div>
    <div style="margin-top:16px;padding:12px 16px;background:#fef2f2;border:1px solid #fecaca;border-radius:8px">
      <div style="font-size:13px;color:#7f1d1d">Total credit requested across ${byInvoice.size} invoice${byInvoice.size === 1 ? "" : "s"}</div>
      <div style="font-size:28px;font-weight:700;color:#b91c1c">$${totalCredit.toFixed(2)}</div>
    </div>
    ${invoiceBlocks}
    <div style="margin-top:32px;font-size:12px;color:#444">Please review the line-level discrepancies above and apply the corresponding credit to our account. Each item was charged above the agreed price-list rate on file.</div>
    <div class="noprint" style="margin-top:24px;text-align:center"><button onclick="window.print()" style="padding:10px 20px;font-size:14px;background:#1d4ed8;color:#fff;border:none;border-radius:6px;cursor:pointer">Print / Save as PDF</button></div>
    </body></html>`;
}

function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

function CreditClaimsTab({ claims, tenantId, audits }: { claims: any[]; tenantId: string | null; audits: any[] }) {
  const { data: claimableLines = [] } = useQuery({
    queryKey: ["claimable-overcharges", tenantId, audits.length],
    queryFn: async (): Promise<ClaimableLine[]> => {
      if (!tenantId || !audits.length) return [];
      // Fully-matched audits (100%) that still carry overcharge
      const fullyMatched = audits.filter(
        (a: any) =>
          a.total_invoice_lines > 0 &&
          a.matched_lines === a.total_invoice_lines &&
          Number(a.total_overcharge_amount || 0) > 0
      );
      if (!fullyMatched.length) return [];
      const auditIds = fullyMatched.map((a) => a.id);
      const { data: lines } = await supabase
        .from("material_invoice_audit_lines")
        .select("id, audit_id, invoice_document_id, supplier_id, invoice_description, supplier_sku, quantity, charged_unit_price, agreed_unit_price, charged_extended_price, expected_extended_price, total_difference")
        .eq("company_id", tenantId)
        .in("audit_id", auditIds)
        .gt("total_difference", 0);
      const auditById = new Map(fullyMatched.map((a: any) => [a.id, a]));
      return (lines || []).map((l: any) => {
        const a: any = auditById.get(l.audit_id);
        const inv = a?.invoice;
        return {
          id: l.id,
          audit_id: l.audit_id,
          invoice_document_id: l.invoice_document_id,
          supplier_id: l.supplier_id,
          supplier_name: a?.supplier?.supplier_name || inv?.vendor_name || "Unknown supplier",
          invoice_number: inv?.invoice_number || "—",
          invoice_date: inv?.invoice_date || null,
          service_address: inv?.service_address || null,
          job_label: getInvoiceJobLabel(inv),
          description: l.invoice_description || "",
          supplier_sku: l.supplier_sku,
          quantity: Number(l.quantity || 0),
          charged_unit_price: Number(l.charged_unit_price || 0),
          agreed_unit_price: l.agreed_unit_price != null ? Number(l.agreed_unit_price) : null,
          charged_extended_price: Number(l.charged_extended_price || 0),
          expected_extended_price: l.expected_extended_price != null ? Number(l.expected_extended_price) : null,
          total_difference: Number(l.total_difference || 0),
        };
      });
    },
    enabled: !!tenantId,
  });

  const grouped = React.useMemo(() => {
    const map = new Map<string, { supplier_name: string; lines: ClaimableLine[]; total: number; invoiceCount: number }>();
    claimableLines.forEach((l) => {
      const key = l.supplier_id || l.supplier_name;
      if (!map.has(key)) map.set(key, { supplier_name: l.supplier_name, lines: [], total: 0, invoiceCount: 0 });
      const g = map.get(key)!;
      g.lines.push(l);
      g.total += l.total_difference;
    });
    map.forEach((g) => {
      g.invoiceCount = new Set(g.lines.map((l) => l.invoice_document_id)).size;
    });
    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  }, [claimableLines]);

  const openClaimDoc = (supplierName: string, lines: ClaimableLine[]) => {
    const html = buildClaimDocumentHtml(supplierName, lines);
    const w = window.open("", "_blank");
    if (!w) { toast.error("Pop-up blocked. Allow pop-ups to view the claim document."); return; }
    w.document.write(html);
    w.document.close();
  };

  return (
    <TabsContent value="credit-claims" className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Claimable Overcharges from Audited Invoices</CardTitle>
          <CardDescription>
            Invoices with 100% line matches that were still billed above the agreed price. Build a per-supplier credit claim document showing every overcharge with invoice number and service address.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {grouped.length === 0 ? (
            <div className="text-center text-muted-foreground py-8 text-sm">
              No overcharges to claim. Once an audited invoice shows 100% match with a positive overcharge, it will appear here.
            </div>
          ) : (
            <div className="space-y-3">
              {grouped.map((g) => (
                <div key={g.supplier_name} className="border rounded-lg p-4">
                  <div className="flex items-center justify-between gap-3 mb-3">
                    <div>
                      <div className="font-semibold text-base">{g.supplier_name}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {g.lines.length} overcharge line{g.lines.length === 1 ? "" : "s"} across {g.invoiceCount} invoice{g.invoiceCount === 1 ? "" : "s"}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-right">
                        <div className="text-xs text-muted-foreground">Credit due</div>
                        <div className="text-lg font-bold text-destructive">${g.total.toFixed(2)}</div>
                      </div>
                      <Button size="sm" onClick={() => openClaimDoc(g.supplier_name, g.lines)}>
                        <FileText className="h-4 w-4 mr-2" />
                        Build Credit Claim
                      </Button>
                    </div>
                  </div>
                  <div className="rounded-md border bg-muted/20 overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="text-xs">Invoice</TableHead>
                          <TableHead className="text-xs">Service Address</TableHead>
                          <TableHead className="text-xs">Item</TableHead>
                          <TableHead className="text-xs text-right">Qty</TableHead>
                          <TableHead className="text-xs text-right">Charged</TableHead>
                          <TableHead className="text-xs text-right">Agreed</TableHead>
                          <TableHead className="text-xs text-right">Overcharge</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {g.lines.map((l) => (
                          <TableRow key={l.id}>
                            <TableCell className="text-xs font-medium">{l.invoice_number}</TableCell>
                            <TableCell className="text-xs">{l.service_address || "—"}</TableCell>
                            <TableCell className="text-xs">{l.description}</TableCell>
                            <TableCell className="text-xs text-right">{l.quantity}</TableCell>
                            <TableCell className="text-xs text-right">${l.charged_unit_price.toFixed(2)}</TableCell>
                            <TableCell className="text-xs text-right">{l.agreed_unit_price != null ? `$${l.agreed_unit_price.toFixed(2)}` : "—"}</TableCell>
                            <TableCell className="text-xs text-right text-destructive font-medium">${l.total_difference.toFixed(2)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Filed Credit Claims</CardTitle>
          <CardDescription>Track disputed charges and credit requests</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Supplier</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Filed</TableHead>
                <TableHead>Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {claims.map((c: any) => (
                <TableRow key={c.id}>
                  <TableCell>{(c as any).material_suppliers?.supplier_name}</TableCell>
                  <TableCell className="font-medium">${Number(c.claim_amount || 0).toFixed(2)}</TableCell>
                  <TableCell className="max-w-xs truncate">{c.claim_reason}</TableCell>
                  <TableCell>
                    <Badge variant={c.claim_status === "credited" ? "default" : "outline"} className={c.claim_status === "credited" ? "bg-emerald-600" : ""}>
                      {c.claim_status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{new Date(c.created_at).toLocaleDateString()}</TableCell>
                  <TableCell>
                    {c.claim_status === "open" && (
                      <Button size="sm" variant="outline">
                        <Copy className="h-3 w-3 mr-1" />Follow Up
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {claims.length === 0 && (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">No credit claims filed yet</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </TabsContent>
  );
}


interface LeverageLine {
  id: string;
  audit_id: string;
  invoice_document_id: string;
  supplier_id: string | null;
  supplier_name: string;
  invoice_number: string;
  invoice_date: string | null;
  service_address: string | null;
  description: string;
  supplier_sku: string | null;
  quantity: number;
  charged_unit_price: number;
  agreed_unit_price: number | null;
  savings_per_unit: number;
  total_savings: number;
}

function PriceLeverageTab({ tenantId, audits }: { tenantId: string | null; audits: any[] }) {
  const [search, setSearch] = React.useState("");
  const { data: leverageLines = [] } = useQuery({
    queryKey: ["price-leverage", tenantId, audits.length],
    queryFn: async (): Promise<LeverageLine[]> => {
      if (!tenantId) return [];
      const { data: lines } = await supabase
        .from("material_invoice_audit_lines")
        .select("id, audit_id, invoice_document_id, supplier_id, invoice_description, supplier_sku, quantity, charged_unit_price, agreed_unit_price, total_difference")
        .eq("company_id", tenantId)
        .lt("total_difference", 0)
        .not("agreed_unit_price", "is", null)
        .limit(2000);
      const auditById = new Map(audits.map((a: any) => [a.id, a]));
      return (lines || []).map((l: any) => {
        const a: any = auditById.get(l.audit_id);
        const inv = a?.invoice;
        const charged = Number(l.charged_unit_price || 0);
        const agreed = l.agreed_unit_price != null ? Number(l.agreed_unit_price) : null;
        return {
          id: l.id,
          audit_id: l.audit_id,
          invoice_document_id: l.invoice_document_id,
          supplier_id: l.supplier_id,
          supplier_name: a?.supplier?.supplier_name || inv?.vendor_name || "Unknown supplier",
          invoice_number: inv?.invoice_number || "—",
          invoice_date: inv?.invoice_date || null,
          service_address: inv?.service_address || null,
          description: l.invoice_description || "",
          supplier_sku: l.supplier_sku,
          quantity: Number(l.quantity || 0),
          charged_unit_price: charged,
          agreed_unit_price: agreed,
          savings_per_unit: agreed != null ? Math.max(agreed - charged, 0) : 0,
          total_savings: Math.abs(Number(l.total_difference || 0)),
        };
      });
    },
    enabled: !!tenantId,
  });

  // Group by item (description + sku) keeping the lowest charged price as the leverage benchmark
  const grouped = React.useMemo(() => {
    const map = new Map<string, { key: string; description: string; supplier_sku: string | null; lowest: LeverageLine; history: LeverageLine[]; total_saved: number }>();
    leverageLines.forEach((l) => {
      const key = `${(l.supplier_sku || "").toLowerCase()}|${l.description.toLowerCase().trim()}`;
      if (!map.has(key)) {
        map.set(key, { key, description: l.description, supplier_sku: l.supplier_sku, lowest: l, history: [], total_saved: 0 });
      }
      const g = map.get(key)!;
      g.history.push(l);
      g.total_saved += l.total_savings;
      if (l.charged_unit_price < g.lowest.charged_unit_price) g.lowest = l;
    });
    let arr = Array.from(map.values()).sort((a, b) => b.total_saved - a.total_saved);
    if (search.trim()) {
      const s = search.toLowerCase();
      arr = arr.filter((g) => g.description.toLowerCase().includes(s) || (g.supplier_sku || "").toLowerCase().includes(s) || g.history.some((h) => h.supplier_name.toLowerCase().includes(s)));
    }
    return arr;
  }, [leverageLines, search]);

  return (
    <TabsContent value="price-leverage" className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Negotiation Leverage — Items Invoiced Below Base Price</CardTitle>
          <CardDescription>
            Historical proof points where you were charged less than your agreed base price. Use these as references when negotiating future invoices on the same items.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="relative max-w-sm">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search item, SKU, or supplier..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8" />
          </div>
          {grouped.length === 0 ? (
            <div className="text-center text-muted-foreground py-8 text-sm">
              No favorable pricing found yet. Once an audited line is invoiced below its agreed price, it will appear here.
            </div>
          ) : (
            <div className="space-y-3">
              {grouped.map((g) => (
                <div key={g.key} className="border rounded-lg p-4">
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div className="min-w-0">
                      <div className="font-semibold text-sm truncate">{g.description}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {g.supplier_sku ? `SKU ${g.supplier_sku} · ` : ""}{g.history.length} favorable invoice{g.history.length === 1 ? "" : "s"}
                      </div>
                    </div>
                    <div className="flex items-center gap-4 shrink-0">
                      <div className="text-right">
                        <div className="text-xs text-muted-foreground">Best price seen</div>
                        <div className="text-base font-bold text-emerald-600">${g.lowest.charged_unit_price.toFixed(2)}</div>
                        <div className="text-[10px] text-muted-foreground">vs agreed ${g.lowest.agreed_unit_price?.toFixed(2) ?? "—"}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-xs text-muted-foreground">Total saved</div>
                        <div className="text-base font-bold text-emerald-600">${g.total_saved.toFixed(2)}</div>
                      </div>
                    </div>
                  </div>
                  <div className="rounded-md border bg-muted/20 overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="text-xs">Supplier</TableHead>
                          <TableHead className="text-xs">Invoice</TableHead>
                          <TableHead className="text-xs">Date</TableHead>
                          <TableHead className="text-xs">Service Address</TableHead>
                          <TableHead className="text-xs text-right">Qty</TableHead>
                          <TableHead className="text-xs text-right">Charged</TableHead>
                          <TableHead className="text-xs text-right">Agreed</TableHead>
                          <TableHead className="text-xs text-right">Saved</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {g.history.sort((a, b) => a.charged_unit_price - b.charged_unit_price).map((l) => (
                          <TableRow key={l.id}>
                            <TableCell className="text-xs">{l.supplier_name}</TableCell>
                            <TableCell className="text-xs font-medium">{l.invoice_number}</TableCell>
                            <TableCell className="text-xs">{l.invoice_date ? new Date(l.invoice_date).toLocaleDateString() : "—"}</TableCell>
                            <TableCell className="text-xs">{l.service_address || "—"}</TableCell>
                            <TableCell className="text-xs text-right">{l.quantity}</TableCell>
                            <TableCell className="text-xs text-right font-medium text-emerald-600">${l.charged_unit_price.toFixed(2)}</TableCell>
                            <TableCell className="text-xs text-right">{l.agreed_unit_price != null ? `$${l.agreed_unit_price.toFixed(2)}` : "—"}</TableCell>
                            <TableCell className="text-xs text-right text-emerald-600">${l.total_savings.toFixed(2)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </TabsContent>
  );
}

// --- Main Component ---
export const MaterialAuditContent = () => {
  const tenantId = useEffectiveTenantId();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState("price-lists");
  const [selectedSupplier, setSelectedSupplier] = useState<string>("all");
  const [searchTerm, setSearchTerm] = useState("");

  const { data: pricebookGroups = [] } = useQuery({
    queryKey: ["pricebook-groups", tenantId],
    queryFn: async () => {
      if (!tenantId) return [];
      const { data } = await supabase
        .from("supplier_pricebooks")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false });
      if (!data || data.length === 0) return [];
      const groups: Record<string, { supplier_name: string; effective_date: string; item_count: number; categories: Set<string>; is_active: boolean; imported_at: string }> = {};
      data.forEach((item: any) => {
        const key = item.supplier_name + "||" + (item.effective_date || "unknown");
        if (!groups[key]) {
          groups[key] = {
            supplier_name: item.supplier_name,
            effective_date: item.effective_date || "",
            item_count: 0,
            categories: new Set(),
            is_active: item.is_active,
            imported_at: item.imported_at || item.created_at,
          };
        }
        groups[key].item_count++;
        if (item.category) groups[key].categories.add(item.category);
      });
      return Object.values(groups).map(g => ({ ...g, categories: Array.from(g.categories) }));
    },
    enabled: !!tenantId,
  });

  const { data: legacyPriceLists = [] } = useQuery({
    queryKey: ["supplier-price-lists", tenantId, selectedSupplier],
    queryFn: async () => {
      if (!tenantId) return [];
      let q = supabase.from("supplier_price_lists").select("*, material_suppliers(supplier_name), supplier_price_list_items(count)").eq("company_id", tenantId).order("created_at", { ascending: false });
      if (selectedSupplier !== "all") q = q.eq("supplier_id", selectedSupplier);
      const { data } = await q;
      return (data || []).map((pl: any) => ({
        ...pl,
        items_count: pl.supplier_price_list_items?.[0]?.count ?? 0,
      }));
    },
    enabled: !!tenantId,
  });

  // Real imported price lists: grouped from the materials catalog (CSV imports)
  const { data: templatePriceLists = [] } = useQuery({
    queryKey: ["catalog-price-lists", tenantId],
    queryFn: async () => {
      if (!tenantId) return [];
      const { data } = await supabase
        .from("materials")
        .select("category_id, base_cost, active, created_at, updated_at, material_categories(name)")
        .eq("tenant_id", tenantId);
      if (!data || data.length === 0) return [];
      const groups: Record<string, { supplier_name: string; item_count: number; categories: Set<string>; is_active: boolean; imported_at: string; updated_at: string }> = {};
      data.forEach((it: any) => {
        const cat = it.material_categories?.name || "Uncategorized";
        if (!groups[cat]) {
          groups[cat] = {
            supplier_name: cat,
            item_count: 0,
            categories: new Set(),
            is_active: false,
            imported_at: it.created_at,
            updated_at: it.updated_at,
          };
        }
        const g = groups[cat];
        g.item_count++;
        g.categories.add(cat);
        if (it.active) g.is_active = true;
        if (it.created_at && it.created_at < g.imported_at) g.imported_at = it.created_at;
        if (it.updated_at && it.updated_at > g.updated_at) g.updated_at = it.updated_at;
      });
      return Object.values(groups)
        .map(g => ({ ...g, categories: Array.from(g.categories) }))
        .sort((a, b) => b.item_count - a.item_count);
    },
    enabled: !!tenantId,
  });

  // Real audit trail of every CSV/PDF import run via the "Import Materials" button
  const { data: importBatches = [] } = useQuery({
    queryKey: ["material-import-batches", tenantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("material_import_batches" as any)
        .select("id, source_filename, supplier_name, source_type, items_count, notes, created_at")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) return [];
      return data || [];
    },
  });

  // Suppliers known only via uploaded invoices (no CSV/PDF import yet).
  // Sources from BOTH project_cost_invoices (so vendors w/o extracted line items
  // still appear) AND line items (for observed pricing). Vendor name variants
  // (ABC / abc / ABC Supply Co; SRS / srs / Suncoast; etc.) are canonicalized,
  // and all permit-fee invoices (city / county / township) are bucketed into a
  // single "Permits" category.
  const { data: invoiceSuppliers = [] } = useQuery({
    queryKey: ["invoice-derived-suppliers-v2", tenantId],
    queryFn: async () => {
      if (!tenantId) return [];

      const canonicalize = canonicalizeVendorName;

      const [{ data: invs }, { data: lines }] = await Promise.all([
        supabase
          .from("project_cost_invoices")
          .select("id, vendor_name, invoice_type, created_at, total_amount")
          .eq("tenant_id", tenantId)
          .not("vendor_name", "is", null),
        supabase
          .from("project_cost_invoice_line_items")
          .select("vendor_name, description, normalized_description, sku, unit_of_measure, unit_price, quantity, created_at, invoice_id")
          .eq("tenant_id", tenantId)
          .not("vendor_name", "is", null)
          .not("unit_price", "is", null),
      ]);

      const bySupplier: Record<string, {
        supplier_name: string;
        invoice_ids: Set<string>;
        line_count: number;
        last_invoice_at: string;
        invoice_types: Set<string>;
        items: Record<string, {
          key: string;
          description: string;
          sku: string | null;
          uom: string | null;
          observations: Array<{ unit_price: number; quantity: number; created_at: string; invoice_id: string | null }>;
        }>;
      }> = {};

      const ensure = (key: string, display: string, created_at: string) => {
        if (!bySupplier[key]) {
          bySupplier[key] = {
            supplier_name: display,
            invoice_ids: new Set(),
            line_count: 0,
            last_invoice_at: created_at,
            invoice_types: new Set(),
            items: {},
          };
        }
        return bySupplier[key];
      };

      // Seed every invoice — even ones with no extracted line items.
      (invs || []).forEach((inv: any) => {
        const { key, display } = canonicalize(inv.vendor_name);
        const sup = ensure(key, display, inv.created_at);
        if (inv.id) sup.invoice_ids.add(inv.id);
        if (inv.invoice_type) sup.invoice_types.add(inv.invoice_type);
        if (inv.created_at && inv.created_at > sup.last_invoice_at) sup.last_invoice_at = inv.created_at;
      });

      // Layer line-item pricing observations on top.
      (lines || []).forEach((row: any) => {
        const { key, display } = canonicalize(row.vendor_name);
        const price = Number(row.unit_price);
        if (!isFinite(price) || price <= 0) return;
        const sup = ensure(key, display, row.created_at);
        sup.line_count++;
        if (row.invoice_id) sup.invoice_ids.add(row.invoice_id);
        if (row.created_at && row.created_at > sup.last_invoice_at) sup.last_invoice_at = row.created_at;
        const itemKey = (row.normalized_description || row.description || row.sku || "unknown").toLowerCase().trim();
        if (!sup.items[itemKey]) {
          sup.items[itemKey] = {
            key: itemKey,
            description: row.description || row.normalized_description || row.sku || "Unknown item",
            sku: row.sku,
            uom: row.unit_of_measure,
            observations: [],
          };
        }
        sup.items[itemKey].observations.push({
          unit_price: price,
          quantity: Number(row.quantity) || 0,
          created_at: row.created_at,
          invoice_id: row.invoice_id,
        });
      });

      return Object.values(bySupplier).map((sup) => {
        const items = Object.values(sup.items).map((it) => {
          const prices = it.observations.map((o) => o.unit_price);
          const min = Math.min(...prices);
          const max = Math.max(...prices);
          const avg = prices.reduce((s, p) => s + p, 0) / prices.length;
          const variance_pct = min > 0 ? ((max - min) / min) * 100 : 0;
          return { ...it, min_price: min, max_price: max, avg_price: avg, variance_pct, observation_count: prices.length };
        }).sort((a, b) => b.variance_pct - a.variance_pct);
        return {
          supplier_name: sup.supplier_name,
          invoice_count: sup.invoice_ids.size,
          line_count: sup.line_count,
          item_count: items.length,
          last_invoice_at: sup.last_invoice_at,
          invoice_types: Array.from(sup.invoice_types),
          items,
        };
      }).sort((a, b) => b.invoice_count - a.invoice_count);
    },
    enabled: !!tenantId,
  });

  const { data: materialInvoices = [] } = useQuery({
    queryKey: ["material-cost-invoices", tenantId],
    queryFn: async () => {
      if (!tenantId) return [];
      const { data } = await supabase
        .from("project_cost_invoices")
        .select("*, pipeline_entries!project_cost_invoices_pipeline_entry_id_fkey(id, lead_name, contacts!pipeline_entries_contact_id_fkey(first_name, last_name)), projects!project_cost_invoices_project_id_fkey(id, name, job_number, project_number)")
        .eq("tenant_id", tenantId)
        .in("invoice_type", ["material"])
        .order("created_at", { ascending: false });
      return data || [];
    },
    enabled: !!tenantId,
  });

  // Build canonical supplier list — every variant of "ABC Supply #489 / ABC Supply Co."
  // collapses to one entry under "ABC Supply", same for SRS / Suncoast Roofers etc.
  const canonicalSuppliers = React.useMemo(() => {
    const byKey = new Map<string, string>();
    materialInvoices.forEach((inv: any) => {
      if (!inv.vendor_name) return;
      const { key, display } = canonicalizeVendorName(inv.vendor_name);
      if (!byKey.has(key)) byKey.set(key, display);
    });
    pricebookGroups.forEach((g: any) => {
      if (!g.supplier_name) return;
      const { key, display } = canonicalizeVendorName(g.supplier_name);
      if (!byKey.has(key)) byKey.set(key, display);
    });
    return Array.from(byKey.entries())
      .map(([key, display]) => ({ key, display }))
      .sort((a, b) => a.display.localeCompare(b.display));
  }, [materialInvoices, pricebookGroups]);


  const { data: audits = [] } = useQuery({
    queryKey: ["material-audits", tenantId],
    queryFn: async () => {
      if (!tenantId) return [];
      // NOTE: material_invoice_audits has no real FK constraints to material_suppliers
      // or project_cost_invoices, so PostgREST embed hints fail silently and return
      // nothing. We fetch the rows flat, then resolve supplier + invoice + project
      // info manually so the UI actually renders.
      const { data: rows, error } = await supabase
        .from("material_invoice_audits")
        .select("*")
        .eq("company_id", tenantId)
        .order("created_at", { ascending: false });
      if (error) { console.error("[audits] query error", error); return []; }
      const list = rows || [];
      if (!list.length) return [];

      const supplierIds = Array.from(new Set(list.map((r: any) => r.supplier_id).filter(Boolean)));
      const invoiceIds = Array.from(new Set(list.map((r: any) => r.invoice_document_id).filter(Boolean)));

      const [{ data: sups }, { data: invs }] = await Promise.all([
        supplierIds.length
          ? supabase.from("material_suppliers").select("id, supplier_name").in("id", supplierIds)
          : Promise.resolve({ data: [] as any[] }),
        invoiceIds.length
          ? supabase
              .from("project_cost_invoices")
              .select("id, invoice_number, vendor_name, invoice_date, invoice_amount, project_id, pipeline_entry_id, pipeline_entries!project_cost_invoices_pipeline_entry_id_fkey(id, lead_name, contacts!pipeline_entries_contact_id_fkey(first_name, last_name)), projects!project_cost_invoices_project_id_fkey(id, name, job_number, project_number)")
              .in("id", invoiceIds)
          : Promise.resolve({ data: [] as any[] }),
      ]);

      const supMap = new Map((sups || []).map((s: any) => [s.id, s]));
      const invMap = new Map((invs || []).map((i: any) => [i.id, i]));

      return list.map((r: any) => ({
        ...r,
        supplier: supMap.get(r.supplier_id) || null,
        invoice: invMap.get(r.invoice_document_id) || null,
      }));
    },
    enabled: !!tenantId,
  });

  const { data: unmatchedLines = [] } = useQuery({
    queryKey: ["unmatched-audit-lines", tenantId],
    queryFn: async () => {
      if (!tenantId) return [];
      const { data } = await supabase.from("material_invoice_audit_lines").select("*, material_suppliers!material_invoice_audit_lines_supplier_id_fkey(supplier_name)").eq("company_id", tenantId).eq("discrepancy_type", "unmatched_item").eq("discrepancy_status", "open").limit(100);
      return data || [];
    },
    enabled: !!tenantId,
  });

  const { data: claims = [] } = useQuery({
    queryKey: ["credit-claims", tenantId],
    queryFn: async () => {
      if (!tenantId) return [];
      const { data } = await supabase.from("material_supplier_credit_claims").select("*, material_suppliers!material_supplier_credit_claims_supplier_id_fkey(supplier_name)").eq("company_id", tenantId).order("created_at", { ascending: false });
      return data || [];
    },
    enabled: !!tenantId,
  });

  const { data: legacySuppliers = [] } = useQuery({
    queryKey: ["material-suppliers", tenantId],
    queryFn: async () => {
      if (!tenantId) return [];
      const { data } = await supabase.from("material_suppliers").select("*").eq("company_id", tenantId).order("supplier_name");
      return data || [];
    },
    enabled: !!tenantId,
  });

  const getAuditStatusBadge = (status: string) => {
    switch (status) {
      case "audited": return <Badge className="bg-emerald-600">Audited</Badge>;
      case "partial_match": return <Badge variant="outline" className="border-yellow-500 text-yellow-600">Partial Match</Badge>;
      case "not_audited": return <Badge variant="outline">Not Audited</Badge>;
      case "needs_review": return <Badge variant="outline" className="border-yellow-500 text-yellow-600">Needs Review</Badge>;
      default: return <Badge variant="outline">{status}</Badge>;
    }
  };

  const getInvoiceStatusBadge = (status: string) => {
    switch (status) {
      case "verified": return <Badge className="bg-emerald-600">Verified</Badge>;
      case "approved": return <Badge className="bg-blue-600">Approved</Badge>;
      case "pending": return <Badge variant="outline" className="border-yellow-500 text-yellow-600">Pending</Badge>;
      case "rejected": return <Badge variant="destructive">Rejected</Badge>;
      default: return <Badge variant="outline">{status}</Badge>;
    }
  };

  const totalInvoiceAmount = materialInvoices.reduce((sum: number, inv: any) => sum + Number(inv.invoice_amount || 0), 0);
  const totalPricebookItems = pricebookGroups.reduce((sum: number, g: any) => sum + g.item_count, 0);

  const chartData = React.useMemo(() => {
    const byVendor: Record<string, { display: string; total: number }> = {};
    materialInvoices.forEach((inv: any) => {
      const { key, display } = canonicalizeVendorName(inv.vendor_name);
      if (!byVendor[key]) byVendor[key] = { display, total: 0 };
      byVendor[key].total += Number(inv.invoice_amount || 0);
    });
    return Object.values(byVendor)
      .map(({ display, total }) => ({ name: display, total: Number(total.toFixed(2)) }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 10);
  }, [materialInvoices]);

  const filteredInvoices = React.useMemo(() => {
    const term = searchTerm.toLowerCase();
    return materialInvoices.filter((inv: any) => {
      if (selectedSupplier !== "all") {
        const { key } = canonicalizeVendorName(inv.vendor_name);
        if (key !== selectedSupplier) return false;
      }
      if (!term) return true;
      return (
        (inv.vendor_name || "").toLowerCase().includes(term) ||
        (inv.invoice_number || "").toLowerCase().includes(term)
      );
    });
  }, [materialInvoices, searchTerm, selectedSupplier]);

  return (
    <div className="space-y-4">
      <SummaryCards
        pricebookGroups={pricebookGroups}
        totalPricebookItems={totalPricebookItems}
        materialInvoices={materialInvoices}
        totalInvoiceAmount={totalInvoiceAmount}
        unmatchedLines={unmatchedLines}
      />
      <SpendChart chartData={chartData} />
      <div className="flex gap-2 items-center">
        <Select value={selectedSupplier} onValueChange={setSelectedSupplier}>
          <SelectTrigger className="w-[260px]"><SelectValue placeholder="All Suppliers" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Suppliers</SelectItem>
            {canonicalSuppliers.map((s) => (
              <SelectItem key={s.key} value={s.key}>{s.display}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pl-8" />
        </div>
      </div>
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="price-lists">Supplier Price Lists</TabsTrigger>
          <TabsTrigger value="invoice-queue">Material Invoices ({materialInvoices.length})</TabsTrigger>
          <TabsTrigger value="audit-results">Audit Results</TabsTrigger>
          <TabsTrigger value="unmatched">Unmatched Mapping ({unmatchedLines.length})</TabsTrigger>
          <TabsTrigger value="credit-claims">Credit Claims</TabsTrigger>
          <TabsTrigger value="price-leverage">Price Leverage</TabsTrigger>
        </TabsList>
        <PriceListsTab pricebookGroups={pricebookGroups} legacyPriceLists={legacyPriceLists} templatePriceLists={templatePriceLists} importBatches={importBatches} invoiceSuppliers={invoiceSuppliers} tenantId={tenantId} legacySuppliers={legacySuppliers} queryClient={queryClient} />
        <InvoiceQueueTab filteredInvoices={filteredInvoices} getInvoiceStatusBadge={getInvoiceStatusBadge} />
        <AuditResultsTab audits={audits} getAuditStatusBadge={getAuditStatusBadge} tenantId={tenantId} queryClient={queryClient} materialInvoices={materialInvoices} />
        <UnmatchedTabContent tenantId={tenantId} unmatchedLines={unmatchedLines} queryClient={queryClient} />
        <CreditClaimsTab claims={claims} tenantId={tenantId} audits={audits} />
        <PriceLeverageTab tenantId={tenantId} audits={audits} />
      </Tabs>
    </div>
  );
};

const MaterialAuditPage = () => (
  <GlobalLayout>
    <div className="p-4">
      <MaterialAuditContent />
    </div>
  </GlobalLayout>
);

// --- Import Price List Dialog ---
function ImportPriceListDialog({ tenantId, suppliers, onSuccess }: { tenantId: string | null; suppliers: any[]; onSuccess: () => void }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ supplierName: "", listName: "", effectiveStartDate: "", effectiveEndDate: "", replaceExisting: false, rawCsv: "" });
  const [importing, setImporting] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [sourceFileName, setSourceFileName] = useState<string>("");
  const extractedRowsCount = React.useMemo(() => Math.max(form.rawCsv.trim().split("\n").length - 1, 0), [form.rawCsv]);

  const fileToBase64 = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => {
        const s = String(r.result || "");
        const i = s.indexOf(",");
        resolve(i >= 0 ? s.slice(i + 1) : s);
      };
      r.onerror = reject;
      r.readAsDataURL(file);
    });

  const handleFile = async (file: File | null) => {
    if (!file) return;
    setSourceFileName(file.name);
    const lower = file.name.toLowerCase();
    const isCsv = lower.endsWith(".csv") || file.type === "text/csv";
    const isPdf = lower.endsWith(".pdf") || file.type === "application/pdf";
    const isImg = /\.(png|jpe?g|webp)$/i.test(lower) || file.type.startsWith("image/");

    if (isCsv) {
      const text = await file.text();
      setForm(f => ({ ...f, rawCsv: text }));
      toast.success("Loaded CSV \u00b7 review and import");
      return;
    }
    if (!isPdf && !isImg) {
      toast.error("Upload a CSV, PDF, or image file");
      return;
    }
    setExtracting(true);
    try {
      const base64 = await fileToBase64(file);
      const { data, error } = await supabase.functions.invoke("parse-price-list-document", {
        body: { document_base64: base64, mime_type: file.type || (isPdf ? "application/pdf" : "image/png") },
      });
      if (error) throw new Error(error.message || "Document extraction failed");
      const rows = (data?.rows || []) as any[];
      if (!rows.length) { toast.error("No price-list rows detected"); return; }
      const csv = ["sku,description,category,brand,uom,price"]
        .concat(rows.map(r => [r.sku, r.description, r.category, r.brand, r.uom, r.price]
          .map(v => v == null ? "" : String(v).replace(/,/g, " "))
          .join(","))).join("\n");
      const guessSupplier = data?.supplier_name
        || (file.name.match(/srs/i) ? "SRS Distribution"
          : file.name.match(/abc/i) ? "ABC Supply"
          : file.name.match(/beacon/i) ? "Beacon"
          : file.name.match(/qxo/i) ? "QXO"
          : "");
      const guessList = file.name.replace(/\.[^.]+$/, "");
      setForm(f => ({
        ...f,
        rawCsv: csv,
        supplierName: f.supplierName || guessSupplier,
        listName: f.listName || guessList,
        effectiveStartDate: f.effectiveStartDate || new Date().toISOString().slice(0, 10),
      }));
      toast.success("Extracted " + rows.length + " rows \u00b7 review and import");
    } catch (e: any) {
      toast.error(e.message || "Could not extract price list");
    } finally {
      setExtracting(false);
    }
  };

  const handleImport = async () => {
    if (!tenantId || !form.supplierName || !form.listName || !form.effectiveStartDate || !form.rawCsv.trim()) {
      toast.error("Fill all required fields and load price list data");
      return;
    }
    setImporting(true);
    try {
      const lines = form.rawCsv.trim().split("\n");
      const header = lines[0].split(",").map(h => h.trim().toLowerCase());
      const rows = lines.slice(1).map(line => {
        const cols = line.split(",").map(c => c.trim());
        const row: any = {};
        header.forEach((h, i) => {
          if (h.includes("sku") && h.includes("supplier")) row.supplierSku = cols[i];
          else if (h.includes("sku") && h.includes("mfr")) row.manufacturerSku = cols[i];
          else if (h.includes("sku")) row.supplierSku = cols[i];
          else if (h.includes("desc")) row.description = cols[i];
          else if (h.includes("cat")) row.category = cols[i];
          else if (h.includes("brand")) row.brand = cols[i];
          else if (h.includes("uom") || h.includes("unit")) row.unitOfMeasure = cols[i];
          else if (h.includes("price") || h.includes("cost")) row.agreedUnitPrice = parseFloat(cols[i]);
        });
        return row;
      }).filter(r => r.description && r.unitOfMeasure && !isNaN(r.agreedUnitPrice));

      const { data, error } = await supabase.functions.invoke("import-supplier-price-list", {
        body: { companyId: tenantId, supplierName: form.supplierName, listName: form.listName, effectiveStartDate: form.effectiveStartDate, effectiveEndDate: form.effectiveEndDate || null, replaceExisting: form.replaceExisting, rows },
      });
      if (error) throw error;
      const importedCount = data?.imported || 0;
      toast.success("Imported " + importedCount + " items");

      // Log batch
      try {
        const userId = (await supabase.auth.getUser()).data?.user?.id || null;
        await (supabase as any).from("material_import_batches").insert({
          tenant_id: tenantId,
          source_filename: sourceFileName || form.listName,
          supplier_name: form.supplierName,
          source_type: sourceFileName.toLowerCase().endsWith(".pdf") ? "pdf" : "csv",
          items_count: importedCount,
          imported_by: userId,
          notes: form.listName,
        });
      } catch {}

      setOpen(false);
      setForm({ supplierName: "", listName: "", effectiveStartDate: "", effectiveEndDate: "", replaceExisting: false, rawCsv: "" });
      setSourceFileName("");
      onSuccess();
    } catch (e: any) {
      toast.error(e.message || "Import failed");
    } finally {
      setImporting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm"><Upload className="h-4 w-4 mr-1" />Import Price List</Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Import Supplier Price List</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Supplier Name *</Label><Input value={form.supplierName} onChange={e => setForm(f => ({ ...f, supplierName: e.target.value }))} placeholder="ABC Supply" /></div>
          <div><Label>List Name *</Label><Input value={form.listName} onChange={e => setForm(f => ({ ...f, listName: e.target.value }))} placeholder="ABC May 2026 Agreement" /></div>
          <div className="grid grid-cols-2 gap-2">
            <div><Label>Effective Start *</Label><Input type="date" value={form.effectiveStartDate} onChange={e => setForm(f => ({ ...f, effectiveStartDate: e.target.value }))} /></div>
            <div><Label>Effective End</Label><Input type="date" value={form.effectiveEndDate} onChange={e => setForm(f => ({ ...f, effectiveEndDate: e.target.value }))} /></div>
          </div>

          <div className="border rounded-md p-3 bg-muted/30 space-y-2">
            <Label className="text-sm">Upload Price List (PDF, CSV, or image)</Label>
            <Input
              type="file"
              accept=".csv,.pdf,.png,.jpg,.jpeg,.webp,text/csv,application/pdf,image/*"
              disabled={extracting}
              onChange={e => handleFile(e.target.files?.[0] || null)}
            />
            {extracting && <p className="text-xs text-muted-foreground">Extracting rows from document with AI…</p>}
            {sourceFileName && !extracting && (
              <p className="text-xs text-muted-foreground">Loaded: <span className="font-medium">{sourceFileName}</span></p>
            )}
          </div>

          <div className="rounded-md border bg-muted/20 p-3">
            <Label>Extracted Price List Data *</Label>
            {form.rawCsv ? (
              <div className="mt-2 space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Ready to import from uploaded file</span>
                  <Badge variant="outline">{extractedRowsCount} rows</Badge>
                </div>
                <div className="max-h-28 overflow-auto rounded border bg-background p-2 text-xs text-muted-foreground">
                  {form.rawCsv.split("\n").slice(0, 4).map((line, i) => <div key={i}>{line}</div>)}
                  {extractedRowsCount > 3 && <div>…</div>}
                </div>
              </div>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">Upload a PDF, CSV, or image and the system will scrape the rows automatically.</p>
            )}
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.replaceExisting} onChange={e => setForm(f => ({ ...f, replaceExisting: e.target.checked }))} /> Replace existing active price list for this supplier</label>
          <Button onClick={handleImport} disabled={importing || extracting} className="w-full">{importing ? "Importing…" : "Import Price List"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// --- Unmatched Mapping Tab ---
function UnmatchedMappingTab({ tenantId, unmatchedLines, suppliers, queryClient }: any) {
  const [mappingLine, setMappingLine] = useState<any>(null);
  const [selectedPriceItem, setSelectedPriceItem] = useState("");

  const { data: priceItems = [] } = useQuery({
    queryKey: ["mapping-price-items", mappingLine?.supplier_id],
    queryFn: async () => {
      if (!mappingLine?.supplier_id) return [];
      const { data } = await supabase.from("supplier_price_list_items").select("*").eq("supplier_id", mappingLine.supplier_id).limit(500);
      return data || [];
    },
    enabled: !!mappingLine?.supplier_id,
  });

  const saveMapping = async () => {
    if (!mappingLine || !selectedPriceItem || !tenantId) return;
    const { error } = await supabase.from("material_item_match_rules").insert({
      company_id: tenantId,
      supplier_id: mappingLine.supplier_id,
      normalized_invoice_description: mappingLine.invoice_description?.toLowerCase()?.trim(),
      supplier_sku: mappingLine.supplier_sku || null,
      price_list_item_id: selectedPriceItem,
      created_by: (await supabase.auth.getUser()).data?.user?.id,
    });
    if (error) { toast.error(error.message); return; }
    await supabase.from("material_invoice_audit_lines").update({ discrepancy_status: "mapped" }).eq("id", mappingLine.id);
    toast.success("Mapping saved. Future audits will auto-match this item.");
    setMappingLine(null);
    setSelectedPriceItem("");
    queryClient.invalidateQueries({ queryKey: ["unmatched-audit-lines"] });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Unmatched Material Mapping</CardTitle>
        <CardDescription>Map invoice line items to the correct price list item.</CardDescription>
      </CardHeader>
      <CardContent>
        {mappingLine && (
          <Card className="mb-4 border-yellow-500">
            <CardContent className="pt-4 space-y-3">
              <p className="font-medium">Map: &quot;{mappingLine.invoice_description}&quot;</p>
              <p className="text-sm text-muted-foreground">Supplier: {(mappingLine as any).material_suppliers?.supplier_name} | SKU: {mappingLine.supplier_sku || "\u2014"}</p>
              <Select value={selectedPriceItem} onValueChange={setSelectedPriceItem}>
                <SelectTrigger><SelectValue placeholder="Select correct price list item..." /></SelectTrigger>
                <SelectContent>
                  {priceItems.map((pi: any) => (
                    <SelectItem key={pi.id} value={pi.id}>{pi.item_description} {"\u2014"} ${pi.agreed_unit_price}/{pi.unit_of_measure} {pi.supplier_sku ? "(" + pi.supplier_sku + ")" : ""}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="flex gap-2">
                <Button onClick={saveMapping} disabled={!selectedPriceItem}>Save Mapping</Button>
                <Button variant="outline" onClick={() => setMappingLine(null)}>Cancel</Button>
              </div>
            </CardContent>
          </Card>
        )}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Supplier</TableHead>
              <TableHead>Invoice Description</TableHead>
              <TableHead>SKU</TableHead>
              <TableHead>Qty</TableHead>
              <TableHead>Charged</TableHead>
              <TableHead>Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {unmatchedLines.map((l: any) => (
              <TableRow key={l.id}>
                <TableCell>{(l as any).material_suppliers?.supplier_name}</TableCell>
                <TableCell className="max-w-xs truncate">{l.invoice_description}</TableCell>
                <TableCell>{l.supplier_sku || "\u2014"}</TableCell>
                <TableCell>{l.quantity}</TableCell>
                <TableCell>${Number(l.charged_unit_price || 0).toFixed(2)}</TableCell>
                <TableCell>
                  <Button size="sm" variant="outline" onClick={() => { setMappingLine(l); setSelectedPriceItem(""); }}>Map</Button>
                </TableCell>
              </TableRow>
            ))}
            {unmatchedLines.length === 0 && (
              <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">All items matched!</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

export default MaterialAuditPage;
