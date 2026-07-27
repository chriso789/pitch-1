/**
 * Owner-review modal for a server-built ABC order preview.
 *
 * Everything shown here comes from the `/orders/build` server orchestration —
 * the browser never derives item numbers, UOMs, prices, branch values or the
 * payload hash. Submission is a separate, explicitly-confirmed action.
 */
import { useState } from 'react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { ChevronDown, Loader2, ShieldCheck } from 'lucide-react';

export interface OrderPreview {
  submission_id: string;
  payload_hash: string;
  idempotency_key: string;
  po_number: string;
  order_context: any;
  lines: any[];
  pricing: Array<{
    key: string; item_number: string; uom: string | null; quantity: number;
    unit_price: number | null; extended_price: number | null; priced: boolean;
  }>;
  totals: { subtotal: number; fees: number; taxes: number; currency: string };
  compatibility_evidence: any[];
  payload: any;
  stages: any[];
  environment?: string;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  preview: OrderPreview | null;
  supplierLabel?: string;
  onSubmit?: (preview: OrderPreview) => Promise<void>;
  canSubmit?: boolean;
}

const money = (n: number | null | undefined) =>
  n == null ? '—' : `$${Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function addressText(a: any) {
  if (!a) return '—';
  const street = [a.line1, a.line2].filter(Boolean).join(' ');
  const region = [a.city, a.state].filter(Boolean).join(', ');
  return [street, [region, a.postal_code].filter(Boolean).join(' ')].filter(Boolean).join(', ') || '—';
}

export function AbcOrderReviewDialog({
  open, onOpenChange, preview, supplierLabel = 'ABC Supply', onSubmit, canSubmit,
}: Props) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [tech, setTech] = useState(false);

  if (!preview) return null;
  const ctx = preview.order_context ?? {};
  const priceByKey = new Map(preview.pricing.map((p) => [p.key, p]));

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Order review — {supplierLabel}</DialogTitle>
            <DialogDescription>
              Every value below was resolved and validated server-side. No order has been submitted.
            </DialogDescription>
          </DialogHeader>

          {/* Order information */}
          <section className="space-y-2">
            <h4 className="text-sm font-semibold">Order information</h4>
            <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
              {[
                ['PO number', preview.po_number],
                ['Supplier', supplierLabel],
                ['Branch', ctx.branch_code ?? '—'],
                ['Ship-To', ctx.ship_to_number ?? '—'],
                ['Job name', ctx.job_name ?? '—'],
                ['Customer', ctx.customer_name ?? '—'],
                ['Delivery method', ctx.delivery_method ?? '—'],
                ['Requested date', ctx.requested_delivery_date ?? (ctx.delivery_date_tbd ? 'To be confirmed' : '—')],
                ['Contact', [ctx.contact_name, ctx.contact_phone].filter(Boolean).join(' · ') || '—'],
              ].map(([label, value]) => (
                <div key={label as string}>
                  <dt className="text-xs text-muted-foreground">{label}</dt>
                  <dd className="font-medium break-words">{String(value)}</dd>
                </div>
              ))}
              <div className="sm:col-span-2">
                <dt className="text-xs text-muted-foreground">Delivery address</dt>
                <dd className="font-medium">{addressText(ctx.delivery_address)}</dd>
              </div>
              <div className="sm:col-span-2 lg:col-span-3">
                <dt className="text-xs text-muted-foreground">Notes</dt>
                <dd className="font-medium">{ctx.notes || '—'}</dd>
              </div>
            </dl>
          </section>

          <Separator />

          {/* Materials */}
          <section className="space-y-2">
            <h4 className="text-sm font-semibold">Materials</h4>
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Material</TableHead>
                    <TableHead>Manufacturer</TableHead>
                    <TableHead>Product</TableHead>
                    <TableHead>Color</TableHead>
                    <TableHead>ABC item #</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead>UOM</TableHead>
                    <TableHead className="text-right">Unit price</TableHead>
                    <TableHead className="text-right">Extended</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.lines.map((l: any) => {
                    const p = priceByKey.get(l.key);
                    const compatible = preview.compatibility_evidence?.some(
                      (e: any) => e.companion_key === l.key || e.field_key === l.key,
                    );
                    return (
                      <TableRow key={l.key}>
                        <TableCell className="font-medium capitalize">{String(l.key).replace(/_/g, ' ')}</TableCell>
                        <TableCell>{l.manufacturer_name ?? '—'}</TableCell>
                        <TableCell>{l.product_line_name ?? l.variant_name ?? '—'}</TableCell>
                        <TableCell>{l.supplier_color_name ?? l.color_name ?? '—'}</TableCell>
                        <TableCell className="font-mono text-xs">{l.supplier_item_number ?? '—'}</TableCell>
                        <TableCell className="text-right">{l.quantity}</TableCell>
                        <TableCell>{p?.uom ?? l.supplier_uom ?? '—'}</TableCell>
                        <TableCell className="text-right">{money(p?.unit_price)}</TableCell>
                        <TableCell className="text-right">{money(p?.extended_price)}</TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            <Badge variant="outline" className="border-emerald-600 text-emerald-700">Exact mapping verified</Badge>
                            {compatible && (
                              <Badge variant="outline" className="border-emerald-600 text-emerald-700">Compatibility verified</Badge>
                            )}
                            <Badge variant="outline">Branch verified</Badge>
                            {p?.priced
                              ? <Badge variant="outline" className="border-emerald-600 text-emerald-700">Priced</Badge>
                              : <Badge variant="destructive">Blocked</Badge>}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            <div className="ml-auto w-full max-w-xs space-y-1 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span>{money(preview.totals.subtotal)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Fees</span><span>{money(preview.totals.fees)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Taxes</span><span>{money(preview.totals.taxes)}</span></div>
              <Separator />
              <div className="flex justify-between font-semibold">
                <span>Total</span>
                <span>{money(preview.totals.subtotal + preview.totals.fees + preview.totals.taxes)}</span>
              </div>
            </div>
          </section>

          {/* Technical details */}
          <Collapsible open={tech} onOpenChange={setTech}>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="gap-1">
                <ChevronDown className={`h-4 w-4 transition-transform ${tech ? 'rotate-180' : ''}`} />
                Technical details
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-2 pt-2">
              <div className="grid gap-2 text-xs md:grid-cols-2">
                <div className="rounded border p-2">
                  <div className="text-muted-foreground">Payload hash</div>
                  <div className="break-all font-mono">{preview.payload_hash}</div>
                </div>
                <div className="rounded border p-2">
                  <div className="text-muted-foreground">Idempotency key</div>
                  <div className="break-all font-mono">{preview.idempotency_key}</div>
                </div>
              </div>
              <pre className="max-h-80 overflow-auto rounded bg-muted p-3 text-xs">
                {JSON.stringify({ payload: preview.payload, compatibility_evidence: preview.compatibility_evidence, stages: preview.stages }, null, 2)}
              </pre>
            </CollapsibleContent>
          </Collapsible>

          <DialogFooter className="gap-2 sm:justify-between">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <ShieldCheck className="h-4 w-4" /> No order was submitted.
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
              {onSubmit && (
                <Button variant="destructive" disabled={!canSubmit || submitting} onClick={() => setConfirmOpen(true)}>
                  Approve &amp; Submit to ABC
                </Button>
              )}
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Submit this order to ABC?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-1 text-sm">
                <div>ABC account: {preview.order_context?.account_number ?? supplierLabel}</div>
                <div>Ship-To: {ctx.ship_to_number ?? '—'}</div>
                <div>Branch: {ctx.branch_code ?? '—'}</div>
                <div>Delivery address: {addressText(ctx.delivery_address)}</div>
                <div>Delivery date: {ctx.requested_delivery_date ?? (ctx.delivery_date_tbd ? 'To be confirmed' : '—')}</div>
                <div>Lines: {preview.lines.length}</div>
                <div>Total: {money(preview.totals.subtotal + preview.totals.fees + preview.totals.taxes)}</div>
                <div>PO number: {preview.po_number}</div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={async (e) => {
                e.preventDefault();
                if (!onSubmit) return;
                setSubmitting(true);
                try { await onSubmit(preview); } finally { setSubmitting(false); setConfirmOpen(false); }
              }}
            >
              {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Submit order
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export default AbcOrderReviewDialog;
