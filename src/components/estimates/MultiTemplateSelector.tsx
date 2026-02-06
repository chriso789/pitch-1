// Force rebuild - clear HMR cache v2
import React, { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Save, FileText, Sparkles, Ruler, RotateCcw, Download, FileUp, Eye, Edit, X, CheckCircle, AlertCircle, MapPin, ArrowRight, Check, Plus } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { seedBrandTemplates } from '@/lib/estimates/brandTemplateSeeder';
import { useMeasurementContext, evaluateFormula } from '@/hooks/useMeasurementContext';
import { SectionedLineItemsTable } from './SectionedLineItemsTable';
import { EstimateBreakdownCard } from './EstimateBreakdownCard';
import { EstimatePDFTemplate } from './EstimatePDFTemplate';
import { EstimatePDFDocument } from './EstimatePDFDocument';
import { PDFExportDialog } from './PDFExportDialog';
import { EstimatePreviewPanel } from './EstimatePreviewPanel';
import { EstimateAddonsPanel } from './EstimateAddonsPanel';
import { type PDFComponentOptions, getDefaultOptions } from './PDFComponentOptions';
import { useQueryClient } from '@tanstack/react-query';
import { saveEstimatePdf } from '@/lib/estimates/estimatePdfSaver';
import { useEstimatePricing, type LineItem } from '@/hooks/useEstimatePricing';
import { TemplateCombobox } from './TemplateCombobox';
// usePDFGeneration removed - now using useMultiPagePDFGeneration for all PDF operations
import { useMultiPagePDFGeneration } from '@/hooks/useMultiPagePDFGeneration';

// Parsed measurements interface for inline import
interface ParsedMeasurements {
  provider: string;
  address?: string | null;
  total_area_sqft?: number | null;
  pitched_area_sqft?: number | null;
  facet_count?: number | null;
  predominant_pitch?: string | null;
  ridges_ft?: number | null;
  hips_ft?: number | null;
  valleys_ft?: number | null;
  rakes_ft?: number | null;
  eaves_ft?: number | null;
  drip_edge_ft?: number | null;
  waste_table?: Array<{
    waste_pct: number;
    area_sqft: number | null;
    squares: number | null;
  }> | null;
}

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
  roof_type?: string;
  template_category?: string;
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
  onUnsavedChangesChange?: (hasChanges: boolean, estimateName?: string) => void;
  onSaveChanges?: () => Promise<void>;
  saveChangesRef?: React.MutableRefObject<(() => Promise<void>) | null>;
}

export const MultiTemplateSelector: React.FC<MultiTemplateSelectorProps> = ({
  pipelineEntryId,
  onCalculationsUpdate,
  onEstimateCreated,
  onUnsavedChangesChange,
  saveChangesRef
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
  const [companyLocations, setCompanyLocations] = useState<any[]>([]);
  const [finePrintContent, setFinePrintContent] = useState<string>('');
  const [customerInfo, setCustomerInfo] = useState<{ name: string; address: string; phone?: string; email?: string } | null>(null);
  const [pdfOptions, setPdfOptions] = useState<PDFComponentOptions>(getDefaultOptions('customer'));
  const [showPreviewPanel, setShowPreviewPanel] = useState(false);
  const [editEstimateProcessed, setEditEstimateProcessed] = useState(false);
  const [editingEstimateNumber, setEditingEstimateNumber] = useState<string | null>(null);
  const [isEditingLoadedEstimate, setIsEditingLoadedEstimate] = useState(false);
  const [isCreatingNewEstimate, setIsCreatingNewEstimate] = useState(false);
  const [estimateDisplayName, setEstimateDisplayName] = useState<string>('');
  const [estimatePricingTier, setEstimatePricingTier] = useState<'good' | 'better' | 'best' | ''>('');
  
   // Template attachments state (e.g., product flyers for metal roofs)
   const [templateAttachments, setTemplateAttachments] = useState<Array<{
     document_id: string;
     file_path: string;
     filename: string;
     attachment_order: number;
   }>>([]);
   
  // Add line item state
  const [isAddingItem, setIsAddingItem] = useState(false);
  const [newItemType, setNewItemType] = useState<'material' | 'labor'>('material');
  const [newItem, setNewItem] = useState({
    item_name: '',
    qty: 1,
    unit: 'ea',
    unit_cost: 0
  });
  
  // Inline import state (replaces dialog)
  const [isImporting, setIsImporting] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importUploading, setImportUploading] = useState(false);
  const [importAnalyzing, setImportAnalyzing] = useState(false);
  const [importParsedData, setImportParsedData] = useState<ParsedMeasurements | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  
  // Assigned rep rates state
  const [repRates, setRepRates] = useState<{
    overheadPercent: number;
    commissionPercent: number;
    commissionStructure: 'profit_split' | 'sales_percentage';
    repName: string;
  } | null>(null);
  
  const { toast } = useToast();
  const { context: measurementContext, summary: measurementSummary, loading: measurementLoading } = useMeasurementContext(pipelineEntryId);
  const { generateMultiPagePDF, downloadPDF: downloadMultiPagePDF, isGenerating: isGeneratingMultiPage } = useMultiPagePDFGeneration();
  const queryClient = useQueryClient();
  const pdfContainerRef = useRef<HTMLDivElement>(null);
  const [searchParams] = useSearchParams();

  // Use the pricing hook - pass rep rates as initial config when available
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
  } = useEstimatePricing([], repRates ? {
    overheadPercent: repRates.overheadPercent,
    repCommissionPercent: repRates.commissionPercent,
    commissionStructure: repRates.commissionStructure,
  } : undefined);

  // Determine if template content should be displayed
  // Only show when actively editing/viewing a loaded estimate, or creating new with template selected
  const shouldShowTemplateContent = useMemo(() => {
    return isEditingLoadedEstimate || 
           (isCreatingNewEstimate && !!selectedTemplateId) || 
           existingEstimateId !== null;
  }, [isEditingLoadedEstimate, isCreatingNewEstimate, selectedTemplateId, existingEstimateId]);

  // Track if there are unsaved changes (items with is_override flag)
  const hasUnsavedChanges = useMemo(() => {
    return existingEstimateId !== null && lineItems.some(item => item.is_override);
  }, [existingEstimateId, lineItems]);

  // Get current estimate display name for the dialog
  const currentEstimateName = estimateDisplayName || editingEstimateNumber || 'current estimate';

  // Notify parent component when unsaved changes state changes
  useEffect(() => {
    onUnsavedChangesChange?.(hasUnsavedChanges, hasUnsavedChanges ? currentEstimateName : undefined);
  }, [hasUnsavedChanges, currentEstimateName, onUnsavedChangesChange]);

  // Expose save function to parent via ref
  useEffect(() => {
    if (saveChangesRef) {
      saveChangesRef.current = handleSaveLineItemChangesForRef;
    }
    return () => {
      if (saveChangesRef) {
        saveChangesRef.current = null;
      }
    };
  }, [saveChangesRef, existingEstimateId, lineItems, breakdown, config]);

  // Save function that can be called from parent (doesn't exit edit mode)
  const handleSaveLineItemChangesForRef = async () => {
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

      const { error } = await supabase.functions.invoke('update-estimate-line-items', {
        body: {
          estimate_id: existingEstimateId,
          line_items: lineItemsJson,
          selling_price: breakdown.sellingPrice,
          pricing_config: config,
          display_name: estimateDisplayName,
          pricing_tier: estimatePricingTier
        }
      });

      if (error) throw error;

      toast({
        title: 'Changes Saved',
        description: 'Estimate updated successfully'
      });

      // Reset override flags since changes are now saved
      const resetItems = lineItems.map(item => ({
        ...item,
        is_override: false,
        qty_original: item.qty,
        unit_cost_original: item.unit_cost
      }));
      setLineItems(resetItems);

      // Invalidate queries to refresh the data
      queryClient.invalidateQueries({ queryKey: ['saved-estimates', pipelineEntryId] });
    } catch (error) {
      console.error('Error saving line item changes:', error);
      toast({
        title: 'Error',
        description: 'Failed to save changes',
        variant: 'destructive'
      });
      throw error; // Re-throw so caller knows save failed
    } finally {
      setSavingLineItems(false);
    }
  };

  // Fetch assigned rep's rates from the pipeline entry
  useEffect(() => {
    const fetchAssignedRepRates = async () => {
      try {
        const { data, error } = await supabaseClient
          .from('pipeline_entries')
          .select(`
            assigned_to,
            profiles!pipeline_entries_assigned_to_fkey(
              first_name,
              last_name,
              overhead_rate,
              personal_overhead_rate,
              commission_rate,
              commission_structure
            )
          `)
          .eq('id', pipelineEntryId)
          .single();
        
        if (error) {
          console.error('Error fetching assigned rep rates:', error);
          return;
        }
        
        const profile = data?.profiles as any;
        if (profile) {
          // Apply overhead hierarchy: personal_overhead_rate > 0 takes priority over overhead_rate
          const personalOverhead = profile.personal_overhead_rate ?? 0;
          const baseOverhead = profile.overhead_rate ?? 10;
          const effectiveOverheadPercent = personalOverhead > 0 ? personalOverhead : baseOverhead;
          
          const rates = {
            overheadPercent: effectiveOverheadPercent,
            commissionPercent: profile.commission_rate ?? 50,
            commissionStructure: (profile.commission_structure === 'sales_percentage' || profile.commission_structure === 'percentage_contract_price') ? 'sales_percentage' : 'profit_split' as 'profit_split' | 'sales_percentage',
            repName: `${profile.first_name || ''} ${profile.last_name || ''}`.trim() || 'Rep'
          };
          setRepRates(rates);
          
          // Apply rep's rates to pricing config
          setConfig({
            overheadPercent: rates.overheadPercent,
            repCommissionPercent: rates.commissionPercent,
            commissionStructure: rates.commissionStructure,
          });
          
          console.log('[MultiTemplateSelector] Applied rep rates:', {
            repName: rates.repName,
            effectiveOverhead: effectiveOverheadPercent,
            personalOverhead,
            baseOverhead,
            commissionRate: rates.commissionPercent,
            commissionStructure: rates.commissionStructure
          });
        }
      } catch (err) {
        console.error('Error fetching assigned rep rates:', err);
      }
    };
    
    fetchAssignedRepRates();
  }, [pipelineEntryId, setConfig]);

  useEffect(() => {
    fetchTemplates();
    loadSelectedTemplate();
    fetchCompanyAndEstimateSettings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Handle editEstimate URL parameter to load estimate for editing
  useEffect(() => {
    const editEstimateId = searchParams.get('editEstimate');
    if (editEstimateId && !editEstimateProcessed && !existingEstimateId) {
      setEditEstimateProcessed(true);
      loadEstimateForEditing(editEstimateId);
      // Clear the URL param after loading
      const newParams = new URLSearchParams(searchParams);
      newParams.delete('editEstimate');
      const newUrl = `${window.location.pathname}?${newParams.toString()}`;
      window.history.replaceState({}, '', newUrl);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, editEstimateProcessed, existingEstimateId]);

  // NOTE: Auto-load of saved estimates on page mount is DISABLED.
  // Users must explicitly select a template from the dropdown to see content.
  // This keeps the template area blank until user action.
  // The loadEstimateForEditing function below can still be called explicitly
  // when editing a specific estimate (e.g., from URL params or "Edit" button).

  // Load an existing estimate for editing
  const loadEstimateForEditing = async (estimateId: string) => {
    setLoading(true);
    try {
      // Fetch the estimate from enhanced_estimates
      const { data: estimate, error } = await supabaseClient
        .from('enhanced_estimates')
        .select('*')
        .eq('id', estimateId)
        .single();

      if (error || !estimate) {
        toast({
          title: 'Error',
          description: 'Could not load estimate for editing',
          variant: 'destructive'
        });
        return;
      }

      // Set the template ID from the estimate and fetch its attachments
      if (estimate.template_id) {
        setSelectedTemplateId(estimate.template_id);
        // FIX: Also fetch template attachments for the loaded template
        fetchTemplateAttachments(estimate.template_id);
      }

      // Set the existing estimate ID to enable save/update mode
      setExistingEstimateId(estimateId);
      setEditingEstimateNumber(estimate.estimate_number);
      setIsEditingLoadedEstimate(true); // Mark as editing loaded estimate to prevent auto-recalculation

      // Load line items from the estimate
      const lineItemsData = estimate.line_items as any;
      if (lineItemsData) {
        const materials = lineItemsData.materials || [];
        const labor = lineItemsData.labor || [];
        
        const allItems: LineItem[] = [
          ...materials.map((item: any) => ({
            ...item,
            item_type: 'material' as const,
          })),
          ...labor.map((item: any) => ({
            ...item,
            item_type: 'labor' as const,
          })),
        ];

        if (allItems.length > 0) {
          setLineItems(allItems);
        }
      }

      // Set pricing config from the estimate
      setConfig({
        overheadPercent: estimate.overhead_percent || 15,
        profitMarginPercent: estimate.actual_profit_percent || 30,
        repCommissionPercent: estimate.rep_commission_percent || 5,
      });

      // Handle fixed price
      if (estimate.is_fixed_price && estimate.fixed_selling_price) {
        setFixedPrice(estimate.fixed_selling_price);
      }

      toast({
        title: 'Estimate Loaded',
        description: `${estimate.estimate_number} is ready for editing`
      });

    } catch (err) {
      console.error('Error loading estimate for editing:', err);
      toast({
        title: 'Error',
        description: 'Failed to load estimate',
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  // Cancel edit mode
  const handleCancelEdit = () => {
    // Immediately clear URL parameter to prevent re-trigger
    const newParams = new URLSearchParams(searchParams);
    newParams.delete('editEstimate');
    const newUrl = `${window.location.pathname}?${newParams.toString()}`;
    window.history.replaceState({}, '', newUrl);
    
    // Reset all editing states
    setExistingEstimateId(null);
    setEditingEstimateNumber(null);
    setEditEstimateProcessed(false);
    setIsEditingLoadedEstimate(false);
    setSelectedTemplateId('');
    setLineItems([]);
    setPdfOptions(getDefaultOptions('customer'));
    
    // Reset pricing config to defaults
    setConfig({
      overheadPercent: 15,
      profitMarginPercent: 30,
      repCommissionPercent: 5,
    });
    
    toast({
      title: 'Edit Mode Cancelled',
      description: 'All changes discarded. Ready to create a new estimate.'
    });
  };
  
  // Delete a line item from the estimate
  const handleDeleteLineItem = (itemId: string) => {
    const updatedItems = lineItems.filter(item => item.id !== itemId);
    setLineItems(updatedItems);
    toast({
      title: 'Item Removed',
      description: 'Line item deleted from estimate'
    });
  };

  // Handle adding a new line item
  const handleAddLineItem = (type: 'material' | 'labor') => {
    setNewItemType(type);
    setNewItem({ item_name: '', qty: 1, unit: 'ea', unit_cost: 0 });
    setIsAddingItem(true);
  };

  // Save the new line item
  const handleSaveNewItem = () => {
    if (!newItem.item_name.trim()) {
      toast({
        title: 'Error',
        description: 'Item name is required',
        variant: 'destructive'
      });
      return;
    }

    // Calculate max sort_order for items of the same type to add at bottom
    const sameTypeItems = lineItems.filter(item => item.item_type === newItemType);
    const maxSortOrder = sameTypeItems.reduce(
      (max, item) => Math.max(max, item.sort_order || 0),
      0
    );

    const item: LineItem = {
      id: crypto.randomUUID(),
      item_name: newItem.item_name,
      qty: newItem.qty,
      unit: newItem.unit,
      unit_cost: newItem.unit_cost,
      line_total: newItem.qty * newItem.unit_cost,
      item_type: newItemType,
      is_override: false,
      sort_order: maxSortOrder + 1
    };
    
    setLineItems([...lineItems, item]);
    setNewItem({ item_name: '', qty: 1, unit: 'ea', unit_cost: 0 });
    setIsAddingItem(false);
    toast({
      title: 'Item Added',
      description: `${newItem.item_name} added to ${newItemType}`
    });
  };

  // Cancel adding a new item
  const handleCancelAddItem = () => {
    setIsAddingItem(false);
    setNewItem({ item_name: '', qty: 1, unit: 'ea', unit_cost: 0 });
  };

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

      // Fetch all company locations
      const { data: locations } = await supabaseClient
        .from('locations')
        .select('id, name, address_street, address_city, address_state, address_zip, phone, email, is_primary, logo_url')
        .eq('tenant_id', tenantId)
        .eq('is_active', true)
        .order('is_primary', { ascending: false });

      if (locations && locations.length > 0) {
        setCompanyLocations(locations);
      }

      // Fetch estimate settings for fine print and sales tax
      const { data: settings } = await supabaseClient
        .from('tenant_estimate_settings')
        .select('fine_print_content, default_include_fine_print, sales_tax_enabled, sales_tax_rate')
        .eq('tenant_id', tenantId)
        .maybeSingle();

      if (settings?.fine_print_content) {
        setFinePrintContent(settings.fine_print_content);
      }
      
      // Apply sales tax settings to pricing config
      if (settings) {
        setConfig({
          salesTaxEnabled: settings.sales_tax_enabled ?? false,
          salesTaxRate: settings.sales_tax_rate ?? 0,
        });
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

  // Calculate line items when template or measurement context changes
  useEffect(() => {
    // IMPORTANT: Don't auto-recalculate when editing a loaded estimate
    // The loaded line items should be preserved as the source of truth
    if (isEditingLoadedEstimate) {
      return;
    }
    
    // CRITICAL: Wait for measurement context to finish loading before calculating
    // This prevents formulas from evaluating to 0 when context is still null
    if (measurementLoading) {
      console.log('📐 Waiting for measurement context to load...');
      return;
    }
    
    if (selectedTemplateId) {
      console.log('📐 Evaluating formulas with context:', measurementContext);
      fetchLineItems(selectedTemplateId);
    } else {
      setLineItems([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTemplateId, measurementContext, isEditingLoadedEstimate, measurementLoading]);

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
        .select('id, name, roof_type, template_category')
        .eq('is_active', true)
        .order('roof_type')
        .order('name');

      if (result.error) throw result.error;
      
      const templatesData = (result.data || []).map((t: any) => ({
        id: t.id,
        name: t.name,
        roof_type: t.roof_type || 'other',
        template_category: t.template_category || 'general'
      }));
      
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

      // NOTE: We intentionally do NOT auto-select on load.
      // User must explicitly select a template to start working.
      // The saved preference is available in metadata but we don't auto-populate.
      // This keeps the template area blank until user action.
      
      // NOTE: We intentionally do NOT auto-enable editing mode here.
      // Editing mode should ONLY be activated by:
      // 1. URL param ?editEstimate=... (from clicking Edit on a saved estimate)
      // 2. User explicitly clicking an "Edit" button
      // The linked estimate ID is stored in metadata but doesn't trigger edit mode.
    } catch (error) {
      console.error('Error loading selected template:', error);
    }
  };

  const handleTemplateSelect = (templateId: string) => {
    setSelectedTemplateId(templateId);
     // Fetch any template attachments (e.g., metal roof flyers)
     fetchTemplateAttachments(templateId);
    // Auto-enable creating mode when template is selected (unless already editing an existing estimate)
    if (!isEditingLoadedEstimate && !existingEstimateId) {
      setIsCreatingNewEstimate(true);
    }
    resetToOriginal();
  };
   
   // Fetch template attachments (e.g., metal roof flyer for 5V/Standing Seam templates)
   // Falls back to roof_type-based attachments if no template-specific ones found
   const fetchTemplateAttachments = async (templateId: string) => {
     try {
       // First, try template-specific attachments
       const { data, error } = await supabaseClient
         .from('estimate_template_attachments')
         .select(`
           document_id,
           attachment_order,
           documents!inner(file_path, filename)
         `)
         .eq('template_id', templateId)
         .order('attachment_order');
       
       if (error) {
         console.error('[fetchTemplateAttachments] Error:', error);
         setTemplateAttachments([]);
         return;
       }
       
       if (data && data.length > 0) {
         const attachments = data.map((d: any) => ({
           document_id: d.document_id,
           file_path: d.documents.file_path,
           filename: d.documents.filename,
           attachment_order: d.attachment_order,
         }));
         setTemplateAttachments(attachments);
         console.log(`[fetchTemplateAttachments] Found ${attachments.length} template-specific attachments:`, attachments.map(a => a.filename));
       } else {
         // No template-specific attachments - try roof_type-based fallback
         const selectedTemplate = templates.find(t => t.id === templateId);
         if (selectedTemplate?.roof_type) {
           console.log(`[fetchTemplateAttachments] No template attachments, checking roof_type fallback for: ${selectedTemplate.roof_type}`);
           
           // Find any template of the same roof_type that HAS attachments
           const { data: roofTypeAttachments, error: rtError } = await supabaseClient
             .from('estimate_template_attachments')
             .select(`
               document_id,
               attachment_order,
               documents!inner(file_path, filename),
               estimate_templates!inner(roof_type)
             `)
             .eq('estimate_templates.roof_type', selectedTemplate.roof_type)
             .order('attachment_order')
             .limit(5);
           
           if (!rtError && roofTypeAttachments && roofTypeAttachments.length > 0) {
             // Dedupe by document_id in case multiple templates have same attachment
             const uniqueAttachments = new Map<string, any>();
             for (const d of roofTypeAttachments) {
               if (!uniqueAttachments.has(d.document_id)) {
                 uniqueAttachments.set(d.document_id, {
                   document_id: d.document_id,
                   file_path: (d.documents as any).file_path,
                   filename: (d.documents as any).filename,
                   attachment_order: d.attachment_order,
                 });
               }
             }
             const attachments = Array.from(uniqueAttachments.values());
             setTemplateAttachments(attachments);
             console.log(`[fetchTemplateAttachments] Found ${attachments.length} roof_type fallback attachments for ${selectedTemplate.roof_type}:`, attachments.map(a => a.filename));
           } else {
             setTemplateAttachments([]);
           }
         } else {
           setTemplateAttachments([]);
         }
       }
     } catch (err) {
       console.error('[fetchTemplateAttachments] Exception:', err);
       setTemplateAttachments([]);
     }
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

      // Generate 2-word short description using roof_type for accurate categorization
      const templateName = selectedTemplate?.name || 'Custom';
      const roofType = selectedTemplate?.roof_type || 'shingle';
      
      // Extract descriptor based on roof type and template name
      const getDescriptor = (name: string, type: string): string => {
        if (type === 'metal') {
          if (name.toLowerCase().includes('5v')) return '5V Metal';
          if (name.toLowerCase().includes('snap')) return 'SnapLok';
          if (name.toLowerCase().includes('standing')) return 'Standing Seam';
          return 'Metal';
        }
        if (type === 'shingle') {
          if (name.toLowerCase().includes('gaf')) return 'GAF';
          if (name.toLowerCase().includes('owens')) return 'Owens Corning';
          if (name.toLowerCase().includes('certainteed')) return 'CertainTeed';
          return 'Shingle';
        }
        if (type === 'tile') return 'Tile';
        if (type === 'flat') return 'Flat';
        if (type === 'slate') return 'Slate';
        if (type === 'cedar') return 'Cedar';
        return type.charAt(0).toUpperCase() + type.slice(1);
      };
      
      const descriptor = getDescriptor(templateName, roofType);
      const priceWord = breakdown.sellingPrice > 20000 ? 'Premium' : 
                        breakdown.sellingPrice > 10000 ? 'Standard' : 'Basic';
      const shortDescription = `${descriptor} ${priceWord}`;

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
        customerPhone: contact?.phone,
        customerEmail: contact?.email,
        companyInfo,
        companyLocations,
        materialItems,
        laborItems,
        breakdown,
        config,
        finePrintContent,
        options: pdfOptions,
      });
      setShowPDFTemplate(true);

      // Wait for render (increased delay for reliable capture)
      await new Promise(resolve => setTimeout(resolve, 500));

      // Generate PDF using multi-page generator with correct element ID
      toast({ title: 'Generating PDF...', description: 'Please wait while we create your estimate document.' });
      
      let pdfBlob: Blob | null = null;
      try {
        const pdfResult = await generateMultiPagePDF('estimate-pdf-pages', 1, {
          filename: `${estimateNumber}.pdf`,
          format: 'letter',
          orientation: 'portrait',
        });
        
        if (pdfResult.success && pdfResult.blob) {
          pdfBlob = pdfResult.blob;
        } else {
          console.error('PDF generation failed:', pdfResult.error);
        }
      } catch (pdfError) {
        console.error('PDF generation failed:', pdfError);
      }

       // Merge template attachments (e.g., metal roof flyer) if any exist
       if (pdfBlob && templateAttachments.length > 0) {
         try {
           console.log(`[handleCreateEstimate] Merging ${templateAttachments.length} template attachments...`);
           
           // Get storage URLs for attachment documents
           const attachmentUrls = templateAttachments.map(att => {
             const { data } = supabase.storage
               .from('company-docs')
               .getPublicUrl(att.file_path);
             return data.publicUrl;
           });
           
           console.log('[handleCreateEstimate] Attachment URLs:', attachmentUrls);
           
           // Dynamically import and merge
           const { mergeEstimateWithAttachments } = await import('@/lib/pdfMerger');
           pdfBlob = await mergeEstimateWithAttachments(pdfBlob, attachmentUrls);
           
           console.log(`📎 Merged ${templateAttachments.length} attachments into estimate PDF`);
           toast({ 
             title: 'Attachments Added', 
             description: `Added ${templateAttachments.length} product document(s) to estimate PDF` 
           });
         } catch (mergeError) {
           console.error('[handleCreateEstimate] Failed to merge attachments:', mergeError);
           // Continue with original PDF if merge fails
         }
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
          userId: user.id,
          estimateDisplayName: estimateDisplayName.trim() || null,
          estimatePricingTier: estimatePricingTier || null,
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
          display_name: estimateDisplayName.trim() || null,
          pricing_tier: estimatePricingTier || null,
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
          sales_tax_rate: config.salesTaxEnabled ? config.salesTaxRate : 0,
          sales_tax_amount: breakdown.salesTaxAmount,
          total_with_tax: breakdown.totalWithTax,
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

      // Update pipeline entry metadata - set BOTH enhanced_estimate_id and selected_estimate_id
      await supabaseClient
        .from('pipeline_entries')
        .update({
          metadata: {
            ...metadata,
            selected_template_id: selectedTemplateId,
            estimate_created_at: new Date().toISOString(),
            enhanced_estimate_id: newEstimate.id,
            selected_estimate_id: newEstimate.id  // Also set as selected so Materials/Labor tabs load it
          }
        })
        .eq('id', pipelineEntryId);

      // Invalidate saved estimates query and selection-related queries to refresh everything
      queryClient.invalidateQueries({ queryKey: ['saved-estimates', pipelineEntryId] });
      queryClient.invalidateQueries({ queryKey: ['pipeline-entry-metadata', pipelineEntryId] });
      queryClient.invalidateQueries({ queryKey: ['pipeline-selected-estimate', pipelineEntryId] });
      queryClient.invalidateQueries({ queryKey: ['enhanced-estimate-items', pipelineEntryId] });
      queryClient.invalidateQueries({ queryKey: ['hyperlink-data', pipelineEntryId] });

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
      setIsCreatingNewEstimate(false);
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
          pricing_config: config,
          display_name: estimateDisplayName,
          pricing_tier: estimatePricingTier
        }
      });

      if (error) throw error;

      // Get tenant info for PDF upload
      const { data: { user } } = await supabase.auth.getUser();
      const { data: profile } = await supabaseClient
        .from('profiles')
        .select('tenant_id, active_tenant_id')
        .eq('id', user?.id)
        .single();
      const tenantId = profile?.active_tenant_id || profile?.tenant_id;

      // Prepare PDF data and show template for capture
      setPdfData({
        estimateNumber: editingEstimateNumber,
        customerName: customerInfo?.name,
        customerAddress: customerInfo?.address,
        companyInfo,
        companyLocations,
        materialItems,
        laborItems,
        breakdown,
        config,
        finePrintContent,
        options: pdfOptions,
      });
      setShowPDFTemplate(true);

      // Wait for render
      await new Promise(resolve => setTimeout(resolve, 500));

      // Generate PDF
      let pdfBlob: Blob | null = null;
      try {
        const pdfResult = await generateMultiPagePDF('estimate-pdf-pages', 1, {
          filename: `${editingEstimateNumber}.pdf`,
          format: 'letter',
          orientation: 'portrait',
        });
        
        if (pdfResult.success && pdfResult.blob) {
          pdfBlob = pdfResult.blob;
        }
      } catch (pdfError) {
        console.error('PDF regeneration failed:', pdfError);
      }

      // Hide PDF template
      setShowPDFTemplate(false);
      setPdfData(null);

      // Upload new PDF to storage (replaces old via upsert)
      if (pdfBlob && editingEstimateNumber && tenantId && user?.id) {
        const result = await saveEstimatePdf({
          pdfBlob,
          pipelineEntryId,
          tenantId,
          estimateNumber: editingEstimateNumber,
          description: `Updated estimate ${editingEstimateNumber}`,
          userId: user.id,
        });
        
        if (result.success && result.filePath) {
          // Update pdf_url in database
          await supabaseClient
            .from('enhanced_estimates')
            .update({ pdf_url: result.filePath })
            .eq('id', existingEstimateId);
        }
      }

      toast({
        title: 'Changes Saved',
        description: 'Estimate and PDF updated successfully'
      });

      // Invalidate queries to refresh the data
      queryClient.invalidateQueries({ queryKey: ['saved-estimates', pipelineEntryId] });
      
      // Reset override state since changes are now saved
      resetToOriginal();
      
      // Exit editing mode and hide the estimate builder
      setExistingEstimateId(null);
      setEditingEstimateNumber(null);
      setIsEditingLoadedEstimate(false);
      setEditEstimateProcessed(false);
      setSelectedTemplateId(null);
      setLineItems([]);
    } catch (error) {
      console.error('Error saving line item changes:', error);
      setShowPDFTemplate(false);
      setPdfData(null);
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

  // Inline import handlers
  const handleImportFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      if (selectedFile.type !== 'application/pdf') {
        setImportError('Please upload a PDF file');
        return;
      }
      setImportFile(selectedFile);
      setImportError(null);
      setImportParsedData(null);
    }
  };

  const handleUploadAndAnalyze = useCallback(async () => {
    if (!importFile) return;

    setImportUploading(true);
    setImportAnalyzing(false);
    setImportError(null);

    try {
      const arrayBuffer = await importFile.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      let binary = '';
      for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const base64 = btoa(binary);

      setImportUploading(false);
      setImportAnalyzing(true);

      const { data, error: fnError } = await supabase.functions.invoke('roof-report-ingest', {
        body: {
          base64_pdf: base64,
          lead_id: pipelineEntryId,
        },
      });

      if (fnError) throw new Error(fnError.message || 'Failed to analyze report');
      if (!data?.ok) throw new Error(data?.message || 'Analysis failed');

      setImportParsedData(data.parsed as ParsedMeasurements);
      
      toast({
        title: 'Report Analyzed',
        description: `Detected ${data.provider} report with ${data.parsed?.total_area_sqft?.toLocaleString() || 0} sqft`,
      });
    } catch (err) {
      console.error('Import error:', err);
      setImportError(err instanceof Error ? err.message : 'Failed to process report');
      toast({
        title: 'Analysis Failed',
        description: err instanceof Error ? err.message : 'Could not analyze the report',
        variant: 'destructive',
      });
    } finally {
      setImportUploading(false);
      setImportAnalyzing(false);
    }
  }, [importFile, pipelineEntryId, toast]);

  const handleApplyImportedMeasurements = useCallback(async () => {
    if (!importParsedData) return;

    try {
      const { data: entry, error: fetchError } = await supabase
        .from('pipeline_entries')
        .select('metadata')
        .eq('id', pipelineEntryId)
        .single();

      if (fetchError) throw fetchError;

      const existingMetadata = (entry?.metadata as Record<string, any>) || {};

      // Build comprehensive measurements with BOTH key formats
      // - The original import keys (ridges_lf, eaves_lf, etc.)
      // - The keys useMeasurementContext expects (ridge_length, eave_length, etc.)
      const totalSquares = importParsedData.total_area_sqft ? importParsedData.total_area_sqft / 100 : 0;
      
      const comprehensiveMeasurements = {
        ...existingMetadata.comprehensive_measurements,
        // Original import keys
        roof_area_sq_ft: importParsedData.total_area_sqft,
        total_area_sqft: importParsedData.total_area_sqft,
        pitched_area_sqft: importParsedData.pitched_area_sqft,
        predominant_pitch: importParsedData.predominant_pitch,
        facet_count: importParsedData.facet_count,
        ridges_lf: importParsedData.ridges_ft,
        hips_lf: importParsedData.hips_ft,
        valleys_lf: importParsedData.valleys_ft,
        rakes_lf: importParsedData.rakes_ft,
        eaves_lf: importParsedData.eaves_ft,
        drip_edge_lf: importParsedData.drip_edge_ft,
        waste_table: importParsedData.waste_table,
        source: `imported_${importParsedData.provider}`,
        imported_at: new Date().toISOString(),
        // Keys expected by useMeasurementContext (for smart tag formulas)
        roof_squares: totalSquares,
        total_squares: totalSquares,
        eave_length: importParsedData.eaves_ft || 0,
        rake_length: importParsedData.rakes_ft || 0,
        ridge_length: importParsedData.ridges_ft || 0,
        hip_length: importParsedData.hips_ft || 0,
        valley_length: importParsedData.valleys_ft || 0,
        step_flashing_length: 0,
        penetration_count: 3,
        waste_factor_percent: 10,
      };

      const { error: updateError } = await supabase
        .from('pipeline_entries')
        .update({
          metadata: {
            ...existingMetadata,
            comprehensive_measurements: comprehensiveMeasurements,
            imported_report_provider: importParsedData.provider,
            imported_report_address: importParsedData.address,
          },
        })
        .eq('id', pipelineEntryId);

      if (updateError) throw updateError;

      toast({
        title: 'Measurements Applied',
        description: 'The imported measurements have been saved',
      });

      // Reset import state
      setIsImporting(false);
      setImportFile(null);
      setImportParsedData(null);
      setImportError(null);
      
      // Refresh measurement context
      queryClient.invalidateQueries({ queryKey: ['measurement-context', pipelineEntryId] });
      if (selectedTemplateId) {
        fetchLineItems(selectedTemplateId);
      }
    } catch (err) {
      console.error('Apply error:', err);
      toast({
        title: 'Failed to Apply',
        description: err instanceof Error ? err.message : 'Could not save measurements',
        variant: 'destructive',
      });
    }
  }, [importParsedData, pipelineEntryId, queryClient, selectedTemplateId, toast, fetchLineItems]);

  const handleCancelImport = () => {
    setIsImporting(false);
    setImportFile(null);
    setImportParsedData(null);
    setImportError(null);
  };

  const formatNumber = (val: number | null | undefined): string => {
    if (val === null || val === undefined) return '—';
    return val.toLocaleString();
  };

  const selectedTemplate = useMemo(() => 
    templates.find(t => t.id === selectedTemplateId),
    [templates, selectedTemplateId]
  );

  // Handle PDF export with options - using multi-page generation for proper pagination
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

      // Set up PDF data with company info and options for the paged document
      setPdfData({
        estimateNumber,
        customerName: customerInfo?.name || 'Customer',
        customerAddress: customerInfo?.address || '',
        customerPhone: customerInfo?.phone,
        customerEmail: customerInfo?.email,
        companyInfo,
        companyLocations,
        materialItems,
        laborItems,
        breakdown,
        config,
        finePrintContent: options.showCustomFinePrint ? finePrintContent : undefined,
        options,
        measurementSummary,
      });
      setShowPDFTemplate(true);

      // Wait for render of all pages
      await new Promise(resolve => setTimeout(resolve, 800));

      // Use multi-page PDF generation for proper pagination
      const result = await downloadMultiPagePDF('estimate-pdf-pages', 1, {
        filename: `${estimateNumber}.pdf`,
        customerName: customerInfo?.name || 'Customer',
        propertyAddress: customerInfo?.address || '',
      });

      setShowPDFTemplate(false);
      setPdfData(null);

      if (result.success) {
        toast({
          title: 'PDF Downloaded',
          description: `${estimateNumber}.pdf has been downloaded`
        });
      } else {
        throw new Error(result.error || 'PDF generation failed');
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
      {/* Editing Mode Banner */}
      {existingEstimateId && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 flex items-center gap-2">
          <Edit className="h-4 w-4 text-yellow-600" />
          <span className="text-yellow-800 font-medium">Editing Mode</span>
          <span className="text-yellow-700 text-sm">
            - {editingEstimateNumber || 'Estimate'} - Changes will update this estimate
          </span>
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={handleCancelEdit}
            className="ml-auto h-7 text-yellow-700 hover:text-yellow-900 hover:bg-yellow-100"
          >
            <X className="h-4 w-4 mr-1" />
            Cancel Edit
          </Button>
        </div>
      )}

      {/* Template Selection Dropdown */}
      <Card>
        <CardHeader>
          <CardTitle>Select Estimate Template</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <TemplateCombobox
            templates={templates}
            value={selectedTemplateId}
            onValueChange={handleTemplateSelect}
            placeholder="Select Template"
            disabled={isEditingLoadedEstimate}
          />

          {/* Show note when editing + options to recalculate or create new */}
          {isEditingLoadedEstimate && selectedTemplateId && (
            <div className="flex items-center justify-between gap-2 p-3 bg-muted/50 rounded-lg">
              <p className="text-sm text-muted-foreground">
                Viewing saved estimate. Select an action below.
              </p>
              <div className="flex gap-2">
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={() => {
                    setIsEditingLoadedEstimate(false);
                    fetchLineItems(selectedTemplateId);
                    toast({
                      title: 'Recalculating',
                      description: 'Line items recalculated from template measurements',
                    });
                  }}
                >
                  <RotateCcw className="h-4 w-4 mr-1" />
                  Recalculate
                </Button>
                <Button 
                  variant="default" 
                  size="sm"
                  onClick={() => {
                    // Clear everything and enable new estimate creation
                    setIsCreatingNewEstimate(true);
                    setIsEditingLoadedEstimate(false);
                    setSelectedTemplateId('');
                    setLineItems([]);
                    setExistingEstimateId(null);
                    setEditingEstimateNumber(null);
                    toast({
                      title: 'Ready for New Estimate',
                      description: 'Select a template to create a new estimate',
                    });
                  }}
                >
                  <Plus className="h-4 w-4 mr-1" />
                  Create New Estimate
                </Button>
              </div>
            </div>
          )}

          {/* Hint when dropdown is unlocked and ready for new estimate */}
          {!isEditingLoadedEstimate && !selectedTemplateId && isCreatingNewEstimate && (
            <div className="p-3 bg-primary/10 border border-primary/20 rounded-lg">
              <p className="text-sm text-primary">
                Select a template above to create a new estimate option for this project.
              </p>
            </div>
          )}

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

      {/* Loading Items */}
      {fetchingItems && (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground mr-2" />
          <span className="text-sm text-muted-foreground">Loading template items...</span>
        </div>
      )}

      {/* Sectioned Line Items Table - Only show when template/estimate is selected */}
      {!fetchingItems && shouldShowTemplateContent && (
        <Card>
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-base">
              {selectedTemplate?.name || 'Estimate'} Line Items
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
              onDeleteItem={handleDeleteLineItem}
              onResetItem={handleResetItem}
              onAddItem={handleAddLineItem}
              editable={true}
              salesTaxEnabled={config.salesTaxEnabled}
              salesTaxRate={config.salesTaxRate}
              salesTaxAmount={breakdown.salesTaxAmount}
              sellingPrice={breakdown.sellingPrice}
              totalWithTax={breakdown.totalWithTax}
              isAddingItem={isAddingItem}
              addingItemType={newItemType}
              newItem={newItem}
              onNewItemChange={setNewItem}
              onSaveNewItem={handleSaveNewItem}
              onCancelAddItem={handleCancelAddItem}
            />
          </CardContent>
        </Card>
      )}

      {/* Add Line Item Form now renders inline in SectionedLineItemsTable */}

      {/* No Template Selected State */}
      {selectedTemplateId && !fetchingItems && lineItems.length === 0 && !isAddingItem && (
        <Card>
          <CardContent className="py-6 text-center">
            <p className="text-sm text-muted-foreground mb-3">
              This template has no line items configured, or add items manually.
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

      {/* Estimate Add-ons Panel - for fine print, photos, etc. */}
      {shouldShowTemplateContent && lineItems.length > 0 && (
        <EstimateAddonsPanel
          pipelineEntryId={pipelineEntryId}
          pdfOptions={pdfOptions}
          onOptionsChange={(changes) => setPdfOptions(prev => ({ ...prev, ...changes }))}
          className="mb-4"
        />
      )}

      {/* Estimate Breakdown Card */}
      {shouldShowTemplateContent && lineItems.length > 0 && (
        <EstimateBreakdownCard
          breakdown={breakdown}
          config={config}
          isFixedPrice={isFixedPrice}
          fixedPrice={fixedPrice}
          onConfigChange={setConfig}
          onFixedPriceChange={setFixedPrice}
          repName={repRates?.repName}
        />
      )}

      {/* Estimate Name and Pricing Tier */}
      {shouldShowTemplateContent && lineItems.length > 0 && (
        <div className="flex gap-4 flex-wrap items-start">
          <div className="space-y-2 flex-1 min-w-[250px]">
            <Label htmlFor="estimate-display-name" className="text-sm font-medium">
              Estimate Name <span className="text-muted-foreground font-normal">(optional)</span>
            </Label>
            <Input
              id="estimate-display-name"
              value={estimateDisplayName}
              onChange={(e) => setEstimateDisplayName(e.target.value)}
              placeholder="e.g., Smith Residence - Full Roof Replacement"
            />
            <p className="text-xs text-muted-foreground">
              Leave blank to use auto-generated estimate number
            </p>
          </div>
          <div className="space-y-2 w-[160px]">
            <Label htmlFor="estimate-pricing-tier" className="text-sm font-medium">
              Pricing Tier
            </Label>
            <Select
              value={estimatePricingTier}
              onValueChange={(val) => setEstimatePricingTier(val as 'good' | 'better' | 'best' | '')}
            >
              <SelectTrigger id="estimate-pricing-tier">
                <SelectValue placeholder="Select tier" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="good">Good</SelectItem>
                <SelectItem value="better">Better</SelectItem>
                <SelectItem value="best">Best</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Good/Better/Best
            </p>
          </div>
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex gap-3 pb-8 flex-wrap">
        {shouldShowTemplateContent && (
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
        )}
        
        {/* Preview and Export PDF buttons */}
        {shouldShowTemplateContent && lineItems.length > 0 && (
          <>
            <Button
              variant="outline"
              onClick={() => setShowPreviewPanel(true)}
              className="flex-1 min-w-[140px]"
            >
              <Eye className="mr-2 h-4 w-4" />
              Preview
            </Button>
            <Button
              variant="outline"
              onClick={() => setShowExportDialog(true)}
              className="flex-1 min-w-[140px]"
            >
              <Download className="mr-2 h-4 w-4" />
              Export PDF
            </Button>
          </>
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

      {/* Hidden PDF Document for multi-page capture */}
      {showPDFTemplate && pdfData && (
        <div 
          ref={pdfContainerRef}
          className="fixed top-0 left-0 opacity-0 pointer-events-none z-[-1]"
          style={{ visibility: 'visible' }}
          aria-hidden="true"
        >
          <EstimatePDFDocument
            estimateNumber={pdfData.estimateNumber}
            customerName={pdfData.customerName}
            customerAddress={pdfData.customerAddress}
            customerPhone={pdfData.customerPhone}
            customerEmail={pdfData.customerEmail}
            companyInfo={pdfData.companyInfo}
            companyLocations={pdfData.companyLocations}
            materialItems={pdfData.materialItems}
            laborItems={pdfData.laborItems}
            breakdown={pdfData.breakdown}
            config={pdfData.config}
            finePrintContent={pdfData.finePrintContent}
            options={pdfData.options}
            measurementSummary={pdfData.measurementSummary}
          />
        </div>
      )}


      {/* Estimate Preview Panel */}
      <EstimatePreviewPanel
        open={showPreviewPanel}
        onOpenChange={setShowPreviewPanel}
        estimateNumber={existingEstimateId ? `EST-${existingEstimateId.slice(0, 8)}` : `EST-DRAFT-${Date.now().toString(36).slice(-4)}`}
        estimateDisplayName={estimateDisplayName}
        customerName={customerInfo?.name || 'Customer'}
        customerAddress={customerInfo?.address || ''}
        customerPhone={customerInfo?.phone}
        customerEmail={customerInfo?.email}
        companyInfo={companyInfo}
        materialItems={materialItems}
        laborItems={laborItems}
        breakdown={breakdown}
        config={config}
        finePrintContent={finePrintContent}
        measurementSummary={measurementSummary}
        templateAttachments={templateAttachments}
      />
    </div>
  );
};
