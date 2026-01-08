/**
 * FastEstimateModal - AI-powered instant roof estimate from satellite imagery
 */

import { useState } from 'react';
import { Calculator, Loader2, CheckCircle, Home, Ruler, DollarSign, ChevronDown } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface FastEstimateModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  property: any;
}

interface EstimateResult {
  total_area_sqft: number;
  total_squares: number;
  pitch: string;
  face_count: number;
  perimeter_ft: number;
  ridge_ft: number;
  estimates: {
    tier: string;
    label: string;
    price_per_sqft: number;
    total: number;
  }[];
}

const PRICE_TIERS = [
  { tier: 'good', label: 'Good (3-Tab)', price_per_sqft: 3.50 },
  { tier: 'better', label: 'Better (Architectural)', price_per_sqft: 4.50 },
  { tier: 'best', label: 'Best (Premium)', price_per_sqft: 6.00 },
];

export default function FastEstimateModal({
  open,
  onOpenChange,
  property,
}: FastEstimateModalProps) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<EstimateResult | null>(null);
  const [selectedTier, setSelectedTier] = useState<string>('better');

  const runEstimate = async () => {
    if (!property?.lat || !property?.lng) {
      toast.error('Property location not available');
      return;
    }

    if (!property?.id) {
      toast.error('Property ID not available');
      return;
    }

    setLoading(true);
    setResult(null);

    try {
      // Call the measure edge function with required action and propertyId
      const { data, error } = await supabase.functions.invoke('measure', {
        body: {
          action: 'pull',
          propertyId: property.id,
          lat: property.lat,
          lng: property.lng,
          address: property.address,
        }
      });

      if (error) throw error;

      if (!data?.ok) {
        throw new Error(data?.error || 'Measurement failed');
      }

      // Parse the measurement result from nested response
      const measurement = data?.data?.measurement;
      const summary = measurement?.summary || {};
      const totalArea = summary.total_area_sqft || 0;
      const squares = summary.total_squares || Math.ceil(totalArea / 100);
      const pitch = summary.pitch || measurement?.faces?.[0]?.pitch || '6/12';
      const faceCount = measurement?.faces?.length || summary.face_count || 4;
      const perimeter = summary.perimeter_ft || 0;
      const ridge = summary.ridge_ft || 0;

      if (totalArea < 100) {
        toast.error('Could not calculate roof area. Try again later.');
        setLoading(false);
        return;
      }

      // Generate estimates for each tier
      const estimates = PRICE_TIERS.map(tier => ({
        tier: tier.tier,
        label: tier.label,
        price_per_sqft: tier.price_per_sqft,
        total: Math.round(totalArea * tier.price_per_sqft),
      }));

      setResult({
        total_area_sqft: totalArea,
        total_squares: squares,
        pitch,
        face_count: faceCount,
        perimeter_ft: perimeter,
        ridge_ft: ridge,
        estimates,
      });

      toast.success('Estimate generated!');
    } catch (err: any) {
      console.error('Fast estimate error:', err);
      toast.error(err.message || 'Failed to generate estimate');
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  const selectedEstimate = result?.estimates.find(e => e.tier === selectedTier);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Calculator className="h-5 w-5 text-primary" />
            Fast Estimate
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Property Info */}
          <div className="p-3 bg-muted/50 rounded-lg">
            <div className="flex items-center gap-2 text-sm">
              <Home className="h-4 w-4 text-muted-foreground" />
              <span className="text-muted-foreground">
                {typeof property?.address === 'string' 
                  ? JSON.parse(property.address).formatted 
                  : property?.address?.formatted || 'Property Address'}
              </span>
            </div>
          </div>

          {!result && !loading && (
            <Button 
              onClick={runEstimate} 
              className="w-full"
              size="lg"
            >
              <Calculator className="h-4 w-4 mr-2" />
              Generate AI Estimate
            </Button>
          )}

          {loading && (
            <div className="flex flex-col items-center justify-center py-8 space-y-3">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">
                Analyzing satellite imagery...
              </p>
            </div>
          )}

          {result && (
            <>
              {/* Measurements */}
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 bg-primary/5 rounded-lg text-center">
                  <Ruler className="h-5 w-5 mx-auto mb-1 text-primary" />
                  <p className="text-lg font-bold">{result.total_area_sqft.toLocaleString()}</p>
                  <p className="text-xs text-muted-foreground">Sq Ft</p>
                </div>
                <div className="p-3 bg-primary/5 rounded-lg text-center">
                  <Home className="h-5 w-5 mx-auto mb-1 text-primary" />
                  <p className="text-lg font-bold">{result.total_squares}</p>
                  <p className="text-xs text-muted-foreground">Squares</p>
                </div>
              </div>

              {/* Details Row */}
              <div className="flex justify-between text-xs text-muted-foreground px-1">
                <span>Pitch: {result.pitch}</span>
                <span>Facets: {result.face_count}</span>
                {result.ridge_ft > 0 && <span>Ridge: {Math.round(result.ridge_ft)} ft</span>}
              </div>

              {/* Pricing Tiers */}
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">Select Material Tier</p>
                {result.estimates.map((estimate) => (
                  <button
                    key={estimate.tier}
                    onClick={() => setSelectedTier(estimate.tier)}
                    className={cn(
                      "w-full p-3 rounded-lg border-2 transition-colors text-left",
                      selectedTier === estimate.tier
                        ? "border-primary bg-primary/5"
                        : "border-border hover:border-primary/50"
                    )}
                  >
                    <div className="flex justify-between items-center">
                      <div>
                        <p className="font-medium text-sm">{estimate.label}</p>
                        <p className="text-xs text-muted-foreground">
                          ${estimate.price_per_sqft.toFixed(2)}/sqft
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-lg font-bold text-primary">
                          {formatCurrency(estimate.total)}
                        </p>
                        {selectedTier === estimate.tier && (
                          <CheckCircle className="h-4 w-4 text-primary inline" />
                        )}
                      </div>
                    </div>
                  </button>
                ))}
              </div>

              {/* Action Buttons */}
              <div className="flex gap-2 pt-2">
                <Button variant="outline" className="flex-1" onClick={() => onOpenChange(false)}>
                  Close
                </Button>
                <Button 
                  className="flex-1"
                  onClick={() => {
                    toast.info('Creating full proposal...');
                    onOpenChange(false);
                  }}
                >
                  <DollarSign className="h-4 w-4 mr-1" />
                  Create Proposal
                </Button>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
