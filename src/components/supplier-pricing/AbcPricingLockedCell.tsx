// Renders the explicit "ABC pricing locked: …" copy demanded by the setup
// gate. Use anywhere an ABC price would otherwise show — NEVER fall back to
// "pending" or "$0.00" when one of these preconditions is missing.

import { Lock } from 'lucide-react';
import { ABC_LOCK_MESSAGES, type AbcLockReason } from '@/lib/templates/supplierPricing';
import { cn } from '@/lib/utils';

interface Props {
  reason: AbcLockReason;
  className?: string;
  compact?: boolean;
}

export function AbcPricingLockedCell({ reason, className, compact }: Props) {
  return (
    <div
      className={cn(
        'flex items-start gap-1.5 rounded-md border border-dashed border-muted-foreground/30 bg-muted/30 px-2 py-1.5 text-left',
        className,
      )}
      role="status"
      aria-live="polite"
    >
      <Lock className="mt-0.5 h-3 w-3 flex-shrink-0 text-muted-foreground" />
      <span
        className={cn(
          'leading-snug text-muted-foreground',
          compact ? 'text-[10px]' : 'text-xs',
        )}
      >
        {ABC_LOCK_MESSAGES[reason]}
      </span>
    </div>
  );
}

export default AbcPricingLockedCell;
