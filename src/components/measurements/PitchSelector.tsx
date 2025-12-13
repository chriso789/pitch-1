import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { PITCH_MULTIPLIERS } from '@/utils/gpsCalculations';

interface PitchSelectorProps {
  value: string;
  onChange: (pitch: string) => void;
  showMultiplier?: boolean;
  variant?: 'select' | 'slider' | 'buttons';
  compact?: boolean;
  disabled?: boolean;
}

const PITCH_OPTIONS = [
  { value: 'flat', label: 'Flat', description: 'Nearly flat roof' },
  { value: '1/12', label: '1/12', description: 'Very low slope' },
  { value: '2/12', label: '2/12', description: 'Low slope' },
  { value: '3/12', label: '3/12', description: 'Minimum for shingles' },
  { value: '4/12', label: '4/12', description: 'Common low pitch' },
  { value: '5/12', label: '5/12', description: 'Standard residential' },
  { value: '6/12', label: '6/12', description: 'Standard (most common)' },
  { value: '7/12', label: '7/12', description: 'Moderate steep' },
  { value: '8/12', label: '8/12', description: 'Steep pitch' },
  { value: '9/12', label: '9/12', description: 'Very steep' },
  { value: '10/12', label: '10/12', description: 'Extremely steep' },
  { value: '11/12', label: '11/12', description: 'Near 45°' },
  { value: '12/12', label: '12/12', description: '45° angle' },
];

// Map slider value (0-12) to pitch string
const sliderToPitch = (value: number): string => {
  if (value === 0) return 'flat';
  return `${value}/12`;
};

// Map pitch string to slider value
const pitchToSlider = (pitch: string): number => {
  if (pitch === 'flat' || pitch === '0/12') return 0;
  const match = pitch.match(/^(\d+)\/12$/);
  return match ? parseInt(match[1], 10) : 6;
};

export function PitchSelector({
  value,
  onChange,
  showMultiplier = true,
  variant = 'select',
  compact = false,
  disabled = false,
}: PitchSelectorProps) {
  const multiplier = PITCH_MULTIPLIERS[value] || PITCH_MULTIPLIERS['6/12'];
  const currentOption = PITCH_OPTIONS.find(o => o.value === value);

  if (variant === 'slider') {
    return (
      <div className={cn("space-y-2", compact && "space-y-1")}>
        <div className="flex items-center justify-between">
          <Label className={cn(compact && "text-xs")}>Roof Pitch</Label>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className={cn("font-mono", compact && "text-xs")}>
              {value === 'flat' ? 'Flat' : value}
            </Badge>
            {showMultiplier && (
              <Badge variant="secondary" className={cn(compact && "text-xs")}>
                ×{multiplier.toFixed(3)}
              </Badge>
            )}
          </div>
        </div>
        <Slider
          value={[pitchToSlider(value)]}
          onValueChange={([v]) => onChange(sliderToPitch(v))}
          min={0}
          max={12}
          step={1}
          disabled={disabled}
          className="w-full"
        />
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>Flat</span>
          <span>12/12</span>
        </div>
      </div>
    );
  }

  if (variant === 'buttons') {
    return (
      <div className={cn("space-y-2", compact && "space-y-1")}>
        <div className="flex items-center justify-between">
          <Label className={cn(compact && "text-xs")}>Roof Pitch</Label>
          {showMultiplier && (
            <Badge variant="secondary" className={cn(compact && "text-xs")}>
              ×{multiplier.toFixed(3)}
            </Badge>
          )}
        </div>
        <div className="flex flex-wrap gap-1">
          {PITCH_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              disabled={disabled}
              onClick={() => onChange(option.value)}
              className={cn(
                "px-2 py-1 text-xs rounded-md border transition-colors",
                value === option.value
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background hover:bg-muted border-input",
                disabled && "opacity-50 cursor-not-allowed"
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
    );
  }

  // Default: select variant
  return (
    <div className={cn("space-y-2", compact && "space-y-1")}>
      <div className="flex items-center justify-between">
        <Label className={cn(compact && "text-xs")}>Roof Pitch</Label>
        {showMultiplier && (
          <Badge variant="secondary" className={cn(compact && "text-xs")}>
            ×{multiplier.toFixed(3)}
          </Badge>
        )}
      </div>
      <Select value={value} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger className={cn(compact && "h-8 text-xs")}>
          <SelectValue placeholder="Select pitch" />
        </SelectTrigger>
        <SelectContent>
          {PITCH_OPTIONS.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              <div className="flex items-center justify-between gap-4 w-full">
                <span className="font-mono">{option.label}</span>
                <span className="text-xs text-muted-foreground">{option.description}</span>
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {currentOption && !compact && (
        <p className="text-xs text-muted-foreground">{currentOption.description}</p>
      )}
    </div>
  );
}

/**
 * Visual pitch reference guide
 */
export function PitchReferenceGuide({ compact = false }: { compact?: boolean }) {
  return (
    <div className={cn(
      "grid gap-1 text-xs",
      compact ? "grid-cols-4" : "grid-cols-3"
    )}>
      <div className="p-2 bg-muted/50 rounded text-center">
        <div className="font-mono font-medium">1-3/12</div>
        <div className="text-muted-foreground">Low</div>
      </div>
      <div className="p-2 bg-primary/10 rounded text-center border border-primary/20">
        <div className="font-mono font-medium">4-6/12</div>
        <div className="text-muted-foreground">Standard</div>
      </div>
      <div className="p-2 bg-muted/50 rounded text-center">
        <div className="font-mono font-medium">7-9/12</div>
        <div className="text-muted-foreground">Steep</div>
      </div>
      {!compact && (
        <div className="p-2 bg-muted/50 rounded text-center">
          <div className="font-mono font-medium">10-12/12</div>
          <div className="text-muted-foreground">Very Steep</div>
        </div>
      )}
    </div>
  );
}
