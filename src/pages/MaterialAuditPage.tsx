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
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Search, Upload, Play, FileText, Download, AlertTriangle, CheckCircle, XCircle, DollarSign, TrendingUp, Copy, Package } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { GlobalLayout } from "@/shared/components/layout/GlobalLayout";

export const MaterialAuditContent = () => {
  const tenantId = useEffectiveTenantId();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState("price-lists");
  const [selectedSupplier, setSelectedSupplier] = useState<string>("all");
  const [searchTerm, setSearchTerm] = useState("");

  // ---- Queries ----

  // Price lists from supplier_pricebooks (grouped by supplier_name + effective_date)
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
      // Group by supplier_name + effective_date
      const groups: Record<string, { supplier_name: string; effective_date: string; item_count: number; categories: Set<string>; is_active: boolean; imported_at: string }> = {};
      data.forEach((item: any) => {
        const key = `${item.supplier_name}||${item.effective_date || 'unknown'}`;
        if (!groups[key]) {
          groups[key] = {
            supplier_name: item.supplier_name,
            effective_date: item.effective_date || '',
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

  // Also check old supplier_price_lists table
  const { data: legacyPriceLists = [] } = useQuery({
    queryKey: ["supplier-price-lists", tenantId, selectedSupplier],
    queryFn: async () => {
      if (!tenantId) return [];
      let q = supabase.from("supplier_price_lists").select("*, material_suppliers(supplier_name)").eq("company_id", tenantId).order("created_at", { ascending: false });
      if (selectedSupplier !== "all") q = q.eq("supplier_id", selectedSupplier);
      const { data } = await q;
      return data || [];
    },
    enabled: !!tenantId,
  });

  // Material invoices from project_cost_invoices (the real data)
  const { data: materialInvoices = [] } = useQuery({
    queryKey: ["material-cost-invoices", tenantId, selectedSupplier],
    queryFn: async () => {
      if (!tenantId) return [];
      let q = supabase
        .from("project_cost_invoices")
        .select("*, pipeline_entries!project_cost_invoices_pipeline_entry_id_fkey(id, lead_name, contacts!pipeline_entries_contact_id_fkey(first_name, last_name))")
        .eq("tenant_id", tenantId)
        .in("invoice_type", ["material"])
        .order("created_at", { ascending: false });
      if (selectedSupplier !== "all") {
        q = q.ilike("vendor_name", `%${selectedSupplier}%`);
      }
      const { data } = await q;
      return data || [];
    },
    enabled: !!tenantId,
  });

  // Get unique vendor names for the supplier filter
  const supplierNames = React.useMemo(() => {
    const names = new Set<string>();
    materialInvoices.forEach((inv: any) => {
      if (inv.vendor_name) names.add(inv.vendor_name);
    });
    pricebookGroups.forEach((g: any) => {
      if (g.supplier_name) names.add(g.supplier_name);
    });
    return Array.from(names).sort();
  }, [materialInvoices, pricebookGroups]);

  // Legacy audit tables (keep existing functionality)
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

  // Legacy suppliers for unmatched mapping
  const { data: legacySuppliers = [] } = useQuery({
    queryKey: ["material-suppliers", tenantId],
    queryFn: async () => {
      if (!tenantId) return [];
      const { data } = await supabase.from("material_suppliers").select("*").eq("company_id", tenantId).order("supplier_name");
      return data || [];
    },
    enabled: !!tenantId,
  });

  // ---- Helpers ----
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
  const totalOvercharges = audits.reduce((sum: number, a: any) => sum + Number(a.total_overcharge_amount || 0), 0);
  const openClaims = claims.filter((c: any) => !["credited", "closed", "denied"].includes(c.claim_status));
  const totalPricebookItems = pricebookGroups.reduce((sum, g: any) => sum + g.item_count, 0);

  // Chart data by vendor
  const chartData = React.useMemo(() => {
    const byVendor: Record<string, number> = {};
    materialInvoices.forEach((inv: any) => {
      const name = inv.vendor_name || "Unknown";
      byVendor[name] = (byVendor[name] || 0) + Number(inv.invoice_amount || 0);
    });
    return Object.entries(byVendor)
      .map(([name, total]) => ({ name, total: Number(total.toFixed(2)) }))
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
        {/* Summary Cards */}
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

        {/* Spend by Vendor Chart */}
        {chartData.length > 0 && (
          <Card>
            <CardHeader><CardTitle className="text-base">Material Spend by Vendor</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" angle={-20} textAnchor="end" height={60} fontSize={12} />
                  <YAxis tickFormatter={(v) => `$${(v / 1000).toFixed(1)}k`} />
                  <Tooltip formatter={(v: number) => `$${v.toLocaleString(undefined, { minimumFractionDigits: 2 })}`} />
                  <Bar dataKey="total" fill="hsl(var(--primary))" name="Spend" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}

        {/* Filter */}
        <div className="flex gap-2 items-center">
          <Select value={selectedSupplier} onValueChange={setSelectedSupplier}>
            <SelectTrigger className="w-[200px]"><SelectValue placeholder="All Suppliers" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Suppliers</SelectItem>
              {supplierNames.map((name) => <SelectItem key={name} value={name}>{name}</SelectItem>)}
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

          {/* Tab 1: Price Lists */}
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
                }} />
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Supplier</TableHead>
                      <TableHead>Effective Date</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Items</TableHead>
                      <TableHead>Categories</TableHead>
                      <TableHead>Imported</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pricebookGroups.map((g: any, i: number) => (
                      <TableRow key={i}>
                        <TableCell className="font-medium">{g.supplier_name}</TableCell>
                        <TableCell>{g.effective_date || "—"}</TableCell>
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
                          {g.imported_at ? new Date(g.imported_at).toLocaleDateString() : "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                    {/* Also show legacy price lists */}
                    {legacyPriceLists.map((pl: any) => (
                      <TableRow key={pl.id}>
                        <TableCell className="font-medium">{(pl as any).material_suppliers?.supplier_name}</TableCell>
                        <TableCell>{pl.effective_start_date} — {pl.effective_end_date || "∞"}</TableCell>
                        <TableCell>
                          <Badge variant={pl.status === "active" ? "default" : "outline"} className={pl.status === "active" ? "bg-emerald-600" : ""}>{pl.status}</Badge>
                        </TableCell>
                        <TableCell>—</TableCell>
                        <TableCell>—</TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {new Date(pl.created_at).toLocaleDateString()}
                        </TableCell>
                      </TableRow>
                    ))}
                    {pricebookGroups.length === 0 && legacyPriceLists.length === 0 && (
                      <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">No price lists imported yet</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Tab 2: Invoice Queue - pulls from project_cost_invoices */}
          <TabsContent value="invoice-queue">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Material Invoice Queue</CardTitle>
                <CardDescription>Material invoices uploaded to projects — compare against price lists</CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Invoice #</TableHead>
                      <TableHead>Vendor</TableHead>
                      <TableHead>Project</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Amount</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Uploaded</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredInvoices.map((inv: any) => {
                      const projectName = inv.pipeline_entries?.lead_name ||
                        (inv.pipeline_entries?.contacts ? `${inv.pipeline_entries.contacts.first_name} ${inv.pipeline_entries.contacts.last_name}` : null) ||
                        "—";
                      return (
                        <TableRow key={inv.id}>
                          <TableCell className="font-medium">{inv.invoice_number || "—"}</TableCell>
                          <TableCell>{inv.vendor_name || "Unknown"}</TableCell>
                          <TableCell className="max-w-[200px] truncate">{projectName}</TableCell>
                          <TableCell>{inv.invoice_date || "—"}</TableCell>
                          <TableCell className="font-medium">${Number(inv.invoice_amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                          <TableCell>{getInvoiceStatusBadge(inv.status)}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">{new Date(inv.created_at).toLocaleDateString()}</TableCell>
                        </TableRow>
                      );
                    })}
                    {filteredInvoices.length === 0 && (
                      <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">No material invoices found</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Tab 3: Audit Results (legacy) */}
          <TabsContent value="audit-results">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Audit Results</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Supplier</TableHead>
                      <TableHead>Invoice #</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Lines</TableHead>
                      <TableHead>Matched %</TableHead>
                      <TableHead>Overcharge</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {audits.map((a: any) => {
                      const matchPct = a.total_invoice_lines > 0 ? Math.round((a.matched_lines / a.total_invoice_lines) * 100) : 0;
                      return (
                        <TableRow key={a.id}>
                          <TableCell className="font-medium">{(a as any).material_suppliers?.supplier_name || "—"}</TableCell>
                          <TableCell>{(a as any).material_invoice_documents?.invoice_number || "—"}</TableCell>
                          <TableCell>{a.invoice_date}</TableCell>
                          <TableCell>{a.total_invoice_lines}</TableCell>
                          <TableCell>{matchPct}%</TableCell>
                          <TableCell className={Number(a.total_overcharge_amount) > 0 ? "text-destructive font-bold" : ""}>${Number(a.total_overcharge_amount || 0).toFixed(2)}</TableCell>
                          <TableCell>{getAuditStatusBadge(a.audit_status)}</TableCell>
                          <TableCell className="space-x-1">
                            <Button size="sm" variant="ghost" title="Download CSV">
                              <Download className="h-3 w-3" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    {audits.length === 0 && (
                      <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">No audits run yet</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Tab 4: Unmatched Mapping */}
          <TabsContent value="unmatched">
            <UnmatchedMappingTab tenantId={tenantId} unmatchedLines={unmatchedLines} suppliers={legacySuppliers} queryClient={queryClient} />
          </TabsContent>

          {/* Tab 5: Credit Claims */}
          <TabsContent value="credit-claims">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Supplier Credit Claims</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Claim #</TableHead>
                      <TableHead>Supplier</TableHead>
                      <TableHead>Claim Amount</TableHead>
                      <TableHead>Credit Received</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {claims.map((c: any) => (
                      <TableRow key={c.id}>
                        <TableCell className="font-medium">{c.claim_number}</TableCell>
                        <TableCell>{(c as any).material_suppliers?.supplier_name}</TableCell>
                        <TableCell className="text-destructive font-bold">${Number(c.total_claim_amount || 0).toFixed(2)}</TableCell>
                        <TableCell className="text-emerald-600">${Number(c.credit_received_amount || 0).toFixed(2)}</TableCell>
                        <TableCell>
                          <Badge variant={c.claim_status === "credited" ? "default" : "outline"} className={c.claim_status === "credited" ? "bg-emerald-600" : ""}>{c.claim_status}</Badge>
                        </TableCell>
                        <TableCell>
                          {c.email_body && (
                            <Button size="sm" variant="ghost" onClick={() => { navigator.clipboard.writeText(c.email_body); toast.success("Email copied"); }} title="Copy email">
                              <Copy className="h-3 w-3" />
                            </Button>
                          )}
                          {c.csv_file_url && (
                            <Button size="sm" variant="ghost" onClick={() => window.open(c.csv_file_url, "_blank")} title="Download CSV">
                              <Download className="h-3 w-3" />
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
        </Tabs>
      </div>
    </GlobalLayout>
  );
};

// --- Import Price List Dialog ---
function ImportPriceListDialog({ tenantId, suppliers, onSuccess }: { tenantId: string | null; suppliers: any[]; onSuccess: () => void }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ supplierName: "", listName: "", effectiveStartDate: "", effectiveEndDate: "", replaceExisting: false, rawCsv: "" });
  const [importing, setImporting] = useState(false);

  const handleImport = async () => {
    if (!tenantId || !form.supplierName || !form.listName || !form.effectiveStartDate || !form.rawCsv.trim()) {
      toast.error("Fill all required fields and paste CSV data");
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
      toast.success(`Imported ${data.imported} items`);
      setOpen(false);
      setForm({ supplierName: "", listName: "", effectiveStartDate: "", effectiveEndDate: "", replaceExisting: false, rawCsv: "" });
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
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Import Supplier Price List</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Supplier Name *</Label><Input value={form.supplierName} onChange={e => setForm(f => ({ ...f, supplierName: e.target.value }))} placeholder="ABC Supply" /></div>
          <div><Label>List Name *</Label><Input value={form.listName} onChange={e => setForm(f => ({ ...f, listName: e.target.value }))} placeholder="ABC May 2026 Agreement" /></div>
          <div className="grid grid-cols-2 gap-2">
            <div><Label>Effective Start *</Label><Input type="date" value={form.effectiveStartDate} onChange={e => setForm(f => ({ ...f, effectiveStartDate: e.target.value }))} /></div>
            <div><Label>Effective End</Label><Input type="date" value={form.effectiveEndDate} onChange={e => setForm(f => ({ ...f, effectiveEndDate: e.target.value }))} /></div>
          </div>
          <div>
            <Label>Paste CSV Data *</Label>
            <p className="text-xs text-muted-foreground mb-1">Headers: sku, description, category, brand, uom, price</p>
            <Textarea rows={6} value={form.rawCsv} onChange={e => setForm(f => ({ ...f, rawCsv: e.target.value }))} placeholder={`sku,description,category,brand,uom,price\nABC-GAF-HDZ-WW,GAF Timberline HDZ Weathered Wood,Shingles,GAF,SQ,98.50`} />
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.replaceExisting} onChange={e => setForm(f => ({ ...f, replaceExisting: e.target.checked }))} /> Replace existing active price list for this supplier</label>
          <Button onClick={handleImport} disabled={importing} className="w-full">{importing ? "Importing..." : "Import Price List"}</Button>
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
              <p className="font-medium">Map: "{mappingLine.invoice_description}"</p>
              <p className="text-sm text-muted-foreground">Supplier: {(mappingLine as any).material_suppliers?.supplier_name} | SKU: {mappingLine.supplier_sku || "—"}</p>
              <Select value={selectedPriceItem} onValueChange={setSelectedPriceItem}>
                <SelectTrigger><SelectValue placeholder="Select correct price list item..." /></SelectTrigger>
                <SelectContent>
                  {priceItems.map((pi: any) => (
                    <SelectItem key={pi.id} value={pi.id}>{pi.item_description} — ${pi.agreed_unit_price}/{pi.unit_of_measure} {pi.supplier_sku ? `(${pi.supplier_sku})` : ""}</SelectItem>
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
                <TableCell>{l.supplier_sku || "—"}</TableCell>
                <TableCell>{l.quantity}</TableCell>
                <TableCell>${Number(l.charged_unit_price || 0).toFixed(2)}</TableCell>
                <TableCell>
                  <Button size="sm" variant="outline" onClick={() => { setMappingLine(l); setSelectedPriceItem(""); }}>Map</Button>
                </TableCell>
              </TableRow>
            ))}
            {unmatchedLines.length === 0 && (
              <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">All items matched! 🎉</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

export default MaterialAuditPage;
