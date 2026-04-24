import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Sparkles } from 'lucide-react';
import { EdgeConfirmationWizard } from './EdgeConfirmationWizard';
import type { PlanEdge } from './DimensionedPlanDrawing';

interface EdgeWizardButtonProps {
  pipelineEntryId: string;
  initialEdges?: PlanEdge[];
  onSuccess?: () => void;
  variant?: 'default' | 'outline' | 'secondary';
  size?: 'default' | 'sm' | 'lg';
  className?: string;
}

export function EdgeWizardButton({
  pipelineEntryId,
  initialEdges,
  onSuccess,
  variant = 'outline',
  size = 'default',
  className,
}: EdgeWizardButtonProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        variant={variant}
        size={size}
        onClick={() => setOpen(true)}
        className={className}
      >
        <Sparkles className="h-4 w-4 mr-2" />
        Verify to 100%
      </Button>
      <EdgeConfirmationWizard
        open={open}
        onOpenChange={setOpen}
        pipelineEntryId={pipelineEntryId}
        initialEdges={initialEdges}
        onSaved={onSuccess}
      />
    </>
  );
}
