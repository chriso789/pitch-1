import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Plus, Trash2, Loader2, Lock, CheckCircle, Download, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { useCompanyInfo } from '@/hooks/useCompanyInfo';
import { useEffectiveTenantId } from '@/hooks/useEffectiveTenantId';
import { useLatestMeasurement } from '@/hooks/useMeasurement';
import { format } from 'date-fns';
import { LaborOrderExport } from '@/components/orders/LaborOrderExport';
import { MaterialLineItemsExport } from '@/components/orders/MaterialLineItemsExport';
import { PushToSupplierButton } from '@/components/orders/PushToSupplierButton';
import { ShareMaterialsButton } from '@/components/orders/ShareMaterialsButton';
import { colorsForItem } from '@/components/orders/shingleBrandColors';
import { useAbcConnectionStatus } from '@/hooks/useAbcConnectionStatus';
import { InlineSupplierMatch, type SupplierKey, type EstimateLineForMatch } from './InlineSupplierMatch';
import type { AbcCatalogItem } from '@/components/orders/AbcCatalogControls';
import { Parser as ExprParser } from 'expr-eval';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

interface LineItem {
  id: string;
  item_name: string;
  qty: number;
  unit: string;
  unit_cost: number;
  line_total: number;
  notes?: string;
  description?: string | null;
  color_specs?: string | null;
  requires_color?: boolean;
  // Supplier match fields — mirror estimate_line_items columns so the
  // Push-to-Supplier dialog picks them up automatically.
  abc_item_number?: string | null;
  abc_color?: string | null;
  abc_uom?: string | null;
  abc_price?: number | null;
  abc_price_status?: string | null;
  abc_price_timestamp?: string | null;
  abc_availability?: string | null;
  srs_item_code?: string | null;
  product_code?: string | null;
  metadata?: any;
}

interface TemplateSectionSelectorProps {
  pipelineEntryId: string;
  sectionType: 'material' | 'labor';
  onTotalChange?: (total: number) => void;
  isLocked?: boolean;
  lockedAt?: string | null;
  lockedByName?: string | null;
  onLockSuccess?: () => void;
}

export const TemplateSectionSelector: React.FC<TemplateSectionSelectorProps> = ({
  pipelineEntryId,
  sectionType,
  onTotalChange,
  isLocked = false,
  lockedAt,
  lockedByName,
  onLockSuccess
}) => {
  const queryClient = useQueryClient();
  const effectiveTenantId = useEffectiveTenantId();
  const { data: companyInfo } = useCompanyInfo();
  const { data: latestMeasurement } = useLatestMeasurement(pipelineEntryId, !!pipelineEntryId);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const [lineItems, setLineItems] = useState<LineItem[]>([]);
  const [isAddingItem, setIsAddingItem] = useState(false);
  const [newItem, setNewItem] = useState({ item_name: '', qty: 1, unit: 'ea', unit_cost: 0 });
  const [showLockDialog, setShowLockDialog] = useState(false);
  const [isCreatingEstimate, setIsCreatingEstimate] = useState(false);

  // Inline supplier-match state — only used in the material section. The
  // SKU we pick here writes back to the same enhanced_estimates.line_items
  // JSON, so PushToSupplierDialog later sees the same matches.
  const abcConnection = useAbcConnectionStatus();
  const [matchSupplier, setMatchSupplier] = useState<SupplierKey | ''>('');
  const [matchBranch, setMatchBranch] = useState<string>('');
  const [matchShipTo, setMatchShipTo] = useState<string>('');
  const [srsConnected, setSrsConnected] = useState<{ branch?: string; environment?: string } | null>(null);
  const [abcCatalog, setAbcCatalog] = useState<AbcCatalogItem[]>([]);
  const [srsCatalog, setSrsCatalog] = useState<any[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogLoadedKey, setCatalogLoadedKey] = useState<string>('');

  // Fetch templates for this tenant
  const { data: templates, isLoading: templatesLoading } = useQuery({
    queryKey: ['estimate-templates', effectiveTenantId, sectionType],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('estimate_calculation_templates')
        .select('id, name, template_category, base_material_cost_per_sq, base_labor_rate_per_hour')
        .eq('tenant_id', effectiveTenantId)
        .eq('is_active', true)
        .order('name');
      
      if (error) throw error;
      return data || [];
    },
    enabled: !!effectiveTenantId
  });

  // First fetch the selected_estimate_id from pipeline_entries metadata
  // Fetch pipeline data including address info for exports
  const { data: pipelineData, isLoading: pipelineDataLoading } = useQuery({
    queryKey: ['pipeline-selected-estimate', pipelineEntryId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('pipeline_entries')
        .select(`
          metadata,
          lead_number,
          contact:contacts(
            first_name,
            last_name,
            address_street,
            address_city,
            address_state,
            address_zip
          )
        `)
        .eq('id', pipelineEntryId)
        .single();
      
      if (error) throw error;
      console.log('[TemplateSectionSelector] Pipeline metadata loaded:', data?.metadata);
      return data;
    },
    staleTime: 0, // Always refetch to get latest selected_estimate_id
    refetchOnMount: 'always'
  });

  // Use effectiveEstimateId: prefer selected_estimate_id, fallback to enhanced_estimate_id
  const metadata = pipelineData?.metadata as any;
  const effectiveEstimateId = metadata?.selected_estimate_id ?? metadata?.enhanced_estimate_id;

  // Fetch existing estimate to get saved line items - using effectiveEstimateId
  const { data: existingEstimate, isLoading: estimateLoading } = useQuery({
    queryKey: ['enhanced-estimate-items', pipelineEntryId, effectiveEstimateId, sectionType],
    queryFn: async () => {
      if (!effectiveEstimateId) return null;
      
      console.log('[TemplateSectionSelector] Fetching estimate:', effectiveEstimateId, 'for section:', sectionType);
      
      const { data, error } = await supabase
        .from('enhanced_estimates')
        .select('id, line_items, template_id, material_cost_locked_at, labor_cost_locked_at, roof_area_sq_ft, property_details, calculation_metadata')
        .eq('id', effectiveEstimateId)
        .single();
      
      if (error) throw error;
      console.log('[TemplateSectionSelector] Estimate loaded:', { id: data?.id, hasLineItems: !!data?.line_items });
      return data;
    },
    enabled: !!effectiveEstimateId,
    staleTime: 0, // Always consider stale so it refetches
    refetchOnMount: 'always' // Always refetch when component mounts
  });

  // Track loading state
  const isLoadingData = pipelineDataLoading || (!!effectiveEstimateId && estimateLoading);

  // Load line items when estimate data changes - using useEffect for proper state management
  useEffect(() => {
    console.log('[TemplateSectionSelector] useEffect triggered:', {
      hasEstimate: !!existingEstimate,
      estimateId: existingEstimate?.id,
      hasLineItems: !!existingEstimate?.line_items,
      sectionType,
      effectiveEstimateId
    });
    
    if (existingEstimate?.line_items) {
      const items = existingEstimate.line_items as unknown as Record<string, any[]>;
      // Check both possible keys: 'materials'/'labor' and 'material'/'labor'
      const primaryKey = sectionType === 'material' ? 'materials' : 'labor';
      const fallbackKey = sectionType === 'material' ? 'material' : 'labor';
      const rawSectionItems = items[primaryKey] || items[fallbackKey];
      
      console.log('[TemplateSectionSelector] Line items found:', {
        primaryKey,
        fallbackKey,
        itemCount: rawSectionItems?.length || 0,
        keys: Object.keys(items)
      });
      
      if (rawSectionItems && rawSectionItems.length > 0) {
        // Normalize line items - handle qty_original/unit_cost_original fallbacks
        const normalizedItems: LineItem[] = rawSectionItems.map((item: any) => {
          const qty = (item.qty > 0 ? item.qty : (item.qty_original ?? 0));
          const unitCost = (item.unit_cost > 0 ? item.unit_cost : (item.unit_cost_original ?? 0));
          const lineTotal = (item.line_total > 0 ? item.line_total : (qty * unitCost));
          
          return {
            id: item.id || crypto.randomUUID(),
            item_name: item.item_name || item.name || 'Unknown Item',
            qty: qty,
            unit: item.unit || 'ea',
            unit_cost: unitCost,
            line_total: lineTotal,
            notes: item.notes || '',
            // Preserve supplier SKU fields so Push-to-Supplier can map items.
            srs_item_code:
              item.srs_item_code ||
              item.srs_sku ||
              item.product_code ||
              item.sku ||
              item.metadata?.srs_item_code ||
              item.metadata?.srs_sku ||
              null,
            abc_item_number: item.abc_item_number || item.metadata?.abc_item_number || null,
            abc_color: item.abc_color || item.metadata?.abc_color || null,
            abc_uom: item.abc_uom || item.metadata?.abc_uom || null,
            abc_price: item.abc_price ?? null,
            abc_price_status: item.abc_price_status ?? null,
            abc_price_timestamp: item.abc_price_timestamp ?? null,
            abc_availability: item.abc_availability ?? null,
            product_code: item.product_code || item.sku || null,
            color_specs: item.color_specs || item.metadata?.color_specs,
            requires_color: item.requires_color ?? item.metadata?.requires_color ?? false,
            metadata: item.metadata,
          } as any;
        });
        
        setLineItems(normalizedItems);
      }
    }
    
    if (existingEstimate?.template_id) {
      setSelectedTemplateId(existingEstimate.template_id);
    }
  }, [existingEstimate?.id, existingEstimate?.line_items, existingEstimate?.template_id, sectionType, effectiveEstimateId]);

  // Detect connected suppliers + load user's default branch overrides.
  // Materials-only; labor section never shows the supplier picker.
  useEffect(() => {
    if (sectionType !== 'material' || !effectiveTenantId) return;
    let cancelled = false;
    (async () => {
      const { data: authData } = await supabase.auth.getUser();
      const userId = authData?.user?.id;
      let prefs: Record<string, string> = {};
      if (userId) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('default_supplier_branches')
          .eq('id', userId)
          .maybeSingle();
        prefs = ((profile as any)?.default_supplier_branches as Record<string, string>) || {};
      }
      const { data: srsRow } = await supabase
        .from('srs_connections')
        .select('default_branch_code, environment, connection_status, valid_indicator')
        .eq('tenant_id', effectiveTenantId as any)
        .maybeSingle();
      if (cancelled) return;
      if (srsRow && ((srsRow as any).connection_status === 'connected' || (srsRow as any).valid_indicator)) {
        setSrsConnected({
          branch: prefs.srs || (srsRow as any).default_branch_code,
          environment: (srsRow as any).environment,
        });
      }
      // Auto-pick: prefer ABC if connected, else SRS.
      setMatchSupplier((prev) => {
        if (prev) return prev;
        if (abcConnection.isConnected) return 'abc';
        if (srsRow && ((srsRow as any).connection_status === 'connected' || (srsRow as any).valid_indicator)) return 'srs';
        return '';
      });
      // Seed branch from user pref / connection default.
      // Sandbox fallback: ABC sandbox tenants get the demo branch '1209'.
      const isAbcSandbox = abcConnection.isConnected && abcConnection.environment !== 'production';
      setMatchBranch((prev) => {
        if (prev) return prev;
        if (abcConnection.isConnected) {
          return prefs.abc || abcConnection.defaultBranchCode || (isAbcSandbox ? '1209' : '');
        }
        return prefs.srs || (srsRow as any)?.default_branch_code || '';
      });
    })();
    return () => { cancelled = true; };
  }, [sectionType, effectiveTenantId, abcConnection.isConnected, abcConnection.defaultBranchCode, abcConnection.environment]);

  // Load ABC catalog once per (branch, supplier) so the inline match can
  // resolve descriptions + auto-pick best matches. We search with a broad
  // query that returns the top SKUs for the branch; the per-row scorer
  // does the final pick. Keeping this a single load keeps API usage low.
  useEffect(() => {
    if (sectionType !== 'material' || !matchSupplier || !matchBranch || !effectiveTenantId) return;
    // Key includes a hash of current line-item names so the catalog reloads
    // when the user adds/removes materials with new product families.
    const itemSig = lineItems.map((li) => li.item_name).join('|');
    const key = `${matchSupplier}:${matchBranch}:${itemSig.length}:${itemSig.slice(0, 80)}`;
    if (catalogLoadedKey === key) return;
    setCatalogLoading(true);
    (async () => {
      try {
        if (matchSupplier === 'abc') {
          // Derive search tokens FROM the actual estimate line items instead
          // of a hard-coded generic list. Roofing items like
          // "GAF EverGuard TPO Bonding Adhesive" should produce queries like
          // "everguard", "tpo", "bonding", "adhesive" so the ABC catalog
          // pull actually contains matching SKUs.
          const STOP = new Set([
            'the','a','an','and','or','for','with','of','to','in','on','per','mil',
            'roll','box','pail','tube','pkg','bundle','board','bag','case','each','ea',
            'gaf','certainteed','owens','corning','iko','tamko','malarkey','atlas', // brand-only words are too broad
            'gallon','oz','lb','lbs','ft','inch','in','sq','sqft',
          ]);
          const tokens = new Map<string, number>();
          for (const li of lineItems) {
            const txt = `${li.item_name || ''} ${(li as any).description || ''}`.toLowerCase();
            for (const raw of txt.split(/[^a-z0-9]+/)) {
              const t = raw.trim();
              if (!t || t.length < 3 || STOP.has(t) || /^\d+$/.test(t)) continue;
              tokens.set(t, (tokens.get(t) || 0) + 1);
            }
          }
          // Take the top distinctive tokens; cap to keep API calls reasonable.
          const queries = Array.from(tokens.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 12)
            .map(([t]) => t);
          // Always include a couple of broad fallbacks so unmatched generic
          // rows (e.g. "Nails") still get some catalog coverage.
          for (const fallback of ['shingle', 'underlayment', 'flashing']) {
            if (!queries.includes(fallback)) queries.push(fallback);
          }
          const merged = new Map<string, AbcCatalogItem>();
          const env: 'sandbox' | 'production' = abcConnection.environment === 'production' ? 'production' : 'sandbox';
          // Fire searches in parallel; each call returns up to itemsPerPage rows.
          const responses = await Promise.allSettled(
            queries.map((q) =>
              supabase.functions.invoke('abc-api-proxy', {
                body: {
                  action: 'search_products',
                  tenant_id: effectiveTenantId,
                  environment: env,
                  query: q,
                  branchNumber: matchBranch.trim(),
                  itemsPerPage: 50,
                },
              }),
            ),
          );
          for (const res of responses) {
            if (res.status !== 'fulfilled') continue;
            const { data, error } = res.value;
            if (error || !data?.success) continue;
            const body = data.body;
            const raw = Array.isArray(body) ? body
              : Array.isArray(body?.items) ? body.items
              : Array.isArray(body?.data) ? body.data
              : Array.isArray(body?.results) ? body.results : [];
            for (const r of raw) {
              const itemNumber = String(r.itemNumber ?? r.item_number ?? r.sku ?? r.productNumber ?? '').trim();
              if (!itemNumber) continue;
              const k = `${itemNumber}::${r.colorOption ?? r.color ?? r.option ?? ''}`;
              if (merged.has(k)) continue;
              merged.set(k, {
                itemNumber,
                itemDescription: String(r.itemDescription ?? r.description ?? r.itemDesc ?? r.productName ?? r.name ?? '').trim(),
                color: r.colorOption ?? r.color ?? r.option ?? r.colorName ?? null,
                uom: r.unitOfMeasure ?? r.uom ?? r.baseUom ?? r.salesUom ?? null,
                raw: r,
              });
            }
          }
          setAbcCatalog(Array.from(merged.values()));
        } else if (matchSupplier === 'srs') {
          const { data, error } = await supabase.functions.invoke('srs-api-proxy', {
            body: { action: 'get_products', tenant_id: effectiveTenantId, branch_code: matchBranch.trim() },
          });
          if (!error) {
            setSrsCatalog(Array.isArray(data?.products) ? data.products : []);
          }
        }
        setCatalogLoadedKey(key);
      } finally {
        setCatalogLoading(false);
      }
    })();
  }, [sectionType, matchSupplier, matchBranch, effectiveTenantId, abcConnection.environment, catalogLoadedKey, lineItems]);




  // Save line items mutation
  const saveLineItemsMutation = useMutation({
    mutationFn: async (payload: LineItem[] | { items: LineItem[]; templateId?: string }) => {
      const items = Array.isArray(payload) ? payload : payload.items;
      const templateIdToSave = Array.isArray(payload) ? selectedTemplateId : payload.templateId ?? selectedTemplateId;
      const sectionKey = sectionType === 'material' ? 'materials' : 'labor';
      const costKey = sectionType === 'material' ? 'material_cost' : 'labor_cost';
      const total = items.reduce((sum, item) => sum + item.line_total, 0);

      // Use the effectiveEstimateId - this is the canonical source
      if (!effectiveEstimateId) {
        throw new Error('No estimate selected. Please select an estimate first.');
      }

      // Get existing line items from the selected estimate to preserve the other section
      const { data: existing, error: fetchError } = await supabase
        .from('enhanced_estimates')
        .select('id, line_items, material_cost, labor_cost')
        .eq('id', effectiveEstimateId)
        .single();

      if (fetchError) throw fetchError;
      if (!existing) throw new Error('Selected estimate not found');

      const existingLineItems = (existing?.line_items as unknown as Record<string, LineItem[]>) || {};
      const updatedLineItems = {
        ...existingLineItems,
        [sectionKey]: items
      } as unknown as Record<string, unknown>;

      // Only update cost columns and line_items — do NOT touch selling_price
      // The selling_price is set by the estimate builder and must not be overwritten
      const { error } = await (supabase
        .from('enhanced_estimates') as any)
        .update({
          line_items: updatedLineItems as any,
          [costKey]: total,
          template_id: templateIdToSave || null
        })
        .eq('id', effectiveEstimateId);
      if (error) throw error;

      return total;
    },
    onSuccess: (total) => {
      // Invalidate all estimate-related queries for cache synchronization
      queryClient.invalidateQueries({ queryKey: ['enhanced-estimate-items', pipelineEntryId] });
      queryClient.invalidateQueries({ queryKey: ['hyperlink-data', pipelineEntryId] });
      queryClient.invalidateQueries({ queryKey: ['estimate-costs', pipelineEntryId] });
      queryClient.invalidateQueries({ queryKey: ['cost-lock-status', pipelineEntryId] });
      onTotalChange?.(total);
      toast.success('Line items saved');
    },
    onError: (error: Error) => {
      toast.error(`Failed to save: ${error.message}`);
    }
  });

  const buildTemplateTags = (): Record<string, number> => {
    const tags: Record<string, number> = {};
    const sourceTags = (latestMeasurement as any)?.tags || {};
    Object.entries(sourceTags).forEach(([key, value]) => {
      tags[key] = Number(value) || 0;
    });

    const totals = (latestMeasurement as any)?.measurement?.totals || {};
    Object.entries(totals).forEach(([key, value]) => {
      tags[key] = tags[key] || Number(value) || 0;
    });

    const estimateDetails = ((existingEstimate as any)?.property_details || {}) as Record<string, any>;
    const estimateMeta = ((existingEstimate as any)?.calculation_metadata || {}) as Record<string, any>;
    const roofArea = Number(
      (existingEstimate as any)?.roof_area_sq_ft ||
      estimateDetails.roof_area_sq_ft ||
      estimateMeta.roof_area_sq_ft ||
      metadata?.roof_area_sq_ft ||
      tags['roof.total_sqft'] ||
      tags['roof.plan_sqft'] ||
      0
    );
    const squares = Number(tags['roof.squares'] || roofArea / 100 || 0);

    tags['roof.total_sqft'] = tags['roof.total_sqft'] || roofArea;
    tags['roof.area'] = tags['roof.area'] || roofArea;
    tags['roof.squares'] = squares;
    [8, 10, 12, 15, 17, 20].forEach((pct) => {
      tags[`waste.${pct}pct.sqft`] = tags[`waste.${pct}pct.sqft`] || roofArea * (1 + pct / 100);
      tags[`waste.${pct}pct.squares`] = tags[`waste.${pct}pct.squares`] || squares * (1 + pct / 100);
    });
    ['ridge', 'hip', 'valley', 'eave', 'rake', 'step', 'wall'].forEach((key) => {
      tags[`lf.${key}`] = tags[`lf.${key}`] || 0;
    });
    tags['pen.pipe_vent'] = tags['pen.pipe_vent'] || 2;
    return tags;
  };

  const evaluateQtyFormula = (formula: string, tags: Record<string, number>): number => {
    if (!formula) return 1;
    const directNumber = Number(formula);
    if (Number.isFinite(directNumber)) return directNumber;

    try {
      const vars: Record<string, any> = { ceil: Math.ceil, floor: Math.floor, round: Math.round, max: Math.max, min: Math.min, abs: Math.abs };
      let expression = formula.replace(/\{\{\s*(.+?)\s*\}\}/g, (_match, expr) => expr);
      Object.entries(tags).forEach(([key, value]) => {
        vars[key.replace(/\./g, '_')] = value;
        const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        expression = expression.replace(new RegExp(escapedKey, 'g'), key.replace(/\./g, '_'));
      });
      const value = new ExprParser().parse(expression).evaluate(vars);
      return Number.isFinite(Number(value)) ? Number(value) : 0;
    } catch (error) {
      console.warn('[TemplateSectionSelector] Failed to evaluate template formula:', formula, error);
      return 0;
    }
  };

  // Handle template selection - load the actual saved template line items
  const handleTemplateSelect = async (templateId: string) => {
    setSelectedTemplateId(templateId);
    const template = templates?.find(t => t.id === templateId);
    if (!template) return;

    if (!effectiveEstimateId) {
      toast.error('Select or create an estimate before applying a template');
      return;
    }

    const { data: templateItems, error } = await supabase
      .from('estimate_calc_template_items')
      .select('id, item_name, description, unit, unit_cost, qty_formula, item_type, sort_order, requires_color')
      .eq('calc_template_id', templateId)
      .eq('tenant_id', effectiveTenantId)
      .eq('item_type', sectionType)
      .eq('active', true)
      .order('sort_order');

    if (error) {
      toast.error(`Failed to load template: ${error.message}`);
      return;
    }

    if (!templateItems?.length) {
      toast.error(`No ${sectionType} items found in this template`);
      return;
    }

    const tags = buildTemplateTags();
    const calculatedItems: LineItem[] = templateItems.map((item: any) => {
      const qty = evaluateQtyFormula(item.qty_formula, tags);
      const unitCost = Number(item.unit_cost) || 0;
      return {
        id: crypto.randomUUID(),
        item_name: item.item_name,
        qty,
        unit: item.unit || 'ea',
        unit_cost: unitCost,
        line_total: qty * unitCost,
        notes: item.description || '',
        requires_color: !!item.requires_color,
      } as any;
    });

    setLineItems(calculatedItems);
    saveLineItemsMutation.mutate({ items: calculatedItems, templateId });
    toast.success(`${template.name} applied with ${calculatedItems.length} ${sectionType} items`);
  };

  // Update a line item
  const handleUpdateItem = (id: string, field: keyof LineItem, value: number | string) => {
    const updatedItems = lineItems.map(item => {
      if (item.id === id) {
        const updated = { ...item, [field]: value };
        // Recalculate line total
        if (field === 'qty' || field === 'unit_cost') {
          updated.line_total = updated.qty * updated.unit_cost;
        }
        return updated;
      }
      return item;
    });
    setLineItems(updatedItems);
  };

  // Remove a line item
  const handleRemoveItem = (id: string) => {
    const filtered = lineItems.filter(item => item.id !== id);
    setLineItems(filtered);
    saveLineItemsMutation.mutate(filtered);
  };

  // Create estimate if none exists, then add item
  const handleCreateEstimateAndAddItem = async () => {
    if (!effectiveTenantId) {
      toast.error('Unable to determine tenant');
      return;
    }

    setIsCreatingEstimate(true);
    try {
      // Create a new enhanced_estimate for this pipeline entry
      const { data: newEstimate, error: createError } = await supabase
        .from('enhanced_estimates')
        .insert({
          pipeline_entry_id: pipelineEntryId,
          tenant_id: effectiveTenantId,
          status: 'draft',
          line_items: { materials: [], labor: [] }
        } as any)
        .select()
        .single();

      if (createError) throw createError;

      // Update pipeline entry metadata with the new estimate ID
      const { data: pipelineEntry } = await supabase
        .from('pipeline_entries')
        .select('metadata')
        .eq('id', pipelineEntryId)
        .single();

      const existingMetadata = (pipelineEntry?.metadata as Record<string, any>) || {};
      
      const { error: updateError } = await supabase
        .from('pipeline_entries')
        .update({
          metadata: {
            ...existingMetadata,
            selected_estimate_id: newEstimate.id,
            enhanced_estimate_id: newEstimate.id
          }
        })
        .eq('id', pipelineEntryId);

      if (updateError) throw updateError;

      // Invalidate queries to refresh the estimate data
      queryClient.invalidateQueries({ queryKey: ['pipeline-selected-estimate', pipelineEntryId] });
      queryClient.invalidateQueries({ queryKey: ['enhanced-estimate-items', pipelineEntryId] });
      
      toast.success('Estimate created');
      
      // Now show the add item form
      setIsAddingItem(true);
    } catch (error: any) {
      console.error('Error creating estimate:', error);
      toast.error(error.message || 'Failed to create estimate');
    } finally {
      setIsCreatingEstimate(false);
    }
  };

  // Add new item
  const handleAddItem = async () => {
    if (!newItem.item_name) return;

    // If no estimate exists, create one first
    if (!effectiveEstimateId) {
      await handleCreateEstimateAndAddItem();
      return;
    }
    
    const item: LineItem = {
      id: crypto.randomUUID(),
      item_name: newItem.item_name,
      qty: newItem.qty,
      unit: newItem.unit,
      unit_cost: newItem.unit_cost,
      line_total: newItem.qty * newItem.unit_cost
    };
    
    const updatedItems = [...lineItems, item];
    setLineItems(updatedItems);
    saveLineItemsMutation.mutate(updatedItems);
    setNewItem({ item_name: '', qty: 1, unit: 'ea', unit_cost: 0 });
    setIsAddingItem(false);
  };

  // Save current items
  const handleSave = () => {
    saveLineItemsMutation.mutate(lineItems);
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2
    }).format(amount);
  };

  const sectionTotal = lineItems.reduce((sum, item) => sum + item.line_total, 0);

  return (
    <div className="space-y-4">
      {/* Template Selector */}
      <div className="flex items-center gap-4">
        <div className="flex-1">
          <label className="text-sm font-medium text-muted-foreground mb-1 block">
            Select {sectionType === 'material' ? 'Material' : 'Labor'} Template
          </label>
          <Select value={selectedTemplateId} onValueChange={handleTemplateSelect}>
            <SelectTrigger>
              <SelectValue placeholder="Choose a template..." />
            </SelectTrigger>
            <SelectContent>
              {templatesLoading ? (
                <SelectItem value="loading" disabled>Loading...</SelectItem>
              ) : templates?.length === 0 ? (
                <SelectItem value="none" disabled>No templates available</SelectItem>
              ) : (
                templates?.map((template) => (
                  <SelectItem key={template.id} value={template.id}>
                    {template.name} 
                    <span className="text-muted-foreground ml-2">
                      ({template.template_category})
                    </span>
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Loading State */}
      {isLoadingData && (
        <div className="flex items-center justify-center py-8 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" />
          <span>Loading {sectionType === 'material' ? 'materials' : 'labor'} line items...</span>
        </div>
      )}

      {/* Supplier match picker — materials only */}
      {!isLoadingData && sectionType === 'material' && lineItems.length > 0 && (abcConnection.isConnected || srsConnected) && (
        <div className="flex flex-wrap items-end gap-3 p-3 border rounded-lg bg-muted/30">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Match to supplier</label>
            <Select
              value={matchSupplier || ''}
              onValueChange={(v) => {
                setMatchSupplier(v as SupplierKey);
                if (v === 'abc') setMatchBranch(abcConnection.defaultBranchCode || (abcConnection.environment !== 'production' ? '1209' : '') || matchBranch);
                if (v === 'srs') setMatchBranch(srsConnected?.branch || matchBranch);
                setCatalogLoadedKey('');
              }}
            >
              <SelectTrigger className="h-8 w-[200px]"><SelectValue placeholder="Pick supplier…" /></SelectTrigger>
              <SelectContent>
                {abcConnection.isConnected && (
                  <SelectItem value="abc">ABC Supply{abcConnection.environment === 'production' ? '' : ' (Sandbox)'}</SelectItem>
                )}
                {srsConnected && (
                  <SelectItem value="srs">SRS Distribution{srsConnected.environment === 'production' ? '' : ' (QA)'}</SelectItem>
                )}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Branch</label>
            <Input
              value={matchBranch}
              onChange={(e) => { setMatchBranch(e.target.value); setCatalogLoadedKey(''); }}
              placeholder={matchSupplier === 'abc' ? 'ABC branch #' : 'SRS branch code'}
              className="h-8 w-[140px]"
            />
          </div>
          {matchSupplier === 'abc' && (
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">Ship-to (for live price)</label>
              <Input
                value={matchShipTo}
                onChange={(e) => setMatchShipTo(e.target.value)}
                placeholder="ABC ship-to #"
                className={`h-8 w-[160px] ${!matchShipTo ? 'border-amber-400' : ''}`}
              />
            </div>
          )}
          {catalogLoading && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" /> Loading catalog…
            </div>
          )}
          {matchSupplier === 'abc' && !matchShipTo && !catalogLoading && (
            <div className="flex items-center gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
              <AlertCircle className="h-3 w-3" />
              Enter an ABC ship-to # to fetch live customer pricing — catalog matching will still run without it.
            </div>
          )}
        </div>
      )}


      {/* Line Items Table */}
      {!isLoadingData && lineItems.length > 0 && (
        <div className="border rounded-lg overflow-hidden">
          <Table className="table-fixed">

            <TableHeader>
              <TableRow>
                <TableHead className="w-[30%]">Item Name</TableHead>
                <TableHead className="w-[15%]">Color / Notes</TableHead>
                <TableHead className="w-[10%] text-right">Qty</TableHead>
                <TableHead className="w-[10%]">Unit</TableHead>
                <TableHead className="w-[15%] text-right">Unit Cost</TableHead>
                <TableHead className="w-[15%] text-right">Line Total</TableHead>
                <TableHead className="w-[5%]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lineItems.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="font-medium align-top min-w-0">
                    <div className="truncate" title={item.item_name}>{item.item_name}</div>

                    {sectionType === 'material' && matchSupplier && effectiveTenantId && (
                      <InlineSupplierMatch
                        tenantId={effectiveTenantId}
                        supplier={matchSupplier}
                        environment={abcConnection.environment === 'production' ? 'production' : 'sandbox'}
                        branchCode={matchBranch}
                        shipToNumber={matchShipTo}
                        item={item as EstimateLineForMatch}
                        abcCatalog={abcCatalog}
                        srsCatalog={srsCatalog}
                        catalogLoading={catalogLoading}
                        onChange={(patch) => {
                          const updated = lineItems.map((li) => li.id === item.id ? { ...li, ...patch } : li);
                          setLineItems(updated);
                          saveLineItemsMutation.mutate(updated);
                        }}
                      />
                    )}
                  </TableCell>
                  <TableCell>
                    {isLocked ? (
                      <span className="text-sm text-muted-foreground">{item.notes || '—'}</span>
                    ) : (() => {
                      const { brand, colors } = colorsForItem(item.item_name);
                      const current = item.notes || '';
                      const inList = colors.includes(current);
                      // No brand match → keep simple free-text input
                      if (!brand || colors.length === 0) {
                        return (
                          <Input
                            value={current}
                            onChange={(e) => handleUpdateItem(item.id, 'notes', e.target.value)}
                            onBlur={handleSave}
                            placeholder="e.g. Weathered Wood"
                            className="h-8 text-sm font-medium"
                          />
                        );
                      }
                      const selectValue = !current ? '' : inList ? current : '__custom__';
                      return (
                        <div className="flex flex-col gap-1">
                          <Select
                            value={selectValue}
                            onValueChange={(v) => {
                              if (v === '__custom__') {
                                handleUpdateItem(item.id, 'notes', current && !inList ? current : ' ');
                              } else {
                                handleUpdateItem(item.id, 'notes', v);
                                handleSave();
                              }
                            }}
                          >
                            <SelectTrigger className="h-8 text-sm">
                              <SelectValue placeholder={`${brand} color…`} />
                            </SelectTrigger>
                            <SelectContent>
                              {colors.map((c) => (
                                <SelectItem key={c} value={c}>{c}</SelectItem>
                              ))}
                              <SelectItem value="__custom__">Custom…</SelectItem>
                            </SelectContent>
                          </Select>
                          {selectValue === '__custom__' && (
                            <Input
                              value={current === ' ' ? '' : current}
                              autoFocus
                              onChange={(e) => handleUpdateItem(item.id, 'notes', e.target.value)}
                              onBlur={handleSave}
                              placeholder="Custom color / notes"
                              className="h-8 text-sm"
                            />
                          )}
                        </div>
                      );
                    })()}
                  </TableCell>
                  <TableCell>
                    {isLocked ? (
                      <span className="text-right block">{item.qty}</span>
                    ) : (
                      <Input
                        type="number"
                        value={item.qty}
                        onChange={(e) => handleUpdateItem(item.id, 'qty', parseFloat(e.target.value) || 0)}
                        onBlur={handleSave}
                        className="h-8 text-right"
                      />
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{item.unit}</TableCell>
                  <TableCell>
                    {isLocked ? (
                      <span className="text-right block">{formatCurrency(item.unit_cost)}</span>
                    ) : (
                      <Input
                        type="number"
                        step="0.01"
                        value={item.unit_cost}
                        onChange={(e) => handleUpdateItem(item.id, 'unit_cost', parseFloat(e.target.value) || 0)}
                        onBlur={handleSave}
                        className="h-8 text-right"
                      />
                    )}
                  </TableCell>
                  <TableCell className="text-right font-semibold">
                    {formatCurrency(item.line_total)}
                  </TableCell>
                  <TableCell>
                    {!isLocked && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:text-destructive"
                        onClick={() => handleRemoveItem(item.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Add Item Form - ALWAYS show if not locked and not loading */}
      {!isLocked && !isLoadingData && (
        isAddingItem ? (
          <div className="flex items-end gap-2 p-3 border rounded-lg bg-muted/30">
            <div className="flex-1">
              <label className="text-xs text-muted-foreground">Item Name</label>
              <Input
                value={newItem.item_name}
                onChange={(e) => setNewItem({ ...newItem, item_name: e.target.value })}
                placeholder="Item name"
                className="h-8"
              />
            </div>
            <div className="w-20">
              <label className="text-xs text-muted-foreground">Qty</label>
              <Input
                type="number"
                value={newItem.qty}
                onChange={(e) => setNewItem({ ...newItem, qty: parseFloat(e.target.value) || 0 })}
                className="h-8"
              />
            </div>
            <div className="w-20">
              <label className="text-xs text-muted-foreground">Unit</label>
              <Input
                value={newItem.unit}
                onChange={(e) => setNewItem({ ...newItem, unit: e.target.value })}
                className="h-8"
              />
            </div>
            <div className="w-24">
              <label className="text-xs text-muted-foreground">Unit Cost</label>
              <Input
                type="number"
                step="0.01"
                value={newItem.unit_cost}
                onChange={(e) => setNewItem({ ...newItem, unit_cost: parseFloat(e.target.value) || 0 })}
                className="h-8"
              />
            </div>
            <Button onClick={handleAddItem} size="sm" disabled={isCreatingEstimate}>
              {isCreatingEstimate ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Add'}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setIsAddingItem(false)}>Cancel</Button>
          </div>
        ) : (
          <Button 
            variant="outline" 
            className="w-full" 
            onClick={() => {
              if (!effectiveEstimateId) {
                handleCreateEstimateAndAddItem();
              } else {
                setIsAddingItem(true);
              }
            }}
            disabled={isCreatingEstimate}
          >
            {isCreatingEstimate ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Plus className="h-4 w-4 mr-2" />
            )}
            {!effectiveEstimateId ? 'Create Estimate & Add Line Item' : 'Add Line Item'}
          </Button>
        )
      )}

      {/* Section Total */}
      <div className="flex items-center justify-between pt-4 border-t">
        <span className="text-lg font-semibold">
          {sectionType === 'material' ? 'Materials' : 'Labor'} Total
        </span>
        <div className="flex items-center gap-2">
          {saveLineItemsMutation.isPending && (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          )}
          {/* Export buttons */}
          {(() => {
            const contact = pipelineData?.contact as any;
            const customerName = contact ? `${contact.first_name || ''} ${contact.last_name || ''}`.trim() : undefined;
            const projectAddress = contact?.address_street 
              ? [contact.address_street, contact.address_city, contact.address_state, contact.address_zip].filter(Boolean).join(', ')
              : undefined;
            const jobNumber = (pipelineData as any)?.lead_number || undefined;
            
            return (
              <>
                {lineItems.length > 0 && sectionType === 'material' && existingEstimate?.id && (
                  <>
                    <MaterialLineItemsExport
                      estimateId={existingEstimate.id}
                      materialItems={lineItems}
                      totalAmount={sectionTotal}
                      customerName={customerName}
                      projectAddress={projectAddress}
                      companyInfo={companyInfo || undefined}
                      jobNumber={jobNumber}
                    />
                    <PushToSupplierButton
                      estimateId={existingEstimate.id}
                      jobId={pipelineEntryId}
                      jobNumber={jobNumber}
                      customerName={customerName}
                      projectAddress={projectAddress}
                      items={lineItems.map((li: any) => ({
                        id: li.id,
                        item_name: li.item_name,
                        qty: Number(li.qty || 0),
                        unit: li.unit || 'EA',
                        unit_cost: Number(li.unit_cost || 0),
                        notes: li.notes,
                        color_specs: li.color_specs,
                        srs_item_code: li.srs_item_code || li.product_code,
                        requires_color: !!(li.requires_color ?? li.metadata?.requires_color),
                      }))}
                    />
                    <ShareMaterialsButton
                      items={lineItems.map((li: any) => ({
                        item_name: li.item_name,
                        qty: Number(li.qty || 0),
                        unit: li.unit || 'EA',
                        unit_cost: Number(li.unit_cost || 0),
                        srs_item_code: li.srs_item_code || li.product_code,
                        notes: li.notes,
                      }))}
                      totalAmount={sectionTotal}
                      customerName={customerName}
                      projectAddress={projectAddress}
                      jobNumber={jobNumber}
                      companyName={companyInfo?.name}
                    />
                  </>
                )}
                {lineItems.length > 0 && sectionType === 'labor' && existingEstimate?.id && (
                  <LaborOrderExport
                    estimateId={existingEstimate.id}
                    pipelineEntryId={pipelineEntryId}
                    laborItems={lineItems}
                    totalAmount={sectionTotal}
                    customerName={customerName}
                    projectAddress={projectAddress}
                    companyInfo={companyInfo || undefined}
                    jobNumber={jobNumber}
                  />
                )}
              </>
            );
          })()}
          <Badge variant="secondary" className="text-lg px-4 py-1">
            {formatCurrency(sectionTotal)}
          </Badge>
        </div>
      </div>

      {/* Lock Status or Lock Button */}
      {isLocked ? (
        <div className="mt-4 p-4 bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 rounded-lg">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CheckCircle className="h-5 w-5 text-green-600" />
              <div>
                <p className="text-sm font-medium text-green-800 dark:text-green-200">
                  Original {sectionType === 'material' ? 'Material' : 'Labor'} Cost Locked
                </p>
                <p className="text-xs text-green-600 dark:text-green-400">
                  {lockedAt && format(new Date(lockedAt), 'MMM d, yyyy h:mm a')}
                  {lockedByName && ` by ${lockedByName}`}
                </p>
              </div>
            </div>
            <span className="text-lg font-bold text-green-800 dark:text-green-200">
              {formatCurrency(sectionTotal)}
            </span>
          </div>
        </div>
      ) : lineItems.length > 0 ? (
        <div className="mt-3 flex justify-end">
          <AlertDialog open={showLockDialog} onOpenChange={setShowLockDialog}>
            <AlertDialogTrigger asChild>
              <Button
                size="sm"
                variant="outline"
                className="border-green-600 text-green-700 hover:bg-green-50 hover:text-green-800 dark:text-green-400 dark:border-green-700 dark:hover:bg-green-950/40"
                disabled={lineItems.length === 0}
              >
                <Lock className="h-3.5 w-3.5 mr-1.5" />
                Lock {sectionType === 'material' ? 'Material' : 'Labor'} Baseline
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Lock {sectionType === 'material' ? 'Material' : 'Labor'} Costs?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will lock the current {sectionType} cost of <strong>{formatCurrency(sectionTotal)}</strong> as the original baseline for cost verification.
                  <br /><br />
                  Once locked, this amount will be used to compare against actual invoices during the Final Inspection phase.
                  <br /><br />
                  <strong>This action cannot be undone.</strong>
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-green-600 hover:bg-green-700"
                  onClick={async () => {
                    try {
                      // Use estimate_id directly if available, otherwise fall back to pipeline_entry_id
                      const lockPayload = existingEstimate?.id 
                        ? { estimate_id: existingEstimate.id, section: sectionType }
                        : { pipeline_entry_id: pipelineEntryId, section: sectionType };
                      
                      const { data, error } = await supabase.functions.invoke('lock-original-costs', {
                        body: lockPayload
                      });
                      if (error) throw error;
                      toast.success(data.message);
                      queryClient.invalidateQueries({ queryKey: ['enhanced-estimate-items', pipelineEntryId] });
                      queryClient.invalidateQueries({ queryKey: ['cost-lock-status', pipelineEntryId] });
                      queryClient.invalidateQueries({ queryKey: ['pipeline-selected-estimate', pipelineEntryId] });
                      onLockSuccess?.();
                    } catch (error: any) {
                      toast.error(error.message || 'Failed to lock costs');
                    }
                  }}
                >
                  <Lock className="h-4 w-4 mr-2" />
                  Lock {sectionType === 'material' ? 'Material' : 'Labor'} Cost
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      ) : null}
    </div>
  );
};
