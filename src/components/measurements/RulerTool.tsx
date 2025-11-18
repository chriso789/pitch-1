import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Ruler, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

interface RulerToolProps {
  active: boolean;
  onToggle: () => void;
  points: [number, number][];
  onAddPoint: (point: [number, number]) => void;
  onClear: () => void;
}

export function RulerTool({ active, onToggle, points, onAddPoint, onClear }: RulerToolProps) {
  const calculateDistance = (p1: [number, number], p2: [number, number]) => {
    const dx = p2[0] - p1[0];
    const dy = p2[1] - p1[1];
    return Math.sqrt(dx * dx + dy * dy);
  };

  const totalDistance = points.length >= 2
    ? points.slice(1).reduce((sum, point, i) => {
        return sum + calculateDistance(points[i], point);
      }, 0)
    : 0;

  // Convert normalized distance to feet (rough approximation)
  const distanceFeet = totalDistance * 100; // Simplified conversion
  const distanceMeters = distanceFeet * 0.3048;

  return (
    <div className="space-y-2">
      <Button
        variant={active ? "default" : "outline"}
        size="sm"
        onClick={onToggle}
      >
        <Ruler className="w-4 h-4 mr-2" />
        {active ? 'Measuring...' : 'Measure Distance'}
      </Button>

      {active && (
        <div className="bg-card border rounded-lg p-3 space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-xs text-muted-foreground">
              Click on canvas to measure distance
            </div>
            <Button variant="ghost" size="sm" onClick={onClear}>
              <X className="w-4 h-4" />
            </Button>
          </div>

          {points.length > 0 && (
            <div className="space-y-1">
              <div className="text-xs text-muted-foreground">Points: {points.length}</div>
              {totalDistance > 0 && (
                <div className="flex gap-2">
                  <Badge variant="default" className="font-mono">
                    {distanceFeet.toFixed(1)} ft
                  </Badge>
                  <Badge variant="outline" className="font-mono">
                    {distanceMeters.toFixed(1)} m
                  </Badge>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
