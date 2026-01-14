import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { PenSquare } from 'lucide-react';
import { ManualMeasurementDialog } from './ManualMeasurementDialog';

interface ManualMeasurementButtonProps {
  pipelineEntryId: string;
  onSuccess?: () => void;
  variant?: 'default' | 'outline' | 'secondary' | 'ghost';
  size?: 'default' | 'sm' | 'lg' | 'icon';
  className?: string;
}

export const ManualMeasurementButton: React.FC<ManualMeasurementButtonProps> = ({
  pipelineEntryId,
  onSuccess,
  variant = 'outline',
  size = 'default',
  className,
}) => {
  const [dialogOpen, setDialogOpen] = useState(false);

  const handleSuccess = () => {
    onSuccess?.();
  };

  return (
    <>
      <Button
        variant={variant}
        size={size}
        onClick={() => setDialogOpen(true)}
        className={className}
      >
        <PenSquare className="h-4 w-4 mr-2" />
        Enter Manually
      </Button>

      <ManualMeasurementDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        pipelineEntryId={pipelineEntryId}
        onSuccess={handleSuccess}
      />
    </>
  );
};
