import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Navigation, X, RefreshCw, ChevronDown, ChevronUp, MapPin, Clock } from 'lucide-react';

interface NavigationPanelProps {
  routeData: {
    distance: { distance: number; unit: string };
    duration: number;
    polyline: string;
  };
  destination: { lat: number; lng: number; address: string };
  onStartNavigation: () => void;
  onClearRoute: () => void;
  onRecalculateRoute: () => void;
}

export default function NavigationPanel({
  routeData,
  destination,
  onStartNavigation,
  onClearRoute,
  onRecalculateRoute,
}: NavigationPanelProps) {
  const [showDirections, setShowDirections] = useState(false);

  const formatDuration = (seconds: number) => {
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `${minutes} min`;
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return `${hours}h ${remainingMinutes}m`;
  };

  return (
    <Card className="absolute top-20 left-4 right-4 z-10 shadow-xl bg-background/95 backdrop-blur">
      <div className="p-4 space-y-4">
        {/* Route Info Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <MapPin className="h-3 w-3" />
              <span>Route to:</span>
            </div>
            <p className="text-sm font-medium truncate">{destination.address}</p>
            <div className="flex items-center gap-4 mt-2">
              <div className="flex items-center gap-1 text-sm font-semibold text-primary">
                <Navigation className="h-4 w-4" />
                <span>{routeData.distance.distance.toFixed(1)} {routeData.distance.unit}</span>
              </div>
              <div className="flex items-center gap-1 text-sm text-muted-foreground">
                <Clock className="h-4 w-4" />
                <span>{formatDuration(routeData.duration)}</span>
              </div>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClearRoute}
            className="shrink-0"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-2">
          <Button
            onClick={onStartNavigation}
            className="flex-1 h-12 gap-2"
            size="lg"
          >
            <Navigation className="h-5 w-5" />
            Start Navigation
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={onRecalculateRoute}
            className="h-12 w-12"
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>

        {/* Turn-by-turn directions (collapsible) */}
        <Collapsible open={showDirections} onOpenChange={setShowDirections}>
          <CollapsibleTrigger asChild>
            <Button
              variant="ghost"
              className="w-full justify-between text-xs"
              size="sm"
            >
              <span>View Turn-by-Turn Directions</span>
              {showDirections ? (
                <ChevronUp className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-2 pt-2">
            <div className="text-xs text-muted-foreground text-center py-4 border rounded-md">
              Turn-by-turn directions will appear here after starting navigation
            </div>
          </CollapsibleContent>
        </Collapsible>
      </div>
    </Card>
  );
}
