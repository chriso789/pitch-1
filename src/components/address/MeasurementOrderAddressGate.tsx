// PR #3C — Drop-in modal that handles the measurement-order 412 address gate.
// Pair it with `useMeasurementJob` so any "Order Measurement" surface gets the
// same guided remediation flow proven on LeadDetails (PR #3A) and
// ProjectAddressPanel (PR #3B).
//
// Usage:
//   const { startJob, addressGate, retryAfterAddressResolved, dismissAddressGate } =
//     useMeasurementJob(pipelineEntryId);
//   <MeasurementOrderAddressGate
//     gate={addressGate}
//     onResolved={retryAfterAddressResolved}
//     onCancel={dismissAddressGate}
//   />
import { useEffectiveTenantId } from '@/hooks/useEffectiveTenantId';
import {
  AddressValidationResolutionModal,
} from '@/components/address/AddressValidationResolutionModal';
import type { MeasurementAddressGate } from '@/hooks/useMeasurementJob';

interface Props {
  gate: MeasurementAddressGate | null;
  onResolved: () => void;
  onCancel: () => void;
}

export function MeasurementOrderAddressGate({ gate, onResolved, onCancel }: Props) {
  const tenantId = useEffectiveTenantId();
  if (!gate || !tenantId) return null;

  // The modal only knows about project / pipeline_entry / contact scopes.
  const sourceEntityType =
    gate.source_entity_type === 'lead' ? 'pipeline_entry' : gate.source_entity_type;

  return (
    <AddressValidationResolutionModal
      open
      tenantId={tenantId}
      sourceEntityType={sourceEntityType as 'project' | 'pipeline_entry' | 'contact'}
      sourceEntityId={gate.source_entity_id}
      requiredForAction="measurement_order"
      canOverride={gate.can_override}
      gateReason={gate.message}
      onResolved={onResolved}
      onCancel={onCancel}
    />
  );
}

export default MeasurementOrderAddressGate;
