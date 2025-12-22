import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Loader2, Package, Save, CheckCircle } from 'lucide-react';
import { renderTemplate } from '@/lib/estimates/templateEngine';
import { toast } from 'sonner';

interface MeasurementData {
  roof_area_sq_ft?: number;
  ridges_lf?: number;
  hips_lf?: number;
  valleys_lf?: number;
  eaves_lf?: number;
  rakes_lf?: number;
  step_flashing_lf?: number;
  wall_flashing_lf?: number;
  drip_edge_lf?: number;
  pitch?: string;
  facets_count?: number;
}

interface TemplateItem {
  name: string;
  qty: string | number;
  unit?: string;
  unit_cost?: number;
}

interface ProductTemplateApplicatorProps {
  leadId: string;
  measurementData?: MeasurementData;
  onApply?: (templateId: string, calculatedItems: CalculatedItem[]) => void;
}

interface CalculatedItem {
  name: string;
  qty: number;
  unit: string;
  unit_cost: number;
  total: number;
}

// Convert measurement data to smart tags format
function measurementToTags(data: MeasurementData): Record<string, any> {
  const area = data.roof_area_sq_ft || 0;
  const squares = area / 100;
  
  return {
    // Roof measurements
    'roof.area': area,
    'roof.total_sqft': area,
    'roof.squares': squares,
    'roof.facets_count': data.facets_count || 1,
    
    // Linear measurements
    'lf.ridge': data.ridges_lf || 0,
    'lf.hip': data.hips_lf || 0,
    'lf.valley': data.valleys_lf || 0,
    'lf.eave': data.eaves_lf || 0,
    'lf.rake': data.rakes_lf || 0,
    'lf.step_flashing': data.step_flashing_lf || 0,
    'lf.wall_flashing': data.wall_flashing_lf || 0,
    'lf.drip_edge': data.drip_edge_lf || (data.eaves_lf || 0) + (data.rakes_lf || 0),
    'lf.ridge_hip_total': (data.ridges_lf || 0) + (data.hips_lf || 0),
    
    // Calculated bundles (using Roofr standards)
    'bundles.shingles': Math.ceil(squares * 3),
    'bundles.ridge_cap': Math.ceil(((data.ridges_lf || 0) + (data.hips_lf || 0)) / 25),
    'bundles.starter': Math.ceil(((data.eaves_lf || 0) + (data.rakes_lf || 0)) / 100),
    'rolls.underlayment': Math.ceil(area / 1000),
    'rolls.ice_water': Math.ceil(((data.eaves_lf || 0) + (data.valleys_lf || 0)) / 65),
    'sticks.drip_edge': Math.ceil(((data.eaves_lf || 0) + (data.rakes_lf || 0)) / 10),
    
    // Waste adjusted
    'waste.10pct.sqft': area * 1.10,
    'waste.10pct.squares': squares * 1.10,
    'waste.15pct.sqft': area * 1.15,
    'waste.15pct.squares': squares * 1.15,
  };
}

export function ProductTemplateApplicator({ leadId, measurementData, onApply }: ProductTemplateApplicatorProps) {
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [savedTemplateId, setSavedTemplateId] = useState<string | null>(null);

  // Fetch estimate templates
  const { data: templates, isLoading: templatesLoading } = useQuery({
    queryKey: ['estimate-templates-for-materials'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('estimate_templates')
        .select('id, name, template_data')
        .eq('is_active', true)
        .order('name');
      
      if (error) throw error;
      return data || [];
    },
  });

  // Fetch current lead's saved template selection
  const { data: leadData } = useQuery({
    queryKey: ['lead-material-template', leadId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('pipeline_entries')
        .select('metadata')
        .eq('id', leadId)
        .single();
      
      if (error) throw error;
      return data;
    },
  });

  // Set initial template from lead metadata
  useMemo(() => {
    if (leadData?.metadata && typeof leadData.metadata === 'object') {
      const metadata = leadData.metadata as Record<string, unknown>;
      if (metadata.material_template_id && !selectedTemplateId) {
        setSelectedTemplateId(metadata.material_template_id as string);
        setSavedTemplateId(metadata.material_template_id as string);
      }
    }
  }, [leadData, selectedTemplateId]);

  // Get selected template
  const selectedTemplate = templates?.find(t => t.id === selectedTemplateId);

  // Calculate materials from template
  const calculatedItems = useMemo((): CalculatedItem[] => {
    if (!selectedTemplate?.template_data || !measurementData) return [];

    const templateData = selectedTemplate.template_data as { materials?: TemplateItem[] };
    const materials = templateData.materials || [];
    const tags = measurementToTags(measurementData);

    return materials.map(item => {
      let qty = 0;
      
      if (typeof item.qty === 'number') {
        qty = item.qty;
      } else if (typeof item.qty === 'string') {
        // Check if it's a template expression
        if (item.qty.includes('{{')) {
          const rendered = renderTemplate(item.qty, { tags });
          qty = parseFloat(rendered) || 0;
        } else {
          // Try to evaluate as a simple expression referencing tags
          try {
            const result = renderTemplate(`{{ ${item.qty} }}`, { tags });
            qty = parseFloat(result) || 0;
          } catch {
            qty = parseFloat(item.qty) || 0;
          }
        }
      }

      const unitCost = item.unit_cost || 0;

      return {
        name: item.name,
        qty: Math.ceil(qty),
        unit: item.unit || 'ea',
        unit_cost: unitCost,
        total: Math.ceil(qty) * unitCost,
      };
    });
  }, [selectedTemplate, measurementData]);

  // Calculate totals
  const totalMaterialCost = calculatedItems.reduce((sum, item) => sum + item.total, 0);

  // Save template selection to lead
  const handleSaveSelection = async () => {
    if (!selectedTemplateId) return;

    setIsSaving(true);
    try {
      const existingMetadata = (leadData?.metadata as Record<string, unknown>) || {};
      const { error } = await supabase
        .from('pipeline_entries')
        .update({
          metadata: JSON.parse(JSON.stringify({
            ...existingMetadata,
            material_template_id: selectedTemplateId,
            material_calculations: calculatedItems.map(item => ({
              name: item.name,
              qty: item.qty,
              unit: item.unit,
              unit_cost: item.unit_cost,
              total: item.total,
            })),
            material_total_cost: totalMaterialCost,
          })),
        })
        .eq('id', leadId);

      if (error) throw error;

      setSavedTemplateId(selectedTemplateId);
      toast.success('Product template saved');
      onApply?.(selectedTemplateId, calculatedItems);
    } catch (error) {
      console.error('Failed to save template:', error);
      toast.error('Failed to save template selection');
    } finally {
      setIsSaving(false);
    }
  };

  if (templatesLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!measurementData?.roof_area_sq_ft) {
    return (
      <div className="text-center py-12">
        <Package className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
        <p className="text-muted-foreground">Complete measurements first to apply product templates</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Template Selector */}
      <div className="space-y-2">
        <label className="text-sm font-medium">Product Template</label>
        <Select
          value={selectedTemplateId || ''}
          onValueChange={(value) => setSelectedTemplateId(value)}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select a product template..." />
          </SelectTrigger>
          <SelectContent>
            {templates?.map((template) => (
              <SelectItem key={template.id} value={template.id}>
                {template.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Calculated Materials Table */}
      {selectedTemplateId && calculatedItems.length > 0 && (
        <Card>
          <CardContent className="pt-4">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Material</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead>Unit</TableHead>
                  <TableHead className="text-right">Unit Cost</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {calculatedItems.map((item, index) => (
                  <TableRow key={index}>
                    <TableCell className="font-medium">{item.name}</TableCell>
                    <TableCell className="text-right">{item.qty}</TableCell>
                    <TableCell className="text-muted-foreground">{item.unit}</TableCell>
                    <TableCell className="text-right">
                      {item.unit_cost > 0 ? `$${item.unit_cost.toFixed(2)}` : '-'}
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {item.total > 0 ? `$${item.total.toFixed(2)}` : '-'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            {/* Total */}
            {totalMaterialCost > 0 && (
              <div className="mt-4 pt-4 border-t flex justify-between items-center">
                <span className="font-medium">Total Material Cost</span>
                <span className="text-lg font-bold text-primary">
                  ${totalMaterialCost.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                </span>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* No materials in template */}
      {selectedTemplateId && calculatedItems.length === 0 && (
        <div className="text-center py-8 text-muted-foreground">
          <p>This template has no material items defined.</p>
          <p className="text-sm">Edit the template to add materials with quantity formulas.</p>
        </div>
      )}

      {/* Save Button */}
      {selectedTemplateId && (
        <div className="flex justify-end gap-2">
          {savedTemplateId === selectedTemplateId && (
            <span className="flex items-center text-sm text-success">
              <CheckCircle className="h-4 w-4 mr-1" />
              Saved
            </span>
          )}
          <Button
            onClick={handleSaveSelection}
            disabled={isSaving || savedTemplateId === selectedTemplateId}
          >
            {isSaving ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Save className="h-4 w-4 mr-2" />
                Apply Template
              </>
            )}
          </Button>
        </div>
      )}

      {/* Measurement Summary */}
      <div className="text-xs text-muted-foreground border-t pt-4 mt-4">
        <p className="font-medium mb-2">Measurement Data Used:</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <span>Area: {measurementData.roof_area_sq_ft?.toLocaleString()} sq ft</span>
          <span>Ridge: {measurementData.ridges_lf || 0} LF</span>
          <span>Hip: {measurementData.hips_lf || 0} LF</span>
          <span>Valley: {measurementData.valleys_lf || 0} LF</span>
          <span>Eave: {measurementData.eaves_lf || 0} LF</span>
          <span>Rake: {measurementData.rakes_lf || 0} LF</span>
        </div>
      </div>
    </div>
  );
}
