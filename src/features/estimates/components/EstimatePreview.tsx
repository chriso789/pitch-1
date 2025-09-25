import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { 
  Calculator, 
  FileText, 
  DollarSign, 
  TrendingUp, 
  AlertTriangle,
  CheckCircle,
  Home,
  Wrench
} from "lucide-react";
import { useState } from "react";

const EstimatePreview = () => {
  const [selectedTemplate, setSelectedTemplate] = useState("shingle");

  const estimateTemplates = {
    shingle: {
      name: "Shingle Replacement",
      description: "Standard asphalt shingle roof replacement",
      materials: [
        { item: "Asphalt Shingles (30-year)", quantity: "35 squares", unitCost: 85, total: 2975 },
        { item: "Underlayment", quantity: "35 squares", unitCost: 12, total: 420 },
        { item: "Ridge Cap Shingles", quantity: "80 LF", unitCost: 3.5, total: 280 },
        { item: "Starter Shingles", quantity: "120 LF", unitCost: 2.8, total: 336 },
        { item: "Drip Edge", quantity: "180 LF", unitCost: 3.2, total: 576 },
        { item: "Nails & Fasteners", quantity: "1 lot", unitCost: 125, total: 125 },
        { item: "Flashing", quantity: "40 LF", unitCost: 8.5, total: 340 }
      ],
      labor: [
        { item: "Tear-off Existing Roof", hours: 16, rate: 45, total: 720 },
        { item: "Shingle Installation", hours: 24, rate: 55, total: 1320 },
        { item: "Ridge & Trim Work", hours: 6, rate: 60, total: 360 },
        { item: "Cleanup & Disposal", hours: 4, rate: 40, total: 160 }
      ]
    },
    metal: {
      name: "Metal Roof Installation", 
      description: "Standing seam metal roof system",
      materials: [
        { item: "Metal Panels (26ga)", quantity: "35 squares", unitCost: 185, total: 6475 },
        { item: "Metal Underlayment", quantity: "35 squares", unitCost: 18, total: 630 },
        { item: "Ridge Cap Metal", quantity: "80 LF", unitCost: 12, total: 960 },
        { item: "Trim & Flashing", quantity: "200 LF", unitCost: 8, total: 1600 },
        { item: "Fasteners & Clips", quantity: "1 lot", unitCost: 285, total: 285 },
        { item: "Sealants", quantity: "1 lot", unitCost: 75, total: 75 }
      ],
      labor: [
        { item: "Tear-off Existing Roof", hours: 16, rate: 45, total: 720 },
        { item: "Metal Panel Installation", hours: 32, rate: 65, total: 2080 },
        { item: "Trim & Detail Work", hours: 8, rate: 70, total: 560 },
        { item: "Cleanup & Disposal", hours: 4, rate: 40, total: 160 }
      ]
    },
    tile: {
      name: "Tile Repair",
      description: "Clay tile repair and replacement",
      materials: [
        { item: "Replacement Tiles", quantity: "45 pieces", unitCost: 8.5, total: 382.5 },
        { item: "Tile Adhesive", quantity: "12 tubes", unitCost: 15, total: 180 },
        { item: "Underlayment Patch", quantity: "3 squares", unitCost: 12, total: 36 },
        { item: "Flashing Repair", quantity: "25 LF", unitCost: 8.5, total: 212.5 },
        { item: "Mortar Mix", quantity: "4 bags", unitCost: 12, total: 48 }
      ],
      labor: [
        { item: "Tile Removal", hours: 8, rate: 40, total: 320 },
        { item: "Repair Work", hours: 12, rate: 55, total: 660 },
        { item: "Tile Installation", hours: 10, rate: 50, total: 500 },
        { item: "Cleanup", hours: 2, rate: 40, total: 80 }
      ]
    }
  };

  const currentTemplate = estimateTemplates[selectedTemplate as keyof typeof estimateTemplates];
  const materialCost = currentTemplate.materials.reduce((sum, item) => sum + item.total, 0);
  const laborCost = currentTemplate.labor.reduce((sum, item) => sum + item.total, 0);
  const totalJobCost = materialCost + laborCost;
  
  // Standard overhead and margin calculations
  const overheadRate = 0.15; // 15% overhead
  const targetMargin = 0.30; // 30% target margin
  const overhead = totalJobCost * overheadRate;
  const totalCostWithOverhead = totalJobCost + overhead;
  
  // Calculate selling price to achieve target margin
  const sellingPrice = totalCostWithOverhead / (1 - targetMargin);
  const actualProfit = sellingPrice - totalCostWithOverhead;
  const actualMargin = (actualProfit / sellingPrice) * 100;
  
  // Commission calculation (example: 3% of gross)
  const commissionRate = 0.03;
  const salesRepPay = sellingPrice * commissionRate;

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(amount);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold gradient-primary bg-clip-text text-transparent">
            Estimate Builder
          </h1>
          <p className="text-muted-foreground">
            Parameter-driven estimates with profit guardrails
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline">
            <FileText className="h-4 w-4 mr-2" />
            Save Draft
          </Button>
          <Button className="gradient-success">
            <CheckCircle className="h-4 w-4 mr-2" />
            Send Estimate
          </Button>
        </div>
      </div>

      {/* Template Selector */}
      <Card className="shadow-soft border-0">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calculator className="h-5 w-5 text-primary" />
            Estimate Template
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-3">
            {Object.entries(estimateTemplates).map(([key, template]) => (
              <Button
                key={key}
                variant={selectedTemplate === key ? "default" : "outline"}
                onClick={() => setSelectedTemplate(key)}
                className="flex-1"
              >
                <Home className="h-4 w-4 mr-2" />
                {template.name}
              </Button>
            ))}
          </div>
          <p className="text-sm text-muted-foreground mt-3">
            {currentTemplate.description}
          </p>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Materials Breakdown */}
        <Card className="shadow-soft border-0">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Wrench className="h-5 w-5 text-secondary" />
              Materials
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {currentTemplate.materials.map((item, index) => (
              <div key={index} className="flex justify-between items-center">
                <div className="flex-1">
                  <div className="font-medium text-sm">{item.item}</div>
                  <div className="text-xs text-muted-foreground">
                    {item.quantity} × {formatCurrency(item.unitCost)}
                  </div>
                </div>
                <div className="font-semibold">
                  {formatCurrency(item.total)}
                </div>
              </div>
            ))}
            <Separator />
            <div className="flex justify-between items-center font-bold">
              <span>Material Total</span>
              <span className="text-secondary">{formatCurrency(materialCost)}</span>
            </div>
          </CardContent>
        </Card>

        {/* Labor Breakdown */}
        <Card className="shadow-soft border-0">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-primary" />
              Labor
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {currentTemplate.labor.map((item, index) => (
              <div key={index} className="flex justify-between items-center">
                <div className="flex-1">
                  <div className="font-medium text-sm">{item.item}</div>
                  <div className="text-xs text-muted-foreground">
                    {item.hours}h × {formatCurrency(item.rate)}/hr
                  </div>
                </div>
                <div className="font-semibold">
                  {formatCurrency(item.total)}
                </div>
              </div>
            ))}
            <Separator />
            <div className="flex justify-between items-center font-bold">
              <span>Labor Total</span>
              <span className="text-primary">{formatCurrency(laborCost)}</span>
            </div>
          </CardContent>
        </Card>

        {/* Profit Analysis */}
        <Card className="shadow-soft border-0">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <DollarSign className="h-5 w-5 text-success" />
              Profit Analysis
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-2">
              <div className="flex justify-between">
                <span className="text-sm">Material Cost</span>
                <span className="font-medium">{formatCurrency(materialCost)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm">Labor Cost</span>
                <span className="font-medium">{formatCurrency(laborCost)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm">Overhead ({(overheadRate * 100).toFixed(0)}%)</span>
                <span className="font-medium">{formatCurrency(overhead)}</span>
              </div>
              <Separator />
              <div className="flex justify-between">
                <span className="text-sm">Total Job Cost</span>
                <span className="font-semibold">{formatCurrency(totalCostWithOverhead)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm">Target Margin</span>
                <Badge variant="outline">{(targetMargin * 100).toFixed(0)}%</Badge>
              </div>
              <Separator />
              <div className="flex justify-between text-lg">
                <span className="font-bold">Contract Price</span>
                <span className="font-bold text-success">{formatCurrency(sellingPrice)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm">Profit Amount</span>
                <span className="font-semibold text-success">{formatCurrency(actualProfit)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm">Actual Margin</span>
                <Badge className="bg-success text-success-foreground">
                  {actualMargin.toFixed(1)}%
                </Badge>
              </div>
            </div>

            {/* Margin Warning */}
            {actualMargin < 25 && (
              <div className="p-3 bg-warning/10 border border-warning rounded-lg">
                <div className="flex items-center gap-2 text-warning">
                  <AlertTriangle className="h-4 w-4" />
                  <span className="text-sm font-medium">Low Margin Warning</span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Margin below company minimum of 25%
                </p>
              </div>
            )}

            <Separator />
            <div className="flex justify-between">
              <span className="text-sm">Sales Rep Pay ({(commissionRate * 100).toFixed(0)}%)</span>
              <span className="font-medium">{formatCurrency(salesRepPay)}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Actions */}
      <Card className="shadow-soft border-0">
        <CardContent className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-semibold">Estimate Ready for Review</h3>
              <p className="text-sm text-muted-foreground">
                All profit guardrails satisfied. Ready to send to customer.
              </p>
            </div>
            <div className="flex gap-3">
              <Button variant="outline">
                <Calculator className="h-4 w-4 mr-2" />
                Adjust Parameters
              </Button>
              <Button className="gradient-primary">
                <FileText className="h-4 w-4 mr-2" />
                Generate PDF
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default EstimatePreview;