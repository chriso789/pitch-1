import React, { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Package, Hammer, DollarSign, Save, FileText } from 'lucide-react';
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
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const [calculation, setCalculation] = useState<TemplateCalculation | null>(null);
  const [loading, setLoading] = useState(true);
  const [calculating, setCalculating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    fetchTemplates();
    loadSelectedTemplate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (selectedTemplateId) {
      calculateTemplate();
    } else {
      setCalculation(null);
      if (onCalculationsUpdate) {
        onCalculationsUpdate([]);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTemplateId]);

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

  const loadSelectedTemplate = async (): Promise<void> => {
    try {
      const result = await supabaseClient.from('pipeline_entries').select('metadata').eq('id', pipelineEntryId).single();

      if (result.error) throw result.error;

      const metadata = result.data?.metadata as any;
      const selected = metadata?.selected_template_ids?.[0] || metadata?.selected_template_id || '';
      setSelectedTemplateId(selected);
    } catch (error) {
      console.error('Error loading selected template:', error);
    }
  };

  const calculateTemplate = async (): Promise<void> => {
    if (!selectedTemplateId) return;
    
    setCalculating(true);

    try {
      const template = templates.find(t => t.id === selectedTemplateId);
      if (!template) {
        setCalculating(false);
        return;
      }

      const response = await supabaseClient.rpc('api_estimate_compute_pricing', {
        p_estimate_id: pipelineEntryId,
        p_mode: 'margin',
        p_pct: 0.30,
        p_currency: template.currency || 'USD'
      });

      if (response.error) {
        console.error('Error calculating template:', response.error);
        setCalculating(false);
        return;
      }

      const data = response.data as any;
      if (data && Array.isArray(data) && data.length > 0) {
        const calc = data[0];
        const result: TemplateCalculation = {
          template_id: selectedTemplateId,
          template_name: template.name,
          materials: Number(calc.materials) || 0,
          labor: Number(calc.labor) || 0,
          overhead: Number(calc.overhead) || 0,
          cost_pre_profit: Number(calc.cost_pre_profit) || 0,
          sale_price: Number(calc.sale_price) || 0,
          profit: Number(calc.profit) || 0
        };
        setCalculation(result);
        if (onCalculationsUpdate) {
          onCalculationsUpdate([result]);
        }
      }
    } catch (error) {
      console.error('Error calculating template:', error);
      toast({
        title: 'Calculation Error',
        description: 'Failed to calculate estimate',
        variant: 'destructive'
      });
    } finally {
      setCalculating(false);
    }
  };

  const handleTemplateSelect = (templateId: string) => {
    setSelectedTemplateId(templateId);
  };

  const handleSaveSelection = async () => {
    if (!selectedTemplateId) return;
    
    setSaving(true);
    try {
      const result1 = await supabaseClient.from('pipeline_entries').select('metadata').eq('id', pipelineEntryId).single();

      if (result1.error) throw result1.error;

      const currentMetadata = (result1.data?.metadata as any) || {};
      const updatedMetadata = {
        ...currentMetadata,
        selected_template_id: selectedTemplateId,
        selected_template_ids: [selectedTemplateId]
      };

      const result2 = await supabaseClient.from('pipeline_entries').update({ metadata: updatedMetadata }).eq('id', pipelineEntryId);

      if (result2.error) throw result2.error;

      toast({
        title: 'Saved',
        description: 'Template selection saved successfully'
      });
    } catch (error) {
      console.error('Error saving template selection:', error);
      toast({
        title: 'Error',
        description: 'Failed to save template selection',
        variant: 'destructive'
      });
    } finally {
      setSaving(false);
    }
  };

  const handleCreateEstimate = async () => {
    if (!selectedTemplateId || !calculation) return;
    
    setCreating(true);
    try {
      // Get user and tenant info
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { data: profile } = await supabaseClient
        .from('profiles')
        .select('tenant_id, active_tenant_id')
        .eq('id', user.id)
        .single();

      const tenantId = profile?.active_tenant_id || profile?.tenant_id;
      if (!tenantId) throw new Error('No tenant found');

      // Get pipeline entry details
      const { data: pipelineEntry } = await supabaseClient
        .from('pipeline_entries')
        .select('contact_id, contacts(first_name, last_name, address, city, state, zip_code)')
        .eq('id', pipelineEntryId)
        .single();

      const contact = pipelineEntry?.contacts;

      // Generate estimate number
      const { count } = await supabaseClient
        .from('enhanced_estimates')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId);

      const estimateNumber = `EST-${String((count || 0) + 1).padStart(5, '0')}`;

      // Create the estimate
      const { data: newEstimate, error: createError } = await supabaseClient
        .from('enhanced_estimates')
        .insert({
          tenant_id: tenantId,
          pipeline_entry_id: pipelineEntryId,
          contact_id: pipelineEntry?.contact_id,
          estimate_number: estimateNumber,
          status: 'draft',
          template_id: selectedTemplateId,
          customer_name: contact ? `${contact.first_name || ''} ${contact.last_name || ''}`.trim() : '',
          property_address: contact?.address || '',
          property_city: contact?.city || '',
          property_state: contact?.state || '',
          property_zip: contact?.zip_code || '',
          material_cost: calculation.materials,
          labor_cost: calculation.labor,
          overhead_cost: calculation.overhead,
          total_cost: calculation.cost_pre_profit,
          selling_price: calculation.sale_price,
          profit_amount: calculation.profit,
          profit_margin: calculation.sale_price > 0 ? (calculation.profit / calculation.sale_price) * 100 : 0,
          created_by: user.id
        })
        .select()
        .single();

      if (createError) throw createError;

      // Update pipeline entry with estimate reference
      await supabaseClient
        .from('pipeline_entries')
        .update({ 
          estimate_id: newEstimate.id,
          metadata: {
            ...(pipelineEntry?.metadata || {}),
            selected_template_id: selectedTemplateId,
            estimate_created_at: new Date().toISOString()
          }
        })
        .eq('id', pipelineEntryId);

      toast({
        title: 'Estimate Created',
        description: `Estimate ${estimateNumber} has been created successfully`
      });

    } catch (error) {
      console.error('Error creating estimate:', error);
      toast({
        title: 'Error',
        description: 'Failed to create estimate',
        variant: 'destructive'
      });
    } finally {
      setCreating(false);
    }
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
      {/* Template Selection Dropdown */}
      <Card>
        <CardHeader>
          <CardTitle>Select Estimate Template</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Select value={selectedTemplateId} onValueChange={handleTemplateSelect}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select a template..." />
            </SelectTrigger>
            <SelectContent className="bg-popover z-50">
              {templates.map((template) => (
                <SelectItem key={template.id} value={template.id}>
                  {template.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {templates.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">
              No estimate templates available. Create one in settings.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Calculation Results */}
      {calculating && (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground mr-2" />
          <span className="text-sm text-muted-foreground">Calculating estimate...</span>
        </div>
      )}

      {!calculating && calculation && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg">{calculation.template_name}</CardTitle>
              <Badge variant="outline" className="text-lg font-semibold">
                {formatCurrency(calculation.sale_price)}
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-4">
              <div className="flex items-center space-x-2">
                <Package className="h-4 w-4 text-muted-foreground" />
                <div>
                  <p className="text-xs text-muted-foreground">Materials</p>
                  <p className="text-sm font-semibold">{formatCurrency(calculation.materials)}</p>
                </div>
              </div>
              <div className="flex items-center space-x-2">
                <Hammer className="h-4 w-4 text-muted-foreground" />
                <div>
                  <p className="text-xs text-muted-foreground">Labor</p>
                  <p className="text-sm font-semibold">{formatCurrency(calculation.labor)}</p>
                </div>
              </div>
              <div className="flex items-center space-x-2">
                <DollarSign className="h-4 w-4 text-muted-foreground" />
                <div>
                  <p className="text-xs text-muted-foreground">Profit</p>
                  <p className="text-sm font-semibold text-green-600">{formatCurrency(calculation.profit)}</p>
                </div>
              </div>
            </div>
            <div className="mt-3 pt-3 border-t border-border">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Total Cost</span>
                <span className="font-medium">{formatCurrency(calculation.cost_pre_profit)}</span>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Action Buttons */}
      <div className="flex gap-3">
        <Button
          variant="outline"
          onClick={handleSaveSelection}
          disabled={!selectedTemplateId || saving}
          className="flex-1"
        >
          {saving ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Save className="mr-2 h-4 w-4" />
          )}
          Save Selection
        </Button>
        <Button
          onClick={handleCreateEstimate}
          disabled={!selectedTemplateId || !calculation || creating}
          className="flex-1"
        >
          {creating ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <FileText className="mr-2 h-4 w-4" />
          )}
          Create Estimate
        </Button>
      </div>
    </div>
  );
};
