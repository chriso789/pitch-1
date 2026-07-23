import { useEffect, useMemo, useRef, useState, type WheelEvent } from 'react';
import { safeText } from '@/lib/safeText';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Truck, Loader2, Package, AlertCircle, Search } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { edgeApi } from '@/lib/edgeApi';
import { useEffectiveTenantId } from '@/hooks/useEffectiveTenantId';
import { useAbcConnectionStatus } from '@/hooks/useAbcConnectionStatus';
import { useAbcCatalog } from '@/hooks/useAbcCatalog';
import {
  AbcCatalogSearchPopover,
  AbcPriceButton,
  AbcPriceCell,
  type AbcLineState,
} from './AbcCatalogControls';
import { colorsForItem } from './shingleBrandColors';

type SupplierKey = 'srs' | 'qxo' | 'abc';

interface SupplierOption {
  key: SupplierKey;
  label: string;
  defaultBranch?: string | null;
  environment?: string | null;
  status?: 'connected' | 'error' | 'not_configured' | 'coming_soon';
  statusNote?: string;
}

interface MaterialItem extends AbcLineState {
  id?: string;
  template_item_id?: string | null;
  item_name: string;
  description?: string;
  quantity: number;
  unit: string;
  unit_cost: number;
  srs_item_code?: string | null;
  color_specs?: string;
  requires_color?: boolean;
  abc_branch?: string | null;
  abc_ship_to?: string | null;
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

const SKU_STOP_WORDS = new Set([
  'and', 'the', 'for', 'with', 'of', 'a', 'an', 'to', 'by', 'roof', 'roofing',
  'material', 'materials', 'item', 'product', 'standard', 'premium', 'generic',
]);

const SKU_SYNONYMS: Record<string, string[]> = {
  bdl: ['bd', 'bundle'],
  bd: ['bdl', 'bundle'],
  pc: ['piece', 'ea', 'each'],
  ea: ['pc', 'piece', 'each'],
  shingle: ['shingles', 'laminate', 'architectural'],
  shingles: ['shingle', 'laminate', 'architectural'],
  ridge: ['cap', 'hip', 'ridgecap'],
  hip: ['ridge', 'cap', 'ridgecap'],
  cap: ['ridge', 'hip', 'ridgecap'],
  starter: ['start', 'starterstrip'],
  strip: ['starterstrip'],
  underlayment: ['underlay', 'felt', 'synthetic'],
  underlay: ['underlayment', 'felt', 'synthetic'],
  ice: ['water', 'barrier', 'leak'],
  water: ['ice', 'barrier', 'leak'],
  leak: ['ice', 'water', 'barrier'],
  drip: ['edge', 'dedge'],
  edge: ['drip', 'dedge'],
  nail: ['nails', 'coil'],
  nails: ['nail', 'coil'],
  coil: ['nail', 'nails'],
  vent: ['ventilation', 'ridgevent'],
  ventilation: ['vent'],
  pipe: ['boot', 'flashing'],
  boot: ['pipe', 'flashing'],
  flashing: ['pipe', 'boot', 'step'],
};

const normalizeSkuText = (value: string | null | undefined) =>
  (value || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();

const singularSkuToken = (token: string) => {
  if (token.endsWith('ies') && token.length > 4) return `${token.slice(0, -3)}y`;
  if (token.endsWith('es') && token.length > 4) return token.slice(0, -2);
  if (token.endsWith('s') && token.length > 4) return token.slice(0, -1);
  return token;
};

const skuTokens = (value: string | null | undefined) =>
  normalizeSkuText(value)
    .split(/\s+/)
    .map(singularSkuToken)
    .filter((token) => token && !SKU_STOP_WORDS.has(token));

const skuAcronym = (value: string | null | undefined) =>
  skuTokens(value)
    .filter((token) => token.length > 2)
    .map((token) => token[0])
    .join('');

const tokenMatches = (needle: string, haystack: Set<string>) => {
  if (haystack.has(needle)) return true;
  const aliases = SKU_SYNONYMS[needle] || [];
  return aliases.some((alias) => haystack.has(singularSkuToken(alias)));
};

const productText = (p: any) =>
  `${p.productId ?? p.productNumber ?? ''} ${p.productName ?? p.description ?? ''} ${p.option ?? ''} ${p.uom ?? ''}`;

const scoreSrsProductMatch = (item: MaterialItem, product: any) => {
  const itemText = `${item.item_name} ${item.description || ''} ${item.color_specs || ''}`;
  const itemTokens = skuTokens(itemText).filter((token) => !/^\d+$/.test(token));
  const productTokens = skuTokens(productText(product));
  if (!itemTokens.length || !productTokens.length) return 0;

  const productSet = new Set(productTokens);
  let totalWeight = 0;
  let matchedWeight = 0;

  for (const token of itemTokens) {
    const important = ['shingle', 'ridge', 'hip', 'cap', 'starter', 'underlayment', 'ice', 'water', 'drip', 'edge', 'nail', 'coil', 'vent', 'boot', 'flashing'].includes(token);
    const weight = important ? 1.35 : token.length <= 2 ? 0.35 : 1;
    totalWeight += weight;
    if (tokenMatches(token, productSet)) {
      matchedWeight += weight;
    } else if (token.length > 3 && productTokens.some((p) => p.startsWith(token) || token.startsWith(p))) {
      matchedWeight += weight * 0.65;
    }
  }

  let score = matchedWeight / Math.max(totalWeight, 1);
  const normalizedProduct = normalizeSkuText(productText(product));
  const normalizedItem = normalizeSkuText(itemText);
  if (normalizedItem.length > 8 && normalizedProduct.includes(normalizedItem)) score += 0.2;
  if (item.unit && normalizedProduct.split(' ').includes(normalizeSkuText(item.unit))) score += 0.06;
  return Math.min(score, 1);
};

const bestSrsCatalogMatch = (item: MaterialItem, catalog: any[]) => {
  const ranked = catalog
    .map((product) => ({ product, score: scoreSrsProductMatch(item, product) }))
    .filter((entry) => entry.product?.productId || entry.product?.productNumber)
    .sort((a, b) => b.score - a.score);
  const best = ranked[0];
  const runnerUp = ranked[1];
  const ambiguous = Boolean(best && runnerUp && best.score < 0.88 && best.score - runnerUp.score < 0.08);
  return best ? { ...best, ambiguous } : null;
};

const autoFillSrsCatalogSkus = (base: MaterialItem[], catalog: any[]) => {
  let matchedCount = 0;
  const items = base.map((item) => {
    if (item.srs_item_code) return item;
    const best = bestSrsCatalogMatch(item, catalog);
    const productId = best?.product?.productId ?? best?.product?.productNumber;
    if (productId && best.score >= 0.72 && !best.ambiguous) {
      matchedCount += 1;
      return { ...item, srs_item_code: String(productId) };
    }
    return item;
  });
  return { items, matchedCount };
};

export function PushToSupplierDialog({
  open, onOpenChange, projectId, estimateId, jobNumber,
  customerName, projectAddress, items, onSubmitted,
}: Props) {
  const { toast } = useToast();
  const tenantId = useEffectiveTenantId();
  const abcConnection = useAbcConnectionStatus();
  const abcCatalog = useAbcCatalog(tenantId, abcConnection.environment);
  const [loadingSuppliers, setLoadingSuppliers] = useState(false);
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([]);
  const [selected, setSelected] = useState<SupplierKey | null>(null);
  const [branchCode, setBranchCode] = useState('');
  const [abcShipToNumber, setAbcShipToNumber] = useState('');
  const [userBranchPrefs, setUserBranchPrefs] = useState<Record<string, string>>({});
  // O'Brien Contracting tenant — pre-fills ABC sandbox demo defaults
  // (branch 1209, ship-to 2010466-2) so the demo flow doesn't trip on
  // empty required fields. Production tenants get no auto-fill.
  const OBRIEN_TENANT_ID = '14de934e-7964-4afd-940a-620d2ace125d';
  const allowSandboxDefaults = tenantId === OBRIEN_TENANT_ID;
  const [deliveryMethod, setDeliveryMethod] = useState<DeliveryMethod>('roof_load');
  const [deliveryDate, setDeliveryDate] = useState<string>(() => {
    const d = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
    return d.toISOString().slice(0, 10);
  });
  const [shipAddress, setShipAddress] = useState(projectAddress || '');
  const [notes, setNotes] = useState('');
  // Jobsite delivery contact (functionCode "DC" on ABC orders). Branches
  // require this so the driver knows who to call on delivery — submitting
  // without it triggers vendor-side rework.
  const [jobsiteContactName, setJobsiteContactName] = useState(customerName || '');
  const [jobsiteContactPhone, setJobsiteContactPhone] = useState('');
  const [jobsiteContactEmail, setJobsiteContactEmail] = useState('');
  const [editableItems, setEditableItems] = useState<MaterialItem[]>(items);
  const [submitting, setSubmitting] = useState(false);
  const [srsCatalog, setSrsCatalog] = useState<any[]>([]);
  const [srsCatalogLoading, setSrsCatalogLoading] = useState(false);
  const [srsCatalogBranch, setSrsCatalogBranch] = useState<string>('');
  // Idempotency key for QXO submits — generated once per dialog open so
  // accidental double-clicks dedupe at the qxo-api layer.
  const qxoIdempotencyKeyRef = useRef<string | null>(null);



  // Only sync from props when the dialog opens — otherwise parent re-renders
  // (which pass a freshly mapped `items` array each time) would wipe out
  // user edits like picked SRS productIds.
  useEffect(() => {
    if (!open) return;
    // Reset QXO idempotency key for each fresh dialog open. A new key is
    // generated lazily on first submit; double-clicks within the same open
    // session dedupe at the qxo-api layer.
    qxoIdempotencyKeyRef.current = null;
    // Hydrate color_specs from free-text notes/description when the estimate
    // line stored the color there (e.g. "Charcoal" written in the Notes
    // popover). This keeps the Push-to-Supplier color dropdown in sync with
    // whatever color was already picked upstream on the estimate.
    const hydrated = items.map((it) => {
      if (it.color_specs && it.color_specs.trim()) return it;
      const { colors } = colorsForItem(it.item_name);
      const haystack = `${(it as any).notes || ''} ${it.description || ''}`.toLowerCase();
      const matched = colors.find((c) => haystack.includes(c.toLowerCase()));
      return matched ? { ...it, color_specs: matched } : it;
    });
    setEditableItems(hydrated);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    setShipAddress(projectAddress || '');
  }, [projectAddress]);

  useEffect(() => {
    // Prefill jobsite contact name from the project's primary contact when
    // the dialog opens. Phone/email left blank for the user to fill in — we
    // intentionally don't auto-pull personal phones to avoid leaking the
    // homeowner's number onto an order without an explicit confirmation.
    if (open) setJobsiteContactName((prev) => prev || customerName || '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, customerName]);

  useEffect(() => {
    if (!open || !tenantId) return;
    // Wait for ABC connection status to load so we don't briefly tell the
    // user ABC is disconnected when it isn't.
    if (abcConnection.loading) return;
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

      const [srsRes, qxoRes] = await Promise.all([
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

      // ABC: single source of truth via useAbcConnectionStatus(). The hook
      // already handles "tenant may have both sandbox AND production rows"
      // and "staging === sandbox" normalization, so the dialog cannot drift
      // out of sync with ABCConnectionSettings.
      if (abcConnection.isConnected) {
        const envLabel = abcConnection.environment === 'production' ? '' : ' (Sandbox)';
        found.push({
          key: 'abc',
          label: `ABC Supply${envLabel}`,
          defaultBranch: prefs.abc || abcConnection.defaultBranchCode,
          environment: abcConnection.environment,
          status: 'connected',
        });
      } else {
        const state = abcConnection.state;
        const envHint =
          abcConnection.environment === 'production' ? 'production' : 'sandbox';
        const note =
          state === 'pending'
            ? `ABC ${envHint} connection is pending — complete OAuth in Settings → Integrations → ABC Supply`
            : state === 'expired'
            ? `ABC ${envHint} session expired — reconnect in Settings → Integrations → ABC Supply`
            : state === 'error'
            ? `ABC ${envHint} connection error — re-authenticate in Settings → Integrations`
            : `ABC ${envHint} connection not found for this company — connect in Settings → Integrations → ABC Supply`;
        found.push({
          key: 'abc',
          label: 'ABC Supply',
          defaultBranch: null,
          environment: abcConnection.environment,
          status: abcConnection.row ? 'error' : 'not_configured',
          statusNote: note,
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
  }, [open, tenantId, abcConnection.loading, abcConnection.state, abcConnection.environment, abcConnection.defaultBranchCode]);

  // ABC-specific defaults: when ABC is the selected supplier and we're in
  // sandbox/staging on the O'Brien demo tenant, pre-fill the branch number
  // and ship-to account so the demo flow is one-click.
  useEffect(() => {
    if (selected !== 'abc') return;
    const abcOpt = suppliers.find(s => s.key === 'abc');
    if (!abcOpt || abcOpt.status !== 'connected') return;
    const isSandbox = abcOpt.environment !== 'production';
    if (!isSandbox) return;
    // In sandbox, every tenant should land on the ABC sandbox demo branch so
    // the test flow is one-click. If the connection synced real branches,
    // prefer the first synced branch; otherwise fall back to the well-known
    // sandbox branch number.
    if (!branchCode.trim()) {
      const firstSynced = abcCatalog.branches[0]?.branch_number;
      setBranchCode(firstSynced || '1209');
    }
    if (allowSandboxDefaults && !abcShipToNumber.trim()) {
      setAbcShipToNumber('2010466-2');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, suppliers, allowSandboxDefaults, abcCatalog.branches]);


  const totalCost = useMemo(
    () => editableItems.reduce((s, i) => s + Number(i.quantity || 0) * Number(i.unit_cost || 0), 0),
    [editableItems]
  );

  const updateItem = (idx: number, patch: Partial<MaterialItem>) => {
    setEditableItems(prev => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
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
    return autoFillSrsCatalogSkus(base, products).items;
  };

  const persistSupplierLine = async (item: MaterialItem, patch: Partial<MaterialItem>) => {
    const dbPatch: Record<string, any> = {};
    const jsonPatch: Record<string, any> = {};

    const setPatch = (key: string, value: any, persistToDb = true) => {
      jsonPatch[key] = value ?? null;
      if (persistToDb) dbPatch[key] = value ?? null;
    };

    if ('srs_item_code' in patch) setPatch('srs_item_code', patch.srs_item_code);
    if ('abc_item_number' in patch) setPatch('abc_item_number', patch.abc_item_number);
    if ('abc_color' in patch) setPatch('abc_color', patch.abc_color);
    if ('abc_uom' in patch) setPatch('abc_uom', patch.abc_uom);
    if ('abc_price' in patch) setPatch('abc_price', patch.abc_price);
    if ('abc_price_status' in patch) setPatch('abc_price_status', patch.abc_price_status);
    if ('abc_price_timestamp' in patch) setPatch('abc_price_timestamp', patch.abc_price_timestamp);
    if ('abc_availability' in patch) setPatch('abc_availability', patch.abc_availability);
    if ('abc_branch' in patch) setPatch('abc_branch', patch.abc_branch);
    if ('abc_ship_to' in patch) setPatch('abc_ship_to', patch.abc_ship_to);
    // color_specs is stored in enhanced_estimates.line_items JSON; the typed
    // estimate_line_items table stores ABC color separately as abc_color.
    if ('color_specs' in patch) setPatch('color_specs', patch.color_specs, false);

    if (item.id && Object.keys(dbPatch).length > 0) {
      await (supabase.from('estimate_line_items') as any)
        .update(dbPatch)
        .eq('id', item.id);
    }

    if (estimateId && Object.keys(jsonPatch).length > 0) {
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
          if (!sameId && !sameName) return li;
          const next = {
            ...li,
            ...jsonPatch,
            product_code: jsonPatch.srs_item_code || li.product_code,
            metadata: {
              ...(li.metadata || {}),
              ...(jsonPatch.abc_item_number !== undefined ? { abc_item_number: jsonPatch.abc_item_number } : {}),
              ...(jsonPatch.abc_uom !== undefined ? { abc_uom: jsonPatch.abc_uom } : {}),
              ...(jsonPatch.abc_color !== undefined ? { abc_color: jsonPatch.abc_color } : {}),
              ...(jsonPatch.color_specs !== undefined ? { color_specs: jsonPatch.color_specs } : {}),
              ...(jsonPatch.srs_item_code !== undefined ? { srs_item_code: jsonPatch.srs_item_code } : {}),
            },
          };
          return next;
        });
        await (supabase.from('enhanced_estimates') as any)
          .update({ line_items: { ...lineItems, materials: nextMaterials } })
          .eq('id', estimateId);
      }
    }
  };

  const persistSku = async (item: MaterialItem, sku: string | null) => {
    await persistSupplierLine(item, { srs_item_code: sku });
  };

  const persistAbcTemplateMapping = async (
    item: MaterialItem,
    patch: Partial<MaterialItem>,
    rawCatalogPayload?: unknown,
  ) => {
    if (!item.template_item_id || !patch.abc_item_number) return;
    const uom = String(patch.abc_uom || item.abc_uom || item.unit || '').trim().toUpperCase();
    if (!uom) return;
    try {
      await edgeApi('supplier-api', '/abc/mapping/approve', {
        template_item_id: item.template_item_id,
        item_number: patch.abc_item_number,
        item_description: item.description || item.item_name,
        valid_uoms: [uom],
        default_uom: uom,
        branch_scope: branchCode.trim() ? [branchCode.trim()] : [],
        raw_catalog_payload: rawCatalogPayload ?? null,
        match_reason: 'line_item_manual_pick',
      });
    } catch (e) {
      console.warn('[PushToSupplier] ABC template mapping approve failed', e);
    }
  };

  const upsertAbcPriceCache = async (item: MaterialItem, next: AbcLineState) => {
    const itemNumber = next.abc_item_number || item.abc_item_number;
    const uom = String(next.abc_uom || item.abc_uom || item.unit || '').trim().toUpperCase();
    const unitPrice = Number(next.abc_price);
    if (!tenantId || !itemNumber || !uom || !branchCode.trim() || !abcShipToNumber.trim() || !Number.isFinite(unitPrice)) return;
    try {
      const { data: authData } = await supabase.auth.getUser();
      const userId = authData?.user?.id;
      if (!userId) return;
      const fetchedAt = next.abc_price_timestamp || new Date().toISOString();
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      await (supabase.from('abc_price_cache') as any).upsert({
        tenant_id: tenantId,
        user_id: userId,
        ship_to_number: abcShipToNumber.trim(),
        branch_number: branchCode.trim(),
        item_number: itemNumber,
        uom,
        purpose: 'estimating',
        unit_price: unitPrice,
        currency: 'USD',
        price_pending: false,
        raw: { source: 'push_to_supplier_dialog', estimate_id: estimateId ?? null, line_item_id: item.id ?? null },
        fetched_at: fetchedAt,
        expires_at: expiresAt,
      }, { onConflict: 'tenant_id,user_id,ship_to_number,branch_number,item_number,uom,purpose' });
    } catch (e) {
      console.warn('[PushToSupplier] ABC price cache upsert failed', e);
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
    if (srsCatalogBranch === branch.trim() && srsCatalog.length) {
      setEditableItems((prev) => autoFillSrsCatalogSkus(prev, srsCatalog).items);
      return;
    }
    setSrsCatalogLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('srs-api-proxy', {
        body: { action: 'get_products', tenant_id: tenantId, branch_code: branch.trim() },
      });
      if (error) throw error;
      const products = Array.isArray(data?.products) ? data.products : [];
      setSrsCatalog(products);
      setSrsCatalogBranch(branch.trim());
      setEditableItems((prev) => autoFillSrsCatalogSkus(prev, products).items);
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
            // Preserve the rep's real choice so SRS gets the correct
            // orderType + shippingMethod label downstream.
            delivery_method: deliveryMethod,
            delivery_date: deliveryDate,
            delivery_address: shipAddress,
            notes: notes || null,
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
          product_description: i.color_specs
            ? `${i.description || i.item_name} — Color: ${i.color_specs}`
            : (i.description || i.item_name),
          // SRS needs the color/variant on each line under orderLineItemDetails.option.
          // Persist it explicitly so the proxy doesn't have to scrape it from
          // free-text description or fall through to variants[0] (wrong color).
          product_option: i.color_specs ? i.color_specs.trim() : null,
          product_color: i.color_specs ? i.color_specs.trim() : null,
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
        // Tenant is resolved server-side from the JWT; do NOT send tenant_id.
        // Idempotency key is generated once per submission attempt so
        // accidental double-clicks dedupe at the qxo-api layer.
        const { data, error } = await edgeApi('qxo-api', '/orders/submit', {
          idempotency_key: qxoIdempotencyKeyRef.current ?? (qxoIdempotencyKeyRef.current = crypto.randomUUID()),
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
            notes: i.color_specs ? `${i.description || ''}${i.description ? ' — ' : ''}Color: ${i.color_specs}` : i.description,
            color_specs: i.color_specs || null,
          })),
        });
        if (error) throw new Error(error);
        const result = data as { beacon_order_id?: string | null; po_number?: string; message?: string | null } | null;
        if (!result?.beacon_order_id && !result?.po_number) {
          throw new Error(result?.message || 'QXO rejected the order');
        }

        toast({
          title: 'Pushed to QXO',
          description: result.beacon_order_id
            ? `Beacon order ${result.beacon_order_id} created (PO ${result.po_number}).`
            : `PO ${result.po_number} submitted.`,
        });
      } else if (selected === 'abc') {
        const unmappedAbcItems = editableItems.filter(i => Number(i.quantity) > 0 && !i.abc_item_number);
        if (unmappedAbcItems.length) {
          throw new Error(
            `ABC requires a catalog item number on every line. Add ABC item numbers for: ${unmappedAbcItems.map(i => i.item_name).join(', ')}.`
          );
        }
        // UOM gate — ABC branches reject orders with an invalid UOM. Block
        // submit if any line is missing a UOM so the user can pull a valid
        // one from the catalog before we contact the API.
        const missingUomLine = editableItems.find(i => !String(i.abc_uom || i.unit || '').trim());
        if (missingUomLine) {
          toast({
            title: 'Missing UOM',
            description: `"${missingUomLine.item_name}" has no UOM. Pick it from the ABC catalog before submitting.`,
            variant: 'destructive',
          });
          setSubmitting(false);
          return;
        }
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
            branch_number: branchCode.trim() || undefined,
            ship_to_number: abcShipToNumber.trim() || undefined,
            delivery_method: deliveryMethod,
            delivery_date: deliveryDate,
            delivery_address: shipAddress,
            notes,
            jobsite_contact: {
              name: jobsiteContactName.trim() || customerName || '',
              phone: jobsiteContactPhone.trim(),
              email: jobsiteContactEmail.trim(),
            },
            items: editableItems.map(i => ({
              template_item_id: i.template_item_id || i.id,
              item_name: i.item_name,
              description: i.description,
              quantity: Number(i.quantity),
              unit: i.abc_uom || i.unit,
              unit_cost: Number(i.unit_cost || 0),
              abc_item_number: i.abc_item_number || null,
              abc_uom: i.abc_uom || i.unit || null,
              abc_price: i.abc_price ?? null,
              abc_color: i.abc_color || null,
              abc_branch: branchCode.trim() || null,
              abc_ship_to: abcShipToNumber.trim() || null,
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
                      {selected === 'abc' ? 'ABC Branch' : 'Branch code'}{' '}
                      <span className="text-destructive">*</span>
                    </Label>
                    {selected === 'abc' && abcCatalog.branches.length > 0 ? (
                      <Select value={branchCode} onValueChange={(v) => setBranchCode(v)}>
                        <SelectTrigger id="branch">
                          <SelectValue placeholder="Select branch…" />
                        </SelectTrigger>
                        <SelectContent>
                          {abcCatalog.branches.map((b) => (
                            <SelectItem key={b.branch_number} value={b.branch_number}>
                              {b.branch_number}
                              {b.name ? ` — ${b.name}` : ''}
                              {b.city ? ` (${b.city}${b.state ? `, ${b.state}` : ''})` : ''}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Input
                        id="branch"
                        value={branchCode}
                        onChange={e =>
                          setBranchCode(
                            selected === 'abc' ? e.target.value : e.target.value.toUpperCase()
                          )
                        }
                        placeholder={
                          selected === 'abc'
                            ? allowSandboxDefaults
                              ? '1209'
                              : 'e.g. 1209'
                            : 'e.g. SROCA'
                        }
                        aria-invalid={selected === 'srs' && !branchCode.trim()}
                        className={selected === 'srs' && !branchCode.trim() ? 'border-destructive' : ''}
                      />
                    )}
                    {selected === 'abc' && abcCatalog.branches.length === 0 && !abcCatalog.loading && (
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        No branches synced yet — reconnect ABC in Settings → Integrations to populate.
                      </p>
                    )}
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

                {selected === 'abc' && (
                  <div className="rounded-md border border-border bg-muted/30 p-3 space-y-3">
                    <div className="flex items-center justify-between">
                      <Label className="text-sm font-medium">Jobsite delivery contact</Label>
                      <span className="text-[11px] text-muted-foreground">Required by ABC branches</span>
                    </div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                      <div>
                        <Label htmlFor="jc-name" className="text-xs">Name</Label>
                        <Input
                          id="jc-name"
                          value={jobsiteContactName}
                          onChange={e => setJobsiteContactName(e.target.value)}
                          placeholder="Driver calls this person"
                        />
                      </div>
                      <div>
                        <Label htmlFor="jc-phone" className="text-xs">Phone</Label>
                        <Input
                          id="jc-phone"
                          type="tel"
                          value={jobsiteContactPhone}
                          onChange={e => setJobsiteContactPhone(e.target.value)}
                          placeholder="(555) 555-5555"
                        />
                      </div>
                      <div>
                        <Label htmlFor="jc-email" className="text-xs">Email</Label>
                        <Input
                          id="jc-email"
                          type="email"
                          value={jobsiteContactEmail}
                          onChange={e => setJobsiteContactEmail(e.target.value)}
                          placeholder="optional"
                        />
                      </div>
                    </div>
                  </div>
                )}

                {selected === 'abc' && (
                  <div>
                    <Label htmlFor="abc-shipto">
                      ABC Ship-To <span className="text-destructive">*</span>
                    </Label>
                    {abcCatalog.shipTos.length > 0 ? (
                      <Select value={abcShipToNumber} onValueChange={(v) => setAbcShipToNumber(v)}>
                        <SelectTrigger id="abc-shipto">
                          <SelectValue placeholder="Select ship-to…" />
                        </SelectTrigger>
                        <SelectContent>
                          {abcCatalog.shipTos.map((s) => (
                            <SelectItem key={s.ship_to_number} value={s.ship_to_number}>
                              {s.ship_to_number}
                              {s.name ? ` — ${s.name}` : ''}
                              {s.city ? ` (${s.city}${s.state ? `, ${s.state}` : ''})` : ''}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Input
                        id="abc-shipto"
                        value={abcShipToNumber}
                        onChange={e => setAbcShipToNumber(e.target.value)}
                        placeholder="e.g. 2010466-2"
                      />
                    )}
                  </div>
                )}


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
                            {selected === 'srs' ? 'Product ID' : selected === 'abc' ? 'ABC Item #' : selected ? `${selected.toUpperCase()} SKU` : 'SKU'}
                          </th>
                          <th className="p-2 text-right">Qty</th>
                          <th className="p-2 text-left">UoM</th>
                          <th className="p-2 text-left">Color</th>
                          {selected === 'abc' && <th className="p-2 text-left">Price</th>}
                        </tr>
                      </thead>
                      <tbody>
                        {editableItems.map((it, i) => {
                          const colorMissing = it.requires_color && !(it.color_specs && it.color_specs.trim());
                          return (
                            <tr key={i} className={`border-t ${colorMissing ? 'bg-destructive/5' : ''}`}>
                              <td className="p-2">
                                <div className="flex items-center gap-2">
                                  <span>{safeText(it.item_name)}</span>
                                  {it.requires_color && (
                                    <Badge variant="outline" className="text-[10px]">Color req.</Badge>
                                  )}
                                </div>
                              </td>
                              <td className="p-2">
                                <div className="flex items-center gap-1">
                                  <Input
                                    value={(selected === 'abc' ? (it.abc_item_number || '') : (it.srs_item_code || ''))}
                                    onChange={e => {
                                      const v = e.target.value.trim() || null;
                                      if (selected === 'abc') updateItem(i, { abc_item_number: v });
                                      else updateItem(i, { srs_item_code: v });
                                    }}
                                    onBlur={async e => {
                                      const value = e.target.value.trim() || null;
                                      if (selected === 'abc') {
                                        const patch = {
                                          abc_item_number: value,
                                          abc_branch: branchCode.trim() || null,
                                          abc_ship_to: abcShipToNumber.trim() || null,
                                          abc_price: null,
                                          abc_price_status: null,
                                          abc_price_timestamp: null,
                                          abc_availability: null,
                                        };
                                        await persistSupplierLine(it, patch);
                                        await persistAbcTemplateMapping(it, patch);
                                      } else {
                                        persistSku(it, value);
                                      }
                                    }}
                                    placeholder={selected === 'srs' ? 'productId (e.g. 3473)' : selected === 'abc' ? 'ABC item #' : 'SKU'}
                                    className={`h-7 w-36 font-mono text-xs ${(selected === 'abc' ? !it.abc_item_number : !it.srs_item_code) ? 'border-amber-400' : ''}`}
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
                                  {selected === 'abc' && tenantId && (
                                    <AbcCatalogSearchPopover
                                      tenantId={tenantId}
                                      environment={(suppliers.find(s => s.key === 'abc')?.environment === 'production' ? 'production' : 'sandbox')}
                                      branchNumber={branchCode}
                                      initialQuery={it.item_name}
                                      onPick={(picked) => {
                                        const patch = {
                                          abc_item_number: picked.itemNumber,
                                          abc_color: picked.color || it.abc_color || null,
                                          abc_uom: picked.uom || it.abc_uom || it.unit || null,
                                          color_specs: picked.color || it.color_specs,
                                          abc_branch: branchCode.trim() || null,
                                          abc_ship_to: abcShipToNumber.trim() || null,
                                          // Reset stale price when item changes
                                          abc_price: null,
                                          abc_price_status: null,
                                          abc_availability: null,
                                          abc_price_timestamp: null,
                                        };
                                        updateItem(i, patch);
                                        persistSupplierLine(it, patch);
                                        persistAbcTemplateMapping(it, patch, picked.raw);
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
                              <td className="p-2">
                                {selected === 'abc' ? (
                                  <Input
                                    value={it.abc_uom || it.unit || ''}
                                    onChange={e => updateItem(i, { abc_uom: e.target.value })}
                                    onBlur={e => persistSupplierLine(it, {
                                      abc_uom: e.target.value.trim().toUpperCase() || null,
                                      abc_branch: branchCode.trim() || null,
                                      abc_ship_to: abcShipToNumber.trim() || null,
                                    })}
                                    className={`h-7 w-20 font-mono text-xs ${!(it.abc_uom || it.unit) ? 'border-amber-400' : ''}`}
                                  />
                                ) : safeText(it.unit)}
                              </td>
                              <td className="p-2">
                                {(() => {
                                  const { brand, colors } = colorsForItem(it.item_name);
                                  const current = it.color_specs || '';
                                  const inList = colors.includes(current);
                                  const selectValue = !current ? '' : inList ? current : '__custom__';
                                  return (
                                    <div className="flex flex-col gap-1">
                                      <Select
                                        value={selectValue}
                                        onValueChange={(v) => {
                                          if (v === '__custom__') {
                                            updateItem(i, { color_specs: current && !inList ? current : ' ' });
                                          } else {
                                            updateItem(i, { color_specs: v });
                                          }
                                        }}
                                      >
                                        <SelectTrigger
                                          className={`h-7 w-40 ${colorMissing ? 'border-destructive' : ''}`}
                                        >
                                          <SelectValue placeholder={brand ? `${brand} color…` : 'Select color…'} />
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
                                          onChange={(e) => updateItem(i, { color_specs: e.target.value })}
                                          placeholder="Custom color"
                                          className={`h-7 w-40 ${colorMissing ? 'border-destructive' : ''}`}
                                        />
                                      )}
                                    </div>
                                  );
                                })()}
                              </td>
                              {selected === 'abc' && tenantId && (
                                <td className="p-2">
                                  <div className="flex items-center gap-1">
                                    <AbcPriceCell state={it} />
                                    <AbcPriceButton
                                      tenantId={tenantId}
                                      environment={(suppliers.find(s => s.key === 'abc')?.environment === 'production' ? 'production' : 'sandbox')}
                                      branchNumber={branchCode}
                                      shipToNumber={abcShipToNumber}
                                      itemNumber={it.abc_item_number}
                                      uom={it.abc_uom || it.unit}
                                      quantity={Number(it.quantity) || 1}
                                      state={it}
                                      onPriced={(next) => {
                                        updateItem(i, next);
                                        persistSupplierLine(it, {
                                          ...next,
                                          abc_branch: branchCode.trim() || null,
                                          abc_ship_to: abcShipToNumber.trim() || null,
                                        });
                                        upsertAbcPriceCache(it, next);
                                      }}
                                    />
                                  </div>
                                </td>
                              )}
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
                  {selected && editableItems.some(i => selected === 'abc' ? !i.abc_item_number : !i.srs_item_code) && (
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

function CatalogSearchPopover({
  catalog,
  loading,
  branchCode,
  initialQuery,
  onOpen,
  onPick,
}: {
  catalog: any[];
  loading: boolean;
  branchCode: string;
  initialQuery: string;
  onOpen: () => void;
  onPick: (productId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setQuery(initialQuery || '');
    window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }, [initialQuery, open]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [query]);

  const filtered = useMemo(() => {
    const q = normalizeSkuText(query);
    if (!q) return catalog.slice(0, 200);
    const tokens = skuTokens(q);
    const scored = catalog
      .map((p) => {
        const pid = String(p.productId ?? p.productNumber ?? '');
        const hay = normalizeSkuText(productText(p));
        const hayTokens = new Set(skuTokens(hay));
        const acronym = skuAcronym(productText(p));
        const exactId = pid === q || pid.includes(q);
        const matchesToken = (token: string) =>
          token.length <= 2
            ? hayTokens.has(token) || acronym.includes(token) || tokenMatches(token, hayTokens)
            : hay.includes(token) || tokenMatches(token, hayTokens);
        const allTokensMatch = tokens.every(matchesToken);
        const score = exactId ? 2 : tokens.reduce((sum, token) => sum + (matchesToken(token) ? 1 : 0), 0) / Math.max(tokens.length, 1);
        return { p, score, allTokensMatch };
      })
      .filter((entry) => entry.allTokensMatch || entry.score >= 0.75)
      .sort((a, b) => b.score - a.score)
      .slice(0, 200);
    return scored.map((entry) => entry.p);
  }, [catalog, query]);

  const handleWheel = (event: WheelEvent<HTMLDivElement>) => {
    const el = scrollRef.current;
    if (!el) return;
    event.preventDefault();
    el.scrollTop += event.deltaY;
    el.scrollLeft += event.deltaX;
    event.stopPropagation();
  };

  return (
    <Popover
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (v) onOpen();
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-7 w-7 shrink-0"
          title="Search SRS catalog"
        >
          {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Search className="h-3 w-3" />}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[min(28rem,calc(100vw-2rem))] p-0"
        align="start"
        onOpenAutoFocus={(event) => event.preventDefault()}
        onWheelCapture={handleWheel}
      >
        <div className="flex items-center border-b px-3 py-2 gap-2">
          <Search className="h-4 w-4 text-muted-foreground shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search ${branchCode || 'SRS'} catalog…`}
            className="flex-1 bg-transparent outline-none text-sm"
          />
        </div>
        <div className="px-3 py-1.5 text-[11px] text-muted-foreground border-b">
          {loading
            ? 'Loading catalog…'
            : `${filtered.length}${filtered.length >= 200 ? '+' : ''} of ${catalog.length} products`}
        </div>
        <div
          ref={scrollRef}
          className="max-h-80 overflow-y-scroll overscroll-contain touch-pan-y [scrollbar-gutter:stable]"
          style={{ WebkitOverflowScrolling: 'touch' }}
        >
          {!loading && catalog.length === 0 && (
            <div className="p-4 text-xs text-muted-foreground">Catalog not loaded.</div>
          )}
          {!loading && catalog.length > 0 && filtered.length === 0 && (
            <div className="p-4 text-xs text-muted-foreground">No matches for "{query}".</div>
          )}
          {filtered.map((p: any) => {
            const pid = String(p.productId ?? p.productNumber ?? '');
            const name = String(p.productName ?? p.description ?? '');
            const opt = p.option ? ` — ${p.option}` : '';
            const uom = p.uom ? ` [${p.uom}]` : '';
            return (
              <button
                key={`${pid}-${name}-${opt}`}
                type="button"
                onClick={() => {
                  onPick(pid);
                  setOpen(false);
                }}
                className="w-full text-left px-3 py-2 text-xs hover:bg-accent flex items-start gap-2 border-b last:border-b-0"
              >
                <span className="font-mono text-muted-foreground shrink-0 w-14">{pid}</span>
                <span className="flex-1">{name}{opt}{uom}</span>
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
