import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { Calculator, DollarSign, Percent, AlertTriangle } from 'lucide-react';

interface PayStructureConfig {
  overhead_rate: number;
  commission_structure: 'profit_split' | 'sales_percentage';
  commission_rate: number;
}

interface RepPayStructureConfigProps {
  role: string;
  onChange: (config: PayStructureConfig) => void;
  currentUser?: any;
}

export const RepPayStructureConfig: React.FC<RepPayStructureConfigProps> = ({
  role,
  onChange,
  currentUser
}) => {
  const [config, setConfig] = useState<PayStructureConfig>({
    overhead_rate: 5,
    commission_structure: 'profit_split',
    commission_rate: 50
  });

  const handleConfigChange = (field: keyof PayStructureConfig, value: any) => {
    const newConfig = { ...config, [field]: value };
    setConfig(newConfig);
    onChange(newConfig);
  };

  // Only show for sales reps and if current user is manager+
  if (!['admin', 'manager'].includes(role) || !['admin', 'manager', 'master'].includes(currentUser?.role)) {
    return null;
  }

  const calculateExampleCommission = (contractValue: number) => {
    const overhead = contractValue * (config.overhead_rate / 100);
    const costs = contractValue * 0.4; // Example 40% costs
    
    if (config.commission_structure === 'profit_split') {
      const netProfit = contractValue - costs - overhead;
      return netProfit * (config.commission_rate / 100);
    } else {
      return contractValue * (config.commission_rate / 100);
    }
  };

  return (
    <Card className="border-primary/20">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Calculator className="h-5 w-5 text-primary" />
          Sales Rep Pay Structure
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
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

        {/* Commission Structure Selection */}
        <div className="space-y-3">
          <Label className="text-base font-medium">Commission Structure</Label>
          <p className="text-sm text-muted-foreground">
            Choose how commission is calculated for this representative
          </p>
          <Select
            value={config.commission_structure}
            onValueChange={(value) => handleConfigChange('commission_structure', value)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="profit_split">
                <div className="flex flex-col">
                  <span className="font-medium">Profit Split</span>
                  <span className="text-xs text-muted-foreground">% of net profit after costs & overhead</span>
                </div>
              </SelectItem>
              <SelectItem value="sales_percentage">
                <div className="flex flex-col">
                  <span className="font-medium">Sales Percentage</span>
                  <span className="text-xs text-muted-foreground">% of total contract value</span>
                </div>
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Commission Rate Input */}
        <div className="space-y-3">
          <Label className="text-base font-medium">
            Commission Rate 
            <Badge variant="outline" className="ml-2">
              {config.commission_structure === 'profit_split' ? 'Profit Share' : 'Sales %'}
            </Badge>
          </Label>
          <p className="text-sm text-muted-foreground">
            {config.commission_structure === 'profit_split' 
              ? 'Percentage of net profit this rep will receive'
              : 'Percentage of total sales price this rep will receive'
            }
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
                  <span className="text-muted-foreground">Project Costs:</span>
                  <span className="ml-2">$20,000</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Rep Overhead ({config.overhead_rate}%):</span>
                  <span className="ml-2">${(50000 * (config.overhead_rate / 100)).toLocaleString()}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Net Profit:</span>
                  <span className="ml-2">${(50000 - 20000 - (50000 * (config.overhead_rate / 100))).toLocaleString()}</span>
                </div>
              </div>
              <div className="mt-3 pt-2 border-t border-border">
                <div className="flex justify-between items-center">
                  <span className="font-medium text-success">Rep Commission ({config.commission_rate}%):</span>
                  <span className="font-bold text-success text-lg">
                    ${calculateExampleCommission(50000).toLocaleString()}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  {config.commission_structure === 'profit_split' 
                    ? `${config.commission_rate}% of $${(50000 - 20000 - (50000 * (config.overhead_rate / 100))).toLocaleString()} net profit`
                    : `${config.commission_rate}% of $50,000 contract value`
                  }
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Important Notes */}
        <div className="bg-warning/10 border border-warning/20 rounded-lg p-4">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-warning mt-0.5" />
            <div className="text-sm">
              <div className="font-medium text-warning mb-1">Important Notes:</div>
              <ul className="text-muted-foreground space-y-1 text-xs">
                <li>• Overhead rate can only be changed by managers</li>
                <li>• Commission structure affects how profit is calculated</li>
                <li>• Changes create a new commission plan automatically</li>
                <li>• Rep will see transparent breakdown in project details</li>
              </ul>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};