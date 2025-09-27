import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { Calculator, Plus, Trash2, FileText, DollarSign } from 'lucide-react';
import { Separator } from '@/components/ui/separator';
import { ProfitBreakdownDisplay } from './ProfitBreakdownDisplay';

interface LineItem {
  item_category: string;
  item_name: string;
  description: string;
  quantity: number;
  unit_cost: number;
  unit_type: string;
  markup_percent: number;
}

interface EnhancedEstimateBuilderProps {
  pipelineEntryId?: string;
  contactId?: string;
  onEstimateCreated?: (estimate: any) => void;
}

export const EnhancedEstimateBuilder: React.FC<EnhancedEstimateBuilderProps> = ({
  pipelineEntryId,
  contactId,
  onEstimateCreated
}) => {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [calculating, setCalculating] = useState(false);
  const [templates, setTemplates] = useState([]);
  const [salesReps, setSalesReps] = useState([]);
  const [selectedSalesRep, setSelectedSalesRep] = useState<any>(null);
  
  const [propertyDetails, setPropertyDetails] = useState({
    roof_area_sq_ft: 0,
    roof_type: 'asphalt_shingle',
    complexity_level: 'moderate',
    roof_pitch: '4/12',
    customer_name: '',
    customer_address: '',
    season: 'spring',
    location_zone: 'standard'
  });

  const [lineItems, setLineItems] = useState<LineItem[]>([
    {
      item_category: 'material',
      item_name: 'Asphalt Shingles',
      description: 'Architectural shingles',
      quantity: 1,
      unit_cost: 150,
      unit_type: 'square',
      markup_percent: 25
    }
  ]);

  const [overrides, setOverrides] = useState({
    overhead_percent: 20,
    target_profit_percent: 30,
    sales_rep_commission_percent: 5
  });

  const [templateId, setTemplateId] = useState('');
  const [salesRepId, setSalesRepId] = useState('');
  const [calculationResults, setCalculationResults] = useState<any>(null);

  useEffect(() => {
    loadTemplates();
    loadSalesReps();
  }, []);

  const loadTemplates = async () => {
    try {
      const { data, error } = await supabase
        .from('estimate_calculation_templates')
        .select('*')
        .eq('is_active', true)
        .order('name');

      if (error) throw error;
      setTemplates(data || []);
    } catch (error: any) {
      console.error('Error loading templates:', error);
    }
  };

  const loadSalesReps = async () => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, first_name, last_name, overhead_rate, commission_structure, commission_rate')
        .in('role', ['admin', 'manager'])  // Include both sales reps and managers
        .eq('is_active', true)
        .order('first_name');

      if (error) throw error;
      setSalesReps(data || []);
    } catch (error: any) {
      console.error('Error loading sales reps:', error);
    }
  };

  const addLineItem = () => {
    setLineItems(prev => [
      ...prev,
      {
        item_category: 'material',
        item_name: '',
        description: '',
        quantity: 1,
        unit_cost: 0,
        unit_type: 'each',
        markup_percent: 25
      }
    ]);
  };

  const removeLineItem = (index: number) => {
    setLineItems(prev => prev.filter((_, i) => i !== index));
  };

  const updateLineItem = (index: number, field: keyof LineItem, value: any) => {
    setLineItems(prev => prev.map((item, i) => 
      i === index ? { ...item, [field]: value } : item
    ));
  };

  const calculateEstimate = async () => {
    if (!propertyDetails.roof_area_sq_ft || propertyDetails.roof_area_sq_ft <= 0) {
      toast({
        title: "Validation Error",
        description: "Please enter a valid roof area",
        variant: "destructive",
      });
      return;
    }

    if (!propertyDetails.customer_name.trim()) {
      toast({
        title: "Validation Error",
        description: "Please enter customer name",
        variant: "destructive",
      });
      return;
    }

    setCalculating(true);
    try {
      const { data, error } = await supabase.functions.invoke('enhanced-estimate-calculator', {
        body: {
          pipeline_entry_id: pipelineEntryId,
          template_id: templateId || null,
          property_details: propertyDetails,
          line_items: lineItems.filter(item => item.item_name.trim()),
          sales_rep_id: salesRepId || null,
          override_percentages: overrides
        }
      });

      if (error) throw error;

      setCalculationResults(data.calculations);
      onEstimateCreated?.(data.estimate);

      toast({
        title: "Estimate Created",
        description: `Enhanced estimate ${data.estimate.estimate_number} created successfully`,
      });

    } catch (error: any) {
      console.error('Error calculating estimate:', error);
      toast({
        title: "Calculation Error",
        description: error.message || 'Failed to calculate estimate',
        variant: "destructive",
      });
    } finally {
      setCalculating(false);
    }
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(amount);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calculator className="h-5 w-5" />
            Enhanced Estimate Builder
          </CardTitle>
        </CardHeader>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left Column - Input Forms */}
        <div className="space-y-6">
          {/* Property Details */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Property Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="customer_name">Customer Name</Label>
                  <Input
                    id="customer_name"
                    value={propertyDetails.customer_name}
                    onChange={(e) => setPropertyDetails(prev => ({ ...prev, customer_name: e.target.value }))}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="roof_area">Roof Area (sq ft)</Label>
                  <Input
                    id="roof_area"
                    type="number"
                    value={propertyDetails.roof_area_sq_ft}
                    onChange={(e) => setPropertyDetails(prev => ({ ...prev, roof_area_sq_ft: parseFloat(e.target.value) || 0 }))}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="customer_address">Customer Address</Label>
                <Textarea
                  id="customer_address"
                  value={propertyDetails.customer_address}
                  onChange={(e) => setPropertyDetails(prev => ({ ...prev, customer_address: e.target.value }))}
                  rows={2}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="roof_type">Roof Type</Label>
                  <Select
                    value={propertyDetails.roof_type}
                    onValueChange={(value) => setPropertyDetails(prev => ({ ...prev, roof_type: value }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="asphalt_shingle">Asphalt Shingle</SelectItem>
                      <SelectItem value="metal">Metal</SelectItem>
                      <SelectItem value="tile">Tile</SelectItem>
                      <SelectItem value="slate">Slate</SelectItem>
                      <SelectItem value="flat">Flat</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="complexity">Complexity Level</Label>
                  <Select
                    value={propertyDetails.complexity_level}
                    onValueChange={(value) => setPropertyDetails(prev => ({ ...prev, complexity_level: value }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="simple">Simple</SelectItem>
                      <SelectItem value="moderate">Moderate</SelectItem>
                      <SelectItem value="complex">Complex</SelectItem>
                      <SelectItem value="extreme">Extreme</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="roof_pitch">Roof Pitch</Label>
                  <Select
                    value={propertyDetails.roof_pitch}
                    onValueChange={(value) => setPropertyDetails(prev => ({ ...prev, roof_pitch: value }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="2/12">2/12</SelectItem>
                      <SelectItem value="4/12">4/12</SelectItem>
                      <SelectItem value="6/12">6/12</SelectItem>
                      <SelectItem value="8/12">8/12</SelectItem>
                      <SelectItem value="10/12">10/12</SelectItem>
                      <SelectItem value="12/12">12/12</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="season">Season</Label>
                  <Select
                    value={propertyDetails.season}
                    onValueChange={(value) => setPropertyDetails(prev => ({ ...prev, season: value }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="spring">Spring</SelectItem>
                      <SelectItem value="summer">Summer</SelectItem>
                      <SelectItem value="fall">Fall</SelectItem>
                      <SelectItem value="winter">Winter</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="location_zone">Location Zone</Label>
                  <Select
                    value={propertyDetails.location_zone}
                    onValueChange={(value) => setPropertyDetails(prev => ({ ...prev, location_zone: value }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="standard">Standard</SelectItem>
                      <SelectItem value="premium">Premium</SelectItem>
                      <SelectItem value="rural">Rural</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Line Items */}
          <Card>
            <CardHeader>
              <div className="flex justify-between items-center">
                <CardTitle className="text-lg">Line Items</CardTitle>
                <Button onClick={addLineItem} size="sm" variant="outline">
                  <Plus className="h-4 w-4 mr-2" />
                  Add Item
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {lineItems.map((item, index) => (
                <div key={index} className="border rounded-lg p-4 space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-medium">Item {index + 1}</span>
                    {lineItems.length > 1 && (
                      <Button
                        onClick={() => removeLineItem(index)}
                        size="sm"
                        variant="ghost"
                        className="text-red-500 hover:text-red-700"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                  
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <Label>Category</Label>
                      <Select
                        value={item.item_category}
                        onValueChange={(value) => updateLineItem(index, 'item_category', value)}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="material">Material</SelectItem>
                          <SelectItem value="labor">Labor</SelectItem>
                          <SelectItem value="equipment">Equipment</SelectItem>
                          <SelectItem value="other">Other</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Item Name</Label>
                      <Input
                        value={item.item_name}
                        onChange={(e) => updateLineItem(index, 'item_name', e.target.value)}
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label>Description</Label>
                    <Input
                      value={item.description}
                      onChange={(e) => updateLineItem(index, 'description', e.target.value)}
                    />
                  </div>

                  <div className="grid grid-cols-4 gap-3">
                    <div className="space-y-2">
                      <Label>Quantity</Label>
                      <Input
                        type="number"
                        value={item.quantity}
                        onChange={(e) => updateLineItem(index, 'quantity', parseFloat(e.target.value) || 0)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Unit Cost</Label>
                      <Input
                        type="number"
                        value={item.unit_cost}
                        onChange={(e) => updateLineItem(index, 'unit_cost', parseFloat(e.target.value) || 0)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Unit Type</Label>
                      <Select
                        value={item.unit_type}
                        onValueChange={(value) => updateLineItem(index, 'unit_type', value)}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="each">Each</SelectItem>
                          <SelectItem value="square">Square</SelectItem>
                          <SelectItem value="linear_ft">Linear Ft</SelectItem>
                          <SelectItem value="hour">Hour</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Markup %</Label>
                      <Input
                        type="number"
                        value={item.markup_percent}
                        onChange={(e) => updateLineItem(index, 'markup_percent', parseFloat(e.target.value) || 0)}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        {/* Right Column - Configuration & Results */}
        <div className="space-y-6">
          {/* Configuration */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Configuration</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="template">Template</Label>
                <Select value={templateId} onValueChange={setTemplateId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select template (optional)" />
                  </SelectTrigger>
                  <SelectContent>
                    {templates.map((template: any) => (
                      <SelectItem key={template.id} value={template.id}>
                        {template.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="sales_rep">Sales Representative</Label>
                <Select value={salesRepId} onValueChange={(value) => {
                  setSalesRepId(value);
                  const rep = salesReps.find((r: any) => r.id === value);
                  setSelectedSalesRep(rep);
                }}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select sales rep (optional)" />
                  </SelectTrigger>
                  <SelectContent>
                    {salesReps.map((rep: any) => (
                      <SelectItem key={rep.id} value={rep.id}>
                        {rep.first_name} {rep.last_name}
                        {rep.commission_structure && (
                          <span className="text-xs text-muted-foreground ml-2">
                            ({rep.commission_structure === 'profit_split' ? 'Profit Split' : 'Sales %'} - {rep.commission_rate}%)
                          </span>
                        )}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <Separator />

              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>Overhead %</Label>
                  <Input
                    type="number"
                    value={overrides.overhead_percent}
                    onChange={(e) => setOverrides(prev => ({ ...prev, overhead_percent: parseFloat(e.target.value) || 0 }))}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Profit %</Label>
                  <Input
                    type="number"
                    value={overrides.target_profit_percent}
                    onChange={(e) => setOverrides(prev => ({ ...prev, target_profit_percent: parseFloat(e.target.value) || 0 }))}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Commission %</Label>
                  <Input
                    type="number"
                    value={overrides.sales_rep_commission_percent}
                    onChange={(e) => setOverrides(prev => ({ ...prev, sales_rep_commission_percent: parseFloat(e.target.value) || 0 }))}
                  />
                </div>
              </div>

              <Button 
                onClick={calculateEstimate} 
                disabled={calculating}
                className="w-full bg-primary hover:bg-primary/90"
              >
                {calculating ? 'Calculating...' : 'Calculate Estimate'}
              </Button>
            </CardContent>
          </Card>

          {/* Results */}
          {calculationResults && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <DollarSign className="h-5 w-5" />
                  Calculation Results
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-muted-foreground">Material Total:</span>
                    <p className="font-medium">{formatCurrency(calculationResults.material_total)}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Labor Total:</span>
                    <p className="font-medium">{formatCurrency(calculationResults.labor_total)}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Subtotal:</span>
                    <p className="font-medium">{formatCurrency(calculationResults.subtotal)}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Overhead:</span>
                    <p className="font-medium">{formatCurrency(calculationResults.overhead_amount)}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Commission:</span>
                    <p className="font-medium">{formatCurrency(calculationResults.sales_rep_commission_amount)}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Profit:</span>
                    <p className="font-medium">{formatCurrency(calculationResults.target_profit_amount)}</p>
                  </div>
                </div>

                <Separator />

                <div className="text-center">
                  <div className="text-2xl font-bold text-primary">
                    {formatCurrency(calculationResults.selling_price)}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {formatCurrency(calculationResults.price_per_sq_ft)}/sq ft
                  </div>
                </div>

                <div className="text-xs text-muted-foreground">
                  <p>Profit Margin: {calculationResults.actual_profit_percent?.toFixed(1)}%</p>
                  <p>Labor Hours: {calculationResults.labor_hours?.toFixed(1)}</p>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
};