import React, { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Database } from "@/integrations/supabase/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Calculator, FileText, Plus, Trash2, Edit, DollarSign } from "lucide-react";
import { toast } from "sonner";

interface EstimateTemplate {
  id: string;
  name: string;
  roof_type: string;
  template_data: any;
  is_active: boolean;
  created_at: string;
}

interface LineItem {
  id: string;
  description: string;
  quantity: number;
  unit: string;
  material_cost: number;
  labor_cost: number;
  total_cost: number;
}

interface EstimateCalculation {
  roof_area: number;
  pitch: string;
  material_type: string;
  labor_hours: number;
  material_cost_per_sq: number;
  labor_rate_per_hour: number;
  overhead_percent: number;
  target_profit_percent: number;
}

export const EstimateBuilder = () => {
  const [templates, setTemplates] = useState<EstimateTemplate[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<EstimateTemplate | null>(null);
  const [loading, setLoading] = useState(false);
  const [showNewTemplate, setShowNewTemplate] = useState(false);
  const [showCalculator, setShowCalculator] = useState(false);
  
  // Template form state
  const [templateName, setTemplateName] = useState("");
  const [roofType, setRoofType] = useState("");
  const [lineItems, setLineItems] = useState<LineItem[]>([]);
  
  // Calculator state
  const [calculation, setCalculation] = useState<EstimateCalculation>({
    roof_area: 0,
    pitch: "4/12",
    material_type: "Asphalt Shingles",
    labor_hours: 0,
    material_cost_per_sq: 0,
    labor_rate_per_hour: 50,
    overhead_percent: 20,
    target_profit_percent: 30
  });
  
  const [calculatedEstimate, setCalculatedEstimate] = useState<any>(null);

  useEffect(() => {
    fetchTemplates();
  }, []);

  const fetchTemplates = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from("estimate_templates")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;
      setTemplates(data || []);
    } catch (error) {
      console.error("Error fetching templates:", error);
      toast.error("Failed to load estimate templates");
    } finally {
      setLoading(false);
    }
  };

  const calculateEstimate = () => {
    const materialCost = calculation.roof_area * calculation.material_cost_per_sq;
    const laborCost = calculation.labor_hours * calculation.labor_rate_per_hour;
    const subtotal = materialCost + laborCost;
    const overheadAmount = subtotal * (calculation.overhead_percent / 100);
    const totalCost = subtotal + overheadAmount;
    const profitAmount = totalCost * (calculation.target_profit_percent / 100);
    const sellingPrice = totalCost + profitAmount;
    const actualMargin = (profitAmount / sellingPrice) * 100;

    const estimate = {
      roof_area: calculation.roof_area,
      pitch: calculation.pitch,
      material_type: calculation.material_type,
      labor_hours: calculation.labor_hours,
      material_cost: materialCost,
      labor_cost: laborCost,
      subtotal: subtotal,
      overhead_percent: calculation.overhead_percent,
      overhead_amount: overheadAmount,
      total_cost: totalCost,
      target_profit_percent: calculation.target_profit_percent,
      profit_amount: profitAmount,
      selling_price: sellingPrice,
      actual_margin_percent: actualMargin
    };

    setCalculatedEstimate(estimate);
    toast.success("Estimate calculated successfully!");
  };

  const addLineItem = () => {
    const newItem: LineItem = {
      id: Date.now().toString(),
      description: "",
      quantity: 1,
      unit: "sq",
      material_cost: 0,
      labor_cost: 0,
      total_cost: 0
    };
    setLineItems([...lineItems, newItem]);
  };

  const updateLineItem = (id: string, field: keyof LineItem, value: any) => {
    setLineItems(items => 
      items.map(item => {
        if (item.id === id) {
          const updated = { ...item, [field]: value };
          if (field === 'quantity' || field === 'material_cost' || field === 'labor_cost') {
            updated.total_cost = updated.quantity * (updated.material_cost + updated.labor_cost);
          }
          return updated;
        }
        return item;
      })
    );
  };

  const removeLineItem = (id: string) => {
    setLineItems(items => items.filter(item => item.id !== id));
  };

  const saveTemplate = async () => {
    if (!templateName || !roofType) {
      toast.error("Please fill in template name and roof type");
      return;
    }

    // Validate roof type is one of the allowed enum values
    const validRoofTypes = ["shingle", "metal", "tile", "flat", "slate", "cedar", "other"];
    if (!validRoofTypes.includes(roofType)) {
      toast.error("Please select a valid roof type");
      return;
    }

    try {
      const templateData = {
        line_items: lineItems,
        default_calculations: calculation
      };

      const { error } = await supabase
        .from("estimate_templates")
        .insert({
          name: templateName,
          roof_type: roofType as Database["public"]["Enums"]["roof_type"],
          template_data: templateData as any,
          is_active: true
        });

      if (error) throw error;

      toast.success("Template saved successfully!");
      setShowNewTemplate(false);
      setTemplateName("");
      setRoofType("");
      setLineItems([]);
      fetchTemplates();
    } catch (error) {
      console.error("Error saving template:", error);
      toast.error("Failed to save template");
    }
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2
    }).format(amount);
  };

  return (
    <div className="space-y-6">
      {/* Header with Actions */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Estimate Builder</h2>
          <p className="text-muted-foreground">
            Manage estimate templates and create accurate calculations
          </p>
        </div>
        <div className="flex gap-3">
          <Dialog open={showCalculator} onOpenChange={setShowCalculator}>
            <DialogTrigger asChild>
              <Button className="flex items-center gap-2">
                <Calculator className="h-4 w-4" />
                Quick Calculator
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Estimate Calculator</DialogTitle>
              </DialogHeader>
              <div className="space-y-6">
                {/* Calculator Form */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-4">
                    <div>
                      <Label htmlFor="roof_area">Roof Area (sq ft)</Label>
                      <Input
                        id="roof_area"
                        type="number"
                        value={calculation.roof_area}
                        onChange={(e) => setCalculation({...calculation, roof_area: parseFloat(e.target.value) || 0})}
                      />
                    </div>
                    
                    <div>
                      <Label htmlFor="pitch">Roof Pitch</Label>
                      <Select value={calculation.pitch} onValueChange={(value) => setCalculation({...calculation, pitch: value})}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="3/12">3/12</SelectItem>
                          <SelectItem value="4/12">4/12</SelectItem>
                          <SelectItem value="5/12">5/12</SelectItem>
                          <SelectItem value="6/12">6/12</SelectItem>
                          <SelectItem value="8/12">8/12</SelectItem>
                          <SelectItem value="10/12">10/12</SelectItem>
                          <SelectItem value="12/12">12/12</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div>
                      <Label htmlFor="material_type">Material Type</Label>
                      <Select value={calculation.material_type} onValueChange={(value) => setCalculation({...calculation, material_type: value})}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Asphalt Shingles">Asphalt Shingles</SelectItem>
                          <SelectItem value="Metal Roofing">Metal Roofing</SelectItem>
                          <SelectItem value="Tile Roofing">Tile Roofing</SelectItem>
                          <SelectItem value="Slate">Slate</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div>
                      <Label htmlFor="labor_hours">Labor Hours</Label>
                      <Input
                        id="labor_hours"
                        type="number"
                        value={calculation.labor_hours}
                        onChange={(e) => setCalculation({...calculation, labor_hours: parseFloat(e.target.value) || 0})}
                      />
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div>
                      <Label htmlFor="material_cost_per_sq">Material Cost per Sq Ft</Label>
                      <Input
                        id="material_cost_per_sq"
                        type="number"
                        step="0.01"
                        value={calculation.material_cost_per_sq}
                        onChange={(e) => setCalculation({...calculation, material_cost_per_sq: parseFloat(e.target.value) || 0})}
                      />
                    </div>

                    <div>
                      <Label htmlFor="labor_rate">Labor Rate per Hour</Label>
                      <Input
                        id="labor_rate"
                        type="number"
                        step="0.01"
                        value={calculation.labor_rate_per_hour}
                        onChange={(e) => setCalculation({...calculation, labor_rate_per_hour: parseFloat(e.target.value) || 0})}
                      />
                    </div>

                    <div>
                      <Label htmlFor="overhead_percent">Overhead Percentage</Label>
                      <Input
                        id="overhead_percent"
                        type="number"
                        step="0.1"
                        value={calculation.overhead_percent}
                        onChange={(e) => setCalculation({...calculation, overhead_percent: parseFloat(e.target.value) || 0})}
                      />
                    </div>

                    <div>
                      <Label htmlFor="target_profit_percent">Target Profit Percentage (Default: 30%)</Label>
                      <Input
                        id="target_profit_percent"
                        type="number"
                        step="0.1"
                        value={calculation.target_profit_percent}
                        onChange={(e) => setCalculation({...calculation, target_profit_percent: parseFloat(e.target.value) || 0})}
                      />
                    </div>
                  </div>
                </div>

                <Button onClick={calculateEstimate} className="w-full">
                  <Calculator className="h-4 w-4 mr-2" />
                  Calculate Estimate
                </Button>

                {/* Results */}
                {calculatedEstimate && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <DollarSign className="h-5 w-5 text-success" />
                        Estimate Results
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div className="text-center">
                          <p className="text-sm text-muted-foreground">Material Cost</p>
                          <p className="text-lg font-semibold">{formatCurrency(calculatedEstimate.material_cost)}</p>
                        </div>
                        <div className="text-center">
                          <p className="text-sm text-muted-foreground">Labor Cost</p>
                          <p className="text-lg font-semibold">{formatCurrency(calculatedEstimate.labor_cost)}</p>
                        </div>
                        <div className="text-center">
                          <p className="text-sm text-muted-foreground">Overhead ({calculatedEstimate.overhead_percent}%)</p>
                          <p className="text-lg font-semibold">{formatCurrency(calculatedEstimate.overhead_amount)}</p>
                        </div>
                        <div className="text-center">
                          <p className="text-sm text-muted-foreground">Profit ({calculatedEstimate.target_profit_percent}%)</p>
                          <p className="text-lg font-semibold text-success">{formatCurrency(calculatedEstimate.profit_amount)}</p>
                        </div>
                      </div>
                      <Separator />
                      <div className="text-center">
                        <p className="text-sm text-muted-foreground">Total Selling Price</p>
                        <p className="text-3xl font-bold text-primary">{formatCurrency(calculatedEstimate.selling_price)}</p>
                        <p className="text-sm text-muted-foreground">
                          Actual Margin: {calculatedEstimate.actual_margin_percent.toFixed(1)}%
                        </p>
                      </div>
                    </CardContent>
                  </Card>
                )}
              </div>
            </DialogContent>
          </Dialog>

          <Dialog open={showNewTemplate} onOpenChange={setShowNewTemplate}>
            <DialogTrigger asChild>
              <Button variant="outline" className="flex items-center gap-2">
                <Plus className="h-4 w-4" />
                New Template
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Create New Estimate Template</DialogTitle>
              </DialogHeader>
              <div className="space-y-6">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="template_name">Template Name</Label>
                    <Input
                      id="template_name"
                      value={templateName}
                      onChange={(e) => setTemplateName(e.target.value)}
                      placeholder="e.g., Standard Shingle Replacement"
                    />
                  </div>
                  <div>
                    <Label htmlFor="roof_type">Roof Type</Label>
                    <Select value={roofType} onValueChange={setRoofType}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select roof type" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="shingle">Shingle</SelectItem>
                        <SelectItem value="metal">Metal</SelectItem>
                        <SelectItem value="tile">Tile</SelectItem>
                        <SelectItem value="flat">Flat</SelectItem>
                        <SelectItem value="slate">Slate</SelectItem>
                        <SelectItem value="cedar">Cedar</SelectItem>
                        <SelectItem value="other">Other</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold">Line Items</h3>
                    <Button onClick={addLineItem} size="sm">
                      <Plus className="h-4 w-4 mr-2" />
                      Add Item
                    </Button>
                  </div>

                  <div className="space-y-3">
                    {lineItems.map((item) => (
                      <div key={item.id} className="grid grid-cols-12 gap-2 items-end">
                        <div className="col-span-4">
                          <Label>Description</Label>
                          <Input
                            value={item.description}
                            onChange={(e) => updateLineItem(item.id, 'description', e.target.value)}
                            placeholder="Item description"
                          />
                        </div>
                        <div className="col-span-1">
                          <Label>Qty</Label>
                          <Input
                            type="number"
                            value={item.quantity}
                            onChange={(e) => updateLineItem(item.id, 'quantity', parseFloat(e.target.value) || 0)}
                          />
                        </div>
                        <div className="col-span-1">
                          <Label>Unit</Label>
                          <Input
                            value={item.unit}
                            onChange={(e) => updateLineItem(item.id, 'unit', e.target.value)}
                            placeholder="sq"
                          />
                        </div>
                        <div className="col-span-2">
                          <Label>Material Cost</Label>
                          <Input
                            type="number"
                            step="0.01"
                            value={item.material_cost}
                            onChange={(e) => updateLineItem(item.id, 'material_cost', parseFloat(e.target.value) || 0)}
                          />
                        </div>
                        <div className="col-span-2">
                          <Label>Labor Cost</Label>
                          <Input
                            type="number"
                            step="0.01"
                            value={item.labor_cost}
                            onChange={(e) => updateLineItem(item.id, 'labor_cost', parseFloat(e.target.value) || 0)}
                          />
                        </div>
                        <div className="col-span-1">
                          <Label>Total</Label>
                          <div className="text-sm font-medium py-2">
                            {formatCurrency(item.total_cost)}
                          </div>
                        </div>
                        <div className="col-span-1">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => removeLineItem(item.id)}
                            className="text-destructive hover:text-destructive"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex justify-end gap-3">
                  <Button variant="outline" onClick={() => setShowNewTemplate(false)}>
                    Cancel
                  </Button>
                  <Button onClick={saveTemplate}>
                    Save Template
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Templates List */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-primary" />
            Estimate Templates
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-center py-8 text-muted-foreground">
              Loading templates...
            </div>
          ) : templates.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No templates found. Create your first estimate template to get started.
            </div>
          ) : (
            <div className="space-y-3">
              {templates.map((template) => (
                <div key={template.id} className="flex items-center justify-between p-4 rounded-lg border bg-card hover:bg-accent/50 transition-colors">
                  <div className="flex-1">
                    <div className="flex items-center gap-3">
                      <h4 className="font-semibold">{template.name}</h4>
                      <Badge variant="secondary">{template.roof_type}</Badge>
                      {template.is_active && (
                        <Badge variant="default">Active</Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Created: {new Date(template.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm">
                      <Edit className="h-4 w-4 mr-2" />
                      Edit
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};