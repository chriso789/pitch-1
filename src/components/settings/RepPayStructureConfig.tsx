import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { Slider } from '@/components/ui/slider';
import { Calculator, DollarSign, Clock, AlertTriangle } from 'lucide-react';

interface PayStructureConfig {
  pay_type: 'hourly' | 'commission';
  hourly_rate: number;
  overhead_rate: number;
  commission_structure: 'profit_split' | 'sales_percentage';
  commission_rate: number;
}

interface RepPayStructureConfigProps {
  role: string;
  onChange: (config: PayStructureConfig) => void;
  currentUser?: { role: string };
  initialPayType?: 'hourly' | 'commission';
}

export const RepPayStructureConfig: React.FC<RepPayStructureConfigProps> = ({
  role,
  onChange,
  currentUser,
  initialPayType = 'commission'
}) => {
  const [config, setConfig] = useState<PayStructureConfig>({
    pay_type: initialPayType,
    hourly_rate: 25,
    overhead_rate: 10,
    commission_structure: 'profit_split',
    commission_rate: 50
  });

  useEffect(() => {
    onChange(config);
  }, [config, onChange]);

  const handleConfigChange = (field: keyof PayStructureConfig, value: unknown) => {
    const newConfig = { ...config, [field]: value };
    setConfig(newConfig);
  };

  // Show for sales/regional managers if current user has proper role
  if (!['sales_manager', 'regional_manager'].includes(role) || 
      !['master', 'owner', 'corporate', 'office_admin', 'regional_manager'].includes(currentUser?.role || '')) {
    return null;
  }

  const calculateExampleCommission = (contractValue: number) => {
    const overhead = contractValue * (config.overhead_rate / 100);
    const costs = contractValue * 0.65; // Materials + Labor = 65%
    
    const netProfit = contractValue - costs - overhead;
    return netProfit * (config.commission_rate / 100);
  };

  return (
    <Card className="border-primary/20">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Calculator className="h-5 w-5 text-primary" />
          Pay Structure Configuration
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Pay Type Toggle */}
        <div className="space-y-3">
          <Label className="text-base font-medium">Pay Type</Label>
          <p className="text-sm text-muted-foreground">
            Choose whether this team member is paid hourly or on commission
          </p>
          <Select
            value={config.pay_type}
            onValueChange={(value: 'hourly' | 'commission') => handleConfigChange('pay_type', value)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="commission">
                <div className="flex items-center gap-2">
                  <DollarSign className="h-4 w-4 text-green-600" />
                  <div className="flex flex-col">
                    <span className="font-medium">Commission</span>
                    <span className="text-xs text-muted-foreground">Percentage of profit on closed deals</span>
                  </div>
                </div>
              </SelectItem>
              <SelectItem value="hourly">
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-blue-600" />
                  <div className="flex flex-col">
                    <span className="font-medium">Hourly</span>
                    <span className="text-xs text-muted-foreground">Fixed rate per hour worked</span>
                  </div>
                </div>
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Separator />

        {config.pay_type === 'hourly' ? (
          /* Hourly Rate Configuration */
          <div className="space-y-4">
            <div className="space-y-3">
              <Label className="text-base font-medium flex items-center gap-2">
                <Clock className="h-4 w-4" />
                Hourly Rate
              </Label>
              <p className="text-sm text-muted-foreground">
                Set the hourly rate for this team member
              </p>
              <div className="space-y-4">
                <Slider
                  value={[config.hourly_rate]}
                  onValueChange={(value) => handleConfigChange('hourly_rate', value[0])}
                  min={15}
                  max={100}
                  step={1}
                  className="w-full"
                />
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">$15/hr</span>
                  <div className="flex items-center gap-2">
                    <span className="text-2xl font-bold text-primary">${config.hourly_rate}</span>
                    <span className="text-muted-foreground">/hour</span>
                  </div>
                  <span className="text-sm text-muted-foreground">$100/hr</span>
                </div>
              </div>
            </div>

            {/* Weekly/Monthly Estimate */}
            <div className="bg-muted/30 rounded-lg p-4 space-y-3">
              <Label className="text-base font-medium">Estimated Earnings</Label>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div className="bg-background rounded-lg p-3">
                  <span className="text-muted-foreground block">Weekly (40 hrs)</span>
                  <span className="text-xl font-bold text-primary">
                    ${(config.hourly_rate * 40).toLocaleString()}
                  </span>
                </div>
                <div className="bg-background rounded-lg p-3">
                  <span className="text-muted-foreground block">Monthly (160 hrs)</span>
                  <span className="text-xl font-bold text-primary">
                    ${(config.hourly_rate * 160).toLocaleString()}
                  </span>
                </div>
              </div>
            </div>
          </div>
        ) : (
          /* Commission Configuration */
          <>
            {/* Overhead Rate Selection */}
            <div className="space-y-3">
              <Label className="text-base font-medium">Rep Overhead Rate</Label>
              <p className="text-sm text-muted-foreground">
                Percentage of total selling price charged as job cost overhead
              </p>
              <Select
                value={config.overhead_rate.toString()}
                onValueChange={(value) => handleConfigChange('overhead_rate', parseFloat(value))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="5">5% - Standard Rate</SelectItem>
                  <SelectItem value="10">10% - Premium Rate</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Separator />

            {/* Commission Rate Input */}
            <div className="space-y-3">
              <Label className="text-base font-medium">
                Commission Rate 
                <Badge variant="outline" className="ml-2">Net Profit Split</Badge>
              </Label>
              <p className="text-sm text-muted-foreground">
                Percentage of net profit this rep will receive
              </p>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  value={config.commission_rate}
                  onChange={(e) => handleConfigChange('commission_rate', parseFloat(e.target.value) || 0)}
                  min="0"
                  max="100"
                  step="5"
                  className="w-24"
                />
                <span className="text-sm font-medium">%</span>
              </div>
            </div>

            <Separator />

            {/* Example Calculation */}
            <div className="space-y-3">
              <Label className="text-base font-medium flex items-center gap-2">
                <DollarSign className="h-4 w-4" />
                Example Commission Calculation
              </Label>
              <div className="bg-muted/30 rounded-lg p-4 space-y-3">
                <div className="text-sm">
                  <div className="font-medium mb-2">$50,000 Contract Example:</div>
                  <div className="grid grid-cols-2 gap-4 text-xs">
                    <div>
                      <span className="text-muted-foreground">Contract Value:</span>
                      <span className="ml-2 font-medium">$50,000</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Materials + Labor (65%):</span>
                      <span className="ml-2">$32,500</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Rep Overhead ({config.overhead_rate}%):</span>
                      <span className="ml-2">${(50000 * (config.overhead_rate / 100)).toLocaleString()}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Net Profit:</span>
                      <span className="ml-2">${(50000 - 32500 - (50000 * (config.overhead_rate / 100))).toLocaleString()}</span>
                    </div>
                  </div>
                  <div className="mt-3 pt-2 border-t border-border">
                    <div className="flex justify-between items-center">
                      <span className="font-medium text-green-600">Rep Commission ({config.commission_rate}%):</span>
                      <span className="font-bold text-green-600 text-lg">
                        ${calculateExampleCommission(50000).toLocaleString()}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}

        {/* Important Notes */}
        <div className="bg-warning/10 border border-warning/20 rounded-lg p-4">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-warning mt-0.5" />
            <div className="text-sm">
              <div className="font-medium text-warning mb-1">Important Notes:</div>
              <ul className="text-muted-foreground space-y-1 text-xs">
                <li>• Pay structure is set at user creation and managed via their profile</li>
                <li>• {config.pay_type === 'hourly' ? 'Hourly workers track time through the system' : 'Commission is calculated on closed deals'}</li>
                <li>• Changes to pay structure require manager approval</li>
                <li>• Rep will see transparent breakdown in their dashboard</li>
              </ul>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};