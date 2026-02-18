import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

const LIFECYCLE_STAGES = {
  prospect: { label: 'Prospect', color: 'bg-muted text-muted-foreground' },
  lead: { label: 'Lead', color: 'bg-blue-500/15 text-blue-700 dark:text-blue-400' },
  customer: { label: 'Customer', color: 'bg-green-500/15 text-green-700 dark:text-green-400' },
  repeat_customer: { label: 'Repeat Customer', color: 'bg-purple-500/15 text-purple-700 dark:text-purple-400' },
  advocate: { label: 'Advocate', color: 'bg-amber-500/15 text-amber-700 dark:text-amber-400' },
} as const;

type LifecycleStage = keyof typeof LIFECYCLE_STAGES;

interface LifecycleStageIndicatorProps {
  stage?: string | null;
  className?: string;
  showLabel?: boolean;
}

export const LifecycleStageIndicator = ({
  stage,
  className,
  showLabel = true,
}: LifecycleStageIndicatorProps) => {
  const key = (stage || 'prospect') as LifecycleStage;
  const config = LIFECYCLE_STAGES[key] || LIFECYCLE_STAGES.prospect;

  return (
    <Badge variant="outline" className={cn('border-0 font-medium', config.color, className)}>
      {showLabel ? config.label : key}
    </Badge>
  );
};

export { LIFECYCLE_STAGES };
export type { LifecycleStage };
