import React, { useEffect, useState, useMemo, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Save, FileText, Sparkles, Ruler, RotateCcw, Download } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { seedBrandTemplates } from '@/lib/estimates/brandTemplateSeeder';
import { useMeasurementContext, evaluateFormula } from '@/hooks/useMeasurementContext';
import { SectionedLineItemsTable } from './SectionedLineItemsTable';
import { EstimateBreakdownCard } from './EstimateBreakdownCard';
import { EstimatePDFTemplate } from './EstimatePDFTemplate';
import { PDFExportDialog } from './PDFExportDialog';
import { type PDFComponentOptions, getDefaultOptions } from './PDFComponentOptions';
import { useEstimatePricing, type LineItem } from '@/hooks/useEstimatePricing';
import { usePDFGeneration } from '@/hooks/usePDFGeneration';
import { useQueryClient } from '@tanstack/react-query';
import { saveEstimatePdf } from '@/lib/estimates/estimatePdfSaver';

const supabaseClient = supabase as any;

interface CompanyInfo {
  name: string;
  logo_url?: string | null;
  phone?: string | null;
  email?: string | null;
  address_street?: string | null;
  address_city?: string | null;
  address_state?: string | null;
  address_zip?: string | null;
  license_number?: string | null;
}

interface Template {
  id: string;
  name: string;
  labor: Record<string, any>;
  overhead: Record<string, any>;
  currency: string;
}

interface TemplateLineItem {
  id: string;
  item_name: string;
  description: string;
  unit: string;
  unit_cost: number;
  qty_formula: string;
  item_type: string;
  sort_order: number;
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
  onEstimateCreated?: (estimateId: string) => void;
}

export const MultiTemplateSelector: React.FC<MultiTemplateSelectorProps> = ({
  pipelineEntryId,
  onCalculationsUpdate,
  onEstimateCreated
}) => {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingLineItems, setSavingLineItems] = useState(false);
  const [creating, setCreating] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [fetchingItems, setFetchingItems] = useState(false);
  const [showPDFTemplate, setShowPDFTemplate] = useState(false);
  const [pdfData, setPdfData] = useState<any>(null);
  const [existingEstimateId, setExistingEstimateId] = useState<string | null>(null);
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [companyInfo, setCompanyInfo] = useState<CompanyInfo | null>(null);
  const [finePrintContent, setFinePrintContent] = useState<string>('');
  const [customerInfo, setCustomerInfo] = useState<{ name: string; address: string; phone?: string; email?: string } | null>(null);
  const [pdfOptions, setPdfOptions] = useState<PDFComponentOptions>(getDefaultOptions('customer'));
  const { toast } = useToast();
  const { context: measurementContext, summary: measurementSummary } = useMeasurementContext(pipelineEntryId);
  const { generatePDF } = usePDFGeneration();
  const queryClient = useQueryClient();
  const pdfContainerRef = useRef<HTMLDivElement>(null);

  // Use the pricing hook
  const {
    lineItems,
    materialItems,
    laborItems,
    breakdown,
    config,
    isFixedPrice,
    fixedPrice,
    setLineItems,
    updateLineItem,
    setConfig,
    setFixedPrice,
    resetToOriginal,
  } = useEstimatePricing([]);

  useEffect(() => {
    fetchTemplates();
    loadSelectedTemplate();
    fetchCompanyAndEstimateSettings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetch company info and estimate settings
  const fetchCompanyAndEstimateSettings = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: profile } = await supabaseClient
        .from('profiles')
        .select('tenant_id, active_tenant_id')
        .eq('id', user.id)
        .single();

      const tenantId = profile?.active_tenant_id || profile?.tenant_id;
      if (!tenantId) return;

      // Fetch tenant info for company branding
      const { data: tenant } = await supabaseClient
        .from('tenants')
        .select('name, logo_url, phone, email, address_street, address_city, address_state, address_zip, license_number')
        .eq('id', tenantId)
        .single();

      if (tenant) {
        setCompanyInfo(tenant as CompanyInfo);
      }

      // Fetch estimate settings for fine print
      const { data: settings } = await supabaseClient
        .from('tenant_estimate_settings')
        .select('fine_print_content, default_include_fine_print')
        .eq('tenant_id', tenantId)
        .maybeSingle();

      if (settings?.fine_print_content) {
        setFinePrintContent(settings.fine_print_content);
      }

      // Fetch customer info from pipeline entry
      const { data: pipelineEntry } = await supabaseClient
        .from('pipeline_entries')
        .select('contacts(first_name, last_name, email, phone, address_street, address_city, address_state, address_zip)')
        .eq('id', pipelineEntryId)
        .single();

      if (pipelineEntry?.contacts) {
        const c = pipelineEntry.contacts;
        const name = `${c.first_name || ''} ${c.last_name || ''}`.trim();
        const addressParts = [
          c.address_street,
          [c.address_city, c.address_state].filter(Boolean).join(', '),
          c.address_zip
        ].filter(Boolean);
        setCustomerInfo({
          name,
          address: addressParts.join(' • '),
          phone: c.phone,
          email: c.email,
        });
      }
    } catch (error) {
      console.error('Error fetching company/estimate settings:', error);
    }
  };

  useEffect(() => {
    if (selectedTemplateId) {
      fetchLineItems(selectedTemplateId);
    } else {
      setLineItems([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTemplateId, measurementContext]);

  // Update parent with calculations when breakdown changes
  useEffect(() => {
    if (selectedTemplateId && lineItems.length > 0) {
      const template = templates.find(t => t.id === selectedTemplateId);
      if (template && onCalculationsUpdate) {
        const calc: TemplateCalculation = {
          template_id: selectedTemplateId,
          template_name: template.name,
          materials: breakdown.materialsTotal,
          labor: breakdown.laborTotal,
          overhead: breakdown.overheadAmount,
          cost_pre_profit: breakdown.totalCost,
          sale_price: breakdown.sellingPrice,
          profit: breakdown.profitAmount,
        };
        onCalculationsUpdate([calc]);
      }
    } else if (onCalculationsUpdate) {
      onCalculationsUpdate([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [breakdown, selectedTemplateId, lineItems.length]);

  const fetchLineItems = async (templateId: string) => {
    setFetchingItems(true);
    try {
      const { data, error } = await supabaseClient
        .from('estimate_calc_template_items')
        .select('id, item_name, description, unit, unit_cost, qty_formula, item_type, sort_order')
        .eq('calc_template_id', templateId)
        .eq('active', true)
        .order('item_type', { ascending: false }) // material first, then labor
        .order('sort_order');

      if (error) throw error;
      
      // Calculate quantities using measurement context and convert to LineItem format
      const items: LineItem[] = (data || []).map((item: TemplateLineItem) => {
        const calculatedQty = measurementContext 
          ? evaluateFormula(item.qty_formula, measurementContext) 
          : 0;
        const lineTotal = calculatedQty * item.unit_cost;
        
        return {
          id: item.id,
          item_name: item.item_name,
          item_type: item.item_type as 'material' | 'labor',
          qty: calculatedQty,
          qty_original: calculatedQty,
          unit: item.unit,
          unit_cost: item.unit_cost,
          unit_cost_original: item.unit_cost,
          line_total: lineTotal,
          is_override: false,
          sort_order: item.sort_order,
        };
      });
      
      setLineItems(items);
    } catch (error) {
      console.error('Error fetching template items:', error);
      setLineItems([]);
    } finally {
      setFetchingItems(false);
    }
  };

  const handleSeedTemplates = async () => {
    setSeeding(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { data: profile } = await supabaseClient
        .from('profiles')
        .select('tenant_id, active_tenant_id')
        .eq('id', user.id)
        .single();

      const tenantId = profile?.active_tenant_id || profile?.tenant_id;
      if (!tenantId) throw new Error('No tenant found');

      const result = await seedBrandTemplates(tenantId);

      if (result.success && result.itemsCreated > 0) {
        toast({
          title: 'Templates Seeded Successfully',
          description: `Created ${result.templatesCreated} templates with ${result.itemsCreated} line items`
        });
        await fetchTemplates();
        if (selectedTemplateId) {
          await fetchLineItems(selectedTemplateId);
        }
      } else if (result.itemsCreated === 0) {
        throw new Error(result.error || 'No items were created - check database permissions');
      } else {
        throw new Error(result.error || 'Seeding failed');
      }
    } catch (error) {
      console.error('Error seeding templates:', error);
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to seed templates',
        variant: 'destructive'
      });
    } finally {
      setSeeding(false);
    }
  };

  const fetchTemplates = async (): Promise<void> => {
    try {
      const result = await supabaseClient
        .from('estimate_calculation_templates')
        .select('*')
        .eq('is_active', true);

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
      const result = await supabaseClient
        .from('pipeline_entries')
        .select('metadata')
        .eq('id', pipelineEntryId)
        .single();

      if (result.error) throw result.error;

      const metadata = result.data?.metadata as any;
      const selected = metadata?.selected_template_ids?.[0] || metadata?.selected_template_id || '';
      setSelectedTemplateId(selected);
      
      // Check if there's an existing estimate linked via metadata
      if (metadata?.enhanced_estimate_id) {
        setExistingEstimateId(metadata?.enhanced_estimate_id);
      }
    } catch (error) {
      console.error('Error loading selected template:', error);
    }
  };

  const handleTemplateSelect = (templateId: string) => {
    setSelectedTemplateId(templateId);
    resetToOriginal();
  };

  const handleSaveSelection = async () => {
    if (!selectedTemplateId) return;
    
    setSaving(true);
    try {
      const result1 = await supabaseClient
        .from('pipeline_entries')
        .select('metadata')
        .eq('id', pipelineEntryId)
        .single();

      if (result1.error) throw result1.error;

      const currentMetadata = (result1.data?.metadata as any) || {};
      const updatedMetadata = {
        ...currentMetadata,
        selected_template_id: selectedTemplateId,
        selected_template_ids: [selectedTemplateId]
      };

      const result2 = await supabaseClient
        .from('pipeline_entries')
        .update({ metadata: updatedMetadata })
        .eq('id', pipelineEntryId);

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
    if (!selectedTemplateId || lineItems.length === 0) return;
    
    setCreating(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { data: profile } = await supabaseClient
        .from('profiles')
        .select('tenant_id, active_tenant_id')
        .eq('id', user.id)
        .single();

      const tenantId = profile?.active_tenant_id || profile?.tenant_id;
      if (!tenantId) throw new Error('No tenant found');

      const { data: pipelineEntry } = await supabaseClient
        .from('pipeline_entries')
        .select('contact_id, metadata, contacts(first_name, last_name, address_street, address_city, address_state, address_zip)')
        .eq('id', pipelineEntryId)
        .single();

      const contact = pipelineEntry?.contacts;
      const metadata = (pipelineEntry?.metadata as any) || {};

      const roofAreaSqFt =
        metadata?.comprehensive_measurements?.roof_area_sq_ft ??
        metadata?.comprehensive_measurements?.total_area_sqft ??
        0;

      // Get tenant name for prefix
      const { data: tenant } = await supabaseClient
        .from('tenants')
        .select('name')
        .eq('id', tenantId)
        .single();

      // Generate tenant prefix (first 3 letters, uppercase)
      const tenantPrefix = tenant?.name?.replace(/[^a-zA-Z]/g, '').substring(0, 3).toUpperCase() || 'EST';

      // Count only this tenant's estimates for unique numbering + add random suffix to prevent collisions
      const { count } = await supabaseClient
        .from('enhanced_estimates')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId);

      const timestamp = Date.now().toString(36).slice(-4);
      const estimateNumber = `${tenantPrefix}-${String((count || 0) + 1).padStart(5, '0')}-${timestamp}`;

      const customerName = contact
        ? `${contact.first_name || ''} ${contact.last_name || ''}`.trim()
        : '';

      const customerAddressParts = [
        contact?.address_street,
        [contact?.address_city, contact?.address_state].filter(Boolean).join(', '),
        contact?.address_zip
      ].filter(Boolean);

      const customerAddress = customerAddressParts.join(' • ');

      const propertyDetails = {
        address_line1: contact?.address_street || '',
        city: contact?.address_city || '',
        state: contact?.address_state || '',
        zip_code: contact?.address_zip || '',
        contact_id: pipelineEntry?.contact_id || null
      };

      // Generate 2-word short description
      const templateName = selectedTemplate?.name || 'Custom';
      const brandWord = templateName.split(' ')[0]; // "GAF", "Owens", etc.
      const priceWord = breakdown.sellingPrice > 20000 ? 'Premium' : 
                        breakdown.sellingPrice > 10000 ? 'Standard' : 'Basic';
      const shortDescription = `${brandWord} ${priceWord}`;

      // Build line items JSON for storage
      const lineItemsJson = {
        materials: materialItems.map(item => ({
          id: item.id,
          item_name: item.item_name,
          qty: item.qty,
          qty_original: item.qty_original,
          unit: item.unit,
          unit_cost: item.unit_cost,
          unit_cost_original: item.unit_cost_original,
          line_total: item.line_total,
          is_override: item.is_override,
        })),
        labor: laborItems.map(item => ({
          id: item.id,
          item_name: item.item_name,
          qty: item.qty,
          qty_original: item.qty_original,
          unit: item.unit,
          unit_cost: item.unit_cost,
          unit_cost_original: item.unit_cost_original,
          line_total: item.line_total,
          is_override: item.is_override,
        })),
      };

      // Prepare PDF data and show template for capture
      setPdfData({
        estimateNumber,
        customerName,
        customerAddress,
        materialItems,
        laborItems,
        breakdown,
        config
      });
      setShowPDFTemplate(true);

      // Wait for render (increased delay for reliable capture)
      await new Promise(resolve => setTimeout(resolve, 500));

      // Generate PDF
      toast({ title: 'Generating PDF...', description: 'Please wait while we create your estimate document.' });
      
      let pdfBlob: Blob | null = null;
      try {
        pdfBlob = await generatePDF('estimate-pdf-template', {
          filename: `${estimateNumber}.pdf`,
          orientation: 'portrait',
          format: 'letter',
          quality: 2
        });
        
        if (!pdfBlob) {
          console.error('PDF generation returned null blob');
        }
      } catch (pdfError) {
        console.error('PDF generation failed:', pdfError);
      }

      // Hide PDF template
      setShowPDFTemplate(false);
      setPdfData(null);

      let pdfUrl: string | null = null;

      // Upload PDF to storage if blob was generated
      if (pdfBlob) {
        const result = await saveEstimatePdf({
          pdfBlob,
          pipelineEntryId,
          tenantId,
          estimateNumber,
          description: shortDescription,
          userId: user.id
        });

        if (result.success && result.filePath) {
          pdfUrl = result.filePath;
        } else {
          console.error('PDF save failed:', result.error);
          toast({ 
            title: 'PDF Upload Failed', 
            description: 'Estimate saved but PDF could not be uploaded.',
            variant: 'destructive' 
          });
        }
      } else {
        console.warn('Estimate saved without PDF - generation failed');
      }

      const { data: newEstimate, error: createError } = await supabaseClient
        .from('enhanced_estimates')
        .insert({
          tenant_id: tenantId,
          pipeline_entry_id: pipelineEntryId,
          estimate_number: estimateNumber,
          status: 'draft',
          template_id: selectedTemplateId,
          customer_name: customerName,
          customer_address: customerAddress,
          property_details: propertyDetails,
          roof_area_sq_ft: roofAreaSqFt,
          material_cost: breakdown.materialsTotal,
          material_total: breakdown.materialsTotal,
          labor_cost: breakdown.laborTotal,
          labor_total: breakdown.laborTotal,
          materials_total: breakdown.materialsTotal,
          overhead_amount: breakdown.overheadAmount,
          overhead_percent: config.overheadPercent,
          subtotal: breakdown.totalCost,
          selling_price: breakdown.sellingPrice,
          fixed_selling_price: isFixedPrice ? fixedPrice : null,
          is_fixed_price: isFixedPrice,
          rep_commission_percent: config.repCommissionPercent,
          rep_commission_amount: breakdown.repCommissionAmount,
          actual_profit_amount: breakdown.profitAmount,
          actual_profit_percent: breakdown.actualProfitMargin,
          line_items: lineItemsJson,
          pdf_url: pdfUrl,
          short_description: shortDescription,
          calculation_metadata: {
            source: 'multi_template_selector',
            selected_template_id: selectedTemplateId,
            pricing_config: config,
          },
          created_by: user.id
        })
        .select()
        .single();

      if (createError) throw createError;

      await supabaseClient
        .from('pipeline_entries')
        .update({
          metadata: {
            ...metadata,
            selected_template_id: selectedTemplateId,
            estimate_created_at: new Date().toISOString(),
            enhanced_estimate_id: newEstimate.id
          }
        })
        .eq('id', pipelineEntryId);

      // Invalidate saved estimates query to refresh the list
      queryClient.invalidateQueries({ queryKey: ['saved-estimates', pipelineEntryId] });

      toast({
        title: 'Estimate Created',
        description: `Estimate ${estimateNumber} has been saved${pdfUrl ? ' with PDF' : ''}`
      });

      // Call the callback if provided
      if (onEstimateCreated) {
        onEstimateCreated(newEstimate.id);
      }

      // Reset the form
      setSelectedTemplateId('');
      resetToOriginal();

    } catch (error) {
      console.error('Error creating estimate:', error);
      setShowPDFTemplate(false);
      setPdfData(null);
      toast({
        title: 'Error',
        description: 'Failed to create estimate',
        variant: 'destructive'
      });
    } finally {
      setCreating(false);
    }
  };

  // Handle saving line item changes for existing estimate
  const handleSaveLineItemChanges = async () => {
    if (!existingEstimateId || lineItems.length === 0) return;
    
    setSavingLineItems(true);
    try {
      const lineItemsJson = {
        materials: materialItems.map(item => ({
          id: item.id,
          item_name: item.item_name,
          qty: item.qty,
          qty_original: item.qty_original,
          unit: item.unit,
          unit_cost: item.unit_cost,
          unit_cost_original: item.unit_cost_original,
          line_total: item.line_total,
          is_override: item.is_override,
        })),
        labor: laborItems.map(item => ({
          id: item.id,
          item_name: item.item_name,
          qty: item.qty,
          qty_original: item.qty_original,
          unit: item.unit,
          unit_cost: item.unit_cost,
          unit_cost_original: item.unit_cost_original,
          line_total: item.line_total,
          is_override: item.is_override,
        })),
      };

      const { data, error } = await supabase.functions.invoke('update-estimate-line-items', {
        body: {
          estimate_id: existingEstimateId,
          line_items: lineItemsJson,
          selling_price: breakdown.sellingPrice,
          pricing_config: config
        }
      });

      if (error) throw error;

      toast({
        title: 'Changes Saved',
        description: 'Estimate line items updated successfully'
      });

      // Invalidate queries to refresh the data
      queryClient.invalidateQueries({ queryKey: ['saved-estimates', pipelineEntryId] });
      
      // Reset override state since changes are now saved
      resetToOriginal();
    } catch (error) {
      console.error('Error saving line item changes:', error);
      toast({
        title: 'Error',
        description: 'Failed to save line item changes',
        variant: 'destructive'
      });
    } finally {
      setSavingLineItems(false);
    }
  };

  const handleResetItem = (id: string) => {
    const item = lineItems.find(i => i.id === id);
    if (item) {
      updateLineItem(id, {
        qty: item.qty_original,
        unit_cost: item.unit_cost_original,
        is_override: false,
      });
    }
  };

  const selectedTemplate = useMemo(() => 
    templates.find(t => t.id === selectedTemplateId),
    [templates, selectedTemplateId]
  );

  // Handle PDF export with options
  const handleExportPDF = async (options: PDFComponentOptions) => {
    if (lineItems.length === 0) return;
    
    setIsExporting(true);
    setPdfOptions(options);
    
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { data: profile } = await supabaseClient
        .from('profiles')
        .select('tenant_id, active_tenant_id')
        .eq('id', user.id)
        .single();

      const tenantId = profile?.active_tenant_id || profile?.tenant_id;
      if (!tenantId) throw new Error('No tenant found');

      // Generate estimate number for export
      const timestamp = Date.now().toString(36).slice(-4);
      const estimateNumber = existingEstimateId 
        ? `EST-EXPORT-${timestamp}`
        : `EST-DRAFT-${timestamp}`;

      // Set up PDF data with company info and options
      setPdfData({
        estimateNumber,
        customerName: customerInfo?.name || 'Customer',
        customerAddress: customerInfo?.address || '',
        customerPhone: customerInfo?.phone,
        customerEmail: customerInfo?.email,
        companyInfo,
        materialItems,
        laborItems,
        breakdown,
        config,
        finePrintContent: options.showCustomFinePrint ? finePrintContent : undefined,
        options,
      });
      setShowPDFTemplate(true);

      // Wait for render
      await new Promise(resolve => setTimeout(resolve, 600));

      // Generate PDF
      const pdfBlob = await generatePDF('estimate-pdf-template', {
        filename: `${estimateNumber}.pdf`,
        orientation: 'portrait',
        format: 'letter',
        quality: 2
      });

      setShowPDFTemplate(false);
      setPdfData(null);

      if (pdfBlob) {
        // Download the PDF
        const url = URL.createObjectURL(pdfBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${estimateNumber}.pdf`;
        a.click();
        URL.revokeObjectURL(url);

        toast({
          title: 'PDF Downloaded',
          description: `${estimateNumber}.pdf has been downloaded`
        });
      } else {
        throw new Error('PDF generation failed');
      }

      setShowExportDialog(false);
    } catch (error) {
      console.error('Error exporting PDF:', error);
      setShowPDFTemplate(false);
      setPdfData(null);
      toast({
        title: 'Export Failed',
        description: 'Failed to generate PDF',
        variant: 'destructive'
      });
    } finally {
      setIsExporting(false);
    }
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
            <div className="text-center py-4 space-y-3">
              <p className="text-sm text-muted-foreground">
                No estimate templates available.
              </p>
              <Button onClick={handleSeedTemplates} disabled={seeding} variant="outline">
                {seeding ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="mr-2 h-4 w-4" />
                )}
                Seed Brand Templates
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Measurement Summary */}
      {measurementSummary && measurementSummary.totalSquares > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Ruler className="h-4 w-4" />
              Applied Measurements
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <div><span className="text-muted-foreground">Squares:</span> <span className="font-medium">{measurementSummary.totalSquares.toFixed(2)}</span></div>
              <div><span className="text-muted-foreground">Area:</span> <span className="font-medium">{measurementSummary.totalSqFt.toFixed(0)} sqft</span></div>
              <div><span className="text-muted-foreground">Eave:</span> <span className="font-medium">{measurementSummary.eaveLength.toFixed(0)} lf</span></div>
              <div><span className="text-muted-foreground">Ridge:</span> <span className="font-medium">{measurementSummary.ridgeLength.toFixed(0)} lf</span></div>
              <div><span className="text-muted-foreground">Hip:</span> <span className="font-medium">{measurementSummary.hipLength.toFixed(0)} lf</span></div>
              <div><span className="text-muted-foreground">Valley:</span> <span className="font-medium">{measurementSummary.valleyLength.toFixed(0)} lf</span></div>
              <div><span className="text-muted-foreground">Rake:</span> <span className="font-medium">{measurementSummary.rakeLength.toFixed(0)} lf</span></div>
              <div><span className="text-muted-foreground">Waste:</span> <span className="font-medium">{measurementSummary.wastePercent}%</span></div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Loading Items */}
      {fetchingItems && (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground mr-2" />
          <span className="text-sm text-muted-foreground">Loading template items...</span>
        </div>
      )}

      {/* Sectioned Line Items Table */}
      {!fetchingItems && lineItems.length > 0 && (
        <Card>
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-base">
              {selectedTemplate?.name || 'Template'} Line Items
            </CardTitle>
            {lineItems.some(item => item.is_override) && (
              <Button variant="ghost" size="sm" onClick={resetToOriginal}>
                <RotateCcw className="h-4 w-4 mr-1" />
                Reset All
              </Button>
            )}
          </CardHeader>
          <CardContent className="p-0">
            <SectionedLineItemsTable
              materialItems={materialItems}
              laborItems={laborItems}
              materialsTotal={breakdown.materialsTotal}
              laborTotal={breakdown.laborTotal}
              onUpdateItem={updateLineItem}
              onResetItem={handleResetItem}
              editable={true}
            />
          </CardContent>
        </Card>
      )}

      {/* No Items State */}
      {selectedTemplateId && !fetchingItems && lineItems.length === 0 && (
        <Card>
          <CardContent className="py-6 text-center">
            <p className="text-sm text-muted-foreground mb-3">
              This template has no line items configured.
            </p>
            <Button onClick={handleSeedTemplates} disabled={seeding} variant="outline" size="sm">
              {seeding ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="mr-2 h-4 w-4" />
              )}
              Seed Brand Templates
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Estimate Breakdown Card */}
      {lineItems.length > 0 && (
        <EstimateBreakdownCard
          breakdown={breakdown}
          config={config}
          isFixedPrice={isFixedPrice}
          fixedPrice={fixedPrice}
          onConfigChange={setConfig}
          onFixedPriceChange={setFixedPrice}
        />
      )}

      {/* Action Buttons */}
      <div className="flex gap-3 pb-8 flex-wrap">
        <Button
          variant="outline"
          onClick={handleSaveSelection}
          disabled={!selectedTemplateId || saving}
          className="flex-1 min-w-[140px]"
        >
          {saving ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Save className="mr-2 h-4 w-4" />
          )}
          Save Selection
        </Button>
        
        {/* Export PDF button */}
        {lineItems.length > 0 && (
          <Button
            variant="outline"
            onClick={() => setShowExportDialog(true)}
            className="flex-1 min-w-[140px]"
          >
            <Download className="mr-2 h-4 w-4" />
            Export PDF
          </Button>
        )}
        
        {/* Show Save Changes button when editing existing estimate with modifications */}
        {existingEstimateId && lineItems.some(item => item.is_override) && (
          <Button
            variant="secondary"
            onClick={handleSaveLineItemChanges}
            disabled={savingLineItems}
            className="flex-1 min-w-[140px]"
          >
            {savingLineItems ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-2 h-4 w-4" />
            )}
            Save Changes
          </Button>
        )}
        
        <Button
          onClick={handleCreateEstimate}
          disabled={!selectedTemplateId || lineItems.length === 0 || creating}
          className="flex-1 min-w-[140px]"
        >
          {creating ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <FileText className="mr-2 h-4 w-4" />
          )}
          Create Estimate
        </Button>
      </div>

      {/* PDF Export Dialog */}
      <PDFExportDialog
        open={showExportDialog}
        onOpenChange={setShowExportDialog}
        onExport={handleExportPDF}
        isExporting={isExporting}
        finePrintAvailable={!!finePrintContent}
        finePrintContent={finePrintContent}
      />

      {/* Hidden PDF Template for capture - positioned in DOM but invisible for html2canvas */}
      {showPDFTemplate && pdfData && (
        <div 
          ref={pdfContainerRef}
          className="fixed top-0 left-0 opacity-0 pointer-events-none z-[-1]"
          style={{ visibility: 'visible' }}
          aria-hidden="true"
        >
          <EstimatePDFTemplate
            estimateNumber={pdfData.estimateNumber}
            customerName={pdfData.customerName}
            customerAddress={pdfData.customerAddress}
            customerPhone={pdfData.customerPhone}
            customerEmail={pdfData.customerEmail}
            companyInfo={pdfData.companyInfo}
            materialItems={pdfData.materialItems}
            laborItems={pdfData.laborItems}
            breakdown={pdfData.breakdown}
            config={pdfData.config}
            finePrintContent={pdfData.finePrintContent}
            options={pdfData.options}
          />
        </div>
      )}
    </div>
  );
};
