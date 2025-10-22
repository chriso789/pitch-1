import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Satellite, Loader2, CheckCircle2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { MeasurementVerificationDialog } from './MeasurementVerificationDialog';

interface PullMeasurementsButtonProps {
  propertyId: string;
  lat: number;
  lng: number;
  address?: string;
  onSuccess?: (measurement: any, tags: Record<string, any>) => void;
}

export function PullMeasurementsButton({
  propertyId,
  lat,
  lng,
  address,
  onSuccess
}: PullMeasurementsButtonProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [verificationData, setVerificationData] = useState<{
    measurement: any;
    tags: Record<string, any>;
    satelliteImageUrl?: string;
  } | null>(null);
  const [showVerificationDialog, setShowVerificationDialog] = useState(false);

  async function handlePull() {
    // Validate coordinates before attempting pull
    if (!lat || !lng || (lat === 0 && lng === 0)) {
      toast({
        title: "Missing Location",
        description: "Property coordinates not found. Please verify the address first.",
        variant: "destructive"
      });
      return;
    }

    setLoading(true);
    setSuccess(false);

    try {
      toast({
        title: "Pulling Measurements",
        description: "Fetching roof data from satellite imagery...",
      });

      const { data, error } = await supabase.functions.invoke('measure', {
        body: {
          action: 'pull',
          propertyId,
          lat,
          lng,
          address
        }
      });

      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || 'Pull failed');

      const { measurement, tags } = data.data;

      // Fetch satellite image
      let satelliteImageUrl: string | undefined;
      try {
        const { data: imageData } = await supabase.functions.invoke('google-maps-proxy', {
          body: { 
            endpoint: 'satellite',
            params: {
              center: `${lat},${lng}`,
              zoom: '20',
              size: '640x640',
              maptype: 'satellite',
              scale: '2'
            }
          }
        });

        if (imageData?.image) {
          satelliteImageUrl = `data:image/png;base64,${imageData.image}`;
        }
      } catch (imgError) {
        console.warn('Failed to fetch satellite image:', imgError);
      }

      // Show verification dialog instead of immediately applying
      setVerificationData({ measurement, tags, satelliteImageUrl });
      setShowVerificationDialog(true);
      
      toast({
        title: "Measurements Pulled",
        description: "Review and adjust measurements before applying",
      });

    } catch (err: any) {
      console.error('Pull measurement error:', err);
      toast({
        title: "Pull Failed",
        description: err.message || "Could not fetch measurements. Try manual mode.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  const handleAcceptMeasurements = async (adjustedMeasurement?: any) => {
    if (!verificationData) return;

    const { measurement, tags } = verificationData;
    const finalMeasurement = adjustedMeasurement || measurement;

    // Invalidate measurement cache
    queryClient.invalidateQueries({ queryKey: ['measurement', propertyId] });

    setSuccess(true);
    
    const squares = adjustedMeasurement?.adjustedSquares || tags['roof.squares'];
    
    toast({
      title: "Measurements Applied",
      description: `${squares?.toFixed(1)} squares ready for estimates`,
    });

    onSuccess?.(finalMeasurement, tags);

    // Reset success state after 3 seconds
    setTimeout(() => setSuccess(false), 3000);
  };

  const handleRejectMeasurements = () => {
    setVerificationData(null);
    setShowVerificationDialog(false);
    toast({
      title: "Measurements Rejected",
      description: "Pull measurements again or enter manually",
      variant: "destructive"
    });
  };

  return (
    <>
      <div className="flex items-center gap-2">
      <Button
        onClick={handlePull}
        disabled={loading}
        variant="outline"
        size="sm"
        className="w-full"
      >
        {loading ? (
          <>
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            Pulling...
          </>
        ) : success ? (
          <>
            <CheckCircle2 className="h-4 w-4 mr-2 text-green-600" />
            Measurements Ready
          </>
        ) : (
          <>
            <Satellite className="h-4 w-4 mr-2" />
            Pull Measurements
          </>
        )}
      </Button>
      {success && (
        <Badge variant="outline" className="text-green-600 border-green-600">
          ✓ Tags Ready
        </Badge>
      )}
      </div>

      {/* Verification Dialog */}
      {verificationData && (
        <MeasurementVerificationDialog
          open={showVerificationDialog}
          onOpenChange={(open) => {
            setShowVerificationDialog(open);
            if (!open) {
              // Clear verification data when dialog is closed
              setVerificationData(null);
            }
          }}
          measurement={verificationData.measurement}
          tags={verificationData.tags}
          satelliteImageUrl={verificationData.satelliteImageUrl}
          centerLat={lat}
          centerLng={lng}
          onAccept={handleAcceptMeasurements}
          onReject={handleRejectMeasurements}
        />
      )}
    </>
  );
}
