import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import { RefreshCw, MapPin, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

interface AddressReverificationButtonProps {
  contactId: string;
  currentAddress: string;
  onReverified?: (newCoords: { lat: number; lng: number; formatted_address: string }) => void;
  variant?: 'default' | 'outline' | 'ghost' | 'link';
  size?: 'default' | 'sm' | 'lg' | 'icon';
  className?: string;
}

interface VerificationResult {
  lat: number;
  lng: number;
  formatted_address: string;
  place_id: string;
  address_components?: any[];
}

export function AddressReverificationButton({
  contactId,
  currentAddress,
  onReverified,
  variant = 'outline',
  size = 'sm',
  className = ''
}: AddressReverificationButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [verificationResult, setVerificationResult] = useState<VerificationResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleReverify = async () => {
    if (!currentAddress) {
      toast({
        title: "No Address",
        description: "No address available to verify",
        variant: "destructive"
      });
      return;
    }

    setIsVerifying(true);
    setError(null);
    setVerificationResult(null);

    try {
      // Call Google Maps geocode API via edge function
      const { data, error: geocodeError } = await supabase.functions.invoke('google-maps-proxy', {
        body: {
          endpoint: 'geocode',
          params: {
            address: currentAddress
          }
        }
      });

      if (geocodeError) throw geocodeError;

      if (data?.results && data.results.length > 0) {
        const result = data.results[0];
        const location = result.geometry.location;

        setVerificationResult({
          lat: location.lat,
          lng: location.lng,
          formatted_address: result.formatted_address,
          place_id: result.place_id,
          address_components: result.address_components
        });
      } else {
        setError('Could not find coordinates for this address. Please check the address and try again.');
      }
    } catch (err) {
      console.error('Address verification error:', err);
      setError('Failed to verify address. Please try again.');
    } finally {
      setIsVerifying(false);
    }
  };

  const handleApplyVerification = async () => {
    if (!verificationResult) return;

    setIsVerifying(true);

    try {
      // Update the contact's verified_address field
      const { error: updateError } = await supabase
        .from('contacts')
        .update({
          verified_address: {
            lat: verificationResult.lat,
            lng: verificationResult.lng,
            formatted_address: verificationResult.formatted_address,
            place_id: verificationResult.place_id,
            verification_timestamp: new Date().toISOString(),
            verification_status: 'verified'
          },
          latitude: verificationResult.lat,
          longitude: verificationResult.lng
        })
        .eq('id', contactId);

      if (updateError) throw updateError;

      toast({
        title: "Address Verified",
        description: "Coordinates updated successfully. Measurements will now use the correct location.",
      });

      onReverified?.({
        lat: verificationResult.lat,
        lng: verificationResult.lng,
        formatted_address: verificationResult.formatted_address
      });

      setIsOpen(false);
      setVerificationResult(null);
    } catch (err) {
      console.error('Failed to update contact:', err);
      toast({
        title: "Update Failed",
        description: "Could not save the verified address. Please try again.",
        variant: "destructive"
      });
    } finally {
      setIsVerifying(false);
    }
  };

  return (
    <>
      <Button
        variant={variant}
        size={size}
        className={className}
        onClick={() => {
          setIsOpen(true);
          handleReverify();
        }}
      >
        <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
        Re-verify Address
      </Button>

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MapPin className="h-5 w-5 text-primary" />
              Re-verify Property Address
            </DialogTitle>
            <DialogDescription>
              Get fresh GPS coordinates from Google for accurate measurements
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* Current Address */}
            <div className="p-3 bg-muted rounded-lg">
              <p className="text-xs text-muted-foreground mb-1">Current Address</p>
              <p className="text-sm font-medium">{currentAddress || 'No address set'}</p>
            </div>

            {/* Loading State */}
            {isVerifying && !verificationResult && (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <span className="ml-2 text-muted-foreground">Verifying with Google...</span>
              </div>
            )}

            {/* Error State */}
            {error && (
              <div className="p-4 bg-destructive/10 rounded-lg flex items-start gap-3">
                <AlertCircle className="h-5 w-5 text-destructive mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-destructive">Verification Failed</p>
                  <p className="text-xs text-muted-foreground mt-1">{error}</p>
                </div>
              </div>
            )}

            {/* Success Result */}
            {verificationResult && (
              <div className="space-y-3">
                <div className="p-4 bg-primary/10 rounded-lg flex items-start gap-3">
                  <CheckCircle2 className="h-5 w-5 text-primary mt-0.5" />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-primary">Address Verified</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {verificationResult.formatted_address}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="p-3 bg-muted rounded-lg">
                    <p className="text-xs text-muted-foreground">Latitude</p>
                    <p className="text-sm font-mono font-medium">{verificationResult.lat.toFixed(6)}</p>
                  </div>
                  <div className="p-3 bg-muted rounded-lg">
                    <p className="text-xs text-muted-foreground">Longitude</p>
                    <p className="text-sm font-mono font-medium">{verificationResult.lng.toFixed(6)}</p>
                  </div>
                </div>

                <Badge variant="outline" className="w-full justify-center py-2">
                  Google Place ID: {verificationResult.place_id?.substring(0, 20)}...
                </Badge>
              </div>
            )}
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setIsOpen(false)} disabled={isVerifying}>
              Cancel
            </Button>
            {error && (
              <Button variant="outline" onClick={handleReverify} disabled={isVerifying}>
                <RefreshCw className="h-4 w-4 mr-1.5" />
                Retry
              </Button>
            )}
            {verificationResult && (
              <Button onClick={handleApplyVerification} disabled={isVerifying}>
                {isVerifying ? (
                  <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-4 w-4 mr-1.5" />
                )}
                Apply & Update Contact
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
