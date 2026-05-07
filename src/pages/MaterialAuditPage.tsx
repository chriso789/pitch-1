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
import { Search, Upload, Play, FileText, Download, AlertTriangle, CheckCircle, XCircle, DollarSign, TrendingUp, Copy } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { GlobalLayout } from "@/shared/components/layout/GlobalLayout";

const MaterialAuditPage = () => {
  const tenantId = useEffectiveTenantId();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState("price-lists");
  const [selectedSupplier, setSelectedSupplier] = useState<string>("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [importOpen, setImportOpen] = useState(false);

  // ---- Queries ----
  const { data: suppliers = [] } = useQuery({
    queryKey: ["material-suppliers", tenantId],
    queryFn: async () => {
      if (!tenantId) return [];
      const { data } = await supabase.from("material_suppliers").select("*").eq("company_id", tenantId).order("supplier_name");
      return data || [];
    },
    enabled: !!tenantId,
  });

  const { data: priceLists = [] } = useQuery({
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

  const { data: priceListItems = [] } = useQuery({
    queryKey: ["price-list-items", tenantId, selectedSupplier],
    queryFn: async () => {
      if (!tenantId) return [];
      let q = supabase.from("supplier_price_list_items").select("*").eq("company_id", tenantId).limit(200);
      if (selectedSupplier !== "all") q = q.eq("supplier_id", selectedSupplier);
      const { data } = await q;
      return data || [];
    },
    enabled: !!tenantId,
  });

  const { data: invoices = [] } = useQuery({
    queryKey: ["material-invoices", tenantId, selectedSupplier],
    queryFn: async () => {
      if (!tenantId) return [];
      let q = supabase.from("material_invoice_documents").select("*, material_suppliers(supplier_name)").eq("company_id", tenantId).order("created_at", { ascending: false });
      if (selectedSupplier !== "all") q = q.eq("supplier_id", selectedSupplier);
      const { data } = await q;
      return data || [];
    },
    enabled: !!tenantId,
  });

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

  // ---- Mutations ----
  const runAudit = useMutation({
    mutationFn: async (invoiceDocumentId: string) => {
      const { data, error } = await supabase.functions.invoke("audit-material-invoice", { body: { invoiceDocumentId } });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      toast.success(`Audit complete: ${data.matched} matched, ${data.unmatched} unmatched, $${Number(data.totalOvercharge || 0).toFixed(2)} overcharge`);
      queryClient.invalidateQueries({ queryKey: ["material-audits"] });
      queryClient.invalidateQueries({ queryKey: ["material-invoices"] });
      queryClient.invalidateQueries({ queryKey: ["unmatched-audit-lines"] });
    },
    onError: (e: any) => toast.error(e.message || "Audit failed"),
  });

  const generateReport = useMutation({
    mutationFn: async (auditId: string) => {
      const { data, error } = await supabase.functions.invoke("generate-material-audit-report", { body: { auditId, format: "csv" } });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      if (data?.csvUrl) window.open(data.csvUrl, "_blank");
      toast.success("Report generated");
    },
    onError: (e: any) => toast.error(e.message || "Report generation failed"),
  });

  const createClaim = useMutation({
    mutationFn: async (auditId: string) => {
      const { data, error } = await supabase.functions.invoke("create-supplier-credit-claim", { body: { auditId } });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Credit claim draft created");
      queryClient.invalidateQueries({ queryKey: ["credit-claims"] });
    },
    onError: (e: any) => toast.error(e.message || "Failed to create claim"),
  });

  // ---- Helpers ----
  const getStatusBadge = (type: string) => {
    switch (type) {
      case "overcharge": return <Badge variant="destructive">Overcharge</Badge>;
      case "undercharge": return <Badge className="bg-orange-500">Undercharge</Badge>;
      case "no_issue": return <Badge className="bg-emerald-600">No Issue</Badge>;
      case "unmatched_item": return <Badge variant="outline" className="border-yellow-500 text-yellow-600">Unmatched</Badge>;
      case "uom_mismatch": return <Badge variant="outline" className="border-yellow-500 text-yellow-600">UOM Mismatch</Badge>;
      case "needs_review": return <Badge variant="outline" className="border-yellow-500 text-yellow-600">Needs Review</Badge>;
      case "duplicate_charge_possible": return <Badge variant="destructive">Possible Duplicate</Badge>;
      case "missing_price_list": return <Badge variant="outline" className="border-red-500 text-red-600">No Price List</Badge>;
      default: return <Badge variant="outline">{type}</Badge>;
    }
  };

  const getAuditStatusBadge = (status: string) => {
    switch (status) {
      case "audited": return <Badge className="bg-emerald-600">Audited</Badge>;
      case "partial_match": return <Badge variant="outline" className="border-yellow-500 text-yellow-600">Partial Match</Badge>;
      case "not_audited": return <Badge variant="outline">Not Audited</Badge>;
      case "needs_review": return <Badge variant="outline" className="border-yellow-500 text-yellow-600">Needs Review</Badge>;
      default: return <Badge variant="outline">{status}</Badge>;
    }
  };

  const totalOvercharges = audits.reduce((sum: number, a: any) => sum + Number(a.total_overcharge_amount || 0), 0);
  const openClaims = claims.filter((c: any) => !["credited", "closed", "denied"].includes(c.claim_status));

  // Chart data
  const chartData = suppliers.map((s: any) => {
    const supplierAudits = audits.filter((a: any) => a.supplier_id === s.id);
    return {
      name: s.supplier_name,
      overcharge: supplierAudits.reduce((sum: number, a: any) => sum + Number(a.total_overcharge_amount || 0), 0),
      undercharge: supplierAudits.reduce((sum: number, a: any) => sum + Number(a.total_undercharge_amount || 0), 0),
    };
  }).filter(d => d.overcharge > 0 || d.undercharge > 0);

  return (
    <AppLayout title="Material Price Audit">
      <div className="p-4 space-y-4">
        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2">
                <FileText className="h-5 w-5 text-muted-foreground" />
                <div>
                  <p className="text-sm text-muted-foreground">Invoices Audited</p>
                  <p className="text-2xl font-bold">{audits.length}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2">
                <DollarSign className="h-5 w-5 text-destructive" />
                <div>
                  <p className="text-sm text-muted-foreground">Total Overcharges</p>
                  <p className="text-2xl font-bold text-destructive">${totalOvercharges.toFixed(2)}</p>
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
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2">
                <TrendingUp className="h-5 w-5 text-emerald-500" />
                <div>
                  <p className="text-sm text-muted-foreground">Open Claims</p>
                  <p className="text-2xl font-bold">{openClaims.length}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Overcharge Chart */}
        {chartData.length > 0 && (
          <Card>
            <CardHeader><CardTitle className="text-base">Overcharge by Supplier</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" />
                  <YAxis tickFormatter={(v) => `$${v}`} />
                  <Tooltip formatter={(v: number) => `$${v.toFixed(2)}`} />
                  <Legend />
                  <Bar dataKey="overcharge" fill="hsl(var(--destructive))" name="Overcharge" />
                  <Bar dataKey="undercharge" fill="hsl(var(--primary))" name="Undercharge" />
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
              {suppliers.map((s: any) => <SelectItem key={s.id} value={s.id}>{s.supplier_name}</SelectItem>)}
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
            <TabsTrigger value="invoice-queue">Invoice Audit Queue</TabsTrigger>
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
                <ImportPriceListDialog tenantId={tenantId} suppliers={suppliers} onSuccess={() => {
                  queryClient.invalidateQueries({ queryKey: ["supplier-price-lists"] });
                  queryClient.invalidateQueries({ queryKey: ["price-list-items"] });
                  queryClient.invalidateQueries({ queryKey: ["material-suppliers"] });
                }} />
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Supplier</TableHead>
                      <TableHead>List Name</TableHead>
                      <TableHead>Effective</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Items</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {priceLists.map((pl: any) => (
                      <TableRow key={pl.id}>
                        <TableCell className="font-medium">{(pl as any).material_suppliers?.supplier_name}</TableCell>
                        <TableCell>{pl.list_name}</TableCell>
                        <TableCell>{pl.effective_start_date} — {pl.effective_end_date || "∞"}</TableCell>
                        <TableCell>
                          <Badge variant={pl.status === "active" ? "default" : "outline"} className={pl.status === "active" ? "bg-emerald-600" : ""}>{pl.status}</Badge>
                        </TableCell>
                        <TableCell>{priceListItems.filter((i: any) => i.price_list_id === pl.id).length}</TableCell>
                      </TableRow>
                    ))}
                    {priceLists.length === 0 && (
                      <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">No price lists imported yet</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Tab 2: Invoice Queue */}
          <TabsContent value="invoice-queue">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Invoice Audit Queue</CardTitle>
                <CardDescription>Invoices pending or completed audit</CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Invoice #</TableHead>
                      <TableHead>Supplier</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Total</TableHead>
                      <TableHead>Audit Status</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {invoices.map((inv: any) => (
                      <TableRow key={inv.id}>
                        <TableCell className="font-medium">{inv.invoice_number || "—"}</TableCell>
                        <TableCell>{(inv as any).material_suppliers?.supplier_name || inv.supplier_detected_name || "Unknown"}</TableCell>
                        <TableCell>{inv.invoice_date || "—"}</TableCell>
                        <TableCell>${Number(inv.invoice_total || 0).toFixed(2)}</TableCell>
                        <TableCell>{getAuditStatusBadge(inv.audit_status)}</TableCell>
                        <TableCell>
                          <Button size="sm" variant="outline" onClick={() => runAudit.mutate(inv.id)} disabled={runAudit.isPending || !inv.supplier_id}>
                            <Play className="h-3 w-3 mr-1" />Run Audit
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                    {invoices.length === 0 && (
                      <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">No invoices found</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Tab 3: Audit Results */}
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
                            <Button size="sm" variant="ghost" onClick={() => generateReport.mutate(a.id)} title="Download CSV">
                              <Download className="h-3 w-3" />
                            </Button>
                            {Number(a.total_overcharge_amount) > 0 && (
                              <Button size="sm" variant="ghost" onClick={() => createClaim.mutate(a.id)} title="Create Credit Claim">
                                <DollarSign className="h-3 w-3" />
                              </Button>
                            )}
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
            <UnmatchedMappingTab tenantId={tenantId} unmatchedLines={unmatchedLines} suppliers={suppliers} queryClient={queryClient} />
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
    </AppLayout>
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
      // Parse CSV rows
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
    // Update audit line status
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
        <CardDescription>Map invoice line items to the correct price list item. Mappings are supplier-specific.</CardDescription>
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
