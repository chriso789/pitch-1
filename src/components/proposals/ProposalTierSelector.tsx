import React from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Check, Star, Shield, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';

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
}

const tierConfig: Record<'good' | 'better' | 'best', {
  label: string;
  icon: typeof Check;
  description: string;
  color: string;
  bgColor: string;
  badge?: string;
  features: string[];
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
    ]
  }
};

export function ProposalTierSelector({ 
  tiers, 
  selectedTier, 
  onSelect, 
  disabled 
}: ProposalTierSelectorProps) {
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(amount);
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {tiers.map((tier) => {
        const config = tierConfig[tier.tier];
        const isSelected = selectedTier === tier.tier;
        const Icon = config.icon;
        const lowestMonthly = tier.financing.length > 0 
          ? Math.min(...tier.financing.map(f => f.monthlyPayment))
          : null;

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
                {lowestMonthly && (
                  <p className="text-sm text-muted-foreground">
                    or from {formatCurrency(lowestMonthly)}/mo
                  </p>
                )}
              </div>

              {/* Warranty */}
              <div className="flex items-center justify-center gap-2 text-sm">
                <Shield className="h-4 w-4 text-primary" />
                <span>{tier.warranty.years}-Year {tier.warranty.type} Warranty</span>
              </div>

              {/* Features */}
              <ul className="space-y-2">
                {config.features.map((feature, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm">
                    <Check className={cn(
                      'h-4 w-4 mt-0.5 shrink-0',
                      tier.tier === 'good' && 'text-blue-500',
                      tier.tier === 'better' && 'text-primary',
                      tier.tier === 'best' && 'text-amber-500'
                    )} />
                    <span>{feature}</span>
                  </li>
                ))}
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
