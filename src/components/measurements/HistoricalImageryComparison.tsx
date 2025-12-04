import { useState, useEffect, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Slider } from '@/components/ui/slider';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Calendar, ChevronLeft, ChevronRight, Flag, Layers, AlertTriangle, RefreshCw, Eye } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';

interface TimePoint {
  year: number;
  label: string;
  imageUrl?: string;
  available: boolean;
}

interface HistoricalImageryComparisonProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lat: number;
  lng: number;
  baselineDate?: { year: number; month: number; day: number };
  onFlagForReview?: () => void;
}

export function HistoricalImageryComparison({
  open,
  onOpenChange,
  lat,
  lng,
  baselineDate,
  onFlagForReview
}: HistoricalImageryComparisonProps) {
  const [timePoints, setTimePoints] = useState<TimePoint[]>([]);
  const [selectedPoint, setSelectedPoint] = useState<number>(0);
  const [comparisonMode, setComparisonMode] = useState<'slider' | 'side-by-side'>('slider');
  const [sliderPosition, setSliderPosition] = useState(50);
  const [isLoading, setIsLoading] = useState(false);
  const [currentImageUrl, setCurrentImageUrl] = useState<string>('');
  const [baselineImageUrl, setBaselineImageUrl] = useState<string>('');
  const containerRef = useRef<HTMLDivElement>(null);

  const currentYear = new Date().getFullYear();
  const baselineYear = baselineDate?.year || currentYear - 10;

  // Generate time points from baseline to current
  useEffect(() => {
    const points: TimePoint[] = [];
    
    // Add baseline
    points.push({
      year: baselineYear,
      label: 'Measurement Baseline',
      available: true
    });

    // Add intermediate points every 2 years
    for (let year = baselineYear + 2; year < currentYear; year += 2) {
      points.push({
        year,
        label: `${year}`,
        available: true
      });
    }

    // Add current
    points.push({
      year: currentYear,
      label: 'Current',
      available: true
    });

    setTimePoints(points);
    setSelectedPoint(points.length - 1); // Start with current
  }, [baselineYear, currentYear]);

  // Fetch imagery for current view
  useEffect(() => {
    const fetchImagery = async () => {
      if (!lat || !lng || !open) return;

      setIsLoading(true);
      try {
        // Fetch Mapbox token
        const { data: tokenData } = await supabase.functions.invoke('get-mapbox-token');
        
        if (!tokenData?.token) {
          throw new Error('Failed to get Mapbox token');
        }

        // Current satellite image (Mapbox always shows most recent)
        const currentUrl = `https://api.mapbox.com/styles/v1/mapbox/satellite-v9/static/${lng},${lat},20,0/640x500?access_token=${tokenData.token}`;
        setCurrentImageUrl(currentUrl);

        // Baseline image (same for now - historical imagery requires different API)
        setBaselineImageUrl(currentUrl);
        
      } catch (error) {
        console.error('Failed to fetch imagery:', error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchImagery();
  }, [open, lat, lng]);

  const handlePrevious = () => {
    if (selectedPoint > 0) {
      setSelectedPoint(prev => prev - 1);
    }
  };

  const handleNext = () => {
    if (selectedPoint < timePoints.length - 1) {
      setSelectedPoint(prev => prev + 1);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Layers className="h-5 w-5" />
            Historical Imagery Comparison
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Alert about historical imagery */}
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              Measurement baseline from <span className="font-medium">{baselineYear}</span>.
              Compare with current satellite imagery to detect roof changes, tarps, or obstructions.
            </AlertDescription>
          </Alert>

          {/* Mode Toggle */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Button
                variant={comparisonMode === 'slider' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setComparisonMode('slider')}
              >
                Slider
              </Button>
              <Button
                variant={comparisonMode === 'side-by-side' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setComparisonMode('side-by-side')}
              >
                Side by Side
              </Button>
            </div>

            <Badge variant="secondary">
              <Calendar className="h-3 w-3 mr-1" />
              {timePoints[selectedPoint]?.label || 'Loading...'}
            </Badge>
          </div>

          {/* Image Comparison Area */}
          <div ref={containerRef} className="relative rounded-lg overflow-hidden border bg-muted h-[400px]">
            {isLoading ? (
              <Skeleton className="w-full h-full" />
            ) : comparisonMode === 'slider' ? (
              // Slider comparison
              <div className="relative w-full h-full">
                {/* Baseline Image (left side) */}
                <div className="absolute inset-0">
                  <img
                    src={baselineImageUrl}
                    alt="Baseline imagery"
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute top-2 left-2 bg-background/80 backdrop-blur px-2 py-1 rounded text-xs font-medium">
                    Baseline ({baselineYear})
                  </div>
                </div>

                {/* Current Image (right side, clipped by slider) */}
                <div
                  className="absolute inset-0 overflow-hidden"
                  style={{ clipPath: `inset(0 0 0 ${sliderPosition}%)` }}
                >
                  <img
                    src={currentImageUrl}
                    alt="Current imagery"
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute top-2 right-2 bg-background/80 backdrop-blur px-2 py-1 rounded text-xs font-medium">
                    Current ({currentYear})
                  </div>
                </div>

                {/* Slider Line */}
                <div
                  className="absolute top-0 bottom-0 w-1 bg-primary cursor-ew-resize z-10"
                  style={{ left: `${sliderPosition}%` }}
                >
                  <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 bg-primary rounded-full flex items-center justify-center">
                    <Eye className="h-4 w-4 text-primary-foreground" />
                  </div>
                </div>

                {/* Slider Control */}
                <div className="absolute bottom-4 left-4 right-4">
                  <Slider
                    value={[sliderPosition]}
                    onValueChange={(value) => setSliderPosition(value[0])}
                    min={0}
                    max={100}
                    step={1}
                    className="cursor-pointer"
                  />
                </div>
              </div>
            ) : (
              // Side by side
              <div className="flex h-full">
                <div className="w-1/2 relative border-r">
                  <img
                    src={baselineImageUrl}
                    alt="Baseline imagery"
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute top-2 left-2 bg-background/80 backdrop-blur px-2 py-1 rounded text-xs font-medium">
                    Baseline ({baselineYear})
                  </div>
                </div>
                <div className="w-1/2 relative">
                  <img
                    src={currentImageUrl}
                    alt="Current imagery"
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute top-2 right-2 bg-background/80 backdrop-blur px-2 py-1 rounded text-xs font-medium">
                    Current ({currentYear})
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Timeline */}
          <Card className="p-3">
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="icon"
                onClick={handlePrevious}
                disabled={selectedPoint === 0}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>

              <div className="flex-1 flex items-center gap-1">
                {timePoints.map((point, index) => (
                  <button
                    key={point.year}
                    onClick={() => setSelectedPoint(index)}
                    className={`flex-1 h-2 rounded-full transition-colors ${
                      index === selectedPoint
                        ? 'bg-primary'
                        : index < selectedPoint
                        ? 'bg-primary/40'
                        : 'bg-muted-foreground/20'
                    }`}
                    title={point.label}
                  />
                ))}
              </div>

              <Button
                variant="ghost"
                size="icon"
                onClick={handleNext}
                disabled={selectedPoint === timePoints.length - 1}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>

            <div className="flex justify-between text-xs text-muted-foreground mt-2">
              <span>{baselineYear}</span>
              <span>{currentYear}</span>
            </div>
          </Card>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          {onFlagForReview && (
            <Button variant="destructive" onClick={onFlagForReview}>
              <Flag className="h-4 w-4 mr-2" />
              Flag for Manual Review
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
