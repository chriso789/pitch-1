import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/components/ui/use-toast";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { 
  Plus, Target, BarChart3, TrendingUp, TrendingDown, DollarSign,
  Package, Wrench, Receipt, FileText, ArrowUpRight, ArrowDownRight,
  Lock, Calculator, Pencil, Check, X, Loader2
} from "lucide-react";

interface BudgetItem {
  id: string;
  category: string;
  item_name: string;
  description?: string;
  budgeted_quantity: number;
  budgeted_unit_cost: number;
  budgeted_total_cost: number;
  actual_quantity: number;
  actual_unit_cost: number;
  actual_total_cost: number;
  variance_amount: number;
  variance_percent: number;
  vendor_name?: string;
  purchase_order_number?: string;
}

interface InvoiceData {
  id: string;
  invoice_type: 'material' | 'labor' | 'overhead';
  vendor_name: string | null;
  crew_name: string | null;
  notes?: string | null;
  invoice_number: string | null;
  invoice_amount: number;
  invoice_date: string | null;
  status: string;
  created_at: string;
}

interface BudgetTrackerProps {
  projectId: string;
  pipelineEntryId?: string;
  budgetItems: BudgetItem[];
  onRefresh: () => void;
}

interface NewBudgetItem {
  category: string;
  item_name: string;
  description: string;
  budgeted_quantity: number;
  budgeted_unit_cost: number;
  vendor_name: string;
}

const formatCurrency = (amount: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(amount);

export const BudgetTracker = ({ projectId, pipelineEntryId, budgetItems, onRefresh }: BudgetTrackerProps) => {
  const queryClient = useQueryClient();
  const [showAddBudgetItem, setShowAddBudgetItem] = useState(false);
  const [newBudgetItem, setNewBudgetItem] = useState<NewBudgetItem>({
    category: '', item_name: '', description: '', budgeted_quantity: 0, budgeted_unit_cost: 0, vendor_name: ''
  });

  // Fetch estimate data for the cap sheet
  const { data: estimateData } = useQuery({
    queryKey: ['budget-estimate-data', pipelineEntryId],
    queryFn: async () => {
      if (!pipelineEntryId) return null;
      const { data, error } = await supabase
        .rpc('api_estimate_hyperlink_bar', { p_pipeline_entry_id: pipelineEntryId });
      if (error) throw error;
      return data as { materials: number; labor: number; sale_price: number; sales_tax_amount: number } | null;
    },
    enabled: !!pipelineEntryId,
  });

  // Fetch sales rep overhead/commission rates
  const { data: repData } = useQuery({
    queryKey: ['budget-rep-data', pipelineEntryId],
    queryFn: async () => {
      if (!pipelineEntryId) return null;
      const { data, error } = await supabase
        .from('pipeline_entries')
        .select(`
          assigned_to,
          profiles!pipeline_entries_assigned_to_fkey(
            first_name, last_name, overhead_rate, personal_overhead_rate, commission_rate
          )
        `)
        .eq('id', pipelineEntryId)
        .single();
      if (error) throw error;
      return data?.profiles as { first_name: string | null; last_name: string | null; overhead_rate: number | null; personal_overhead_rate: number | null; commission_rate: number | null } | null;
    },
    enabled: !!pipelineEntryId,
  });

  // Fetch all invoices
  const { data: invoices } = useQuery({
    queryKey: ['budget-invoices', pipelineEntryId],
    queryFn: async () => {
      if (!pipelineEntryId) return [];
      const { data, error } = await supabase
        .from('project_cost_invoices')
        .select('*')
        .eq('pipeline_entry_id', pipelineEntryId)
        .in('status', ['pending', 'approved', 'verified'])
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as InvoiceData[];
    },
    enabled: !!pipelineEntryId,
  });

  // Calculate cap sheet numbers
  const sellingPrice = estimateData?.sale_price || 0;
  const salesTax = (estimateData as any)?.sales_tax_amount || 0;
  const preTaxPrice = sellingPrice - salesTax;
  const originalMaterials = estimateData?.materials || 0;
  const originalLabor = estimateData?.labor || 0;
  const overheadRate = (repData?.personal_overhead_rate && repData.personal_overhead_rate > 0) 
    ? repData.personal_overhead_rate : (repData?.overhead_rate ?? 10);
  const commissionRate = repData?.commission_rate ?? 50;
  const repName = repData ? `${repData.first_name || ''} ${repData.last_name || ''}`.trim() : '';

  const materialInvoices = (invoices || []).filter(i => i.invoice_type === 'material');
  const laborInvoices = (invoices || []).filter(i => i.invoice_type === 'labor');
  const overheadInvoices = (invoices || []).filter(i => i.invoice_type === 'overhead');

  const actualMaterials = materialInvoices.reduce((s, i) => s + i.invoice_amount, 0);
  const actualLabor = laborInvoices.reduce((s, i) => s + i.invoice_amount, 0);
  const otherCharges = overheadInvoices.reduce((s, i) => s + i.invoice_amount, 0);

  const hasMaterialInvoices = actualMaterials > 0;
  const hasLaborInvoices = actualLabor > 0;

  const effectiveMaterials = hasMaterialInvoices ? actualMaterials : originalMaterials;
  const effectiveLabor = hasLaborInvoices ? actualLabor : originalLabor;
  const overheadAmount = preTaxPrice * (overheadRate / 100);
  const totalCosts = effectiveMaterials + effectiveLabor + overheadAmount + otherCharges;
  const grossProfit = preTaxPrice - totalCosts;
  const repCommission = grossProfit * (commissionRate / 100);
  const companyNet = grossProfit - repCommission;
  const profitMargin = preTaxPrice > 0 ? (grossProfit / preTaxPrice) * 100 : 0;

  const totalBudgetedCosts = budgetItems.reduce((sum, item) => sum + Number(item.budgeted_total_cost), 0);
  const totalActualCosts = budgetItems.reduce((sum, item) => sum + Number(item.actual_total_cost), 0);
  const budgetVariance = totalActualCosts - totalBudgetedCosts;

  const addBudgetItem = async () => {
    try {
      const user = await supabase.auth.getUser();
      const { error } = await supabase
        .from('project_budget_items')
        .insert({
          ...newBudgetItem,
          project_id: projectId,
          tenant_id: user.data.user?.user_metadata?.tenant_id,
          created_by: user.data.user?.id
        });
      if (error) throw error;
      toast({ title: "Success", description: "Budget item added" });
      setNewBudgetItem({ category: '', item_name: '', description: '', budgeted_quantity: 0, budgeted_unit_cost: 0, vendor_name: '' });
      setShowAddBudgetItem(false);
      onRefresh();
    } catch (error) {
      toast({ title: "Error", description: "Failed to add budget item", variant: "destructive" });
    }
  };

  const VarianceChip = ({ original, actual }: { original: number; actual: number }) => {
    const diff = actual - original;
    if (diff === 0) return null;
    return (
      <span className={cn("text-xs flex items-center gap-0.5", diff > 0 ? "text-red-600" : "text-green-600")}>
        {diff > 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
        {formatCurrency(Math.abs(diff))}
      </span>
    );
  };

  return (
    <div className="space-y-6">
      {/* ===== CAP SHEET ===== */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Lock className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-lg font-semibold">Cap Sheet</h3>
          {repName && <Badge variant="secondary" className="text-xs">{repName}</Badge>}
        </div>

        {preTaxPrice > 0 ? (
          <Card className="border-primary/20">
            <CardContent className="p-4 space-y-3">
              {/* Contract / Selling Price */}
              <div className="flex justify-between items-center">
                <span className="font-medium">Contract Price</span>
                <span className="font-bold text-lg">{formatCurrency(sellingPrice)}</span>
              </div>
              {salesTax > 0 && (
                <div className="flex justify-between items-center text-sm text-muted-foreground pl-4">
                  <span>Sales Tax</span>
                  <span>-{formatCurrency(salesTax)}</span>
                </div>
              )}

              <Separator />

              {/* Cost Breakdown */}
              <div className="space-y-2">
                <div className="grid grid-cols-4 gap-2 text-xs text-muted-foreground font-medium">
                  <span>Category</span>
                  <span className="text-right">Budgeted</span>
                  <span className="text-right">Actual</span>
                  <span className="text-right">Variance</span>
                </div>

                {/* Materials */}
                <div className="grid grid-cols-4 gap-2 text-sm items-center">
                  <span className="flex items-center gap-1.5">
                    <Package className="h-3.5 w-3.5 text-blue-500" />
                    Materials
                  </span>
                  <span className="text-right text-muted-foreground">{formatCurrency(originalMaterials)}</span>
                  <span className={cn("text-right font-medium", hasMaterialInvoices ? "" : "text-muted-foreground")}>
                    {hasMaterialInvoices ? formatCurrency(actualMaterials) : '—'}
                  </span>
                  <span className="text-right">
                    {hasMaterialInvoices ? <VarianceChip original={originalMaterials} actual={actualMaterials} /> : '—'}
                  </span>
                </div>

                {/* Labor */}
                <div className="grid grid-cols-4 gap-2 text-sm items-center">
                  <span className="flex items-center gap-1.5">
                    <Wrench className="h-3.5 w-3.5 text-orange-500" />
                    Labor
                  </span>
                  <span className="text-right text-muted-foreground">{formatCurrency(originalLabor)}</span>
                  <span className={cn("text-right font-medium", hasLaborInvoices ? "" : "text-muted-foreground")}>
                    {hasLaborInvoices ? formatCurrency(actualLabor) : '—'}
                  </span>
                  <span className="text-right">
                    {hasLaborInvoices ? <VarianceChip original={originalLabor} actual={actualLabor} /> : '—'}
                  </span>
                </div>

                {/* Overhead */}
                <div className="grid grid-cols-4 gap-2 text-sm items-center">
                  <span className="flex items-center gap-1.5">
                    <Calculator className="h-3.5 w-3.5 text-purple-500" />
                    Overhead ({overheadRate}%)
                  </span>
                  <span className="text-right text-muted-foreground">{formatCurrency(overheadAmount)}</span>
                  <span className="text-right text-muted-foreground">—</span>
                  <span className="text-right">—</span>
                </div>

                {/* Other Charges */}
                {otherCharges > 0 && (
                  <div className="grid grid-cols-4 gap-2 text-sm items-center">
                    <span className="flex items-center gap-1.5">
                      <Receipt className="h-3.5 w-3.5 text-amber-500" />
                      Other Charges
                    </span>
                    <span className="text-right text-muted-foreground">—</span>
                    <span className="text-right font-medium">{formatCurrency(otherCharges)}</span>
                    <span className="text-right">—</span>
                  </div>
                )}
              </div>

              <Separator />

              {/* Total Costs */}
              <div className="flex justify-between items-center text-sm font-medium">
                <span>Total Costs</span>
                <span>{formatCurrency(totalCosts)}</span>
              </div>

              {/* Gross Profit */}
              <div className="flex justify-between items-center py-2 bg-accent/30 rounded-md px-3 -mx-1">
                <span className="font-medium">Gross Profit</span>
                <div className="text-right">
                  <span className={cn("font-bold text-lg", grossProfit >= 0 ? "text-green-600" : "text-red-600")}>
                    {formatCurrency(grossProfit)}
                  </span>
                  <span className={cn("text-xs ml-2", profitMargin >= 25 ? "text-green-600" : profitMargin >= 15 ? "text-yellow-600" : "text-red-600")}>
                    ({profitMargin.toFixed(1)}%)
                  </span>
                </div>
              </div>

              {/* Commission Split */}
              <div className="flex justify-between items-center py-2 bg-primary/10 rounded-md px-3 -mx-1">
                <div className="flex items-center gap-2">
                  <DollarSign className="h-4 w-4 text-primary" />
                  <span className="font-medium">Rep Commission ({commissionRate}%)</span>
                </div>
                <span className="font-bold text-lg text-primary">{formatCurrency(repCommission)}</span>
              </div>

              <div className="flex justify-between items-center text-sm">
                <span className="text-muted-foreground">Company Net</span>
                <span className="font-medium">{formatCurrency(companyNet)}</span>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              <Calculator className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p>No estimate data available for cap sheet</p>
              <p className="text-sm">Complete the estimate to populate the budget</p>
            </CardContent>
          </Card>
        )}
      </div>

      {/* ===== INVOICES & CHARGES ===== */}
      {(invoices || []).length > 0 && (
        <div>
          <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
            <FileText className="h-4 w-4" />
            Invoices & Charges
            <Badge variant="secondary" className="text-xs">{(invoices || []).length}</Badge>
          </h3>

          {/* Material Invoices */}
          {materialInvoices.length > 0 && (
            <div className="mb-3">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5 flex items-center gap-1">
                <Package className="h-3 w-3 text-blue-500" /> Materials ({materialInvoices.length})
              </p>
              <div className="space-y-1">
                {materialInvoices.map(inv => (
                  <div key={inv.id} className="flex justify-between items-center p-2 bg-muted/40 rounded text-sm">
                    <div className="min-w-0">
                      <span className="font-medium">{inv.vendor_name?.trim() || 'Material Invoice'}</span>
                      {inv.invoice_number && <span className="text-xs text-muted-foreground ml-2">#{inv.invoice_number}</span>}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{formatCurrency(inv.invoice_amount)}</span>
                      <Badge variant="outline" className={cn("text-xs", inv.status === 'verified' ? "bg-green-500/10 text-green-600 border-green-500/30" : "bg-yellow-500/10 text-yellow-600 border-yellow-500/30")}>
                        {inv.status}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Labor Invoices */}
          {laborInvoices.length > 0 && (
            <div className="mb-3">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5 flex items-center gap-1">
                <Wrench className="h-3 w-3 text-orange-500" /> Labor ({laborInvoices.length})
              </p>
              <div className="space-y-1">
                {laborInvoices.map(inv => (
                  <div key={inv.id} className="flex justify-between items-center p-2 bg-muted/40 rounded text-sm">
                    <div className="min-w-0">
                      <span className="font-medium">{inv.vendor_name?.trim() || inv.crew_name?.trim() || 'Labor Invoice'}</span>
                      {inv.invoice_number && <span className="text-xs text-muted-foreground ml-2">#{inv.invoice_number}</span>}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{formatCurrency(inv.invoice_amount)}</span>
                      <Badge variant="outline" className={cn("text-xs", inv.status === 'verified' ? "bg-green-500/10 text-green-600 border-green-500/30" : "bg-yellow-500/10 text-yellow-600 border-yellow-500/30")}>
                        {inv.status}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Overhead Invoices */}
          {overheadInvoices.length > 0 && (
            <div className="mb-3">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5 flex items-center gap-1">
                <Receipt className="h-3 w-3 text-purple-500" /> Overhead ({overheadInvoices.length})
              </p>
              <div className="space-y-1">
                {overheadInvoices.map(inv => (
                  <div key={inv.id} className="flex justify-between items-center p-2 bg-muted/40 rounded text-sm">
                    <div className="min-w-0">
                      <span className="font-medium">{inv.vendor_name?.trim() || inv.notes?.split('\n')[0]?.trim() || 'Overhead'}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{formatCurrency(inv.invoice_amount)}</span>
                      <Badge variant="outline" className={cn("text-xs", inv.status === 'verified' ? "bg-green-500/10 text-green-600 border-green-500/30" : "bg-yellow-500/10 text-yellow-600 border-yellow-500/30")}>
                        {inv.status}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Totals */}
          <Card className="mt-3">
            <CardContent className="p-3">
              <div className="grid grid-cols-3 gap-4 text-center">
                <div>
                  <p className="text-xs text-muted-foreground">Material Total</p>
                  <p className="font-bold text-blue-600">{formatCurrency(actualMaterials)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Labor Total</p>
                  <p className="font-bold text-orange-600">{formatCurrency(actualLabor)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Overhead Total</p>
                  <p className="font-bold text-purple-600">{formatCurrency(otherCharges)}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ===== CUSTOM BUDGET ITEMS ===== */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-semibold">Budget Line Items</h3>
          <Dialog open={showAddBudgetItem} onOpenChange={setShowAddBudgetItem}>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline">
                <Plus className="h-4 w-4 mr-2" />
                Add Item
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add Budget Item</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>Category</Label>
                    <Select value={newBudgetItem.category} onValueChange={(v) => setNewBudgetItem(p => ({ ...p, category: v }))}>
                      <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="material">Material</SelectItem>
                        <SelectItem value="labor">Labor</SelectItem>
                        <SelectItem value="overhead">Overhead</SelectItem>
                        <SelectItem value="equipment">Equipment</SelectItem>
                        <SelectItem value="permits">Permits</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Item Name</Label>
                    <Input value={newBudgetItem.item_name} onChange={(e) => setNewBudgetItem(p => ({ ...p, item_name: e.target.value }))} placeholder="e.g., Shingles" />
                  </div>
                </div>
                <div>
                  <Label>Description</Label>
                  <Input value={newBudgetItem.description} onChange={(e) => setNewBudgetItem(p => ({ ...p, description: e.target.value }))} placeholder="Optional" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>Quantity</Label>
                    <Input type="number" value={newBudgetItem.budgeted_quantity} onChange={(e) => setNewBudgetItem(p => ({ ...p, budgeted_quantity: parseFloat(e.target.value) || 0 }))} />
                  </div>
                  <div>
                    <Label>Unit Cost</Label>
                    <Input type="number" step="0.01" value={newBudgetItem.budgeted_unit_cost} onChange={(e) => setNewBudgetItem(p => ({ ...p, budgeted_unit_cost: parseFloat(e.target.value) || 0 }))} />
                  </div>
                </div>
                <div>
                  <Label>Vendor</Label>
                  <Input value={newBudgetItem.vendor_name} onChange={(e) => setNewBudgetItem(p => ({ ...p, vendor_name: e.target.value }))} placeholder="Vendor name" />
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setShowAddBudgetItem(false)}>Cancel</Button>
                  <Button onClick={addBudgetItem} disabled={!newBudgetItem.category || !newBudgetItem.item_name}>Add Item</Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {budgetItems.length > 0 ? (
          <div className="space-y-2">
            {budgetItems.map((item) => (
              <div key={item.id} className="p-3 bg-muted/30 rounded-lg">
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <h4 className="font-medium text-sm">{item.item_name}</h4>
                    <p className="text-xs text-muted-foreground">{item.category} {item.vendor_name ? `• ${item.vendor_name}` : ''}</p>
                  </div>
                  {Math.abs(item.variance_percent) > 10 && (
                    <Badge variant={item.variance_amount > 0 ? "destructive" : "default"} className="text-xs">
                      {item.variance_percent > 0 ? '+' : ''}{item.variance_percent.toFixed(1)}%
                    </Badge>
                  )}
                </div>
                <div className="grid grid-cols-3 gap-3 text-xs">
                  <div>
                    <p className="text-muted-foreground">Budgeted</p>
                    <p className="font-medium">{formatCurrency(item.budgeted_total_cost)}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Actual</p>
                    <p className="font-medium">{formatCurrency(item.actual_total_cost)}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Variance</p>
                    <p className={cn("font-medium", item.variance_amount >= 0 ? "text-red-600" : "text-green-600")}>
                      {item.variance_amount >= 0 ? '+' : ''}{formatCurrency(item.variance_amount)}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <Card>
            <CardContent className="py-6 text-center text-muted-foreground">
              <Target className="h-6 w-6 mx-auto mb-2 opacity-50" />
              <p className="text-sm">No custom budget items — add line items to track granular costs</p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
};
