import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { 
  Calculator, 
  Package, 
  TrendingUp, 
  ShoppingCart,
  AlertCircle 
} from 'lucide-react';
import {
  calculateMaterials,
  getAvailableBrands,
  type RoofMeasurementData,
  type MaterialCalculationOptions,
  type MaterialCalculationResult,
} from '@/lib/measurements/materialCalculations';
import { useToast } from '@/hooks/use-toast';
import { useMaterialOrders } from '@/hooks/useMaterialOrders';
import { supabase } from '@/integrations/supabase/client';

interface MaterialCalculatorProps {
  measurementData: RoofMeasurementData;
  pipelineEntryId?: string;
  onOrderCreated?: (orderId: string) => void;
}

export const MaterialCalculator: React.FC<MaterialCalculatorProps> = ({
  measurementData,
  pipelineEntryId,
  onOrderCreated,
}) => {
  const { toast } = useToast();
  const { createOrderFromEstimate } = useMaterialOrders();
  
  const [wastePercentage, setWastePercentage] = useState(10);
  const [selectedBrands, setSelectedBrands] = useState<MaterialCalculationOptions['selected_brands']>({
    shingles: 'GAF',
    underlayment: 'Top Shield',
    ridge_cap: 'GAF',
    ice_water: 'GAF',
    starter: 'GAF',
  });
  
  const [calculation, setCalculation] = useState<MaterialCalculationResult | null>(null);
  const [isCreatingOrder, setIsCreatingOrder] = useState(false);

  const availableBrands = getAvailableBrands();
  const wasteOptions = [0, 8, 10, 12, 15, 17, 20];

  // Recalculate when inputs change
  useEffect(() => {
    const result = calculateMaterials(measurementData, {
      waste_percentage: wastePercentage,
      selected_brands: selectedBrands,
    });
    setCalculation(result);
  }, [measurementData, wastePercentage, selectedBrands]);

  const handleBrandChange = (category: keyof typeof selectedBrands, brand: string) => {
    setSelectedBrands(prev => ({ ...prev, [category]: brand }));
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(amount);
  };

  const handleCreateOrder = async () => {
    if (!calculation) {
      toast({
        variant: 'destructive',
        title: 'Cannot create order',
        description: 'Missing calculation data',
      });
      return;
    }

    setIsCreatingOrder(true);
    try {
      // Prepare materials for order creation
      const materials = calculation.waste_adjusted_materials.map((item) => ({
        srs_item_code: item.item_code,
        item_description: item.product_name,
        quantity: item.quantity,
        unit_price: item.unit_cost,
        line_total: item.total_cost,
        metadata: {
          category: item.category,
          brand: item.brand,
          unit: item.unit_of_measure,
        },
      }));

      // Call edge function to create order
      const { data, error } = await supabase.functions.invoke('create-material-order', {
        body: {
          pipeline_entry_id: pipelineEntryId,
          vendor_id: 'default-vendor-id', // TODO: Allow vendor selection
          materials,
          notes: 'Order created from material calculator',
        },
      });

      if (error) throw error;

      toast({
        title: 'Order Created',
        description: `Order ${data.po_number} created successfully with ${data.item_count} items`,
      });
      
      if (data.order_id) {
        onOrderCreated?.(data.order_id);
      }
    } catch (error) {
      console.error('Error creating order:', error);
      toast({
        variant: 'destructive',
        title: 'Order creation failed',
        description: error instanceof Error ? error.message : 'Unknown error',
      });
    } finally {
      setIsCreatingOrder(false);
    }
  };

  if (!calculation) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center p-8">
          <AlertCircle className="h-8 w-8 text-muted-foreground mr-2" />
          <p className="text-muted-foreground">No measurement data available</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Configuration Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calculator className="h-5 w-5" />
            Material Calculation Settings
          </CardTitle>
          <CardDescription>
            Configure waste factors and select preferred brands
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Waste Factor */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Waste Factor</label>
            <Select
              value={wastePercentage.toString()}
              onValueChange={(value) => setWastePercentage(parseInt(value))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {wasteOptions.map((pct) => (
                  <SelectItem key={pct} value={pct.toString()}>
                    {pct}% {pct === 10 ? '(Standard)' : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Brand Selection */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Shingles</label>
              <Select
                value={selectedBrands.shingles}
                onValueChange={(value) => handleBrandChange('shingles', value)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(availableBrands['Shingles'] || []).map((brand) => (
                    <SelectItem key={brand} value={brand}>
                      {brand}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Underlayment</label>
              <Select
                value={selectedBrands.underlayment}
                onValueChange={(value) => handleBrandChange('underlayment', value)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(availableBrands['Underlayment'] || []).map((brand) => (
                    <SelectItem key={brand} value={brand}>
                      {brand}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Ridge Cap</label>
              <Select
                value={selectedBrands.ridge_cap}
                onValueChange={(value) => handleBrandChange('ridge_cap', value)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(availableBrands['Hip & Ridge'] || []).map((brand) => (
                    <SelectItem key={brand} value={brand}>
                      {brand}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Ice & Water</label>
              <Select
                value={selectedBrands.ice_water}
                onValueChange={(value) => handleBrandChange('ice_water', value)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(availableBrands['Ice & Water'] || []).map((brand) => (
                    <SelectItem key={brand} value={brand}>
                      {brand}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Starter</label>
              <Select
                value={selectedBrands.starter}
                onValueChange={(value) => handleBrandChange('starter', value)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(availableBrands['Starter'] || []).map((brand) => (
                    <SelectItem key={brand} value={brand}>
                      {brand}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Summary Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            Material Summary
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">Shingle Bundles</p>
              <p className="text-2xl font-bold">{calculation.summary.shingle_bundles}</p>
            </div>
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">Ridge Cap Bundles</p>
              <p className="text-2xl font-bold">{calculation.summary.ridge_cap_bundles}</p>
            </div>
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">Underlayment Rolls</p>
              <p className="text-2xl font-bold">{calculation.summary.underlayment_rolls}</p>
            </div>
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">Ice & Water Rolls</p>
              <p className="text-2xl font-bold">{calculation.summary.ice_water_rolls}</p>
            </div>
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">Starter Bundles</p>
              <p className="text-2xl font-bold">{calculation.summary.starter_bundles}</p>
            </div>
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">Drip Edge Sticks</p>
              <p className="text-2xl font-bold">{calculation.summary.drip_edge_sticks}</p>
            </div>
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">Valley Rolls</p>
              <p className="text-2xl font-bold">{calculation.summary.valley_rolls}</p>
            </div>
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">Flashings</p>
              <p className="text-2xl font-bold">{calculation.summary.penetration_flashings}</p>
            </div>
          </div>

          <div className="mt-6 pt-6 border-t">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total Material Cost</p>
                <p className="text-3xl font-bold">{formatCurrency(calculation.total_waste_adjusted_cost)}</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Includes {wastePercentage}% waste factor
                </p>
              </div>
              <Button
                size="lg"
                onClick={handleCreateOrder}
                disabled={isCreatingOrder}
              >
                <ShoppingCart className="mr-2 h-5 w-5" />
                {isCreatingOrder ? 'Creating...' : 'Create Material Order'}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Detailed Materials Table */}
      <Card>
        <CardHeader>
          <CardTitle>Detailed Material List</CardTitle>
          <CardDescription>
            Complete breakdown with quantities and pricing
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="waste-adjusted">
            <TabsList>
              <TabsTrigger value="base">Base Quantities</TabsTrigger>
              <TabsTrigger value="waste-adjusted">With Waste ({wastePercentage}%)</TabsTrigger>
            </TabsList>
            
            <TabsContent value="base">
              <MaterialTable materials={calculation.base_materials} formatCurrency={formatCurrency} />
            </TabsContent>
            
            <TabsContent value="waste-adjusted">
              <MaterialTable materials={calculation.waste_adjusted_materials} formatCurrency={formatCurrency} />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
};

// Material Table Component
const MaterialTable: React.FC<{ 
  materials: MaterialCalculationResult['base_materials'];
  formatCurrency: (amount: number) => string;
}> = ({ materials, formatCurrency }) => (
  <div className="rounded-md border">
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Category</TableHead>
          <TableHead>Product</TableHead>
          <TableHead>Brand</TableHead>
          <TableHead className="text-right">Quantity</TableHead>
          <TableHead className="text-right">Unit Cost</TableHead>
          <TableHead className="text-right">Total</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {materials.map((material, index) => (
          <TableRow key={index}>
            <TableCell>
              <Badge variant="secondary">{material.category}</Badge>
            </TableCell>
            <TableCell>
              <div>
                <p className="font-medium">{material.product_name}</p>
                <p className="text-xs text-muted-foreground">{material.item_code}</p>
              </div>
            </TableCell>
            <TableCell>{material.brand}</TableCell>
            <TableCell className="text-right">
              {material.quantity} {material.unit_of_measure}
            </TableCell>
            <TableCell className="text-right">
              {formatCurrency(material.unit_cost)}
            </TableCell>
            <TableCell className="text-right font-medium">
              {formatCurrency(material.total_cost)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  </div>
);
