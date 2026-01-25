import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Calculator, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

interface QuickEstimateButtonProps {
  pipelineEntryId: string;
  hasMeasurement: boolean;
  className?: string;
}

export function QuickEstimateButton({ 
  pipelineEntryId, 
  hasMeasurement,
  className 
}: QuickEstimateButtonProps) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);

  const handleCreateEstimate = () => {
    if (!hasMeasurement) {
      toast.error('No measurement available', {
        description: 'Pull or import a measurement first before creating an estimate.'
      });
      return;
    }

    setLoading(true);
    
    // Navigate to estimate tab with auto-populate flag
    navigate(`/lead/${pipelineEntryId}?tab=estimate&autoPopulate=true`);
    
    toast.success('Navigating to Estimate Builder', {
      description: 'Measurement data will be auto-populated in templates.'
    });
    
    setLoading(false);
  };

  return (
    <Button
      onClick={handleCreateEstimate}
      disabled={!hasMeasurement || loading}
      variant="default"
      size="sm"
      className={className}
    >
      {loading ? (
        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
      ) : (
        <Calculator className="h-4 w-4 mr-2" />
      )}
      Create Estimate
    </Button>
  );
}
