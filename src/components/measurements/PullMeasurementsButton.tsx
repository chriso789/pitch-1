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

      // Try to use Mapbox visualization URL first, then fallback to Google Maps
      let satelliteImageUrl: string | undefined;
      
      if (measurement.mapbox_visualization_url) {
        // Use the pre-generated Mapbox visualization with overlays
        satelliteImageUrl = measurement.mapbox_visualization_url;
        console.log('Using Mapbox visualization:', satelliteImageUrl);
      } else {
        // Fallback to Google Maps satellite image (ALWAYS provide fallback)
        console.log('Mapbox visualization not available, using Google Maps fallback');
        try {
          const { data: imageData, error: imageError } = await supabase.functions.invoke('google-maps-proxy', {
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

          if (imageError) {
            console.error('Google Maps proxy error:', imageError);
          } else if (imageData?.image) {
            satelliteImageUrl = `data:image/png;base64,${imageData.image}`;
            console.log('Google Maps fallback image loaded successfully');
          } else {
            console.warn('Google Maps proxy returned no image data');
          }
        } catch (imgError) {
          console.error('Failed to fetch satellite image:', imgError);
        }
      }
      
      // Log final satellite image status
      if (satelliteImageUrl) {
        console.log('Satellite image ready for verification dialog');
      } else {
        console.warn('No satellite image available - verification will be limited');
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
    
    // Merge penetrations and age data into tags if adjusted
    let finalTags = { ...tags };
    if (adjustedMeasurement?.penetrations) {
      const penetrations = adjustedMeasurement.penetrations;
      finalTags['pen.pipe_vent'] = penetrations.pipe_vent || 0;
      finalTags['pen.skylight'] = penetrations.skylight || 0;
      finalTags['pen.chimney'] = penetrations.chimney || 0;
      finalTags['pen.hvac'] = penetrations.hvac || 0;
      finalTags['pen.other'] = penetrations.other || 0;
      finalTags['pen.total'] = (
        (penetrations.pipe_vent || 0) +
        (penetrations.skylight || 0) +
        (penetrations.chimney || 0) +
        (penetrations.hvac || 0) +
        (penetrations.other || 0)
      );
    }
    if (adjustedMeasurement?.roofAge !== undefined) {
      finalTags['age.years'] = adjustedMeasurement.roofAge;
    }
    if (adjustedMeasurement?.roofAgeSource) {
      finalTags['age.source'] = adjustedMeasurement.roofAgeSource;
    }

    // Invalidate measurement cache
    queryClient.invalidateQueries({ queryKey: ['measurement', propertyId] });

    setSuccess(true);
    
    const squares = adjustedMeasurement?.adjustedSquares || tags['roof.squares'];
    
    toast({
      title: "Measurements Applied",
      description: `${squares?.toFixed(1)} squares ready for estimates`,
    });

    onSuccess?.(finalMeasurement, finalTags);

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
