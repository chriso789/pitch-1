import { Check, Star, Shield, Award, Sparkles } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { TierPricing } from '@/hooks/useProposalGenerator';

interface TierComparisonCardProps {
  tier: TierPricing;
  isSelected?: boolean;
  isPopular?: boolean;
  onSelect: () => void;
  disabled?: boolean;
}

const tierConfig = {
  good: {
    label: 'Good',
    icon: Shield,
    description: 'Quality materials with standard warranty',
    color: 'border-blue-500',
    bgColor: 'bg-blue-500/10',
    features: [
      '3-Tab or Standard Architectural Shingles',
      'Standard Underlayment',
      '10-Year Workmanship Warranty',
      'Basic Ventilation',
      'Standard Flashing',
    ],
  },
  better: {
    label: 'Better',
    icon: Star,
    description: 'Premium materials with extended coverage',
    color: 'border-amber-500',
    bgColor: 'bg-amber-500/10',
    features: [
      'Premium Architectural Shingles',
      'Synthetic Underlayment',
      '25-Year Workmanship Warranty',
      'Enhanced Ridge Ventilation',
      'Upgraded Drip Edge & Flashing',
      'Ice & Water Shield at Valleys',
    ],
  },
  best: {
    label: 'Best',
    icon: Award,
    description: 'Top-tier materials with lifetime protection',
    color: 'border-emerald-500',
    bgColor: 'bg-emerald-500/10',
    features: [
      'Designer or Luxury Shingles',
      'Premium Synthetic Underlayment',
      'Lifetime Workmanship Warranty',
      'Complete Ventilation System',
      'Premium Metal Flashing Package',
      'Full Ice & Water Shield Coverage',
      'Extended Manufacturer Warranty',
      'Priority Service Guarantee',
    ],
  },
};

export const TierComparisonCard = ({
  tier,
  isSelected,
  isPopular,
  onSelect,
  disabled,
}: TierComparisonCardProps) => {
  const config = tierConfig[tier.tierName];
  const Icon = config.icon;

  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);

  return (
    <Card
      className={cn(
        'relative transition-all duration-300 hover:shadow-lg',
        config.color,
        isSelected && 'ring-2 ring-primary shadow-xl scale-[1.02]',
        isPopular && 'border-2'
      )}
    >
      {isPopular && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2">
          <Badge className="bg-amber-500 text-white gap-1">
            <Sparkles className="h-3 w-3" />
            Most Popular
          </Badge>
        </div>
      )}

      <CardHeader className={cn('text-center pb-2', config.bgColor)}>
        <div className="flex justify-center mb-2">
          <div className={cn('p-3 rounded-full', config.bgColor)}>
            <Icon className="h-8 w-8" />
          </div>
        </div>
        <CardTitle className="text-2xl">{config.label}</CardTitle>
        <p className="text-sm text-muted-foreground">{config.description}</p>
      </CardHeader>

      <CardContent className="pt-6 space-y-6">
        {/* Price Display */}
        <div className="text-center">
          <div className="text-4xl font-bold text-primary">
            {formatCurrency(tier.total)}
          </div>
          <div className="text-sm text-muted-foreground mt-1">
            {formatCurrency(tier.pricePerSquare)} / square
          </div>
        </div>

        {/* Financing Option */}
        {tier.financing.length > 0 && (
          <div className="text-center p-3 bg-muted rounded-lg">
            <div className="text-sm text-muted-foreground">Or as low as</div>
            <div className="text-xl font-semibold">
              {formatCurrency(tier.financing[0].monthlyPayment)}/mo
            </div>
            <div className="text-xs text-muted-foreground">
              {tier.financing[0].termMonths} months @ {tier.financing[0].apr}% APR
            </div>
          </div>
        )}

        {/* Features List */}
        <ul className="space-y-2">
          {config.features.map((feature, idx) => (
            <li key={idx} className="flex items-start gap-2 text-sm">
              <Check className="h-4 w-4 text-green-500 mt-0.5 shrink-0" />
              <span>{feature}</span>
            </li>
          ))}
        </ul>

        {/* Warranty Badge */}
        <div className="flex items-center justify-center gap-2 p-2 bg-muted rounded-lg">
          <Shield className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium">
            {tier.warranty.years}-Year {tier.warranty.type} Warranty
          </span>
        </div>

        {/* Select Button */}
        <Button
          className="w-full"
          size="lg"
          variant={isSelected ? 'default' : 'outline'}
          onClick={onSelect}
          disabled={disabled}
        >
          {isSelected ? 'Selected' : 'Select This Option'}
        </Button>
      </CardContent>
    </Card>
  );
};
