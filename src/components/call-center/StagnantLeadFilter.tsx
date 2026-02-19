import React from 'react';
import { Badge } from '@/components/ui/badge';
import { Clock } from 'lucide-react';
import { cn } from '@/lib/utils';

interface StagnantLeadFilterProps {
  selectedDays: number | null;
  onSelect: (days: number | null) => void;
}

const STAGNANT_OPTIONS = [
  { label: '7+ days', days: 7 },
  { label: '14+ days', days: 14 },
  { label: '30+ days', days: 30 },
  { label: '60+ days', days: 60 },
  { label: '90+ days', days: 90 },
];

export const StagnantLeadFilter: React.FC<StagnantLeadFilterProps> = ({ selectedDays, onSelect }) => {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <Clock className="h-3.5 w-3.5" />
        <span>Stagnant:</span>
      </div>
      {STAGNANT_OPTIONS.map((opt) => (
        <Badge
          key={opt.days}
          variant={selectedDays === opt.days ? 'default' : 'outline'}
          className={cn(
            'cursor-pointer transition-colors',
            selectedDays === opt.days
              ? 'bg-primary text-primary-foreground'
              : 'hover:bg-accent'
          )}
          onClick={() => onSelect(selectedDays === opt.days ? null : opt.days)}
        >
          {opt.label}
        </Badge>
      ))}
    </div>
  );
};
