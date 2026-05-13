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
  return (
    <TabsContent value="invoice-queue">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Material Invoice Queue</CardTitle>
          <CardDescription>Material invoices uploaded to projects {"\u2014"} compare against price lists</CardDescription>
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
    </TabsContent>
  );
}

// --- Audit Results Tab ---
function AuditResultsTab({ audits, getAuditStatusBadge }: any) {
  return (
    <TabsContent value="audit-results">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Audit History</CardTitle>
          <CardDescription>Results from automated price verification runs</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Supplier</TableHead>
                <TableHead>Invoice</TableHead>
                <TableHead>Lines</TableHead>
                <TableHead>Match %</TableHead>
                <TableHead>Overcharge</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {audits.map((a: any) => {
                const matchPct = a.total_invoice_lines > 0 ? Math.round((a.matched_lines / a.total_invoice_lines) * 100) : 0;
                return (
                  <TableRow key={a.id}>
                    <TableCell className="font-medium">{(a as any).material_suppliers?.supplier_name || "\u2014"}</TableCell>
                    <TableCell>{(a as any).material_invoice_documents?.invoice_number || "\u2014"}</TableCell>
                    <TableCell>{a.total_invoice_lines}</TableCell>
                    <TableCell>
                      <Badge variant={matchPct >= 90 ? "default" : "outline"} className={matchPct >= 90 ? "bg-emerald-600" : matchPct >= 70 ? "border-yellow-500 text-yellow-600" : "border-destructive text-destructive"}>
                        {matchPct}%
                      </Badge>
                    </TableCell>
                    <TableCell className={Number(a.total_overcharge_amount || 0) > 0 ? "text-destructive font-medium" : ""}>
                      ${Number(a.total_overcharge_amount || 0).toFixed(2)}
                    </TableCell>
                    <TableCell>{getAuditStatusBadge(a.audit_status)}</TableCell>
                  </TableRow>
                );
              })}
              {audits.length === 0 && (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">No audits run yet</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
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
function CreditClaimsTab({ claims }: any) {
  return (
    <TabsContent value="credit-claims">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Supplier Credit Claims</CardTitle>
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
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">No credit claims yet</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
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
        .select("*, pipeline_entries!project_cost_invoices_pipeline_entry_id_fkey(id, lead_name, contacts!pipeline_entries_contact_id_fkey(first_name, last_name))")
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
      const { data } = await supabase.from("material_invoice_audits").select("*, material_suppliers!material_invoice_audits_supplier_id_fkey(supplier_name), material_invoice_documents!material_invoice_audits_invoice_document_id_fkey(invoice_number)").eq("company_id", tenantId).order("created_at", { ascending: false });
      return data || [];
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
    if (!searchTerm) return materialInvoices;
    const term = searchTerm.toLowerCase();
    return materialInvoices.filter((inv: any) =>
      (inv.vendor_name || "").toLowerCase().includes(term) ||
      (inv.invoice_number || "").toLowerCase().includes(term)
    );
  }, [materialInvoices, searchTerm]);

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
          <SelectTrigger className="w-[200px]"><SelectValue placeholder="All Suppliers" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Suppliers</SelectItem>
            {supplierNames.map((name) => (
              <SelectItem key={name} value={name}>{name}</SelectItem>
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
          <TabsTrigger value="invoice-queue">Invoice Audit Queue ({materialInvoices.length})</TabsTrigger>
          <TabsTrigger value="audit-results">Audit Results</TabsTrigger>
          <TabsTrigger value="unmatched">Unmatched Mapping ({unmatchedLines.length})</TabsTrigger>
          <TabsTrigger value="credit-claims">Credit Claims</TabsTrigger>
        </TabsList>
        <PriceListsTab pricebookGroups={pricebookGroups} legacyPriceLists={legacyPriceLists} templatePriceLists={templatePriceLists} importBatches={importBatches} invoiceSuppliers={invoiceSuppliers} tenantId={tenantId} legacySuppliers={legacySuppliers} queryClient={queryClient} />
        <InvoiceQueueTab filteredInvoices={filteredInvoices} getInvoiceStatusBadge={getInvoiceStatusBadge} />
        <AuditResultsTab audits={audits} getAuditStatusBadge={getAuditStatusBadge} />
        <UnmatchedTabContent tenantId={tenantId} unmatchedLines={unmatchedLines} queryClient={queryClient} />
        <CreditClaimsTab claims={claims} />
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
