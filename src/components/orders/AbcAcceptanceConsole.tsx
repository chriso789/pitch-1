/**
 * ABC sandbox acceptance console — Phases D, E and F.
 *
 * D  Prove material-order behavior: pick manufacturer / product line / color,
 *    resolve the field shingle, the matching hip-and-ridge and an accessory
 *    independently, change color or branch and prove resolution changes or is
 *    invalidated.
 * E  Pricing preflight: price every resolved ABC item number against the
 *    selected sandbox ship-to + branch with ordering purpose.
 * F  Acceptance preview: server-built payload, payload hash and idempotency
 *    key — displayed only. NOTHING is ever submitted from this console.
 *
 * Item codes are NEVER derived in the browser. Every code shown here comes from
 * supplier-api `/catalog/resolve` reading approved rows in
 * `supplier_item_mappings`.
 */
import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { edgeApi } from '@/lib/edgeApi';
import { useEffectiveTenantId } from '@/hooks/useEffectiveTenantId';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Loader2, ShieldCheck, ShieldAlert, ReceiptText, FlaskConical } from 'lucide-react';

type Role = 'field' | 'ridge' | 'accessory';

const ROLE_LABEL: Record<Role, string> = {
  field: 'Field shingle',
  ridge: 'Hip & ridge',
  accessory: 'Accessory',
};

interface ApprovedMapping {
  id: string;
  variant_id: string;
  color_id: string | null;
  branch_code: string | null;
  supplier_item_number: string;
  supplier_description: string | null;
  supplier_color_name: string | null;
  supplier_uom: string;
  validated_at: string | null;
  mapping_source: string | null;
  catalog_fingerprint: string | null;
  variant?: {
    id: string;
    variant_name: string;
    is_accessory: boolean;
    accessory_kind: string | null;
    canonical_uom: string;
    manufacturer_id: string;
    product_line_id: string;
    mfr_manufacturers?: { name: string } | null;
    mfr_product_lines?: { name: string } | null;
  } | null;
  color?: { id: string; canonical_name: string; manufacturer_color_code: string | null } | null;
}

interface ResolvedLine {
  key: string;
  ok: boolean;
  failure_code?: string;
  failure_message?: string;
  manufacturer_name: string | null;
  product_line_name: string | null;
  variant_name: string | null;
  color_name: string | null;
  supplier_color_name: string | null;
  supplier_item_number: string | null;
  supplier_uom: string | null;
  branch_code: string | null;
  quantity: number;
  mapping_source: string | null;
  validated_at: string | null;
}

interface LineSlot {
  role: Role;
  mappingId: string | null;
  quantity: number;
}

const DEFAULT_SLOTS: LineSlot[] = [
  { role: 'field', mappingId: null, quantity: 30 },
  { role: 'ridge', mappingId: null, quantity: 6 },
  { role: 'accessory', mappingId: null, quantity: 4 },
];

function roleOf(m: ApprovedMapping): Role {
  const v = m.variant;
  if (v?.is_accessory) return 'accessory';
  const text = `${v?.variant_name ?? ''} ${m.supplier_description ?? ''}`.toLowerCase();
  if (/(hip|ridge|seal-?a-?ridge|timbertex|z ?ridge)/.test(text)) return 'ridge';
  return 'field';
}

interface ShipToOption {
  id: string;
  ship_to_number: string;
  name: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  is_default: boolean | null;
  active: boolean;
  status_label: string;
  branch_numbers: string[];
}

function formatShipToAddress(s: ShipToOption) {
  const street = [s.address_line1, s.address_line2].filter(Boolean).join(' ');
  const region = [s.city, s.state].filter(Boolean).join(', ');
  return [street, [region, s.postal_code].filter(Boolean).join(' ')]
    .filter((p) => p && p.trim())
    .join(', ');
}

function shipToLabel(s: ShipToOption) {
  const addr = formatShipToAddress(s);
  const branchPart = s.branch_numbers.length
    ? `Branch ${s.branch_numbers.slice(0, 3).join('/')}${s.branch_numbers.length > 3 ? '…' : ''}`
    : 'No branches synced';
  return [s.ship_to_number, s.name || 'Unnamed account', addr || 'No address on file', branchPart]
    .join(' — ');
}

const SHIP_TO_STORAGE_PREFIX = 'abc.acceptance.shipTo.';
const BRANCH_STORAGE_PREFIX = 'abc.acceptance.branch.';

export default function AbcAcceptanceConsole() {
  const tenantId = useEffectiveTenantId();
  const { toast } = useToast();

  const [slots, setSlots] = useState<LineSlot[]>(DEFAULT_SLOTS);
  const [branch, setBranch] = useState('');
  const [shipTo, setShipTo] = useState('');
  const [poNumber, setPoNumber] = useState('PITCH-ACCEPT-001');

  const [resolving, setResolving] = useState(false);
  const [pricing, setPricing] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [validating, setValidating] = useState(false);
  const [validation, setValidation] = useState<
    | { shipTo: string; branch: string; valid: boolean; message: string; error_code?: string }
    | null
  >(null);

  const [resolved, setResolved] = useState<ResolvedLine[] | null>(null);
  const [priceRows, setPriceRows] = useState<any[] | null>(null);
  const [priceMeta, setPriceMeta] = useState<{ endpoint?: string; status?: number } | null>(null);
  const [preview, setPreview] = useState<any | null>(null);
  const [hashLog, setHashLog] = useState<Array<{ at: string; hash: string; key: string; note: string }>>([]);

  // ---- connection / branch / ship-to context -----------------------------
  const { data: ctx } = useQuery({
    queryKey: ['abc-acceptance-ctx', tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const [conn, ships, branches] = await Promise.all([
        supabase
          .from('abc_connections')
          .select('id, environment, account_number, selected_ship_to_number, selected_branch_number, connection_status')
          .eq('tenant_id', tenantId as string)
          .order('updated_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from('abc_ship_to_accounts')
          .select('id, ship_to_number, name, address_line1, address_line2, city, state, postal_code, is_default, raw')
          .eq('tenant_id', tenantId as string)
          .order('ship_to_number')
          .limit(200),
        supabase
          .from('abc_account_branches')
          .select('branch_number, name, city, state, ship_to_id, is_home_branch')
          .eq('tenant_id', tenantId as string)
          .order('branch_number')
          .limit(500),
      ]);

      const branchRows = (branches.data ?? []) as any[];
      const branchesByShipTo = new Map<string, string[]>();
      for (const b of branchRows) {
        if (!b.ship_to_id) continue;
        const list = branchesByShipTo.get(b.ship_to_id) ?? [];
        list.push(String(b.branch_number));
        branchesByShipTo.set(b.ship_to_id, list);
      }

      const shipTos: ShipToOption[] = ((ships.data ?? []) as any[]).map((s) => {
        const rawStatus = s.raw?.shipTo?.status ?? s.raw?.status ?? null;
        const active = typeof rawStatus === 'string' ? !/inactive|closed|suspend/i.test(rawStatus) : true;
        return {
          id: s.id,
          ship_to_number: s.ship_to_number,
          name: s.name,
          address_line1: s.address_line1,
          address_line2: s.address_line2,
          city: s.city,
          state: s.state,
          postal_code: s.postal_code,
          is_default: s.is_default,
          active,
          status_label: typeof rawStatus === 'string' && rawStatus ? rawStatus : active ? 'Active' : 'Inactive',
          branch_numbers: branchesByShipTo.get(s.id) ?? [],
        };
      });

      // De-duplicate the branch dropdown while keeping full metadata.
      const seen = new Set<string>();
      const branchOptions = branchRows.filter((b) => {
        const key = String(b.branch_number);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      return { connection: conn.data ?? null, shipTos, branches: branchOptions };
    },
  });

  const connection = ctx?.connection ?? null;

  // Restore the last selection for this tenant so a reload never silently
  // changes which ABC account an acceptance test runs against.
  useEffect(() => {
    if (!tenantId) return;
    const savedShipTo = localStorage.getItem(SHIP_TO_STORAGE_PREFIX + tenantId);
    const savedBranch = localStorage.getItem(BRANCH_STORAGE_PREFIX + tenantId);
    if (savedShipTo) setShipTo(savedShipTo);
    if (savedBranch) setBranch(savedBranch);
  }, [tenantId]);

  const effectiveBranch = branch || connection?.selected_branch_number || '';
  const effectiveShipTo = shipTo || connection?.selected_ship_to_number || '';

  const shipToOptions = ctx?.shipTos ?? [];
  const selectedShipTo = shipToOptions.find((s) => s.ship_to_number === effectiveShipTo) ?? null;

  // Recommend the ship-to that is actually authorized for the selected branch.
  const recommendedShipTo = useMemo(() => {
    if (!effectiveBranch) return null;
    const compatible = shipToOptions.filter(
      (s) => s.active && s.branch_numbers.includes(effectiveBranch),
    );
    if (!compatible.length) return null;
    return compatible.find((s) => s.is_default) ?? compatible[0];
  }, [shipToOptions, effectiveBranch]);

  const pairingLooksValid =
    !!selectedShipTo && !!effectiveBranch && selectedShipTo.branch_numbers.includes(effectiveBranch);

  const validationMatchesSelection =
    !!validation && validation.shipTo === effectiveShipTo && validation.branch === effectiveBranch;
  const serverValidated = validationMatchesSelection && validation!.valid;

  const persistShipTo = (v: string) => {
    setShipTo(v);
    if (tenantId) localStorage.setItem(SHIP_TO_STORAGE_PREFIX + tenantId, v);
    setValidation(null);
  };
  const persistBranch = (v: string) => {
    setBranch(v);
    if (tenantId) localStorage.setItem(BRANCH_STORAGE_PREFIX + tenantId, v);
    setValidation(null);
  };

  // Server-side gate — must pass before pricing or payload preparation.
  const runValidation = async (probeItemNumber?: string | null): Promise<boolean> => {
    if (!effectiveShipTo || !effectiveBranch) {
      toast({ title: 'Select a ship-to and a branch first', variant: 'destructive' });
      return false;
    }
    setValidating(true);
    const { data, error } = await supabase.functions.invoke('abc-api-proxy', {
      body: {
        action: 'validate_ship_to_branch',
        tenant_id: tenantId,
        environment: connection?.environment ?? 'sandbox',
        shipToNumber: effectiveShipTo,
        branchNumber: effectiveBranch,
        probeItemNumber: probeItemNumber ?? null,
      },
    });
    setValidating(false);
    if (error) {
      setValidation({ shipTo: effectiveShipTo, branch: effectiveBranch, valid: false, message: error.message });
      toast({ title: 'Validation failed', description: error.message, variant: 'destructive' });
      return false;
    }
    const valid = !!data?.valid;
    setValidation({
      shipTo: effectiveShipTo,
      branch: effectiveBranch,
      valid,
      message: data?.message ?? (valid ? 'Validated.' : 'Ship-to/branch pairing rejected.'),
      error_code: data?.error_code,
    });
    toast({
      title: valid ? 'Ship-to validated' : 'Ship-to/branch rejected',
      description: data?.message,
      variant: valid ? 'default' : 'destructive',
    });
    return valid;
  };


  // ---- approved mappings (the only orderable source) ---------------------
  const { data: mappings = [], isLoading: loadingMappings, refetch } = useQuery({
    queryKey: ['abc-approved-mappings', tenantId],
    enabled: !!tenantId,
    queryFn: async (): Promise<ApprovedMapping[]> => {
      const { data, error } = await supabase
        .from('supplier_item_mappings')
        .select(
          'id, variant_id, color_id, branch_code, supplier_item_number, supplier_description, supplier_color_name, supplier_uom, validated_at, mapping_source, catalog_fingerprint, variant:mfr_product_variants(id, variant_name, is_accessory, accessory_kind, canonical_uom, manufacturer_id, product_line_id, mfr_manufacturers(name), mfr_product_lines(name)), color:mfr_colors(id, canonical_name, manufacturer_color_code)',
        )
        .eq('tenant_id', tenantId as string)
        .eq('supplier', 'abc')
        .eq('approval_state', 'approved')
        .eq('status', 'active')
        .order('supplier_description')
        .limit(1000);
      if (error) throw error;
      return (data ?? []) as unknown as ApprovedMapping[];
    },
  });

  const byRole = useMemo(() => {
    const buckets: Record<Role, ApprovedMapping[]> = { field: [], ridge: [], accessory: [] };
    for (const m of mappings) buckets[roleOf(m)].push(m);
    return buckets;
  }, [mappings]);

  const mappingById = useMemo(() => {
    const map = new Map<string, ApprovedMapping>();
    for (const m of mappings) map.set(m.id, m);
    return map;
  }, [mappings]);

  const activeSlots = slots.filter((s) => s.mappingId && mappingById.has(s.mappingId));

  const buildLines = () =>
    activeSlots.map((s) => {
      const m = mappingById.get(s.mappingId as string) as ApprovedMapping;
      return {
        key: s.role,
        variant_id: m.variant_id,
        color_id: m.color_id,
        uom: m.supplier_uom || m.variant?.canonical_uom || 'EA',
        quantity: s.quantity,
      };
    });

  const invalidate = (note: string) => {
    setResolved(null);
    setPriceRows(null);
    setPreview(null);
    if (note) toast({ title: 'Validation cleared', description: note });
  };

  const setSlot = (role: Role, patch: Partial<LineSlot>) => {
    setSlots((prev) => prev.map((s) => (s.role === role ? { ...s, ...patch } : s)));
    invalidate('');
    setResolved(null);
    setPriceRows(null);
    setPreview(null);
  };

  // ---- D: resolve --------------------------------------------------------
  const runResolve = async () => {
    if (!activeSlots.length) {
      toast({ title: 'Pick at least one approved mapping', variant: 'destructive' });
      return;
    }
    setResolving(true);
    setPriceRows(null);
    setPreview(null);
    const { data, error } = await edgeApi<any>('supplier-api', '/catalog/resolve', {
      supplier: 'abc',
      supplier_connection_id: connection?.id ?? null,
      supplier_account_number: connection?.account_number ?? null,
      branch_code: effectiveBranch || null,
      lines: buildLines(),
    });
    setResolving(false);
    if (error) {
      toast({ title: 'Resolution failed', description: error, variant: 'destructive' });
      return;
    }
    setResolved((data?.lines ?? []) as ResolvedLine[]);
    const bad = (data?.unresolved_count ?? 0) as number;
    toast({
      title: bad ? `${bad} line(s) blocked` : 'All lines resolved',
      description: bad
        ? 'Blocked lines have no approved, branch-valid mapping.'
        : 'Exact ABC item numbers resolved from approved mappings.',
      variant: bad ? 'destructive' : 'default',
    });
  };

  // ---- E: pricing preflight ---------------------------------------------
  const runPricing = async () => {
    const okLines = (resolved ?? []).filter((l) => l.ok && l.supplier_item_number);
    if (!okLines.length) {
      toast({ title: 'Resolve lines first', variant: 'destructive' });
      return;
    }
    if (!effectiveShipTo || !effectiveBranch) {
      toast({ title: 'Ship-to and branch are required', variant: 'destructive' });
      return;
    }
    // Server-side gate: the pairing must be validated before ABC pricing runs.
    if (!serverValidated) {
      const ok = await runValidation(okLines[0]?.supplier_item_number ?? null);
      if (!ok) return;
    }
    setPricing(true);

    const { data, error } = await supabase.functions.invoke('abc-api-proxy', {
      body: {
        action: 'price_items',
        tenant_id: tenantId,
        environment: connection?.environment ?? 'sandbox',
        purpose: 'ordering',
        shipToNumber: effectiveShipTo,
        branchNumber: effectiveBranch,
        lines: okLines.map((l) => ({
          itemNumber: l.supplier_item_number,
          quantity: l.quantity,
          unitOfMeasure: l.supplier_uom,
        })),
      },
    });
    setPricing(false);
    if (error || data?.success === false) {
      toast({
        title: 'Pricing preflight failed',
        description: (data?.message || data?.error || error?.message) ?? 'ABC pricing call failed',
        variant: 'destructive',
      });
      return;
    }
    const parsed = data?.parsed?.lines ?? data?.parsed?.items ?? data?.body?.items ?? [];
    setPriceRows(Array.isArray(parsed) ? parsed : []);
    setPriceMeta({ endpoint: data?.endpoint, status: data?.status });
    toast({ title: 'Pricing preflight complete', description: `${(parsed || []).length} priced line(s) returned.` });
  };

  // ---- F: acceptance preview (never submits) -----------------------------
  const runPreview = async () => {
    if (!(resolved ?? []).some((l) => l.ok)) {
      toast({ title: 'Resolve lines first', variant: 'destructive' });
      return;
    }
    setPreparing(true);
    const { data, error } = await edgeApi<any>('supplier-api', '/orders/prepare', {
      supplier: 'abc',
      supplier_connection_id: connection?.id ?? null,
      supplier_account_number: connection?.account_number ?? null,
      branch_code: effectiveBranch || null,
      ship_to_number: effectiveShipTo || null,
      po_number: poNumber || null,
      order_version: 1,
      lines: buildLines(),
    });
    setPreparing(false);
    if (error) {
      toast({ title: 'Preview build failed', description: error, variant: 'destructive' });
      return;
    }
    setPreview(data);
    if (data?.payload_hash) {
      setHashLog((prev) => [
        {
          at: new Date().toLocaleTimeString(),
          hash: data.payload_hash,
          key: data.idempotency_key,
          note: (resolved ?? []).map((l) => `${l.supplier_item_number ?? '—'}@${l.quantity}`).join(' · '),
        },
        ...prev,
      ].slice(0, 8));
    }
    toast({ title: 'Acceptance preview built', description: 'Nothing was submitted to ABC.' });
  };

  const distinctHashes = new Set(hashLog.map((h) => h.hash)).size;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <FlaskConical className="h-5 w-5" />
              ABC acceptance console (Phases D–F)
            </CardTitle>
            <CardDescription>
              Resolve approved mappings to exact ABC item numbers, run the ordering pricing
              preflight, and build the redacted acceptance payload. This console never submits an order.
            </CardDescription>
          </div>
          <Badge variant="outline">{connection?.environment ?? 'no connection'}</Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        {!loadingMappings && mappings.length === 0 && (
          <Alert>
            <ShieldAlert className="h-4 w-4" />
            <AlertTitle>No approved ABC mappings yet</AlertTitle>
            <AlertDescription>
              Approve at least one field shingle, its matching hip &amp; ridge and one accessory in the
              mapping approval panel above. Only approved, branch-valid mappings can build a payload.
            </AlertDescription>
          </Alert>
        )}

        {/* Context */}
        <div className="grid gap-4 md:grid-cols-3">
          <div className="space-y-1.5">
            <Label>Ship-to</Label>
            <Select value={effectiveShipTo} onValueChange={(v) => { setShipTo(v); invalidate('Ship-to changed — re-resolve required.'); }}>
              <SelectTrigger><SelectValue placeholder="Select ship-to" /></SelectTrigger>
              <SelectContent>
                {(ctx?.shipTos ?? []).map((s: any) => (
                  <SelectItem key={s.ship_to_number} value={s.ship_to_number}>
                    {s.ship_to_number} — {s.name ?? ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Branch</Label>
            <Select value={effectiveBranch} onValueChange={(v) => { setBranch(v); invalidate('Branch changed — previous validation invalidated.'); }}>
              <SelectTrigger><SelectValue placeholder="Select branch" /></SelectTrigger>
              <SelectContent>
                {(ctx?.branches ?? []).map((b: any) => (
                  <SelectItem key={b.branch_number} value={b.branch_number}>
                    {b.branch_number} — {b.name ?? ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>PO number</Label>
            <Input value={poNumber} onChange={(e) => { setPoNumber(e.target.value); setPreview(null); }} />
          </div>
        </div>

        <Separator />

        {/* D — line selection */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold">Phase D — coordinated order lines</h4>
            <Button variant="ghost" size="sm" onClick={() => refetch()}>Reload approved mappings</Button>
          </div>
          {slots.map((slot) => {
            const options = byRole[slot.role];
            return (
              <div key={slot.role} className="grid gap-3 md:grid-cols-[140px_1fr_110px] items-end">
                <div className="text-sm font-medium">{ROLE_LABEL[slot.role]}</div>
                <Select
                  value={slot.mappingId ?? ''}
                  onValueChange={(v) => setSlot(slot.role, { mappingId: v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={options.length ? 'Select approved mapping' : 'No approved mappings'} />
                  </SelectTrigger>
                  <SelectContent>
                    {options.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {(m.variant?.mfr_manufacturers?.name ?? '')} {m.variant?.variant_name ?? m.supplier_description}
                        {m.color?.canonical_name ? ` · ${m.color.canonical_name}` : ''} · {m.supplier_item_number}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  type="number"
                  min={1}
                  value={slot.quantity}
                  onChange={(e) => setSlot(slot.role, { quantity: Number(e.target.value) || 1 })}
                />
              </div>
            );
          })}

          <div className="flex flex-wrap gap-2 pt-1">
            <Button onClick={runResolve} disabled={resolving || !activeSlots.length}>
              {resolving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <ShieldCheck className="h-4 w-4 mr-2" />}
              Resolve exact ABC item numbers
            </Button>
            <Button variant="outline" onClick={runPricing} disabled={pricing || !resolved}>
              {pricing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <ReceiptText className="h-4 w-4 mr-2" />}
              Phase E — pricing preflight
            </Button>
            <Button variant="secondary" onClick={runPreview} disabled={preparing || !resolved}>
              {preparing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Phase F — build acceptance preview
            </Button>
          </div>
        </div>

        {/* Resolution table */}
        {resolved && (
          <div className="space-y-2">
            <h4 className="text-sm font-semibold">Resolution table</h4>
            <div className="border rounded-md overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Pitch product</TableHead>
                    <TableHead>Manufacturer</TableHead>
                    <TableHead>Product line</TableHead>
                    <TableHead>Color</TableHead>
                    <TableHead>ABC color</TableHead>
                    <TableHead>ABC item #</TableHead>
                    <TableHead>Branch</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead>UOM</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead>Validated</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {resolved.map((l) => (
                    <TableRow key={l.key}>
                      <TableCell className="font-medium">{ROLE_LABEL[l.key as Role] ?? l.key}</TableCell>
                      <TableCell>{l.manufacturer_name ?? '—'}</TableCell>
                      <TableCell>{l.product_line_name ?? '—'}</TableCell>
                      <TableCell>{l.color_name ?? '—'}</TableCell>
                      <TableCell>{l.supplier_color_name ?? '—'}</TableCell>
                      <TableCell className="font-mono text-xs">{l.supplier_item_number ?? '—'}</TableCell>
                      <TableCell>{l.branch_code ?? '—'}</TableCell>
                      <TableCell className="text-right">{l.quantity}</TableCell>
                      <TableCell>{l.supplier_uom ?? '—'}</TableCell>
                      <TableCell>{l.mapping_source ?? '—'}</TableCell>
                      <TableCell className="text-xs">
                        {l.validated_at ? new Date(l.validated_at).toLocaleDateString() : '—'}
                      </TableCell>
                      <TableCell>
                        {l.ok ? (
                          <Badge variant="outline" className="text-emerald-600 border-emerald-600">resolved</Badge>
                        ) : (
                          <Badge variant="destructive">{l.failure_code ?? 'blocked'}</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {resolved.some((l) => !l.ok) && (
              <p className="text-xs text-muted-foreground">
                {resolved.filter((l) => !l.ok).map((l) => `${l.key}: ${l.failure_message ?? l.failure_code}`).join(' · ')}
              </p>
            )}
          </div>
        )}

        {/* E — pricing */}
        {priceRows && (
          <div className="space-y-2">
            <h4 className="text-sm font-semibold">Phase E — ABC ordering pricing preflight</h4>
            <p className="text-xs text-muted-foreground">
              Endpoint {priceMeta?.endpoint ?? '—'} · HTTP {priceMeta?.status ?? '—'} · ship-to ****
              {effectiveShipTo.slice(-4)} · branch {effectiveBranch}
            </p>
            <div className="border rounded-md overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ABC item #</TableHead>
                    <TableHead>UOM</TableHead>
                    <TableHead className="text-right">Unit price</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead>Result</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {priceRows.map((r: any, i: number) => {
                    const unit = r?.unitPrice ?? r?.unit_price ?? r?.price ?? null;
                    const blocked = unit == null || Number(unit) <= 0;
                    return (
                      <TableRow key={i}>
                        <TableCell className="font-mono text-xs">{r?.itemNumber ?? r?.item_number ?? '—'}</TableCell>
                        <TableCell>{r?.unitOfMeasure ?? r?.uom ?? '—'}</TableCell>
                        <TableCell className="text-right">
                          {blocked ? '—' : `$${Number(unit).toFixed(2)}`}
                        </TableCell>
                        <TableCell className="text-right">{r?.quantity ?? '—'}</TableCell>
                        <TableCell>
                          {blocked
                            ? <Badge variant="destructive">blocked — no price</Badge>
                            : <Badge variant="outline" className="text-emerald-600 border-emerald-600">priced</Badge>}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </div>
        )}

        {/* F — preview */}
        {preview && (
          <div className="space-y-2">
            <h4 className="text-sm font-semibold">Phase F — acceptance preview (not submitted)</h4>
            <div className="grid gap-2 md:grid-cols-2 text-xs">
              <div className="rounded border p-2">
                <div className="text-muted-foreground">Payload hash</div>
                <div className="font-mono break-all">{preview.payload_hash}</div>
              </div>
              <div className="rounded border p-2">
                <div className="text-muted-foreground">Idempotency key</div>
                <div className="font-mono break-all">{preview.idempotency_key}</div>
              </div>
            </div>
            <pre className="text-xs bg-muted rounded p-3 overflow-x-auto max-h-96">
              {JSON.stringify(preview.payload ?? preview, null, 2)}
            </pre>
            <Alert>
              <ShieldCheck className="h-4 w-4" />
              <AlertTitle>No order was submitted</AlertTitle>
              <AlertDescription>
                This console only prepares and stores the immutable snapshot. Submission stays behind the
                existing Push-to-supplier flow and your explicit approval.
              </AlertDescription>
            </Alert>
          </div>
        )}

        {/* Hash evidence log */}
        {hashLog.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-sm font-semibold">Payload hash evidence</h4>
            <p className="text-xs text-muted-foreground">
              {hashLog.length} build(s) · {distinctHashes} distinct hash(es). Rebuilding an unchanged order
              must reuse the same key; changing color or quantity must produce a different one.
            </p>
            <div className="border rounded-md overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Time</TableHead>
                    <TableHead>Lines</TableHead>
                    <TableHead>Hash</TableHead>
                    <TableHead>Idempotency key</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {hashLog.map((h, i) => (
                    <TableRow key={i}>
                      <TableCell className="text-xs">{h.at}</TableCell>
                      <TableCell className="text-xs font-mono">{h.note}</TableCell>
                      <TableCell className="text-xs font-mono">{h.hash.slice(0, 16)}…</TableCell>
                      <TableCell className="text-xs font-mono">{h.key.slice(0, 20)}…</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
