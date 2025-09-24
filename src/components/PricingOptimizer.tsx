import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AlertTriangle, Cloud, TrendingUp, DollarSign, Settings, BarChart3 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { DynamicPricingEngine } from './DynamicPricingEngine';

interface PricingConfig {
  id: string;
  min_margin_percent: number;
  max_margin_percent: number;
  base_markup_percent: number;
  weather_risk_multiplier: number;
  backlog_multiplier: number;
  season_multipliers: any;
  price_anomaly_threshold_percent: number;
}

interface PricingCalculation {
  id: string;
  suggested_price: number;
  final_markup_percent: number;
  weather_risk_score: number;
  season: string;
  rationale: any;
  calculated_at: string;
}

export const PricingOptimizer: React.FC = () => {
  const [config, setConfig] = useState<PricingConfig | null>(null);
  const [recentCalculations, setRecentCalculations] = useState<PricingCalculation[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  
  const { toast } = useToast();

  useEffect(() => {
    fetchPricingConfig();
    fetchRecentCalculations();
  }, []);

  const fetchPricingConfig = async () => {
    try {
      const { data, error } = await supabase
        .from('dynamic_pricing_config')
        .select('*')
        .eq('is_active', true)
        .maybeSingle();

      if (error) throw error;
      setConfig(data);
    } catch (error) {
      console.error('Error fetching pricing config:', error);
      toast({
        title: "Configuration Error",
        description: "Failed to load pricing configuration.",
        variant: "destructive",
      });
    }
  };

  const fetchRecentCalculations = async () => {
    try {
      const { data, error } = await supabase
        .from('pricing_calculations')
        .select('*')
        .order('calculated_at', { ascending: false })
        .limit(10);

      if (error) throw error;
      setRecentCalculations(data || []);
    } catch (error) {
      console.error('Error fetching calculations:', error);
    }
  };

  const updateConfig = async () => {
    if (!config) return;

    setIsSaving(true);
    try {
      const { error } = await supabase
        .from('dynamic_pricing_config')
        .update({
          min_margin_percent: config.min_margin_percent,
          max_margin_percent: config.max_margin_percent,
          base_markup_percent: config.base_markup_percent,
          weather_risk_multiplier: config.weather_risk_multiplier,
          backlog_multiplier: config.backlog_multiplier,
          price_anomaly_threshold_percent: config.price_anomaly_threshold_percent,
          updated_at: new Date().toISOString()
        })
        .eq('id', config.id);

      if (error) throw error;

      toast({
        title: "Configuration Updated",
        description: "Dynamic pricing settings have been saved.",
      });
    } catch (error) {
      console.error('Error updating config:', error);
      toast({
        title: "Update Failed",
        description: "Failed to save configuration changes.",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const getRiskBadgeColor = (score: number) => {
    if (score > 0.7) return 'destructive';
    if (score > 0.4) return 'secondary';
    return 'default';
  };

  const getRiskLabel = (score: number) => {
    if (score > 0.7) return 'HIGH';
    if (score > 0.4) return 'MEDIUM';
    return 'LOW';
  };

  if (!config) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="text-center">
            <div className="text-lg font-semibold mb-2">Loading Pricing Configuration...</div>
            <div className="text-muted-foreground">Setting up dynamic pricing engine</div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Pricing Optimizer</h2>
          <p className="text-muted-foreground">
            Market-aware pricing with weather analytics and dynamic adjustments
          </p>
        </div>
      </div>

      <Tabs defaultValue="calculator" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="calculator" className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4" />
            Price Calculator
          </TabsTrigger>
          <TabsTrigger value="analytics" className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4" />
            Analytics
          </TabsTrigger>
          <TabsTrigger value="settings" className="flex items-center gap-2">
            <Settings className="h-4 w-4" />
            Configuration
          </TabsTrigger>
        </TabsList>

        <TabsContent value="calculator">
          <DynamicPricingEngine onPriceCalculated={(calculation) => {
            fetchRecentCalculations(); // Refresh the calculations list
          }} />
        </TabsContent>

        <TabsContent value="analytics" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Recent Calculations</CardTitle>
                <CardDescription>Last 10 pricing calculations</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {recentCalculations.length === 0 ? (
                    <p className="text-muted-foreground text-sm">No calculations yet</p>
                  ) : (
                    recentCalculations.map((calc) => (
                      <div key={calc.id} className="flex items-center justify-between p-3 border rounded-lg">
                        <div>
                          <div className="font-medium">${calc.suggested_price.toLocaleString()}</div>
                          <div className="text-sm text-muted-foreground">
                            {calc.final_markup_percent.toFixed(1)}% markup • {calc.season}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {calc.weather_risk_score > 0 && (
                            <Badge variant={getRiskBadgeColor(calc.weather_risk_score)} className="text-xs">
                              <Cloud className="h-3 w-3 mr-1" />
                              {getRiskLabel(calc.weather_risk_score)}
                            </Badge>
                          )}
                          <div className="text-xs text-muted-foreground">
                            {new Date(calc.calculated_at).toLocaleDateString()}
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Pricing Trends</CardTitle>
                <CardDescription>Market conditions overview</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Average Markup</span>
                    <span className="font-medium">
                      {recentCalculations.length > 0 
                        ? (recentCalculations.reduce((sum, calc) => sum + calc.final_markup_percent, 0) / recentCalculations.length).toFixed(1)
                        : '0.0'
                      }%
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">High Risk Weather Days</span>
                    <span className="font-medium">
                      {recentCalculations.filter(calc => calc.weather_risk_score > 0.7).length}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Season Adjustments</span>
                    <span className="font-medium">
                      {recentCalculations.filter(calc => calc.rationale?.adjustments?.season !== 0).length}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="settings" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Settings className="h-5 w-5" />
                Pricing Configuration
              </CardTitle>
              <CardDescription>
                Configure dynamic pricing parameters and constraints
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="minMargin">Minimum Margin (%)</Label>
                  <Input
                    id="minMargin"
                    type="number"
                    step="0.1"
                    value={config.min_margin_percent}
                    onChange={(e) => setConfig({
                      ...config,
                      min_margin_percent: parseFloat(e.target.value) || 0
                    })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="maxMargin">Maximum Margin (%)</Label>
                  <Input
                    id="maxMargin"
                    type="number"
                    step="0.1"
                    value={config.max_margin_percent}
                    onChange={(e) => setConfig({
                      ...config,
                      max_margin_percent: parseFloat(e.target.value) || 0
                    })}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="baseMarkup">Base Markup (%)</Label>
                  <Input
                    id="baseMarkup"
                    type="number"
                    step="0.1"
                    value={config.base_markup_percent}
                    onChange={(e) => setConfig({
                      ...config,
                      base_markup_percent: parseFloat(e.target.value) || 0
                    })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="anomalyThreshold">Anomaly Threshold (%)</Label>
                  <Input
                    id="anomalyThreshold"
                    type="number"
                    step="0.1"
                    value={config.price_anomaly_threshold_percent}
                    onChange={(e) => setConfig({
                      ...config,
                      price_anomaly_threshold_percent: parseFloat(e.target.value) || 0
                    })}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="weatherMultiplier">Weather Risk Multiplier</Label>
                  <Input
                    id="weatherMultiplier"
                    type="number"
                    step="0.01"
                    value={config.weather_risk_multiplier}
                    onChange={(e) => setConfig({
                      ...config,
                      weather_risk_multiplier: parseFloat(e.target.value) || 1.0
                    })}
                  />
                  <p className="text-xs text-muted-foreground">
                    Multiplier applied during high weather risk (e.g., 1.15 = 15% increase)
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="backlogMultiplier">Backlog Multiplier</Label>
                  <Input
                    id="backlogMultiplier"
                    type="number"
                    step="0.01"
                    value={config.backlog_multiplier}
                    onChange={(e) => setConfig({
                      ...config,
                      backlog_multiplier: parseFloat(e.target.value) || 1.0
                    })}
                  />
                  <p className="text-xs text-muted-foreground">
                    Multiplier applied when backlog is high (e.g., 1.10 = 10% increase)
                  </p>
                </div>
              </div>

              <div className="pt-4">
                <Button 
                  onClick={updateConfig} 
                  disabled={isSaving}
                  className="w-full"
                >
                  {isSaving ? "Saving..." : "Save Configuration"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};