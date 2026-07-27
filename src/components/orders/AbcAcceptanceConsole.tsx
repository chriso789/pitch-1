/**
 * ABC order console — ONE production action: "Validate & Build ABC Order".
 *
 * Resolution, mapping verification, manufacturer compatibility, branch/Ship-To
 * validation, ABC pricing, payload build and the immutable preview snapshot all
 * run inside a single server orchestration (`supplier-api /orders/build`).
 * The browser never chains trusted results and never supplies item codes,
 * UOMs, prices, branch values, mapping IDs or payload fields.
 *
 * Nothing on this screen submits an order. Submission is a separate,
 * role-gated, hash-verified action inside the review modal.
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
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Separator } from '@/components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Loader2, ShieldAlert, ShieldCheck, RotateCcw } from 'lucide-react';
import { AbcOrderReviewDialog, type OrderPreview } from './AbcOrderReviewDialog';

type Role = 'field' | 'ridge' | 'accessory';

const ROLE_LABEL: Record<Role, string> = {
  field: 'Field shingle',
  ridge: 'Hip & ridge',
  accessory: 'Accessory',
};

const STAGE_SEQUENCE = [
  'Validating order…',
  'Resolving ABC products…',
  'Checking compatibility…',
  'Checking branch and Ship-To…',
  'Retrieving ABC pricing…',
  'Building order preview…',
];

interface ApprovedMapping {
  id: string;
  variant_id: string;
  color_id: string | null;
  branch_code: string | null;
  supplier_item_number: string;
  supplier_description: string | null;
  supplier_color_name: string | null;
  supplier_uom: string;
  variant?: { variant_name: string; is_accessory: boolean; canonical_uom: string } | null;
  color?: { canonical_name: string } | null;
}

interface LineSlot { role: Role; mappingId: string | null; quantity: number }

const DEFAULT_SLOTS: LineSlot[] = [
  { role: 'field', mappingId: null, quantity: 30 },
  { role: 'ridge', mappingId: null, quantity: 6 },
  { role: 'accessory', mappingId: null, quantity: 4 },
];

function roleOf(m: ApprovedMapping): Role {
  if (m.variant?.is_accessory) return 'accessory';
  const text = `${m.variant?.variant_name ?? ''} ${m.supplier_description ?? ''}`.toLowerCase();
  if (/(hip|ridge|seal-?a-?ridge|timbertex|z ?ridge)/.test(text)) return 'ridge';
  if (/(shingle|timberline|hdz|architectural|starter|shake|slate|gaf)/.test(text)) return 'field';
  return 'accessory';
}

interface ShipToOption {
  id: string; ship_to_number: string; name: string | null;
  address_line1: string | null; address_line2: string | null;
  city: string | null; state: string | null; postal_code: string | null;
  is_default: boolean | null; active: boolean; branch_numbers: string[];
}

const SHIP_TO_KEY = 'abc.order.shipTo.';
const BRANCH_KEY = 'abc.order.branch.';

interface BuildFailure {
  failed_stage: string;
  stage_label: string;
  line_key: string | null;
  reason: string;
  correction: string;
}

export default function AbcAcceptanceConsole() {
  const tenantId = useEffectiveTenantId();
  const { toast } = useToast();

  const [slots, setSlots] = useState<LineSlot[]>(DEFAULT_SLOTS);
  const [branch, setBranch] = useState('');
  const [shipTo, setShipTo] = useState('');

  // Order information (all required unless noted).
  const [jobName, setJobName] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [addr, setAddr] = useState({ line1: '', line2: '', city: '', state: '', postal_code: '' });
  const [deliveryDate, setDeliveryDate] = useState('');
  const [dateTbd, setDateTbd] = useState(false);
  const [deliveryMethod, setDeliveryMethod] = useState('delivery');
  const [contactName, setContactName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [notes, setNotes] = useState('');

  const [running, setRunning] = useState(false);
  const [stageIdx, setStageIdx] = useState(-1);
  const [failure, setFailure] = useState<BuildFailure | null>(null);
  const [preview, setPreview] = useState<OrderPreview | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);

  // ---- connection / branch / ship-to context -----------------------------
  const { data: ctx } = useQuery({
    queryKey: ['abc-order-ctx', tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const [conn, ships, branches] = await Promise.all([
        supabase.from('abc_connections')
          .select('id, environment, account_number, selected_ship_to_number, selected_branch_number, connection_status')
          .eq('tenant_id', tenantId as string).order('updated_at', { ascending: false }).limit(1).maybeSingle(),
        supabase.from('abc_ship_to_accounts')
          .select('id, ship_to_number, name, address_line1, address_line2, city, state, postal_code, is_default, raw')
          .eq('tenant_id', tenantId as string).order('ship_to_number').limit(200),
        supabase.from('abc_account_branches')
          .select('branch_number, name, city, state, ship_to_id')
          .eq('tenant_id', tenantId as string).order('branch_number').limit(500),
      ]);

      const branchRows = (branches.data ?? []) as any[];
      const byShipTo = new Map<string, string[]>();
      for (const b of branchRows) {
        if (!b.ship_to_id) continue;
        const list = byShipTo.get(b.ship_to_id) ?? [];
        list.push(String(b.branch_number));
        byShipTo.set(b.ship_to_id, list);
      }
      const shipTos: ShipToOption[] = ((ships.data ?? []) as any[]).map((s) => {
        const rawStatus = s.raw?.shipTo?.status ?? s.raw?.status ?? null;
        return {
          id: s.id, ship_to_number: s.ship_to_number, name: s.name,
          address_line1: s.address_line1, address_line2: s.address_line2,
          city: s.city, state: s.state, postal_code: s.postal_code,
          is_default: s.is_default,
          active: typeof rawStatus === 'string' ? !/inactive|closed|suspend/i.test(rawStatus) : true,
          branch_numbers: byShipTo.get(s.id) ?? [],
        };
      });
      const seen = new Set<string>();
      const branchOptions = branchRows.filter((b) => {
        const k = String(b.branch_number);
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
      return { connection: conn.data ?? null, shipTos, branches: branchOptions };
    },
  });

  const connection = ctx?.connection ?? null;

  useEffect(() => {
    if (!tenantId) return;
    const s = localStorage.getItem(SHIP_TO_KEY + tenantId);
    const b = localStorage.getItem(BRANCH_KEY + tenantId);
    if (s) setShipTo(s);
    if (b) setBranch(b);
  }, [tenantId]);

  const effectiveBranch = branch || connection?.selected_branch_number || '';
  const effectiveShipTo = shipTo || connection?.selected_ship_to_number || '';
  const shipToOptions = ctx?.shipTos ?? [];

  // ---- approved mappings (the only orderable source) ---------------------
  const { data: mappings = [], isLoading: loadingMappings, refetch } = useQuery({
    queryKey: ['abc-approved-mappings', tenantId, effectiveBranch || 'all'],
    enabled: !!tenantId,
    queryFn: async (): Promise<ApprovedMapping[]> => {
      let q = supabase.from('supplier_item_mappings')
        .select('id, variant_id, color_id, branch_code, supplier_item_number, supplier_description, supplier_color_name, supplier_uom')
        .eq('tenant_id', tenantId as string)
        .eq('supplier', 'abc')
        .eq('approval_state', 'approved')
        .eq('status', 'active')
        .order('supplier_description')
        .limit(2000);
      if (effectiveBranch) q = q.eq('branch_code', effectiveBranch);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as ApprovedMapping[];
    },
  });

  const byRole = useMemo(() => {
    const b: Record<Role, ApprovedMapping[]> = { field: [], ridge: [], accessory: [] };
    for (const m of mappings) b[roleOf(m)].push(m);
    return b;
  }, [mappings]);

  const mappingById = useMemo(() => new Map(mappings.map((m) => [m.id, m])), [mappings]);
  const activeSlots = slots.filter((s) => s.mappingId && mappingById.has(s.mappingId));

  // Any edit invalidates the preview — mappings and catalog rows are untouched.
  const invalidatePreview = () => { setPreview(null); setFailure(null); };

  const setSlot = (role: Role, patch: Partial<LineSlot>) => {
    setSlots((prev) => prev.map((s) => (s.role === role ? { ...s, ...patch } : s)));
    invalidatePreview();
  };
  const persistShipTo = (v: string) => {
    setShipTo(v);
    if (tenantId) localStorage.setItem(SHIP_TO_KEY + tenantId, v);
    invalidatePreview();
  };
  const persistBranch = (v: string) => {
    setBranch(v);
    if (tenantId) localStorage.setItem(BRANCH_KEY + tenantId, v);
    invalidatePreview();
  };

  // ---- restore last saved preview (no ABC pricing re-run) ----------------
  useEffect(() => {
    if (!tenantId) return;
    let cancelled = false;
    (async () => {
      const { data } = await edgeApi<any>('supplier-api', '/orders/preview');
      const row = data?.preview;
      if (cancelled || !row || row.state !== 'prepared') return;
      setPreview({
        submission_id: row.id,
        payload_hash: row.payload_hash,
        idempotency_key: row.idempotency_key,
        po_number: row.order_context?.po_number ?? '—',
        order_context: row.order_context ?? {},
        lines: row.resolved_lines ?? [],
        pricing: row.pricing_snapshot?.lines ?? [],
        totals: row.pricing_snapshot?.totals ?? { subtotal: 0, fees: 0, taxes: 0, currency: 'USD' },
        compatibility_evidence: row.compatibility_evidence ?? [],
        payload: row.outbound_payload,
        stages: row.stage_results ?? [],
      });
    })();
    return () => { cancelled = true; };
  }, [tenantId]);

  const buildLines = () =>
    activeSlots.map((s) => {
      const m = mappingById.get(s.mappingId as string) as ApprovedMapping;
      return {
        key: s.role,
        role: s.role,
        variant_id: m.variant_id,
        color_id: m.color_id,
        uom: m.supplier_uom || m.variant?.canonical_uom || 'EA',
        quantity: s.quantity,
      };
    });

  // ---- THE one production action -----------------------------------------
  const runBuild = async () => {
    if (running) return; // duplicate-click guard
    setRunning(true);
    setFailure(null);
    setPreview(null);
    setStageIdx(0);

    const ticker = setInterval(
      () => setStageIdx((i) => (i < STAGE_SEQUENCE.length - 1 ? i + 1 : i)),
      900,
    );

    const { data, error, raw } = await edgeApi<any>('supplier-api', '/orders/build', {
      branch_code: effectiveBranch || null,
      ship_to_number: effectiveShipTo || null,
      order_version: 1,
      lines: buildLines(),
      order_context: {
        job_name: jobName || null,
        customer_name: customerName || null,
        delivery_address: addr,
        requested_delivery_date: dateTbd ? null : (deliveryDate || null),
        delivery_date_tbd: dateTbd,
        delivery_method: deliveryMethod || null,
        contact_name: contactName || null,
        contact_phone: contactPhone || null,
        notes: notes || null,
      },
    } as any);

    clearInterval(ticker);
    setRunning(false);

    if (error) {
      const d = ((raw as any)?.details ?? {}) as any;
      setStageIdx(-1);
      setFailure({
        failed_stage: d.failed_stage ?? 'order_loaded',
        stage_label: d.stage_label ?? 'Validation failed',
        line_key: d.line_key ?? null,
        reason: typeof error === 'string' ? error : String(error),
        correction: d.correction ?? 'Correct the highlighted input and retry.',
      });
      toast({ title: 'Order blocked', description: typeof error === 'string' ? error : 'Validation failed', variant: 'destructive' });
      return;
    }

    setStageIdx(STAGE_SEQUENCE.length);
    setPreview(data as OrderPreview);
    setReviewOpen(true);
    toast({ title: 'Ready for review', description: 'Order validated and priced. Nothing was submitted.' });
  };

  const submitOrder = async (p: OrderPreview) => {
    const { error } = await edgeApi<any>('supplier-api', '/orders/submit', {
      submission_id: p.submission_id,
      approved_payload_hash: p.payload_hash,
    });
    if (error) {
      toast({ title: 'Submission stopped', description: String(error), variant: 'destructive' });
      return;
    }
    toast({ title: 'Order submitted' });
  };

  const buttonLabel = running
    ? (STAGE_SEQUENCE[Math.max(0, stageIdx)] ?? 'Working…')
    : preview
      ? 'Ready for review'
      : 'Validate & Build ABC Order';

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5" />
              ABC order validation
            </CardTitle>
            <CardDescription>
              One action runs resolution, manufacturer compatibility, branch/Ship-To checks, ABC pricing and
              the payload build on the server. Nothing is submitted until you explicitly approve it.
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
              Approve at least one field shingle, its manufacturer-approved hip &amp; ridge and one accessory
              in the mapping approval panel above.
            </AlertDescription>
          </Alert>
        )}

        {/* Supplier context */}
        <div className="grid gap-4 md:grid-cols-3">
          <div className="space-y-1.5 md:col-span-2">
            <Label>ABC Ship-To</Label>
            <Select value={effectiveShipTo} onValueChange={persistShipTo}>
              <SelectTrigger className="h-auto py-2 text-left"><SelectValue placeholder="Select ship-to" /></SelectTrigger>
              <SelectContent className="max-w-[680px]">
                {shipToOptions.map((s) => (
                  <SelectItem key={s.ship_to_number} value={s.ship_to_number}>
                    <div className="flex flex-col gap-0.5 py-0.5">
                      <span className="font-medium">{s.ship_to_number} — {s.name || 'Unnamed account'}</span>
                      <span className="text-xs text-muted-foreground">
                        {[s.address_line1, s.city, s.state, s.postal_code].filter(Boolean).join(', ') || 'No address on file'}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {s.active ? 'Active' : 'Inactive'} · {s.branch_numbers.length ? `Branches ${s.branch_numbers.join(', ')}` : 'No branches synced'}
                      </span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>ABC branch</Label>
            <Select value={effectiveBranch} onValueChange={persistBranch}>
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
        </div>

        <Separator />

        {/* Order information */}
        <div className="space-y-3">
          <h4 className="text-sm font-semibold">Order information</h4>
          <p className="text-xs text-muted-foreground">
            The purchase-order number is issued by the company numbering sequence on the server.
          </p>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Job name</Label>
              <Input value={jobName} onChange={(e) => { setJobName(e.target.value); invalidatePreview(); }} />
            </div>
            <div className="space-y-1.5">
              <Label>Customer name</Label>
              <Input value={customerName} onChange={(e) => { setCustomerName(e.target.value); invalidatePreview(); }} />
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-6">
            <div className="space-y-1.5 md:col-span-3">
              <Label>Delivery street</Label>
              <Input value={addr.line1} onChange={(e) => { setAddr({ ...addr, line1: e.target.value }); invalidatePreview(); }} />
            </div>
            <div className="space-y-1.5 md:col-span-1">
              <Label>Unit</Label>
              <Input value={addr.line2} onChange={(e) => { setAddr({ ...addr, line2: e.target.value }); invalidatePreview(); }} />
            </div>
            <div className="space-y-1.5 md:col-span-2">
              <Label>City</Label>
              <Input value={addr.city} onChange={(e) => { setAddr({ ...addr, city: e.target.value }); invalidatePreview(); }} />
            </div>
            <div className="space-y-1.5 md:col-span-1">
              <Label>State</Label>
              <Input value={addr.state} onChange={(e) => { setAddr({ ...addr, state: e.target.value }); invalidatePreview(); }} />
            </div>
            <div className="space-y-1.5 md:col-span-2">
              <Label>Postal code</Label>
              <Input value={addr.postal_code} onChange={(e) => { setAddr({ ...addr, postal_code: e.target.value }); invalidatePreview(); }} />
            </div>
            <div className="space-y-1.5 md:col-span-3">
              <Label>Delivery method</Label>
              <Select value={deliveryMethod} onValueChange={(v) => { setDeliveryMethod(v); invalidatePreview(); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="delivery">Delivery</SelectItem>
                  <SelectItem value="pickup">Branch pickup</SelectItem>
                  <SelectItem value="rooftop_delivery">Rooftop delivery</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <div className="space-y-1.5">
              <Label>Requested delivery / pickup date</Label>
              <Input
                type="date"
                value={deliveryDate}
                disabled={dateTbd}
                onChange={(e) => { setDeliveryDate(e.target.value); invalidatePreview(); }}
              />
              <label className="flex items-center gap-2 pt-1 text-xs text-muted-foreground">
                <Checkbox checked={dateTbd} onCheckedChange={(v) => { setDateTbd(!!v); invalidatePreview(); }} />
                Date to be confirmed
              </label>
            </div>
            <div className="space-y-1.5">
              <Label>Contact name</Label>
              <Input value={contactName} onChange={(e) => { setContactName(e.target.value); invalidatePreview(); }} />
            </div>
            <div className="space-y-1.5">
              <Label>Contact phone</Label>
              <Input value={contactPhone} onChange={(e) => { setContactPhone(e.target.value); invalidatePreview(); }} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Order notes (optional)</Label>
            <Textarea rows={2} value={notes} onChange={(e) => { setNotes(e.target.value); invalidatePreview(); }} />
          </div>
        </div>

        <Separator />

        {/* Material lines */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold">Materials</h4>
            <Button variant="ghost" size="sm" onClick={() => refetch()}>Reload approved mappings</Button>
          </div>
          {slots.map((slot) => (
            <div key={slot.role} className="grid items-end gap-3 md:grid-cols-[140px_1fr_110px]">
              <div className="text-sm font-medium">{ROLE_LABEL[slot.role]}</div>
              <Select value={slot.mappingId ?? ''} onValueChange={(v) => setSlot(slot.role, { mappingId: v })}>
                <SelectTrigger>
                  <SelectValue placeholder={byRole[slot.role].length ? 'Select approved mapping' : 'No approved mappings'} />
                </SelectTrigger>
                <SelectContent>
                  {byRole[slot.role].map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.supplier_description ?? m.variant?.variant_name} · {m.supplier_item_number}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                type="number" min={1} value={slot.quantity}
                onChange={(e) => setSlot(slot.role, { quantity: Number(e.target.value) || 1 })}
              />
            </div>
          ))}
        </div>

        {/* The one action */}
        <div className="flex flex-wrap items-center gap-3">
          <Button size="lg" onClick={runBuild} disabled={running || !activeSlots.length}>
            {running ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
            {buttonLabel}
          </Button>
          {preview && !running && (
            <Button variant="outline" onClick={() => setReviewOpen(true)}>Open order review</Button>
          )}
        </div>

        {running && (
          <ol className="space-y-1 text-xs text-muted-foreground">
            {STAGE_SEQUENCE.map((s, i) => (
              <li key={s} className={i <= stageIdx ? 'text-foreground' : ''}>
                {i < stageIdx ? '✓ ' : i === stageIdx ? '• ' : '  '}{s}
              </li>
            ))}
          </ol>
        )}

        {failure && (
          <Alert variant="destructive">
            <ShieldAlert className="h-4 w-4" />
            <AlertTitle>Failed at: {failure.stage_label}</AlertTitle>
            <AlertDescription className="space-y-2">
              {failure.line_key && (
                <div className="text-xs">
                  Affected line: <span className="font-medium capitalize">{failure.line_key.replace(/_/g, ' ')}</span>
                </div>
              )}
              <div>{failure.reason}</div>
              <div className="text-xs">Required correction: {failure.correction}</div>
              <Button size="sm" variant="outline" onClick={runBuild} disabled={running}>
                <RotateCcw className="mr-2 h-3.5 w-3.5" /> Retry
              </Button>
            </AlertDescription>
          </Alert>
        )}
      </CardContent>

      <AbcOrderReviewDialog
        open={reviewOpen}
        onOpenChange={setReviewOpen}
        preview={preview}
        onSubmit={submitOrder}
        canSubmit={!!preview}
      />
    </Card>
  );
}
