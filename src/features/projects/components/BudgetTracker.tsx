import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/components/ui/use-toast";
import { Plus, Target, BarChart3, TrendingUp, TrendingDown } from "lucide-react";

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

interface BudgetTrackerProps {
  projectId: string;
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

export const BudgetTracker = ({ projectId, budgetItems, onRefresh }: BudgetTrackerProps) => {
  const [showAddBudgetItem, setShowAddBudgetItem] = useState(false);
  const [newBudgetItem, setNewBudgetItem] = useState<NewBudgetItem>({
    category: '',
    item_name: '',
    description: '',
    budgeted_quantity: 0,
    budgeted_unit_cost: 0,
    vendor_name: ''
  });

  const totalBudgetedCosts = budgetItems.reduce((sum, item) => sum + Number(item.budgeted_total_cost), 0);
  const totalActualCosts = budgetItems.reduce((sum, item) => sum + Number(item.actual_total_cost), 0);
  const budgetVariance = totalActualCosts - totalBudgetedCosts;
  const budgetVariancePercent = totalBudgetedCosts > 0 ? (budgetVariance / totalBudgetedCosts) * 100 : 0;

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

      toast({
        title: "Success",
        description: "Budget item added successfully",
      });

      setNewBudgetItem({
        category: '',
        item_name: '',
        description: '',
        budgeted_quantity: 0,
        budgeted_unit_cost: 0,
        vendor_name: ''
      });
      setShowAddBudgetItem(false);
      onRefresh();
    } catch (error) {
      console.error('Error adding budget item:', error);
      toast({
        title: "Error",
        description: "Failed to add budget item",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Project Budget</h3>
          <p className="text-muted-foreground">Track budgeted vs actual costs by category</p>
        </div>
        <Dialog open={showAddBudgetItem} onOpenChange={setShowAddBudgetItem}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="h-4 w-4 mr-2" />
              Add Budget Item
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Budget Item</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="category">Category</Label>
                  <Select value={newBudgetItem.category} onValueChange={(value) => setNewBudgetItem(prev => ({ ...prev, category: value }))}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select category" />
                    </SelectTrigger>
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
                  <Label htmlFor="item_name">Item Name</Label>
                  <Input
                    id="item_name"
                    value={newBudgetItem.item_name}
                    onChange={(e) => setNewBudgetItem(prev => ({ ...prev, item_name: e.target.value }))}
                    placeholder="e.g., Shingles"
                  />
                </div>
              </div>
              <div>
                <Label htmlFor="description">Description</Label>
                <Input
                  id="description"
                  value={newBudgetItem.description}
                  onChange={(e) => setNewBudgetItem(prev => ({ ...prev, description: e.target.value }))}
                  placeholder="Optional description"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="quantity">Quantity</Label>
                  <Input
                    id="quantity"
                    type="number"
                    value={newBudgetItem.budgeted_quantity}
                    onChange={(e) => setNewBudgetItem(prev => ({ ...prev, budgeted_quantity: parseFloat(e.target.value) || 0 }))}
                  />
                </div>
                <div>
                  <Label htmlFor="unit_cost">Unit Cost</Label>
                  <Input
                    id="unit_cost"
                    type="number"
                    step="0.01"
                    value={newBudgetItem.budgeted_unit_cost}
                    onChange={(e) => setNewBudgetItem(prev => ({ ...prev, budgeted_unit_cost: parseFloat(e.target.value) || 0 }))}
                  />
                </div>
              </div>
              <div>
                <Label htmlFor="vendor">Vendor</Label>
                <Input
                  id="vendor"
                  value={newBudgetItem.vendor_name}
                  onChange={(e) => setNewBudgetItem(prev => ({ ...prev, vendor_name: e.target.value }))}
                  placeholder="Vendor name"
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setShowAddBudgetItem(false)}>
                  Cancel
                </Button>
                <Button onClick={addBudgetItem} disabled={!newBudgetItem.category || !newBudgetItem.item_name}>
                  Add Item
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Budget Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <Target className="h-4 w-4 text-primary" />
              <div>
                <p className="text-sm text-muted-foreground">Total Budgeted</p>
                <p className="text-lg font-bold">${totalBudgetedCosts.toLocaleString()}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-warning" />
              <div>
                <p className="text-sm text-muted-foreground">Total Actual</p>
                <p className="text-lg font-bold">${totalActualCosts.toLocaleString()}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              {budgetVariance <= 0 ? (
                <TrendingDown className="h-4 w-4 text-success" />
              ) : (
                <TrendingUp className="h-4 w-4 text-destructive" />
              )}
              <div>
                <p className="text-sm text-muted-foreground">Variance</p>
                <p className={`text-lg font-bold ${budgetVariance <= 0 ? 'text-success' : 'text-destructive'}`}>
                  {budgetVariance >= 0 ? '+' : ''}${budgetVariance.toLocaleString()}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Budget Items Table */}
      <Card>
        <CardHeader>
          <CardTitle>Budget Items</CardTitle>
        </CardHeader>
        <CardContent>
          {budgetItems.length > 0 ? (
            <div className="space-y-3">
              {budgetItems.map((item) => (
                <div key={item.id} className="p-4 bg-muted/30 rounded-lg">
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <h4 className="font-medium">{item.item_name}</h4>
                      <p className="text-sm text-muted-foreground">
                        {item.category} • {item.vendor_name}
                      </p>
                      {item.description && (
                        <p className="text-sm text-muted-foreground mt-1">{item.description}</p>
                      )}
                    </div>
                    {Math.abs(item.variance_percent) > 10 && (
                      <Badge variant={item.variance_amount > 0 ? "destructive" : "default"}>
                        {item.variance_percent > 0 ? '+' : ''}{item.variance_percent.toFixed(1)}% variance
                      </Badge>
                    )}
                  </div>
                  <div className="grid grid-cols-4 gap-4 text-sm">
                    <div>
                      <p className="text-muted-foreground">Budgeted</p>
                      <p className="font-medium">${item.budgeted_total_cost.toLocaleString()}</p>
                      <p className="text-xs text-muted-foreground">
                        {item.budgeted_quantity} × ${item.budgeted_unit_cost}
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Actual</p>
                      <p className="font-medium">${item.actual_total_cost.toLocaleString()}</p>
                      <p className="text-xs text-muted-foreground">
                        {item.actual_quantity} × ${item.actual_unit_cost}
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Variance</p>
                      <p className={`font-medium ${item.variance_amount >= 0 ? 'text-destructive' : 'text-success'}`}>
                        {item.variance_amount >= 0 ? '+' : ''}${item.variance_amount.toLocaleString()}
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Progress</p>
                      <Progress 
                        value={item.budgeted_total_cost > 0 ? (item.actual_total_cost / item.budgeted_total_cost) * 100 : 0} 
                        className="mt-1"
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <Target className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p>No budget items added yet</p>
              <p className="text-sm">Click "Add Budget Item" to start tracking your project budget</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};