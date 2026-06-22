// PR #3A — Reusable address gate remediation modal.
// Used wherever a 412 `address_validation_required` is returned so the user
// can validate, accept a suggested canonical address, or (manager+) override.
import { useEffect, useMemo, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Loader2, AlertTriangle, CheckCircle2, ShieldCheck } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import {
  useAddressValidation,
  type AddressValidationStatus,
  type ValidateAddressInput,
} from '@/hooks/useAddressValidation';
import { toast } from 'sonner';

export type AddressGateAction =
  | 'lead_to_project'
  | 'measurement_order'
  | 'permit_packet'
  | 'material_delivery'
  | 'production_schedule';

export interface AddressValidationResolutionModalProps {
  open: boolean;
  tenantId: string;
  sourceEntityType: ValidateAddressInput['source_entity_type'];
  sourceEntityId: string;
  initialAddress?: {
    address_line_1?: string | null;
    address_line_2?: string | null;
    locality?: string | null;
    administrative_area?: string | null;
    postal_code?: string | null;
    country_code?: string | null;
  } | null;
  gateReason?: string;
  requiredForAction: AddressGateAction;
  canOverride?: boolean;
  onResolved: () => void;
  onCancel: () => void;
}

const MANAGER_ROLES = ['master', 'owner', 'corporate', 'office_admin', 'regional_manager', 'sales_manager'];

const ACTION_LABEL: Record<AddressGateAction, string> = {
  lead_to_project: 'Continue Conversion',
  measurement_order: 'Continue Measurement Order',
  permit_packet: 'Continue Permit Packet',
  material_delivery: 'Continue Material Order',
  production_schedule: 'Continue Scheduling',
};

export function AddressValidationResolutionModal(props: AddressValidationResolutionModalProps) {
  const {
    open,
    tenantId,
    sourceEntityType,
    sourceEntityId,
    initialAddress,
    gateReason,
    requiredForAction,
    canOverride,
    onResolved,
    onCancel,
  } = props;

  const { user } = useAuth();
  const { validate, loading: validating } = useAddressValidation();

  const [status, setStatus] = useState<AddressValidationStatus>('unvalidated');
  const [addressRowId, setAddressRowId] = useState<string | null>(null);
  const [formatted, setFormatted] = useState<string | null>(null);
  const [decisionReason, setDecisionReason] = useState<string>('');
  const [missing, setMissing] = useState<string[]>([]);
  const [overrideReason, setOverrideReason] = useState('');
  const [submittingOverride, setSubmittingOverride] = useState(false);
  const [role, setRole] = useState<string | null>(null);

  const [line1, setLine1] = useState(initialAddress?.address_line_1 ?? '');
  const [line2, setLine2] = useState(initialAddress?.address_line_2 ?? '');
  const [locality, setLocality] = useState(initialAddress?.locality ?? '');
  const [admin, setAdmin] = useState(initialAddress?.administrative_area ?? '');
  const [postal, setPostal] = useState(initialAddress?.postal_code ?? '');

  // Load current address row + role on open
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('property_addresses')
        .select('id, validation_status, formatted_address, address_line_1, address_line_2, locality, administrative_area, postal_code, missing_component_types')
        .eq('tenant_id', tenantId)
        .eq('source_entity_type', sourceEntityType)
        .eq('source_entity_id', sourceEntityId)
        .is('archived_at', null)
        .maybeSingle();
      if (cancelled) return;
      if (data) {
        setAddressRowId(data.id);
        setStatus((data.validation_status as AddressValidationStatus) ?? 'unvalidated');
        setFormatted(data.formatted_address ?? null);
        setMissing((data.missing_component_types as string[]) ?? []);
        setLine1((prev) => prev || data.address_line_1 || '');
        setLine2((prev) => prev || data.address_line_2 || '');
        setLocality((prev) => prev || data.locality || '');
        setAdmin((prev) => prev || data.administrative_area || '');
        setPostal((prev) => prev || data.postal_code || '');
      }
      if (user?.id) {
        const { data: prof } = await supabase
          .from('profiles')
          .select('role')
          .eq('id', user.id)
          .maybeSingle();
        if (!cancelled) setRole((prof?.role as string) ?? null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, tenantId, sourceEntityType, sourceEntityId, user?.id]);

  const isManager = useMemo(() => !!role && MANAGER_ROLES.includes(role), [role]);
  const allowOverride = canOverride ?? isManager;

  const handleValidate = async () => {
    const result = await validate({
      tenant_id: tenantId,
      source_entity_type: sourceEntityType,
      source_entity_id: sourceEntityId,
      address_lines: [line1, line2].filter(Boolean) as string[],
      locality,
      administrative_area: admin,
      postal_code: postal,
      country_code: 'US',
      force_revalidate: true,
    });
    if (!result) return;
    setAddressRowId(result.property_address_id);
    setStatus(result.validation_status);
    setFormatted(result.formatted_address);
    setDecisionReason(result.decision_reason);
    setMissing(result.missing_component_types ?? []);
  };

  const handleOverride = async () => {
    if (!allowOverride) {
      toast.error('You do not have permission to override address validation.');
      return;
    }
    if (overrideReason.trim().length < 8) {
      toast.error('Override reason must be at least 8 characters.');
      return;
    }
    if (!addressRowId) {
      // Need a row to override — kick off a validate first to materialise one.
      await handleValidate();
      return;
    }
    setSubmittingOverride(true);
    try {
      const { error } = await supabase
        .from('property_addresses')
        .update({
          validation_status: 'override_accepted',
          override_reason: overrideReason.trim(),
          override_by: user?.id ?? null,
          override_at: new Date().toISOString(),
        })
        .eq('id', addressRowId);
      if (error) throw error;
      // history row written by DB trigger; surface success and resolve
      setStatus('override_accepted');
      toast.success('Address override accepted.');
      onResolved();
    } catch (e: any) {
      toast.error(`Override failed: ${e.message ?? e}`);
    } finally {
      setSubmittingOverride(false);
    }
  };

  const isReady = status === 'valid' || status === 'override_accepted';

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Validate property address</DialogTitle>
          <DialogDescription>
            {gateReason ??
              'This action is blocked until the property address is validated or a manager override is recorded.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Current status:</span>
            <StatusBadge status={status} />
          </div>

          {formatted && (
            <Alert>
              <CheckCircle2 className="h-4 w-4" />
              <AlertTitle>Canonical address</AlertTitle>
              <AlertDescription className="break-words">{formatted}</AlertDescription>
            </Alert>
          )}

          {decisionReason && status !== 'valid' && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Validator reason</AlertTitle>
              <AlertDescription>
                {decisionReason}
                {missing.length > 0 && (
                  <div className="mt-1 text-xs">Missing: {missing.join(', ')}</div>
                )}
              </AlertDescription>
            </Alert>
          )}

          <div className="grid grid-cols-1 gap-3">
            <div>
              <Label htmlFor="addr-line1">Street address</Label>
              <Input id="addr-line1" value={line1} onChange={(e) => setLine1(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="addr-line2">Unit / Suite (optional)</Label>
              <Input id="addr-line2" value={line2} onChange={(e) => setLine2(e.target.value)} />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="col-span-2">
                <Label htmlFor="addr-city">City</Label>
                <Input id="addr-city" value={locality} onChange={(e) => setLocality(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="addr-state">State</Label>
                <Input id="addr-state" value={admin} onChange={(e) => setAdmin(e.target.value)} />
              </div>
            </div>
            <div>
              <Label htmlFor="addr-zip">ZIP</Label>
              <Input id="addr-zip" value={postal} onChange={(e) => setPostal(e.target.value)} />
            </div>
          </div>

          {allowOverride && !isReady && (
            <div className="space-y-2 border-t pt-3">
              <Label htmlFor="override-reason" className="flex items-center gap-1">
                <ShieldCheck className="h-3.5 w-3.5" /> Manager override reason
              </Label>
              <Textarea
                id="override-reason"
                placeholder="Explain why this address is acceptable despite failing validation (audited)."
                value={overrideReason}
                onChange={(e) => setOverrideReason(e.target.value)}
                rows={3}
              />
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="secondary" onClick={handleValidate} disabled={validating}>
            {validating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Validate address
          </Button>
          {allowOverride && !isReady && (
            <Button
              variant="destructive"
              onClick={handleOverride}
              disabled={submittingOverride || overrideReason.trim().length < 8}
            >
              {submittingOverride && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Accept override
            </Button>
          )}
          <Button onClick={onResolved} disabled={!isReady}>
            {ACTION_LABEL[requiredForAction]}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StatusBadge({ status }: { status: AddressValidationStatus }) {
  const map: Record<AddressValidationStatus, { label: string; variant: 'default' | 'destructive' | 'secondary' | 'outline' }> = {
    unvalidated: { label: 'Unvalidated', variant: 'outline' },
    valid: { label: 'Valid', variant: 'default' },
    needs_review: { label: 'Needs review', variant: 'secondary' },
    invalid: { label: 'Invalid', variant: 'destructive' },
    override_accepted: { label: 'Override accepted', variant: 'default' },
  };
  const s = map[status];
  return <Badge variant={s.variant}>{s.label}</Badge>;
}

export default AddressValidationResolutionModal;
