import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Check, Star, Shield, Sparkles, ArrowUp, Zap, Calculator, ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useFinancingCalculations } from '@/hooks/useFinancingCalculations';

interface TierData {
  tier: 'good' | 'better' | 'best';
  totalPrice: number;
  warranty: { years: number; type: string; description?: string };
  financing: Array<{
    provider: string;
    termMonths: number;
    aprPercent: number;
    monthlyPayment: number;
  }>;
  materials: Array<{ name: string; quantity: number; unit: string }>;
  labor: Array<{ task: string; hours: number }>;
}

interface ProposalTierSelectorProps {
  tiers: TierData[];
  selectedTier: 'good' | 'better' | 'best' | null;
  onSelect: (tier: 'good' | 'better' | 'best') => void;
  disabled?: boolean;
  showComparison?: boolean;
}

const tierConfig: Record<'good' | 'better' | 'best', {
  label: string;
  icon: typeof Check;
  description: string;
  color: string;
  bgColor: string;
  badge?: string;
  features: string[];
  exclusiveFeatures?: string[]; // Features only in this tier and above
}> = {
  good: {
    label: 'Good',
    icon: Check,
    description: 'Quality materials with standard warranty',
    color: 'border-blue-500',
    bgColor: 'bg-blue-50',
    features: [
      '3-tab architectural shingles',
      'Standard underlayment',
      'Basic flashing replacement',
      'Workmanship guarantee'
    ]
  },
  better: {
    label: 'Better',
    icon: Star,
    description: 'Premium materials with enhanced protection',
    color: 'border-primary',
    bgColor: 'bg-primary/5',
    badge: 'Most Popular',
    features: [
      'Dimensional architectural shingles',
      'Synthetic underlayment',
      'Enhanced ice & water shield',
      'Extended warranty coverage',
      'Ridge vent ventilation'
    ],
    exclusiveFeatures: [
      'Synthetic underlayment',
      'Enhanced ice & water shield',
      'Extended warranty coverage',
      'Ridge vent ventilation'
    ]
  },
  best: {
    label: 'Best',
    icon: Sparkles,
    description: 'Top-tier materials with maximum protection',
    color: 'border-amber-500',
    bgColor: 'bg-amber-50',
    badge: 'Premium',
    features: [
      'Designer luxury shingles',
      'Premium synthetic underlayment',
      'Full perimeter ice & water shield',
      'Lifetime warranty',
      'Enhanced ventilation system',
      'Copper flashing upgrade'
    ],
    exclusiveFeatures: [
      'Designer luxury shingles',
      'Premium synthetic underlayment',
      'Full perimeter ice & water shield',
      'Lifetime warranty',
      'Copper flashing upgrade'
    ]
  }
};

// Financing display component
function FinancingDisplay({ totalPrice }: { totalPrice: number }) {
  const [showOptions, setShowOptions] = useState(false);
  const { options, lowestMonthlyPayment, apr } = useFinancingCalculations({
    principal: totalPrice,
    defaultApr: 8.99,
    terms: [36, 60, 84, 120]
  });

  const formatCurrencyCompact = (amount: number) =>
    new Intl.NumberFormat('en-US', { 
      style: 'currency', 
      currency: 'USD',
      maximumFractionDigits: 0 
    }).format(amount);

  if (!lowestMonthlyPayment || totalPrice <= 0) return null;

  return (
    <Collapsible open={showOptions} onOpenChange={setShowOptions}>
      <div className="text-center p-3 bg-muted rounded-lg">
        <div className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
          <Calculator className="h-3.5 w-3.5" />
          <span>Or as low as</span>
        </div>
        <div className="text-xl font-semibold text-primary">
          {formatCurrencyCompact(lowestMonthlyPayment.monthlyPayment)}/mo
        </div>
        <div className="text-xs text-muted-foreground mb-1">
          {lowestMonthlyPayment.termMonths} months @ {apr}% APR
        </div>
        
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm" className="text-xs gap-1 h-6 px-2">
            View options
            {showOptions ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </Button>
        </CollapsibleTrigger>
      </div>

      <CollapsibleContent className="mt-2">
        <div className="space-y-1.5 p-2 bg-muted/50 rounded-lg text-sm">
          {options.map((option) => (
            <div 
              key={option.termMonths} 
              className={cn(
                "flex justify-between items-center py-1 px-2 rounded",
                option.termMonths === lowestMonthlyPayment.termMonths && "bg-primary/10"
              )}
            >
              <span className="text-muted-foreground">{option.termMonths} mo</span>
              <span className="font-medium">{formatCurrencyCompact(option.monthlyPayment)}/mo</span>
            </div>
          ))}
          <p className="text-[10px] text-muted-foreground pt-1 border-t">
            *Subject to credit approval
          </p>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

export function ProposalTierSelector({ 
  tiers, 
  selectedTier, 
  onSelect, 
  disabled,
  showComparison = false
}: ProposalTierSelectorProps) {
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(amount);
  };

  // Calculate value per dollar for "Best Value" callout
  const getValueCallout = (tier: TierData): string | null => {
    if (tier.tier === 'better') {
      const goodTier = tiers.find(t => t.tier === 'good');
      if (goodTier) {
        const priceDiff = tier.totalPrice - goodTier.totalPrice;
        const warrantyDiff = tier.warranty.years - goodTier.warranty.years;
        if (warrantyDiff > 0) {
          return `+${warrantyDiff} years warranty`;
        }
      }
    }
    if (tier.tier === 'best') {
      return 'Maximum protection';
    }
    return null;
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {tiers.map((tier, tierIndex) => {
        const config = tierConfig[tier.tier];
        const isSelected = selectedTier === tier.tier;
        const Icon = config.icon;
        const lowestMonthly = tier.financing.length > 0 
          ? Math.min(...tier.financing.map(f => f.monthlyPayment))
          : null;
        const valueCallout = getValueCallout(tier);

        return (
          <Card 
            key={tier.tier}
            className={cn(
              'relative transition-all duration-200 cursor-pointer hover:shadow-lg',
              isSelected && `ring-2 ring-primary ${config.bgColor}`,
              tier.tier === 'better' && 'md:-mt-2 md:mb-2 md:scale-[1.02]',
              disabled && 'opacity-60 cursor-not-allowed'
            )}
            onClick={() => !disabled && onSelect(tier.tier)}
          >
            {/* Popular/Premium Badge */}
            {config.badge && (
              <Badge 
                className={cn(
                  'absolute -top-3 left-1/2 -translate-x-1/2 shadow-sm',
                  tier.tier === 'better' ? 'bg-primary' : 'bg-amber-500'
                )}
              >
                {config.badge}
              </Badge>
            )}

            <CardHeader className="pb-2 pt-6">
              <div className="flex items-center justify-center mb-2">
                <div className={cn(
                  'p-3 rounded-full',
                  tier.tier === 'good' && 'bg-blue-100 text-blue-600',
                  tier.tier === 'better' && 'bg-primary/10 text-primary',
                  tier.tier === 'best' && 'bg-amber-100 text-amber-600'
                )}>
                  <Icon className="h-6 w-6" />
                </div>
              </div>
              <CardTitle className="text-center text-xl">{config.label}</CardTitle>
              <CardDescription className="text-center">
                {config.description}
              </CardDescription>
            </CardHeader>

            <CardContent className="space-y-4">
              {/* Price */}
              <div className="text-center">
                <p className="text-3xl font-bold">{formatCurrency(tier.totalPrice)}</p>
              </div>

              {/* Financing Calculator */}
              <FinancingDisplay totalPrice={tier.totalPrice} />

              {/* Value Callout */}
              {valueCallout && showComparison && (
                <div className={cn(
                  'flex items-center justify-center gap-1.5 text-xs font-medium px-2 py-1 rounded-full',
                  tier.tier === 'better' && 'bg-primary/10 text-primary',
                  tier.tier === 'best' && 'bg-amber-100 text-amber-700'
                )}>
                  <Zap className="h-3 w-3" />
                  {valueCallout}
                </div>
              )}

              {/* Warranty */}
              <div className="flex items-center justify-center gap-2 text-sm">
                <Shield className="h-4 w-4 text-primary" />
                <span>{tier.warranty.years}-Year {tier.warranty.type} Warranty</span>
              </div>

              {/* Features */}
              <ul className="space-y-2">
                {config.features.map((feature, i) => {
                  const isExclusive = config.exclusiveFeatures?.includes(feature);
                  return (
                    <li key={i} className="flex items-start gap-2 text-sm">
                      {isExclusive && showComparison ? (
                        <ArrowUp className={cn(
                          'h-4 w-4 mt-0.5 shrink-0',
                          tier.tier === 'better' && 'text-primary',
                          tier.tier === 'best' && 'text-amber-500'
                        )} />
                      ) : (
                        <Check className={cn(
                          'h-4 w-4 mt-0.5 shrink-0',
                          tier.tier === 'good' && 'text-blue-500',
                          tier.tier === 'better' && 'text-primary',
                          tier.tier === 'best' && 'text-amber-500'
                        )} />
                      )}
                      <span className={cn(
                        isExclusive && showComparison && 'font-medium'
                      )}>
                        {feature}
                        {isExclusive && showComparison && (
                          <Badge variant="outline" className="ml-1.5 text-[9px] py-0 px-1">
                            Upgrade
                          </Badge>
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>

              {/* Select Button */}
              <Button 
                variant={isSelected ? 'default' : 'outline'}
                className="w-full"
                disabled={disabled}
                onClick={(e) => {
                  e.stopPropagation();
                  if (!disabled) onSelect(tier.tier);
                }}
              >
                {isSelected ? (
                  <>
                    <Check className="h-4 w-4 mr-2" />
                    Selected
                  </>
                ) : (
                  'Select This Option'
                )}
              </Button>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
