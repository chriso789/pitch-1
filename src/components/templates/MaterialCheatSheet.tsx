import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
  Calculator, 
  ChevronDown, 
  ChevronUp, 
  Copy, 
  FileText,
  Info
} from 'lucide-react';
import { 
  ROOF_TYPE_CHEAT_SHEETS, 
  SAMPLE_MEASUREMENTS,
  RoofMeasurements,
  getAvailableCheatSheets 
} from '@/data/roofTypeCheatSheets';
import { toast } from 'sonner';

interface MaterialCheatSheetProps {
  defaultRoofType?: string;
  compact?: boolean;
}

export const MaterialCheatSheet: React.FC<MaterialCheatSheetProps> = ({
  defaultRoofType = 'shingle',
  compact = false,
}) => {
  const [selectedType, setSelectedType] = useState(defaultRoofType);
  const [isOpen, setIsOpen] = useState(!compact);
  const [measurements, setMeasurements] = useState<RoofMeasurements>(SAMPLE_MEASUREMENTS);
  const [showCalculator, setShowCalculator] = useState(false);

  const cheatSheet = ROOF_TYPE_CHEAT_SHEETS[selectedType];
  const availableTypes = getAvailableCheatSheets();

  const handleCopyFormula = (formula: string) => {
    navigator.clipboard.writeText(formula);
    toast.success('Formula copied to clipboard');
  };

  const updateMeasurement = (key: keyof RoofMeasurements, value: string) => {
    const numValue = parseFloat(value) || 0;
    setMeasurements(prev => ({ ...prev, [key]: numValue }));
    // Also update sqft when squares changes
    if (key === 'squares') {
      setMeasurements(prev => ({ ...prev, sqft: numValue * 100 }));
    }
  };

  if (!cheatSheet) return null;

  const content = (
    <div className="space-y-4">
      {/* Roof Type Selector */}
      <div className="flex items-center gap-4">
        <div className="flex-1">
          <Select value={selectedType} onValueChange={setSelectedType}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {availableTypes.map((type) => (
                <SelectItem key={type.value} value={type.value}>
                  {type.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowCalculator(!showCalculator)}
        >
          <Calculator className="h-4 w-4 mr-1" />
          Calc
        </Button>
      </div>

      {/* Description */}
      <div className="flex items-start gap-2 p-3 bg-muted/50 rounded-lg text-sm">
        <Info className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
        <div>
          <p className="text-muted-foreground">{cheatSheet.description}</p>
          <p className="text-xs text-muted-foreground mt-1">
            <strong>Waste:</strong> {cheatSheet.wasteRecommendation}
          </p>
        </div>
      </div>

      {/* Quick Calculator */}
      {showCalculator && (
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-sm">Quick Calculator</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-3 gap-3 py-2">
            <div>
              <Label className="text-xs">Squares</Label>
              <Input
                type="number"
                value={measurements.squares}
                onChange={(e) => updateMeasurement('squares', e.target.value)}
                className="h-8"
              />
            </div>
            <div>
              <Label className="text-xs">Ridge LF</Label>
              <Input
                type="number"
                value={measurements.ridgeLF}
                onChange={(e) => updateMeasurement('ridgeLF', e.target.value)}
                className="h-8"
              />
            </div>
            <div>
              <Label className="text-xs">Hip LF</Label>
              <Input
                type="number"
                value={measurements.hipLF}
                onChange={(e) => updateMeasurement('hipLF', e.target.value)}
                className="h-8"
              />
            </div>
            <div>
              <Label className="text-xs">Eave LF</Label>
              <Input
                type="number"
                value={measurements.eaveLF}
                onChange={(e) => updateMeasurement('eaveLF', e.target.value)}
                className="h-8"
              />
            </div>
            <div>
              <Label className="text-xs">Rake LF</Label>
              <Input
                type="number"
                value={measurements.rakeLF}
                onChange={(e) => updateMeasurement('rakeLF', e.target.value)}
                className="h-8"
              />
            </div>
            <div>
              <Label className="text-xs">Pipe Vents</Label>
              <Input
                type="number"
                value={measurements.pipeVents}
                onChange={(e) => updateMeasurement('pipeVents', e.target.value)}
                className="h-8"
              />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Material List */}
      <ScrollArea className={compact ? 'h-[300px]' : 'h-auto max-h-[500px]'}>
        <div className="space-y-2">
          {cheatSheet.items.map((item, index) => (
            <div
              key={index}
              className="flex items-start justify-between p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm truncate">
                    {item.material}
                  </span>
                  <Badge variant="secondary" className="text-xs shrink-0">
                    {item.unit}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {item.coverage}
                </p>
                <p className="text-xs text-primary font-mono mt-1">
                  {item.exampleCalc(measurements.squares, measurements)}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0"
                onClick={() => handleCopyFormula(item.formula)}
                title="Copy formula"
              >
                <Copy className="h-3 w-3" />
              </Button>
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );

  if (compact) {
    return (
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CollapsibleTrigger asChild>
          <Button
            variant="outline"
            className="w-full justify-between"
          >
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4" />
              <span>Material Cheat Sheet</span>
            </div>
            {isOpen ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-2">
          <Card>
            <CardContent className="pt-4">
              {content}
            </CardContent>
          </Card>
        </CollapsibleContent>
      </Collapsible>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <FileText className="h-5 w-5" />
          Material Cheat Sheet
        </CardTitle>
      </CardHeader>
      <CardContent>
        {content}
      </CardContent>
    </Card>
  );
};

export default MaterialCheatSheet;
