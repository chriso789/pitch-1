import { useState, useEffect, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Slider } from '@/components/ui/slider';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Calendar, ChevronLeft, ChevronRight, Flag, Layers, AlertTriangle, RefreshCw, Eye, Loader2, ImageOff } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface TimePoint {
  year: number;
  month?: number;
  label: string;
  releaseDate?: string;
  imageUrl?: string;
  available: boolean;
  source?: string;
  isLoading?: boolean;
  error?: string;
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
  const [imageryError, setImageryError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const currentYear = new Date().getFullYear();
  const baselineYear = baselineDate?.year || currentYear - 10;

  // Fetch historical imagery from ESRI Wayback API
  useEffect(() => {
    const fetchHistoricalImagery = async () => {
      if (!lat || !lng || !open) return;

      setIsLoading(true);
      setImageryError(null);

      try {
        console.log(`📸 Fetching historical imagery for ${lat}, ${lng}`);
        
        // Call our edge function to get historical imagery URLs
        const { data, error } = await supabase.functions.invoke('historical-imagery-fetch', {
          body: { lat, lng, zoom: 18, width: 640, height: 500 }
        });

        if (error) {
          throw new Error(error.message || 'Failed to fetch historical imagery');
        }

        if (!data?.ok) {
          throw new Error(data?.error || 'Historical imagery unavailable');
        }

        const fetchedPoints: TimePoint[] = data.data.timePoints.map((point: any) => ({
          year: point.year,
          month: point.month,
          label: point.label,
          releaseDate: point.releaseDate,
          imageUrl: point.imageUrl,
          available: point.available,
          source: point.source,
          isLoading: false,
          error: undefined
        }));

        setTimePoints(fetchedPoints);
        
        // Set current (first) and baseline (last or closest to baseline year) images
        if (fetchedPoints.length > 0) {
          setCurrentImageUrl(fetchedPoints[0].imageUrl || '');
          setSelectedPoint(0);
          
          // Find baseline image
          const baselinePoint = fetchedPoints.find(p => p.year <= baselineYear) || fetchedPoints[fetchedPoints.length - 1];
          setBaselineImageUrl(baselinePoint?.imageUrl || '');
        }

        console.log(`✅ Loaded ${fetchedPoints.length} historical imagery time points`);
        
      } catch (error: any) {
        console.error('Failed to fetch historical imagery:', error);
        setImageryError(error.message || 'Could not load historical imagery');
        
        // Fallback: generate time points with Mapbox current imagery only
        await fetchMapboxFallback();
      } finally {
        setIsLoading(false);
      }
    };

    fetchHistoricalImagery();
  }, [open, lat, lng, baselineYear]);

  // Fallback to Mapbox if ESRI Wayback fails
  const fetchMapboxFallback = async () => {
    try {
      const { data: tokenData } = await supabase.functions.invoke('get-mapbox-token');
      
      if (!tokenData?.token) {
        throw new Error('Failed to get Mapbox token');
      }

      // Generate fallback time points (only current imagery available)
      const fallbackPoints: TimePoint[] = [];
      
      // Current imagery
      const currentUrl = `https://api.mapbox.com/styles/v1/mapbox/satellite-v9/static/${lng},${lat},18,0/640x500?access_token=${tokenData.token}`;
      fallbackPoints.push({
        year: currentYear,
        label: 'Current',
        imageUrl: currentUrl,
        available: true,
        source: 'mapbox'
      });

      // Add placeholder time points for historical years (unavailable)
      for (let year = currentYear - 2; year >= baselineYear; year -= 2) {
        fallbackPoints.push({
          year,
          label: year === baselineYear ? 'Measurement Baseline' : `${year}`,
          available: false,
          source: 'unavailable'
        });
      }

      setTimePoints(fallbackPoints);
      setCurrentImageUrl(currentUrl);
      setBaselineImageUrl(currentUrl); // Same image as fallback
      
      toast.warning('Historical imagery unavailable - showing current satellite only');
      
    } catch (err) {
      console.error('Mapbox fallback also failed:', err);
    }
  };

  // Update displayed image when selected point changes
  useEffect(() => {
    if (timePoints.length > 0 && timePoints[selectedPoint]?.imageUrl) {
      setCurrentImageUrl(timePoints[selectedPoint].imageUrl!);
    }
  }, [selectedPoint, timePoints]);

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

  const handleRefresh = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('historical-imagery-fetch', {
        body: { lat, lng, zoom: 18, width: 640, height: 500 }
      });

      if (data?.ok) {
        const fetchedPoints = data.data.timePoints;
        setTimePoints(fetchedPoints);
        toast.success('Historical imagery refreshed');
      }
    } catch (err) {
      toast.error('Failed to refresh imagery');
    } finally {
      setIsLoading(false);
    }
  };

  const selectedTimePoint = timePoints[selectedPoint];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Layers className="h-5 w-5" />
            Historical Imagery Comparison
            {isLoading && <Loader2 className="h-4 w-4 animate-spin ml-2" />}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Alert about historical imagery */}
          <Alert variant={imageryError ? 'destructive' : 'default'}>
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              {imageryError ? (
                <>
                  <span className="font-medium">Historical imagery unavailable:</span> {imageryError}
                  <br />
                  Showing current satellite imagery for reference.
                </>
              ) : (
                <>
                  Measurement baseline from <span className="font-medium">{baselineYear}</span>.
                  Compare with satellite imagery across years to detect roof changes, tarps, or obstructions.
                  <br />
                  <span className="text-xs text-muted-foreground">
                    Source: ESRI World Imagery Wayback Archive (2014-{currentYear})
                  </span>
                </>
              )}
            </AlertDescription>
          </Alert>

          {/* Mode Toggle & Refresh */}
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
              <Button
                variant="ghost"
                size="sm"
                onClick={handleRefresh}
                disabled={isLoading}
              >
                <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
              </Button>
            </div>

            <div className="flex items-center gap-2">
              {selectedTimePoint && (
                <Badge variant={selectedTimePoint.available ? 'secondary' : 'outline'}>
                  <Calendar className="h-3 w-3 mr-1" />
                  {selectedTimePoint.label}
                  {selectedTimePoint.source && (
                    <span className="text-xs ml-1 opacity-60">({selectedTimePoint.source})</span>
                  )}
                </Badge>
              )}
            </div>
          </div>

          {/* Image Comparison Area */}
          <div ref={containerRef} className="relative rounded-lg overflow-hidden border bg-muted h-[400px]">
            {isLoading ? (
              <div className="w-full h-full flex items-center justify-center">
                <div className="text-center space-y-3">
                  <Loader2 className="h-8 w-8 animate-spin mx-auto text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">Loading historical imagery...</p>
                </div>
              </div>
            ) : comparisonMode === 'slider' ? (
              // Slider comparison
              <div className="relative w-full h-full">
                {/* Baseline Image (left side) */}
                <div className="absolute inset-0">
                  {baselineImageUrl ? (
                    <img
                      src={baselineImageUrl}
                      alt="Baseline imagery"
                      className="w-full h-full object-cover"
                      onError={() => console.warn('Baseline image failed to load')}
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center bg-muted">
                      <div className="text-center">
                        <ImageOff className="h-8 w-8 mx-auto text-muted-foreground" />
                        <p className="text-sm text-muted-foreground mt-2">Baseline unavailable</p>
                      </div>
                    </div>
                  )}
                  <div className="absolute top-2 left-2 bg-background/80 backdrop-blur px-2 py-1 rounded text-xs font-medium">
                    Baseline ({baselineYear})
                  </div>
                </div>

                {/* Current/Selected Image (right side, clipped by slider) */}
                <div
                  className="absolute inset-0 overflow-hidden"
                  style={{ clipPath: `inset(0 0 0 ${sliderPosition}%)` }}
                >
                  {currentImageUrl ? (
                    <img
                      src={currentImageUrl}
                      alt="Selected imagery"
                      className="w-full h-full object-cover"
                      onError={() => console.warn('Current image failed to load')}
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center bg-muted">
                      <ImageOff className="h-8 w-8 text-muted-foreground" />
                    </div>
                  )}
                  <div className="absolute top-2 right-2 bg-background/80 backdrop-blur px-2 py-1 rounded text-xs font-medium">
                    {selectedTimePoint?.label || 'Current'}
                  </div>
                </div>

                {/* Slider Line */}
                <div
                  className="absolute top-0 bottom-0 w-1 bg-primary cursor-ew-resize z-10"
                  style={{ left: `${sliderPosition}%` }}
                >
                  <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 bg-primary rounded-full flex items-center justify-center shadow-lg">
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
                  {baselineImageUrl ? (
                    <img
                      src={baselineImageUrl}
                      alt="Baseline imagery"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center bg-muted">
                      <ImageOff className="h-8 w-8 text-muted-foreground" />
                    </div>
                  )}
                  <div className="absolute top-2 left-2 bg-background/80 backdrop-blur px-2 py-1 rounded text-xs font-medium">
                    Baseline ({baselineYear})
                  </div>
                </div>
                <div className="w-1/2 relative">
                  {currentImageUrl ? (
                    <img
                      src={currentImageUrl}
                      alt="Selected imagery"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center bg-muted">
                      <ImageOff className="h-8 w-8 text-muted-foreground" />
                    </div>
                  )}
                  <div className="absolute top-2 right-2 bg-background/80 backdrop-blur px-2 py-1 rounded text-xs font-medium">
                    {selectedTimePoint?.label || 'Current'}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Timeline Navigation */}
          <Card className="p-3">
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="icon"
                onClick={handlePrevious}
                disabled={selectedPoint === 0 || isLoading}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>

              <div className="flex-1 flex items-center gap-1">
                {timePoints.map((point, index) => (
                  <button
                    key={`${point.year}-${index}`}
                    onClick={() => point.available && setSelectedPoint(index)}
                    disabled={!point.available}
                    className={`flex-1 h-2 rounded-full transition-colors ${
                      index === selectedPoint
                        ? 'bg-primary'
                        : point.available
                        ? index < selectedPoint
                          ? 'bg-primary/40'
                          : 'bg-muted-foreground/20 hover:bg-muted-foreground/40'
                        : 'bg-muted-foreground/10 cursor-not-allowed'
                    }`}
                    title={point.available ? point.label : `${point.label} (unavailable)`}
                  />
                ))}
              </div>

              <Button
                variant="ghost"
                size="icon"
                onClick={handleNext}
                disabled={selectedPoint === timePoints.length - 1 || isLoading}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>

            <div className="flex justify-between text-xs text-muted-foreground mt-2">
              <span>{timePoints[timePoints.length - 1]?.year || baselineYear}</span>
              <span className="text-center">
                {timePoints.filter(p => p.available).length} of {timePoints.length} years available
              </span>
              <span>{timePoints[0]?.year || currentYear}</span>
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
