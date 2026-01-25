import React from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Award, CheckCircle, Download, Shield, Star, Trophy } from 'lucide-react';
import { cn } from '@/lib/utils';

export type CertificationLevel = 'bronze' | 'silver' | 'gold' | 'platinum' | 'diamond' | 'uncertified' | null;

interface DiamondCertificationBadgeProps {
  certificationLevel: CertificationLevel;
  overallScore: number;
  validUntil?: Date | null;
  certificationNumber?: string | null;
  componentScores?: Record<string, number>;
  checksPerformed?: { check: string; passed: boolean; score: number }[];
  onViewCertificate?: () => void;
  onDownloadPDF?: () => void;
  compact?: boolean;
}

const CERTIFICATION_CONFIG: Record<string, {
  color: string;
  bgColor: string;
  borderColor: string;
  icon: React.ElementType;
  label: string;
  minScore: number;
  description: string;
}> = {
  diamond: {
    color: 'text-cyan-600',
    bgColor: 'bg-gradient-to-r from-cyan-50 via-blue-50 to-purple-50',
    borderColor: 'border-cyan-300',
    icon: Trophy,
    label: 'Diamond Certified',
    minScore: 100,
    description: 'Perfect accuracy - zero tolerance validation passed',
  },
  platinum: {
    color: 'text-slate-600',
    bgColor: 'bg-gradient-to-r from-slate-100 to-gray-100',
    borderColor: 'border-slate-400',
    icon: Award,
    label: 'Platinum Certified',
    minScore: 98,
    description: '99.5%+ accuracy with ground truth verification',
  },
  gold: {
    color: 'text-amber-600',
    bgColor: 'bg-gradient-to-r from-amber-50 to-yellow-50',
    borderColor: 'border-amber-400',
    icon: Star,
    label: 'Gold Certified',
    minScore: 95,
    description: '95%+ accuracy with all critical checks passed',
  },
  silver: {
    color: 'text-gray-500',
    bgColor: 'bg-gradient-to-r from-gray-100 to-slate-100',
    borderColor: 'border-gray-400',
    icon: Shield,
    label: 'Silver Certified',
    minScore: 90,
    description: '90%+ accuracy with deviation under 5%',
  },
  bronze: {
    color: 'text-orange-600',
    bgColor: 'bg-gradient-to-r from-orange-50 to-amber-50',
    borderColor: 'border-orange-400',
    icon: CheckCircle,
    label: 'Bronze Certified',
    minScore: 80,
    description: 'Valid topology with reasonable area',
  },
  uncertified: {
    color: 'text-muted-foreground',
    bgColor: 'bg-muted/50',
    borderColor: 'border-muted',
    icon: Shield,
    label: 'Pending Certification',
    minScore: 0,
    description: 'Awaiting verification or requires manual review',
  },
};

export const DiamondCertificationBadge: React.FC<DiamondCertificationBadgeProps> = ({
  certificationLevel,
  overallScore,
  validUntil,
  certificationNumber,
  componentScores,
  checksPerformed,
  onViewCertificate,
  onDownloadPDF,
  compact = false,
}) => {
  const level = certificationLevel || 'uncertified';
  const config = CERTIFICATION_CONFIG[level] || CERTIFICATION_CONFIG.uncertified;
  const Icon = config.icon;

  const isValid = validUntil ? new Date(validUntil) > new Date() : true;
  const daysRemaining = validUntil 
    ? Math.ceil((new Date(validUntil).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    : null;

  if (compact) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge 
              variant="outline" 
              className={cn(
                'gap-1 cursor-help',
                config.bgColor,
                config.borderColor,
                config.color
              )}
            >
              <Icon className="h-3 w-3" />
              <span className="text-[10px] font-medium">{Math.round(overallScore)}%</span>
            </Badge>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-xs">
            <div className="space-y-1">
              <div className="font-semibold">{config.label}</div>
              <div className="text-xs text-muted-foreground">{config.description}</div>
              {certificationNumber && (
                <div className="text-[10px] text-muted-foreground">
                  Certificate: {certificationNumber}
                </div>
              )}
            </div>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return (
    <div className={cn(
      'rounded-lg border p-4',
      config.bgColor,
      config.borderColor
    )}>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className={cn(
            'p-2 rounded-full',
            level === 'diamond' ? 'bg-gradient-to-br from-cyan-400 to-purple-500' :
            level === 'platinum' ? 'bg-gradient-to-br from-slate-400 to-gray-500' :
            level === 'gold' ? 'bg-gradient-to-br from-amber-400 to-yellow-500' :
            level === 'silver' ? 'bg-gradient-to-br from-gray-400 to-slate-400' :
            level === 'bronze' ? 'bg-gradient-to-br from-orange-400 to-amber-500' :
            'bg-muted'
          )}>
            <Icon className={cn(
              'h-5 w-5',
              level === 'uncertified' ? 'text-muted-foreground' : 'text-white'
            )} />
          </div>
          <div>
            <div className={cn('font-semibold text-sm', config.color)}>
              {config.label}
            </div>
            <div className="text-[10px] text-muted-foreground">
              {config.description}
            </div>
          </div>
        </div>

        <div className="text-right">
          <div className={cn('text-2xl font-bold', config.color)}>
            {Math.round(overallScore)}%
          </div>
          <div className="text-[10px] text-muted-foreground">
            Accuracy Score
          </div>
        </div>
      </div>

      {/* Component Scores */}
      {componentScores && Object.keys(componentScores).length > 0 && (
        <div className="mb-3 pt-3 border-t border-dashed">
          <div className="text-[10px] font-medium text-muted-foreground uppercase mb-2">
            Component Scores
          </div>
          <div className="grid grid-cols-5 gap-1">
            {Object.entries(componentScores).map(([component, score]) => (
              <div key={component} className="text-center">
                <div className={cn(
                  'text-xs font-semibold',
                  score >= 95 ? 'text-green-600' :
                  score >= 85 ? 'text-amber-600' :
                  'text-red-600'
                )}>
                  {Math.round(score)}%
                </div>
                <div className="text-[9px] text-muted-foreground capitalize">
                  {component}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Checks Performed */}
      {checksPerformed && checksPerformed.length > 0 && (
        <div className="mb-3 pt-3 border-t border-dashed">
          <div className="text-[10px] font-medium text-muted-foreground uppercase mb-2">
            Validation Checks
          </div>
          <div className="grid grid-cols-2 gap-1">
            {checksPerformed.slice(0, 6).map((check, i) => (
              <div key={i} className="flex items-center gap-1 text-[10px]">
                <div className={cn(
                  'w-2 h-2 rounded-full',
                  check.passed ? 'bg-green-500' : 'bg-red-500'
                )} />
                <span className="truncate text-muted-foreground">
                  {check.check.replace(/_/g, ' ')}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between pt-3 border-t border-dashed">
        <div className="text-[10px] text-muted-foreground">
          {certificationNumber && (
            <div>Certificate: {certificationNumber}</div>
          )}
          {validUntil && (
            <div className={cn(!isValid && 'text-destructive')}>
              {isValid 
                ? `Valid for ${daysRemaining} days`
                : 'Expired - recertification required'
              }
            </div>
          )}
        </div>

        <div className="flex gap-1">
          {onViewCertificate && (
            <Button 
              size="sm" 
              variant="ghost" 
              className="h-7 text-xs"
              onClick={onViewCertificate}
            >
              View Details
            </Button>
          )}
          {onDownloadPDF && level !== 'uncertified' && (
            <Button 
              size="sm" 
              variant="outline" 
              className="h-7 text-xs gap-1"
              onClick={onDownloadPDF}
            >
              <Download className="h-3 w-3" />
              PDF
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};

export default DiamondCertificationBadge;
