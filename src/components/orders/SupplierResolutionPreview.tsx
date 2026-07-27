import { useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';
import { FAILURE_LABELS, type ResolvedLine } from '@/lib/suppliers/resolution';

interface Props {
  supplierLabel: string;
  branchLabel?: string | null;
  lines: ResolvedLine[];
  loading?: boolean;
  /** Display name for each line key, so the table shows the Pitch product the user picked. */
  pitchProductNames?: Record<string, string>;
}

/**
 * Final pre-submission resolution preview. The user must be able to confirm
 * that the color they selected matches the supplier catalog color and the exact
 * item code that will be transmitted. The caller keeps Send disabled until
 * every line reports `ok`.
 */
export function SupplierResolutionPreview({
  supplierLabel,
  branchLabel,
  lines,
  loading,
  pitchProductNames,
}: Props) {
  const unresolved = useMemo(() => lines.filter((l) => !l.ok), [lines]);
  const allOk = lines.length > 0 && unresolved.length === 0;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">Supplier resolution preview</CardTitle>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Badge variant="outline">{supplierLabel}</Badge>
            {branchLabel ? <Badge variant="outline">Branch {branchLabel}</Badge> : null}
            {loading ? (
              <span className="flex items-center gap-1">
                <Loader2 className="h-3 w-3 animate-spin" /> Resolving…
              </span>
            ) : allOk ? (
              <span className="flex items-center gap-1 text-emerald-600">
                <CheckCircle2 className="h-3 w-3" /> All lines verified
              </span>
            ) : (
              <span className="flex items-center gap-1 text-destructive">
                <AlertTriangle className="h-3 w-3" /> {unresolved.length} blocked
              </span>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {unresolved.length > 0 && !loading ? (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Order blocked</AlertTitle>
            <AlertDescription>
              <ul className="mt-1 list-disc space-y-1 pl-4 text-xs">
                {unresolved.map((l) => (
                  <li key={l.key}>
                    <span className="font-medium">
                      {pitchProductNames?.[l.key] ?? l.variant_name ?? l.key}
                    </span>
                    {' — '}
                    {l.failure_code ? FAILURE_LABELS[l.failure_code] : 'Unresolved'}
                    {l.failure_message ? `: ${l.failure_message}` : ''}
                  </li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        ) : null}

        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-xs">
            <thead className="bg-muted/50 uppercase">
              <tr>
                <th className="p-2 text-left">Pitch product</th>
                <th className="p-2 text-left">Manufacturer</th>
                <th className="p-2 text-left">Product line</th>
                <th className="p-2 text-left">Selected color</th>
                <th className="p-2 text-left">Supplier</th>
                <th className="p-2 text-left">Supplier item code</th>
                <th className="p-2 text-left">Supplier description / color</th>
                <th className="p-2 text-left">Branch</th>
                <th className="p-2 text-right">Qty</th>
                <th className="p-2 text-left">UOM</th>
                <th className="p-2 text-left">Resolution source</th>
                <th className="p-2 text-left">Validation status</th>
              </tr>

            </thead>
            <tbody>
              {lines.length === 0 ? (
                <tr>
                  <td colSpan={11} className="p-4 text-center text-muted-foreground">
                    No material lines to resolve.
                  </td>
                </tr>
              ) : (
                lines.map((l) => (
                  <tr key={l.key} className="border-t align-top">
                    <td className="p-2">{pitchProductNames?.[l.key] ?? l.variant_name ?? '—'}</td>
                    <td className="p-2">{l.manufacturer_name ?? '—'}</td>
                    <td className="p-2">{l.product_line_name ?? '—'}</td>
                    <td className="p-2">
                      {l.color_name ?? '—'}
                      {l.manufacturer_color_code ? (
                        <span className="ml-1 text-muted-foreground">({l.manufacturer_color_code})</span>
                      ) : null}
                    </td>
                    <td className="p-2 uppercase">{l.supplier}</td>
                    <td className="p-2">
                      <code>{l.supplier_item_number ?? '—'}</code>
                    </td>
                    <td className="p-2">
                      {l.supplier_description ?? '—'}
                      {l.supplier_color_name ? (
                        <div className="text-muted-foreground">Color: {l.supplier_color_name}</div>
                      ) : null}
                    </td>
                    <td className="p-2">{l.branch_code ?? '—'}</td>
                    <td className="p-2 text-right">{l.quantity}</td>
                    <td className="p-2">{l.supplier_uom ?? l.requested_uom}</td>
                    <td className="p-2">
                      {l.ok ? (
                        <Badge variant="outline" className="border-emerald-500 text-emerald-600">
                          Verified
                        </Badge>
                      ) : (
                        <Badge variant="destructive">
                          {l.failure_code ? FAILURE_LABELS[l.failure_code] : 'Blocked'}
                        </Badge>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <p className="text-[11px] text-muted-foreground">
          Item codes are resolved server-side from approved supplier mappings only. Descriptions are never
          matched or guessed, and a code resolved for one supplier, account or branch is never reused for
          another.
        </p>
      </CardContent>
    </Card>
  );
}
