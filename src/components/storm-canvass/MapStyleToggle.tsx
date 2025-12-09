import { Satellite, Map } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export type MapStyle = 'satellite' | 'lot-lines';

interface MapStyleToggleProps {
  value: MapStyle;
  onChange: (style: MapStyle) => void;
}

export default function MapStyleToggle({ value, onChange }: MapStyleToggleProps) {
  return (
    <div className="flex bg-background/90 backdrop-blur-sm rounded-lg p-1 shadow-lg border border-border">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => onChange('satellite')}
        className={cn(
          'flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-all',
          value === 'satellite' 
            ? 'bg-primary text-primary-foreground shadow-sm' 
            : 'hover:bg-muted'
        )}
      >
        <Satellite className="h-4 w-4" />
        <span className="text-xs font-medium">Satellite</span>
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => onChange('lot-lines')}
        className={cn(
          'flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-all',
          value === 'lot-lines' 
            ? 'bg-primary text-primary-foreground shadow-sm' 
            : 'hover:bg-muted'
        )}
      >
        <Map className="h-4 w-4" />
        <span className="text-xs font-medium">Lot Lines</span>
      </Button>
    </div>
  );
}
