import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { AlertTriangle, CheckCircle2, AlertCircle, Sun, Cloud, Eye } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ImageQualityBadgeProps {
  shadowRisk: 'low' | 'medium' | 'high';
  qualityScore?: number;
  factors?: string[];
  compact?: boolean;
}

export function ImageQualityBadge({ 
  shadowRisk, 
  qualityScore = 75, 
  factors = [],
  compact = false 
}: ImageQualityBadgeProps) {
  const getRiskConfig = () => {
    switch (shadowRisk) {
      case 'high':
        return {
          icon: AlertTriangle,
          label: compact ? 'High' : 'High Shadow Risk',
          variant: 'destructive' as const,
          className: 'bg-destructive/10 text-destructive border-destructive/20',
          description: 'Shadows may affect measurement accuracy'
        };
      case 'medium':
        return {
          icon: AlertCircle,
          label: compact ? 'Medium' : 'Medium Shadow Risk',
          variant: 'secondary' as const,
          className: 'bg-amber-500/10 text-amber-600 border-amber-500/20',
          description: 'Some shadow interference detected'
        };
      case 'low':
      default:
        return {
          icon: CheckCircle2,
          label: compact ? 'Good' : 'Good Image Quality',
          variant: 'secondary' as const,
          className: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20',
          description: 'Clear imagery suitable for measurement'
        };
    }
  };

  const config = getRiskConfig();
  const Icon = config.icon;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge 
            variant={config.variant}
            className={cn(
              'gap-1 cursor-help border',
              config.className
            )}
          >
            <Icon className="h-3 w-3" />
            <span>{config.label}</span>
            {qualityScore !== undefined && !compact && (
              <span className="opacity-70">({qualityScore}%)</span>
            )}
          </Badge>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-xs">
          <div className="space-y-2">
            <div className="font-medium">{config.description}</div>
            
            {qualityScore !== undefined && (
              <div className="flex items-center gap-2 text-sm">
                <Eye className="h-3.5 w-3.5 text-muted-foreground" />
                <span>Quality Score: {qualityScore}%</span>
              </div>
            )}
            
            {factors.length > 0 && (
              <div className="space-y-1">
                <div className="text-xs text-muted-foreground">Factors:</div>
                <ul className="text-xs space-y-0.5">
                  {factors.slice(0, 4).map((factor, i) => (
                    <li key={i} className="flex items-start gap-1">
                      <span className="text-muted-foreground">•</span>
                      <span>{factor}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            
            {shadowRisk === 'high' && (
              <div className="text-xs text-destructive/80 border-t pt-2 mt-2">
                Manual review recommended for accuracy
              </div>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
