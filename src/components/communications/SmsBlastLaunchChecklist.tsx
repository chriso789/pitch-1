import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { CheckCircle2, XCircle, AlertTriangle, ShieldCheck } from 'lucide-react';

export interface SmsBlastLaunchChecklistProps {
  blastId?: string;
  tenantId: string;
  goal: string;
  recipientCount: number;
  eligibleCount: number;
  skippedMissingAddress: number;
  skippedOptOut: number;
  dryRunCompleted: boolean;
  aiFollowupEnabled: boolean;
  senderNumberConfigured?: boolean;
  hasStopLanguage?: boolean;
  allRenderedHavePersonalizedMessage?: boolean;
  allRenderedHaveAddressSnapshot?: boolean;
  batchSize: number;
  onConfirmReady: () => void;
}

interface CheckItem {
  id: string;
  label: string;
  ok: boolean;
  required: boolean;
  reason?: string;
}

export function SmsBlastLaunchChecklist(props: SmsBlastLaunchChecklistProps) {
  const {
    goal, recipientCount, eligibleCount, skippedMissingAddress, skippedOptOut,
    dryRunCompleted, aiFollowupEnabled, senderNumberConfigured = true,
    hasStopLanguage = true, allRenderedHavePersonalizedMessage = true,
    allRenderedHaveAddressSnapshot = true, batchSize, onConfirmReady,
  } = props;

  const isEmailCapture = goal === 'collect_homeowner_email_for_roof_estimate';

  const checks: CheckItem[] = useMemo(() => [
    {
      id: 'dry-run',
      label: 'Dry run completed',
      ok: dryRunCompleted,
      required: isEmailCapture,
      reason: 'Run a dry-run so every message is rendered and verified before sending.',
    },
    {
      id: 'no-missing-address',
      label: 'No missing-address contacts in send group',
      ok: !isEmailCapture || skippedMissingAddress === 0,
      required: isEmailCapture,
      reason: `${skippedMissingAddress} contact(s) without a street address will be skipped — remove them from the batch or import their address first.`,
    },
    {
      id: 'opt-outs',
      label: 'Opt-outs excluded',
      ok: true,
      required: true,
      reason: `${skippedOptOut} opted-out recipient(s) auto-excluded.`,
    },
    {
      id: 'rendered-locked',
      label: 'Personalized messages rendered and locked',
      ok: !dryRunCompleted || allRenderedHavePersonalizedMessage,
      required: isEmailCapture,
      reason: 'Some recipients are missing a locked personalized_message.',
    },
    {
      id: 'address-snapshot',
      label: 'Address snapshot stored on each item',
      ok: !isEmailCapture || !dryRunCompleted || allRenderedHaveAddressSnapshot,
      required: isEmailCapture,
      reason: 'Some recipients are missing address_street_snapshot — production guard will block them.',
    },
    {
      id: 'ai-followup',
      label: `AI follow-up: ${aiFollowupEnabled ? 'ON' : 'OFF'}`,
      ok: true,
      required: false,
    },
    {
      id: 'sender',
      label: 'Sender number configured',
      ok: senderNumberConfigured,
      required: true,
      reason: 'No active SMS-capable Telnyx number found for this tenant.',
    },
    {
      id: 'batch-size',
      label: `Batch size confirmed (${recipientCount} ≤ ${batchSize})`,
      ok: recipientCount > 0 && recipientCount <= batchSize,
      required: true,
      reason: 'Recipient count must be > 0 and ≤ selected batch size.',
    },
    {
      id: 'eligible',
      label: `Eligible recipients: ${eligibleCount}`,
      ok: eligibleCount > 0,
      required: true,
      reason: 'No eligible recipients in this batch.',
    },
  ], [
    isEmailCapture, dryRunCompleted, skippedMissingAddress, skippedOptOut,
    allRenderedHavePersonalizedMessage, allRenderedHaveAddressSnapshot,
    hasStopLanguage, aiFollowupEnabled, senderNumberConfigured,
    recipientCount, batchSize, eligibleCount,
  ]);

  const blockingFailures = checks.filter(c => c.required && !c.ok);
  const ready = blockingFailures.length === 0;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <ShieldCheck className="h-4 w-4" />
          Launch Checklist
          {isEmailCapture && (
            <Badge variant="outline" className="text-[10px]">Roof Estimate Email Capture</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <ul className="space-y-1.5">
          {checks.map((c) => (
            <li key={c.id} className="flex items-start gap-2 text-xs">
              {c.ok ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 mt-0.5 shrink-0" />
              ) : c.required ? (
                <XCircle className="h-3.5 w-3.5 text-destructive mt-0.5 shrink-0" />
              ) : (
                <AlertTriangle className="h-3.5 w-3.5 text-amber-500 mt-0.5 shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className={c.ok ? '' : c.required ? 'text-destructive font-medium' : ''}>
                    {c.label}
                  </span>
                  {!c.required && <Badge variant="outline" className="text-[9px] py-0">optional</Badge>}
                </div>
                {!c.ok && c.reason && (
                  <p className="text-[11px] text-muted-foreground mt-0.5">{c.reason}</p>
                )}
              </div>
            </li>
          ))}
        </ul>

        {!ready && (
          <Alert variant="destructive" className="py-2">
            <AlertDescription className="text-xs">
              {blockingFailures.length} blocking issue{blockingFailures.length !== 1 ? 's' : ''} — Launch is disabled.
            </AlertDescription>
          </Alert>
        )}

        <Button
          size="sm"
          className="w-full"
          disabled={!ready}
          onClick={onConfirmReady}
        >
          {ready ? 'Launch Campaign' : 'Launch blocked'}
        </Button>
      </CardContent>
    </Card>
  );
}

export default SmsBlastLaunchChecklist;
