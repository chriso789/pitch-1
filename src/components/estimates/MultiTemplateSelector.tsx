import React, { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Loader2, Package, Hammer, DollarSign } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

const supabaseClient = supabase as any;

interface Template {
  id: string;
  name: string;
  labor: Record<string, any>;
  overhead: Record<string, any>;
  currency: string;
}

interface TemplateCalculation {
  template_id: string;
  template_name: string;
  materials: number;
  labor: number;
  overhead: number;
  cost_pre_profit: number;
  sale_price: number;
  profit: number;
}

interface MultiTemplateSelectorProps {
  pipelineEntryId: string;
  onCalculationsUpdate?: (calculations: TemplateCalculation[]) => void;
}

export const MultiTemplateSelector: React.FC<MultiTemplateSelectorProps> = ({
  pipelineEntryId,
  onCalculationsUpdate
}) => {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selectedTemplateIds, setSelectedTemplateIds] = useState<string[]>([]);
  const [calculations, setCalculations] = useState<TemplateCalculation[]>([]);
  const [loading, setLoading] = useState(true);
  const [calculating, setCalculating] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    fetchTemplates();
    loadSelectedTemplates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (selectedTemplateIds.length > 0) {
      calculateAllTemplates();
    } else {
      setCalculations([]);
      if (onCalculationsUpdate) {
        onCalculationsUpdate([]);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTemplateIds.join(',')]);

  const fetchTemplates = async (): Promise<void> => {
    try {
      const result = await supabaseClient.from('estimate_calculation_templates').select('*').eq('is_active', true);

      if (result.error) throw result.error;
      
      const templatesData = (result.data || []).map((t: any) => ({
        id: t.id,
        name: t.name,
        labor: t.labor || {},
        overhead: t.overhead || {},
        currency: t.currency || 'USD'
      }));
      
      // Sort in-memory instead
      templatesData.sort((a, b) => a.name.localeCompare(b.name));
      setTemplates(templatesData);
    } catch (error) {
      console.error('Error fetching templates:', error);
      toast({
        title: 'Error',
        description: 'Failed to load estimate templates',
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  const loadSelectedTemplates = async (): Promise<void> => {
    try {
      const result = await supabaseClient.from('pipeline_entries').select('metadata').eq('id', pipelineEntryId).single();

      if (result.error) throw result.error;

      const metadata = result.data?.metadata as any;
      const selected = metadata?.selected_template_ids || [];
      setSelectedTemplateIds(selected);
    } catch (error) {
      console.error('Error loading selected templates:', error);
    }
  };

  const saveSelectedTemplates = async (templateIds: string[]): Promise<void> => {
    try {
      const result1 = await supabaseClient.from('pipeline_entries').select('metadata').eq('id', pipelineEntryId).single();

      if (result1.error) throw result1.error;

      const currentMetadata = (result1.data?.metadata as any) || {};
      const updatedMetadata = {
        ...currentMetadata,
        selected_template_ids: templateIds
      };

      const result2 = await supabaseClient.from('pipeline_entries').update({ metadata: updatedMetadata }).eq('id', pipelineEntryId);

      if (result2.error) throw result2.error;
    } catch (error) {
      console.error('Error saving selected templates:', error);
      toast({
        title: 'Error',
        description: 'Failed to save template selection',
        variant: 'destructive'
      });
    }
  };

  const calculateAllTemplates = async (): Promise<void> => {
    setCalculating(true);
    const results: TemplateCalculation[] = [];

    try {
      for (const templateId of selectedTemplateIds) {
        const template = templates.find(t => t.id === templateId);
        if (!template) continue;

        const response = await supabaseClient.rpc('api_estimate_compute_pricing', {
          p_estimate_id: pipelineEntryId,
          p_mode: 'margin',
          p_pct: 0.30,
          p_currency: template.currency || 'USD'
        });

        if (response.error) {
          console.error('Error calculating template:', response.error);
          continue;
        }

        const data = response.data as any;
        if (data && Array.isArray(data) && data.length > 0) {
          const calc = data[0];
          results.push({
            template_id: templateId,
            template_name: template.name,
            materials: Number(calc.materials) || 0,
            labor: Number(calc.labor) || 0,
            overhead: Number(calc.overhead) || 0,
            cost_pre_profit: Number(calc.cost_pre_profit) || 0,
            sale_price: Number(calc.sale_price) || 0,
            profit: Number(calc.profit) || 0
          });
        }
      }

      setCalculations(results);
      if (onCalculationsUpdate) {
        onCalculationsUpdate(results);
      }
    } catch (error) {
      console.error('Error calculating templates:', error);
      toast({
        title: 'Calculation Error',
        description: 'Failed to calculate some templates',
        variant: 'destructive'
      });
    } finally {
      setCalculating(false);
    }
  };

  const handleTemplateToggle = (templateId: string, checked: boolean) => {
    const newSelected = checked
      ? [...selectedTemplateIds, templateId]
      : selectedTemplateIds.filter(id => id !== templateId);

    setSelectedTemplateIds(newSelected);
    saveSelectedTemplates(newSelected);
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(amount);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Template Selection */}
      <Card>
        <CardHeader>
          <CardTitle>Select Estimate Templates</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {templates.map((template) => (
              <div
                key={template.id}
                className="flex items-center space-x-3 p-3 rounded-lg border border-border hover:bg-accent/50 transition-colors"
              >
                <Checkbox
                  id={template.id}
                  checked={selectedTemplateIds.includes(template.id)}
                  onCheckedChange={(checked) => handleTemplateToggle(template.id, checked as boolean)}
                />
                <label
                  htmlFor={template.id}
                  className="flex-1 text-sm font-medium cursor-pointer"
                >
                  {template.name}
                </label>
                {selectedTemplateIds.includes(template.id) && (
                  <Badge variant="default">Selected</Badge>
                )}
              </div>
            ))}
            {templates.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">
                No estimate templates available. Create one in settings.
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Budget Calculator Lines */}
      {calculating && (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground mr-2" />
          <span className="text-sm text-muted-foreground">Calculating estimates...</span>
        </div>
      )}

      {!calculating && calculations.length > 0 && (
        <div className="space-y-4">
          {calculations.map((calc) => (
            <Card key={calc.template_id}>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg">{calc.template_name}</CardTitle>
                  <Badge variant="outline" className="text-lg font-semibold">
                    {formatCurrency(calc.sale_price)}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-3 gap-4">
                  <div className="flex items-center space-x-2">
                    <Package className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <p className="text-xs text-muted-foreground">Materials</p>
                      <p className="text-sm font-semibold">{formatCurrency(calc.materials)}</p>
                    </div>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Hammer className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <p className="text-xs text-muted-foreground">Labor</p>
                      <p className="text-sm font-semibold">{formatCurrency(calc.labor)}</p>
                    </div>
                  </div>
                  <div className="flex items-center space-x-2">
                    <DollarSign className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <p className="text-xs text-muted-foreground">Profit</p>
                      <p className="text-sm font-semibold text-success">{formatCurrency(calc.profit)}</p>
                    </div>
                  </div>
                </div>
                <div className="mt-3 pt-3 border-t border-border">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Total Cost</span>
                    <span className="font-medium">{formatCurrency(calc.cost_pre_profit)}</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};
