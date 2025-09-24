import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, Cloud, TrendingUp, DollarSign, Lock, Unlock } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';

interface PricingCalculation {
  calculationId: string;
  suggestedPrice: number;
  finalMarkupPercent: number;
  totalCost: number;
  markupAmount: number;
  rationale: {
    summary: string;
    factors: string[];
    adjustments: {
      weather: number;
      backlog: number;
      season: number;
      leadtime: number;
      total: number;
    };
    anomalyWarnings: string[];
    weatherRiskScore: number;
    season: string;
  };
  config: {
    minMargin: number;
    maxMargin: number;
    baseMarkup: number;
  };
}

interface DynamicPricingEngineProps {
  estimateId?: string;
  initialBaseCost?: number;
  initialLaborCost?: number;
  initialZipCode?: string;
  onPriceCalculated?: (calculation: PricingCalculation) => void;
}

export const DynamicPricingEngine: React.FC<DynamicPricingEngineProps> = ({
  estimateId,
  initialBaseCost = 0,
  initialLaborCost = 0,
  initialZipCode = '',
  onPriceCalculated
}) => {
  const [baseCost, setBaseCost] = useState(initialBaseCost);
  const [laborCost, setLaborCost] = useState(initialLaborCost);
  const [zipCode, setZipCode] = useState(initialZipCode);
  const [season, setSeason] = useState('');
  const [backlogDays, setBacklogDays] = useState(0);
  const [vendorLeadtimeDays, setVendorLeadtimeDays] = useState(0);
  const [calculation, setCalculation] = useState<PricingCalculation | null>(null);
  const [isCalculating, setIsCalculating] = useState(false);
  const [isLocked, setIsLocked] = useState(false);
  
  const { toast } = useToast();

  const calculateDynamicPricing = async () => {
    if (!baseCost || !laborCost || !zipCode) {
      toast({
        title: "Missing Information",
        description: "Please provide base cost, labor cost, and ZIP code.",
        variant: "destructive",
      });
      return;
    }

    setIsCalculating(true);
    try {
      const { data, error } = await supabase.functions.invoke('dynamic-pricing-calculator', {
        body: {
          tenantId: (await supabase.auth.getUser()).data.user?.id,
          estimateId,
          baseCost,
          laborCost,
          zipCode,
          season: season || undefined,
          backlogDays,
          vendorLeadtimeDays
        }
      });

      if (error) throw error;

      setCalculation(data);
      onPriceCalculated?.(data);
      
      toast({
        title: "Pricing Calculated",
        description: `Suggested price: $${data.suggestedPrice.toLocaleString()} (${data.finalMarkupPercent}% markup)`,
      });

    } catch (error) {
      console.error('Error calculating dynamic pricing:', error);
      toast({
        title: "Calculation Failed",
        description: "Failed to calculate dynamic pricing. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsCalculating(false);
    }
  };

  const toggleLock = () => {
    setIsLocked(!isLocked);
    toast({
      title: isLocked ? "Price Unlocked" : "Price Locked",
      description: isLocked 
        ? "Price can now be recalculated with market conditions."
        : "Price is locked and won't change with market conditions.",
    });
  };

  const getRiskBadgeColor = (score: number) => {
    if (score > 0.7) return 'destructive';
    if (score > 0.4) return 'secondary';
    return 'default';
  };

  const getRiskLabel = (score: number) => {
    if (score > 0.7) return 'HIGH RISK';
    if (score > 0.4) return 'MEDIUM RISK';
    return 'LOW RISK';
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="h-5 w-5" />
                Dynamic Pricing Engine
              </CardTitle>
              <CardDescription>
                Market-aware pricing with weather risk analysis and seasonal adjustments
              </CardDescription>
            </div>
            {calculation && (
              <Button
                variant={isLocked ? "destructive" : "outline"}
                size="sm"
                onClick={toggleLock}
                className="flex items-center gap-2"
              >
                {isLocked ? <Lock className="h-4 w-4" /> : <Unlock className="h-4 w-4" />}
                {isLocked ? "Locked" : "Unlocked"}
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="baseCost">Base Cost ($)</Label>
              <Input
                id="baseCost"
                type="number"
                value={baseCost}
                onChange={(e) => setBaseCost(parseFloat(e.target.value) || 0)}
                placeholder="Enter base cost"
                disabled={isLocked}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="laborCost">Labor Cost ($)</Label>
              <Input
                id="laborCost"
                type="number"
                value={laborCost}
                onChange={(e) => setLaborCost(parseFloat(e.target.value) || 0)}
                placeholder="Enter labor cost"
                disabled={isLocked}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="zipCode">ZIP Code</Label>
              <Input
                id="zipCode"
                value={zipCode}
                onChange={(e) => setZipCode(e.target.value)}
                placeholder="Enter ZIP code"
                disabled={isLocked}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="season">Season (Optional)</Label>
              <Select value={season} onValueChange={setSeason} disabled={isLocked}>
                <SelectTrigger>
                  <SelectValue placeholder="Auto-detect season" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="spring">Spring</SelectItem>
                  <SelectItem value="summer">Summer</SelectItem>
                  <SelectItem value="fall">Fall</SelectItem>
                  <SelectItem value="winter">Winter</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="backlogDays">Backlog (Days)</Label>
              <Input
                id="backlogDays"
                type="number"
                value={backlogDays}
                onChange={(e) => setBacklogDays(parseInt(e.target.value) || 0)}
                placeholder="0"
                disabled={isLocked}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="vendorLeadtime">Vendor Leadtime (Days)</Label>
              <Input
                id="vendorLeadtime"
                type="number"
                value={vendorLeadtimeDays}
                onChange={(e) => setVendorLeadtimeDays(parseInt(e.target.value) || 0)}
                placeholder="0"
                disabled={isLocked}
              />
            </div>
          </div>

          <Button 
            onClick={calculateDynamicPricing} 
            disabled={isCalculating || isLocked}
            className="w-full"
          >
            {isCalculating ? "Calculating..." : "Calculate Dynamic Price"}
          </Button>
        </CardContent>
      </Card>

      {calculation && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <DollarSign className="h-5 w-5" />
              Pricing Results
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="text-center p-4 border rounded-lg">
                <div className="text-2xl font-bold text-primary">
                  ${calculation.suggestedPrice.toLocaleString()}
                </div>
                <div className="text-sm text-muted-foreground">Suggested Price</div>
              </div>
              <div className="text-center p-4 border rounded-lg">
                <div className="text-2xl font-bold">
                  {calculation.finalMarkupPercent.toFixed(1)}%
                </div>
                <div className="text-sm text-muted-foreground">Final Markup</div>
              </div>
              <div className="text-center p-4 border rounded-lg">
                <div className="text-2xl font-bold">
                  ${calculation.markupAmount.toLocaleString()}
                </div>
                <div className="text-sm text-muted-foreground">Markup Amount</div>
              </div>
            </div>

            {calculation.rationale.weatherRiskScore > 0 && (
              <div className="flex items-center gap-2 p-3 bg-muted rounded-lg">
                <Cloud className="h-5 w-5" />
                <span className="text-sm">Weather Risk Analysis:</span>
                <Badge variant={getRiskBadgeColor(calculation.rationale.weatherRiskScore)}>
                  {getRiskLabel(calculation.rationale.weatherRiskScore)}
                </Badge>
                <span className="text-sm text-muted-foreground">
                  ({(calculation.rationale.weatherRiskScore * 100).toFixed(0)}% risk score)
                </span>
              </div>
            )}

            <div className="space-y-2">
              <h4 className="font-semibold">Pricing Rationale:</h4>
              <ul className="space-y-1">
                {calculation.rationale.factors.map((factor, index) => (
                  <li key={index} className="text-sm flex items-start gap-2">
                    <span className="text-muted-foreground">•</span>
                    <span>{factor}</span>
                  </li>
                ))}
              </ul>
            </div>

            {calculation.rationale.anomalyWarnings.length > 0 && (
              <div className="space-y-2">
                <h4 className="font-semibold flex items-center gap-2 text-orange-600">
                  <AlertTriangle className="h-4 w-4" />
                  Anomaly Warnings:
                </h4>
                <ul className="space-y-1">
                  {calculation.rationale.anomalyWarnings.map((warning, index) => (
                    <li key={index} className="text-sm text-orange-600 flex items-start gap-2">
                      <span>⚠️</span>
                      <span>{warning}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="text-xs text-muted-foreground p-3 bg-muted rounded">
              <div>Markup constraints: {calculation.config.minMargin}% - {calculation.config.maxMargin}% (Base: {calculation.config.baseMarkup}%)</div>
              <div>Total cost: ${calculation.totalCost.toLocaleString()} | Season: {calculation.rationale.season}</div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};