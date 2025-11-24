import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { X, Trash2, Mountain, Triangle, ArrowDownUp } from "lucide-react";
import { toast } from "sonner";

interface LinePropertiesPanelProps {
  lineType: string;
  lineIndex: number;
  lineData: any;
  onChangeType: (oldType: string, lineIndex: number, newType: string) => void;
  onDelete: (type: string, lineIndex: number) => void;
  onClose: () => void;
}

export function LinePropertiesPanel({
  lineType,
  lineIndex,
  lineData,
  onChangeType,
  onDelete,
  onClose,
}: LinePropertiesPanelProps) {
  const length = lineData?.length || 0;
  
  const handleTypeChange = (newType: string) => {
    if (newType !== lineType) {
      onChangeType(lineType, lineIndex, newType);
    }
  };

  const handleDelete = () => {
    onDelete(lineType, lineIndex);
    onClose();
  };

  const getLineColor = (type: string) => {
    switch (type) {
      case 'ridge': return 'text-green-500';
      case 'hip': return 'text-blue-500';
      case 'valley': return 'text-red-500';
      default: return 'text-foreground';
    }
  };

  const getLineIcon = (type: string) => {
    switch (type) {
      case 'ridge': return <Mountain className="h-4 w-4" />;
      case 'hip': return <Triangle className="h-4 w-4" />;
      case 'valley': return <ArrowDownUp className="h-4 w-4" />;
      default: return null;
    }
  };

  return (
    <Card className="mt-4 border-primary">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <span className={getLineColor(lineType)}>
              {getLineIcon(lineType)}
            </span>
            {lineType.charAt(0).toUpperCase() + lineType.slice(1)} Line Properties
          </CardTitle>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label className="text-sm font-medium">Length</Label>
          <div className="text-2xl font-bold">
            {Math.round(length)} ft
          </div>
        </div>

        <div className="space-y-2">
          <Label className="text-sm font-medium">Line Type</Label>
          <RadioGroup value={lineType} onValueChange={handleTypeChange}>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="ridge" id="ridge" />
              <Label htmlFor="ridge" className="flex items-center gap-2 cursor-pointer font-normal">
                <Mountain className="h-4 w-4 text-green-500" />
                Ridge
              </Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="hip" id="hip" />
              <Label htmlFor="hip" className="flex items-center gap-2 cursor-pointer font-normal">
                <Triangle className="h-4 w-4 text-blue-500" />
                Hip
              </Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="valley" id="valley" />
              <Label htmlFor="valley" className="flex items-center gap-2 cursor-pointer font-normal">
                <ArrowDownUp className="h-4 w-4 text-red-500" />
                Valley
              </Label>
            </div>
          </RadioGroup>
        </div>

        <div className="pt-2 border-t">
          <Button
            variant="destructive"
            size="sm"
            className="w-full"
            onClick={handleDelete}
          >
            <Trash2 className="h-4 w-4 mr-2" />
            Delete Line
          </Button>
        </div>

        <div className="text-xs text-muted-foreground">
          <p>💡 Tip: Right-click any line to delete it quickly</p>
        </div>
      </CardContent>
    </Card>
  );
}
