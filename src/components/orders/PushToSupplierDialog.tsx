import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Truck, Loader2, Package, AlertCircle, Search } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { useEffectiveTenantId } from '@/hooks/useEffectiveTenantId';

type SupplierKey = 'srs' | 'qxo' | 'abc';

interface SupplierOption {
  key: SupplierKey;
  label: string;
  defaultBranch?: string | null;
  environment?: string | null;
  status?: 'connected' | 'error' | 'not_configured' | 'coming_soon';
  statusNote?: string;
}

interface MaterialItem {
  id?: string;
  item_name: string;
  description?: string;
  quantity: number;
  unit: string;
  unit_cost: number;
  srs_item_code?: string | null;
  color_specs?: string;
  requires_color?: boolean;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  projectId: string;
  estimateId?: string;
  jobNumber?: string;
  customerName?: string;
  projectAddress?: string;
  items: MaterialItem[];
  onSubmitted?: () => void;
}

type DeliveryMethod = 'roof_load' | 'ground_drop' | 'pickup';

export function PushToSupplierDialog({
  open, onOpenChange, projectId, estimateId, jobNumber,
  customerName, projectAddress, items, onSubmitted,
}: Props) {
  const { toast } = useToast();
  const tenantId = useEffectiveTenantId();
  const [loadingSuppliers, setLoadingSuppliers] = useState(false);
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([]);
  const [selected, setSelected] = useState<SupplierKey | null>(null);
  const [branchCode, setBranchCode] = useState('');
  const [userBranchPrefs, setUserBranchPrefs] = useState<Record<string, string>>({});
  const [deliveryMethod, setDeliveryMethod] = useState<DeliveryMethod>('roof_load');
  const [deliveryDate, setDeliveryDate] = useState<string>(() => {
    const d = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
    return d.toISOString().slice(0, 10);
  });
  const [shipAddress, setShipAddress] = useState(projectAddress || '');
  const [notes, setNotes] = useState('');
  const [editableItems, setEditableItems] = useState<MaterialItem[]>(items);
  const [submitting, setSubmitting] = useState(false);
  const [srsCatalog, setSrsCatalog] = useState<any[]>([]);
  const [srsCatalogLoading, setSrsCatalogLoading] = useState(false);
  const [srsCatalogBranch, setSrsCatalogBranch] = useState<string>('');

  useEffect(() => {
    setEditableItems(items);
  }, [items]);

  useEffect(() => {
    setShipAddress(projectAddress || '');
  }, [projectAddress]);

  useEffect(() => {
    if (!open || !tenantId) return;
    let cancelled = false;

    (async () => {
      setLoadingSuppliers(true);
      const found: SupplierOption[] = [];

      // Load the signed-in user's per-supplier default branch overrides.
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

      const [srsRes, qxoRes, abcRes] = await Promise.all([
        supabase
          .from('srs_connections')
          .select('default_branch_code, environment, connection_status, valid_indicator')
          .eq('tenant_id', tenantId as any)
          .maybeSingle(),
        supabase
          .from('qxo_connections')
          .select('default_branch_code, environment, connection_status')
          .eq('tenant_id', tenantId as any)
          .maybeSingle(),
        supabase
          .from('abc_connections')
          .select('default_branch_code, environment, connection_status')
          .eq('tenant_id', tenantId as any)
          .maybeSingle(),
      ]);

      if (srsRes.data && (srsRes.data.connection_status === 'connected' || srsRes.data.valid_indicator)) {
        found.push({
          key: 'srs',
          label: `SRS Distribution${srsRes.data.environment === 'production' ? '' : ' (QA)'}`,
          defaultBranch: prefs.srs || srsRes.data.default_branch_code,
          environment: srsRes.data.environment,
          status: 'connected',
        });
      } else {
        found.push({
          key: 'srs',
          label: 'SRS Distribution',
          status: 'not_configured',
          statusNote: 'Connect in Settings → Integrations',
        });
      }

      if (qxoRes.data && qxoRes.data.connection_status === 'connected') {
        found.push({
          key: 'qxo',
          label: `QXO / Beacon${qxoRes.data.environment === 'production' ? '' : ' (Test)'}`,
          defaultBranch: prefs.qxo || qxoRes.data.default_branch_code,
          environment: qxoRes.data.environment,
          status: 'connected',
        });
      } else {
        found.push({
          key: 'qxo',
          label: 'QXO / Beacon',
          environment: qxoRes.data?.environment,
          status: qxoRes.data ? 'error' : 'not_configured',
          statusNote: qxoRes.data
            ? 'Connection error — re-authenticate in Settings → Integrations'
            : 'Connect in Settings → Integrations',
        });
      }

      if (abcRes.data && abcRes.data.connection_status === 'connected') {
        found.push({
          key: 'abc',
          label: `ABC Supply${abcRes.data.environment === 'production' ? '' : ' (Sandbox)'}`,
          defaultBranch: prefs.abc || abcRes.data.default_branch_code,
          environment: abcRes.data.environment,
          status: 'connected',
        });
      } else {
        const status = abcRes.data?.connection_status;
        const isPending = status === 'pending' || (abcRes.data && !abcRes.data.connection_status);
        found.push({
          key: 'abc',
          label: 'ABC Supply',
          defaultBranch: null,
          environment: abcRes.data?.environment ?? null,
          status: abcRes.data ? 'error' : 'not_configured',
          statusNote: !abcRes.data
            ? 'Connect in Settings → Integrations'
            : isPending
            ? 'Not authorized yet — complete OAuth in Settings → Integrations → ABC Supply'
            : `Connection ${status || 'error'} — re-authenticate in Settings → Integrations`,
        });
      }

      if (cancelled) return;
      setUserBranchPrefs(prefs);
      setSuppliers(found);
      const connected = found.filter(s => s.status === 'connected');
      if (connected.length === 1) {
        setSelected(connected[0].key);
        setBranchCode(connected[0].defaultBranch || '');
      } else if (connected.length === 0) {
        setSelected(null);
      }
      setLoadingSuppliers(false);
    })();

    return () => { cancelled = true; };
  }, [open, tenantId]);

  const totalCost = useMemo(
    () => editableItems.reduce((s, i) => s + Number(i.quantity || 0) * Number(i.unit_cost || 0), 0),
    [editableItems]
  );

  const updateItem = (idx: number, patch: Partial<MaterialItem>) => {
    setEditableItems(prev => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  };

  const normalizeSkuText = (value: string | null | undefined) =>
    (value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

  const tokenScore = (a: string, b: string) => {
    const A = new Set(normalizeSkuText(a).split(' ').filter(Boolean));
    const B = new Set(normalizeSkuText(b).split(' ').filter(Boolean));
    if (!A.size || !B.size) return 0;
    let hits = 0;
    A.forEach(t => { if (B.has(t)) hits += 1; });
    return hits / A.size;
  };

  const resolveSrsCatalogSkus = async (base: MaterialItem[], branch: string) => {
    if (!tenantId || !branch.trim()) return base;
    const needsSku = base.some(i => !i.srs_item_code);
    if (!needsSku) return base;

    const { data, error } = await supabase.functions.invoke('srs-api-proxy', {
      body: { action: 'get_products', tenant_id: tenantId, branch_code: branch.trim() },
    });
    if (error) throw error;
    const products = Array.isArray(data?.products) ? data.products : [];

    return base.map(item => {
      if (item.srs_item_code) return item;
      const haystack = `${item.item_name} ${item.description || ''}`;
      let best: any = null;
      let bestScore = 0;
      for (const product of products) {
        const score = tokenScore(haystack, product.productName || '');
        if (score > bestScore) {
          best = product;
          bestScore = score;
        }
      }
      return best?.productId && bestScore >= 0.55
        ? { ...item, srs_item_code: String(best.productId) }
        : item;
    });
  };

  const persistSku = async (item: MaterialItem, sku: string | null) => {
    if (item.id) {
      await supabase
        .from('estimate_line_items')
        .update({ srs_item_code: sku })
        .eq('id', item.id);
    }

    if (estimateId) {
      const { data: enhanced } = await (supabase.from('enhanced_estimates') as any)
        .select('id, line_items')
        .eq('id', estimateId)
        .maybeSingle();

      const lineItems = (enhanced?.line_items || {}) as Record<string, any[]>;
      const materials = Array.isArray(lineItems.materials) ? lineItems.materials : Array.isArray(lineItems.material) ? lineItems.material : [];
      if (enhanced?.id && materials.length) {
        const nextMaterials = materials.map((li: any) => {
          const sameId = item.id && li.id === item.id;
          const sameName = li.item_name === item.item_name || li.name === item.item_name;
          return sameId || sameName ? { ...li, srs_item_code: sku, product_code: sku || li.product_code } : li;
        });
        await (supabase.from('enhanced_estimates') as any)
          .update({ line_items: { ...lineItems, materials: nextMaterials } })
          .eq('id', estimateId);
      }
    }
  };

  // Resolve per-supplier SKUs via vendor_products map. Overwrites srs_item_code
  // with the SKU for the currently selected supplier so downstream submit code
  // (which already reads srs_item_code) works for SRS / ABC / QXO alike.
  const [resolvingSkus, setResolvingSkus] = useState(false);
  const resolveSkusFor = async (key: SupplierKey, base: MaterialItem[]) => {
    if (!tenantId || !base.length) return base;
    setResolvingSkus(true);
    try {
      const { data, error } = await supabase.functions.invoke('resolve-supplier-skus', {
        body: {
          tenant_id: tenantId,
          supplier_key: key,
          items: base.map((it, i) => ({ key: String(i), name: it.item_name, description: it.description })),
        },
      });
      if (error) throw error;
      const map = new Map<string, string | null>(
        (data?.items || []).map((r: any) => [String(r.key), r.vendor_sku as string | null]),
      );
      return base.map((it, i) => ({
        ...it,
        // Never erase a SKU the user already typed/saved just because the resolver
        // has no vendor_products match yet. That empty mapping is why SRS was being
        // blocked with "Saved as draft — no SRS SKUs".
        srs_item_code: map.get(String(i)) || it.srs_item_code || null,
      }));
    } catch (e) {
      console.warn('[PushToSupplier] SKU resolution failed', e);
      return base;
    } finally {
      setResolvingSkus(false);
    }
  };

  const handleSelectSupplier = async (key: SupplierKey) => {
    setSelected(key);
    const s = suppliers.find(s => s.key === key);
    const nextBranch = s?.defaultBranch || '';
    setBranchCode(nextBranch);
    const resolved = await resolveSkusFor(key, items);
    const next = key === 'srs' ? await resolveSrsCatalogSkus(resolved, nextBranch) : resolved;
    setEditableItems(next);
  };

  // Lazy-load the SRS branch catalog so users can manually look up productIds
  // for items the auto-resolver missed.
  const loadSrsCatalog = async (branch: string) => {
    if (!tenantId || !branch.trim()) return;
    if (srsCatalogBranch === branch.trim() && srsCatalog.length) return;
    setSrsCatalogLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('srs-api-proxy', {
        body: { action: 'get_products', tenant_id: tenantId, branch_code: branch.trim() },
      });
      if (error) throw error;
      const products = Array.isArray(data?.products) ? data.products : [];
      setSrsCatalog(products);
      setSrsCatalogBranch(branch.trim());
    } catch (e) {
      console.warn('[PushToSupplier] catalog load failed', e);
    } finally {
      setSrsCatalogLoading(false);
    }
  };

  useEffect(() => {
    if (selected === 'srs' && branchCode.trim()) {
      loadSrsCatalog(branchCode);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, branchCode]);

  const parseAddress = (raw: string) => {
    const m = raw.match(/^(.*?),\s*(.*?),\s*([A-Z]{2})\s*(\d{5})/i);
    return m
      ? { address1: m[1].trim(), city: m[2].trim(), state: m[3].toUpperCase(), postalCode: m[4] }
      : { address1: raw.trim() };
  };

  const submit = async () => {
    if (!tenantId || !selected) return;
    const sel = suppliers.find(s => s.key === selected);
    if (sel?.status === 'coming_soon') {
      toast({
        title: `${sel.label} coming soon`,
        description: 'This supplier integration is on the roadmap.',
      });
      return;
    }
    if (sel?.status !== 'connected') {
      toast({
        title: `${sel?.label || 'Supplier'} not connected`,
        description: sel?.statusNote || 'Set up this supplier in Settings → Integrations first.',
        variant: 'destructive',
      });
      return;
    }
    if (!editableItems.length) {
      toast({ title: 'No items to push', variant: 'destructive' });
      return;
    }

    // Color requirement gate: every "requires color" line must have a color filled in.
    const missingColor = editableItems.filter(
      i => i.requires_color && !(i.color_specs && i.color_specs.trim())
    );
    if (missingColor.length) {
      toast({
        title: 'Color required',
        description: `Add a color for: ${missingColor.map(i => i.item_name).join(', ')}. The order can't be pushed to the supplier until every color-required item has a color.`,
        variant: 'destructive',
      });
      return;
    }

    // Branch code gate: SRS requires a branch on every order row.
    if (selected === 'srs' && !branchCode.trim()) {
      toast({
        title: 'Branch code required',
        description: 'Enter the SRS branch code for this order (e.g. SROCA). You can set a default in your profile so it auto-fills next time.',
        variant: 'destructive',
      });
      return;
    }

    setSubmitting(true);
    try {
      // Remember this branch as the user's default for this supplier.
      try {
        const { data: authData } = await supabase.auth.getUser();
        const userId = authData?.user?.id;
        if (userId && branchCode && userBranchPrefs[selected] !== branchCode) {
          const nextPrefs = { ...userBranchPrefs, [selected]: branchCode };
          await supabase
            .from('profiles')
            .update({ default_supplier_branches: nextPrefs } as any)
            .eq('id', userId);
          setUserBranchPrefs(nextPrefs);
        }
      } catch (e) {
        console.warn('[PushToSupplier] could not save default branch preference', e);
      }

      if (selected === 'srs') {
        const catalogResolvedItems = await resolveSrsCatalogSkus(editableItems, branchCode);
        setEditableItems(catalogResolvedItems);
        // Resolve a real projects.id (the route may pass a pipeline_entries.id from /lead/:id)
        let resolvedProjectId: string | null = null;
        {
          const { data: pById } = await supabase
            .from('projects').select('id').eq('id', projectId).maybeSingle();
          if (pById?.id) resolvedProjectId = pById.id;
          if (!resolvedProjectId) {
            const { data: pByPipeline } = await supabase
              .from('projects').select('id').eq('pipeline_entry_id', projectId).maybeSingle();
            if (pByPipeline?.id) resolvedProjectId = pByPipeline.id;
          }
        }
        if (!resolvedProjectId) {
          throw new Error('No project record found for this lead. Convert the lead to a project before pushing to SRS.');
        }

        // Validate estimateId actually exists in estimates table (avoid FK violation)
        let resolvedEstimateId: string | null = null;
        if (estimateId) {
          const { data: estRow } = await supabase
            .from('estimates').select('id').eq('id', estimateId).maybeSingle();
          if (estRow?.id) resolvedEstimateId = estRow.id;
        }

        const allItems = catalogResolvedItems.filter(i => Number(i.quantity) > 0);
        const unmappedItems = allItems.filter(i => !i.srs_item_code);
        if (unmappedItems.length) {
          throw new Error(
            `SRS requires a valid productId on every line before it will place the order. Add SKUs for: ${unmappedItems.map(i => i.item_name).join(', ')}.`
          );
        }

        // 1. Create the srs_orders draft + items linked to the project
        const orderNumber = `PITCH-${jobNumber || 'JOB'}-${Date.now()}`;
        const { data: orderRow, error: orderErr } = await supabase
          .from('srs_orders')
          .insert({
            tenant_id: tenantId as any,
            project_id: resolvedProjectId,

            estimate_id: resolvedEstimateId,
            order_number: orderNumber,
            branch_code: branchCode.trim(),
            status: 'draft',
            // srs_orders.delivery_method only allows 'pickup' | 'delivery'
            delivery_method: deliveryMethod === 'pickup' ? 'pickup' : 'delivery',
            delivery_date: deliveryDate,
            delivery_address: shipAddress,
            notes: [
              deliveryMethod === 'roof_load' ? 'Delivery: Roof Load' :
              deliveryMethod === 'ground_drop' ? 'Delivery: Ground Drop' : null,
              notes,
            ].filter(Boolean).join('\n') || null,
            total_amount: totalCost,
          } as any)
          .select('id')
          .single();
        if (orderErr) throw orderErr;

        await Promise.all(
          catalogResolvedItems
            .filter(i => i.srs_item_code && Number(i.quantity) > 0)
            .map(i => persistSku(i, i.srs_item_code!.trim())),
        );

        const itemsPayload = allItems.map(i => ({
          order_id: orderRow.id,
          srs_product_id: Number(i.srs_item_code),
          product_name: i.item_name,
          product_description: i.description || i.item_name,
          quantity: Number(i.quantity),
          uom: (i.unit || 'EA').toUpperCase(),
          unit_price: Number(i.unit_cost || 0),
          total_price: Number(i.quantity || 0) * Number(i.unit_cost || 0),
        }));

        if (itemsPayload.length) {
          const { error: itemsErr } = await supabase.from('srs_order_items').insert(itemsPayload);
          if (itemsErr) throw itemsErr;
        }

        // 2. Submit through the proxy
        const { data, error } = await supabase.functions.invoke('srs-api-proxy', {
          body: { action: 'submit_order', tenant_id: tenantId, order_id: orderRow.id },
        });
        if (error) {
          // Supabase FunctionsHttpError hides the response body; pull it out.
          let detail = error.message;
          try {
            const ctx: any = (error as any).context;
            if (ctx && typeof ctx.json === 'function') {
              const body = await ctx.json();
              detail = body?.error || body?.message || JSON.stringify(body);
            } else if (ctx && typeof ctx.text === 'function') {
              detail = (await ctx.text()) || detail;
            }
          } catch {}
          throw new Error(detail);
        }
        if (!data?.success) throw new Error(data?.error || 'SRS rejected the order');

        toast({
          title: 'Pushed to SRS',
          description: data.srsOrderId
            ? `Order ${orderNumber} submitted (SRS ID ${data.srsOrderId}).`
            : `Order ${orderNumber} queued by SRS${data.queueId ? ` (queue ${data.queueId})` : ''}; awaiting real order ID.`,
        });
      } else if (selected === 'qxo') {
        const addr = shipAddress ? parseAddress(shipAddress) : null;
        const { data, error } = await supabase.functions.invoke('qxo-submit-order', {
          body: {
            tenant_id: tenantId,
            project_id: projectId,
            job_id: projectId,
            job_name: customerName,
            job_number: jobNumber,
            delivery_address: addr,
            special_instruction: notes || (customerName ? `For ${customerName}` : undefined),
            on_hold: false,
            check_for_availability: 'yes',
            items: editableItems.map(i => ({
              item_name: i.item_name,
              qty: Number(i.quantity),
              unit: i.unit,
              unit_cost: Number(i.unit_cost),
              unit_price: Number(i.unit_cost),
              notes: i.description,
            })),
          },
        });
        if (error) throw error;
        if (!data?.success) throw new Error(data?.message || data?.error || 'QXO rejected the order');

        toast({
          title: 'Pushed to QXO',
          description: data.beacon_order_id
            ? `Beacon order ${data.beacon_order_id} created (PO ${data.po_number}).`
            : `PO ${data.po_number} submitted.`,
        });
      } else if (selected === 'abc') {
        const { data, error } = await supabase.functions.invoke('abc-api-proxy', {
          body: {
            action: 'submit_order',
            tenant_id: tenantId,
            environment: sel?.environment === 'production' ? 'production' : 'sandbox',
            project_id: projectId,
            estimate_id: estimateId,
            job_number: jobNumber,
            customer_name: customerName,
            branch_code: branchCode.trim() || undefined,
            delivery_method: deliveryMethod,
            delivery_date: deliveryDate,
            delivery_address: shipAddress,
            notes,
            items: editableItems.map(i => ({
              item_name: i.item_name,
              description: i.description,
              quantity: Number(i.quantity),
              unit: i.unit,
              unit_cost: Number(i.unit_cost || 0),
              srs_item_code: i.srs_item_code || null,
              color_specs: i.color_specs || null,
            })),
          },
        });
        if (error) throw error;
        if (!data?.success) {
          const body = data?.orderResponse?.body;
          const msg =
            (typeof body === 'object' && body && (body.error_description || body.message || body.error)) ||
            data?.error ||
            'ABC rejected the order.';
          throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
        }
        toast({
          title: 'Pushed to ABC Supply',
          description: data.abcOrderNumber
            ? `ABC order ${data.abcOrderNumber} created (PO ${data.purchaseOrderNumber}).`
            : `PO ${data.purchaseOrderNumber} submitted.`,
        });
      }

      onSubmitted?.();
      onOpenChange(false);
    } catch (e: any) {
      toast({ title: 'Push failed', description: e.message, variant: 'destructive' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Truck className="h-5 w-5" />
            Push Order to Supplier
          </DialogTitle>
        </DialogHeader>

        {loadingSuppliers ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin" />
            <span className="ml-2 text-sm text-muted-foreground">Checking connected suppliers…</span>
          </div>
        ) : (
          <div className="space-y-5">
            {/* Supplier picker */}
            <div>
              <Label className="mb-2 block">Supplier</Label>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                {suppliers.map(s => {
                  const isSelected = selected === s.key;
                  return (
                    <Card
                      key={s.key}
                      onClick={() => handleSelectSupplier(s.key)}
                      className={`cursor-pointer transition ${
                        isSelected ? 'ring-2 ring-primary' : 'hover:bg-muted/50'
                      }`}
                    >
                      <CardContent className="flex items-center justify-between gap-2 p-4">
                        <div className="min-w-0">
                          <div className="font-medium truncate">{s.label}</div>
                          {s.defaultBranch && (
                            <div className="text-xs text-muted-foreground">Branch {s.defaultBranch}</div>
                          )}
                          {s.statusNote && (
                            <div className="text-xs text-muted-foreground truncate">{s.statusNote}</div>
                          )}
                        </div>
                        <Badge
                          variant={
                            isSelected
                              ? 'default'
                              : s.status === 'connected'
                              ? 'outline'
                              : 'secondary'
                          }
                        >
                          {isSelected
                            ? 'Selected'
                            : s.status === 'connected'
                            ? 'Choose'
                            : s.status === 'coming_soon'
                            ? 'Soon'
                            : s.status === 'error'
                            ? 'Error'
                            : 'Setup'}
                        </Badge>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </div>

            {selected && (
              <>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div>
                    <Label htmlFor="branch">
                      Branch code <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      id="branch"
                      value={branchCode}
                      onChange={e => setBranchCode(e.target.value.toUpperCase())}
                      placeholder="e.g. SROCA"
                      aria-invalid={selected === 'srs' && !branchCode.trim()}
                      className={selected === 'srs' && !branchCode.trim() ? 'border-destructive' : ''}
                    />
                  </div>
                  <div>
                    <Label htmlFor="dmethod">Delivery method</Label>
                    <Select value={deliveryMethod} onValueChange={(v: any) => setDeliveryMethod(v)}>
                      <SelectTrigger id="dmethod"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="roof_load">Roof Load</SelectItem>
                        <SelectItem value="ground_drop">Ground Drop</SelectItem>
                        <SelectItem value="pickup">Pick up / Will-call</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="ddate">Requested date</Label>
                    <Input id="ddate" type="date" value={deliveryDate} onChange={e => setDeliveryDate(e.target.value)} />
                  </div>
                </div>

                <div>
                  <Label htmlFor="addr">Ship-to address</Label>
                  <Input id="addr" value={shipAddress} onChange={e => setShipAddress(e.target.value)} />
                </div>

                <div>
                  <Label htmlFor="notes">Notes</Label>
                  <Textarea id="notes" rows={2} value={notes} onChange={e => setNotes(e.target.value)} />
                </div>

                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <Label>Items ({editableItems.length})</Label>
                    <span className="text-xs text-muted-foreground">
                      {resolvingSkus
                        ? 'Looking up supplier SKUs…'
                        : 'Pricing will be quoted by the supplier'}
                    </span>
                  </div>
                  <div className="max-h-64 overflow-y-auto rounded-md border">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50 text-xs uppercase">
                        <tr>
                          <th className="p-2 text-left">Item</th>
                          <th className="p-2 text-left">
                            {selected ? `${selected.toUpperCase()} SKU` : 'SKU'}
                          </th>
                          <th className="p-2 text-right">Qty</th>
                          <th className="p-2 text-left">UoM</th>
                          <th className="p-2 text-left">Color</th>
                        </tr>
                      </thead>
                      <tbody>
                        {editableItems.map((it, i) => {
                          const colorMissing = it.requires_color && !(it.color_specs && it.color_specs.trim());
                          return (
                            <tr key={i} className={`border-t ${colorMissing ? 'bg-destructive/5' : ''}`}>
                              <td className="p-2">
                                <div className="flex items-center gap-2">
                                  <span>{it.item_name}</span>
                                  {it.requires_color && (
                                    <Badge variant="outline" className="text-[10px]">Color req.</Badge>
                                  )}
                                </div>
                              </td>
                              <td className="p-2">
                                <div className="flex items-center gap-1">
                                  <Input
                                    value={it.srs_item_code || ''}
                                    onChange={e => updateItem(i, { srs_item_code: e.target.value.trim() || null })}
                                    onBlur={async e => persistSku(it, e.target.value.trim() || null)}
                                    placeholder={selected === 'srs' ? 'productId (e.g. 3473)' : 'SKU'}
                                    className={`h-7 w-36 font-mono text-xs ${!it.srs_item_code ? 'border-amber-400' : ''}`}
                                  />
                                  {selected === 'srs' && (
                                    <CatalogSearchPopover
                                      catalog={srsCatalog}
                                      loading={srsCatalogLoading}
                                      branchCode={branchCode}
                                      initialQuery={it.item_name}
                                      onOpen={() => loadSrsCatalog(branchCode)}
                                      onPick={(pid) => {
                                        updateItem(i, { srs_item_code: pid });
                                        persistSku(it, pid);
                                      }}
                                    />
                                  )}
                                </div>
                              </td>
                              <td className="p-2 text-right">
                                <Input
                                  type="number"
                                  value={it.quantity}
                                  onChange={e => updateItem(i, { quantity: Number(e.target.value) })}
                                  className="h-7 w-20 text-right"
                                />
                              </td>
                              <td className="p-2">{it.unit}</td>
                              <td className="p-2">
                                {it.requires_color ? (
                                  <Input
                                    value={it.color_specs || ''}
                                    onChange={e => updateItem(i, { color_specs: e.target.value })}
                                    placeholder="Color…"
                                    className={`h-7 w-32 ${colorMissing ? 'border-destructive' : ''}`}
                                  />
                                ) : (
                                  <span className="text-xs text-muted-foreground">{it.color_specs || '—'}</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                        {editableItems.length === 0 && (
                          <tr>
                            <td colSpan={5} className="p-6 text-center text-muted-foreground">
                              <Package className="mx-auto mb-2 h-5 w-5" />
                              No material line items found on this project's estimate.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                  {editableItems.some(i => i.requires_color && !(i.color_specs && i.color_specs.trim())) && (
                    <p className="mt-2 flex items-center gap-1 text-xs text-destructive">
                      <AlertCircle className="h-3 w-3" />
                      A color is required on every highlighted line before this order can be pushed to the supplier.
                    </p>
                  )}
                  {selected && editableItems.some(i => !i.srs_item_code) && (
                    <p className="mt-2 text-xs text-amber-600">
                      Items without a {selected.toUpperCase()} SKU cannot be placed automatically. Add a valid supplier SKU/productId to every line before pushing.
                    </p>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {selected && (() => {
          const sel = suppliers.find(s => s.key === selected);
          const env = (sel?.environment || '').toLowerCase();
          const isProd = env === 'production';
          if (env && !isProd) {
            return (
              <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400">
                <div className="flex items-start gap-2">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <div>
                    <div className="font-medium">
                      {selected.toUpperCase()} is connected to <span className="uppercase">{env}</span> — test mode.
                    </div>
                    <div className="mt-1 text-xs">
                      Orders pushed here are for verification only and will NOT reach the real {selected.toUpperCase()} rep. Switch to <strong>Production</strong> in Settings → Integrations once staging is verified.
                    </div>
                  </div>
                </div>
              </div>
            );
          }
          return null;
        })()}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={!selected || submitting || editableItems.length === 0}
          >
            {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Truck className="mr-2 h-4 w-4" />}
            Push to {selected ? selected.toUpperCase() : 'Supplier'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
