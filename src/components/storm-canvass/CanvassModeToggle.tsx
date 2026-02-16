import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Footprints, Hand } from "lucide-react";

export type CanvassMapMode = 'knock' | 'canvas';

interface CanvassModeToggleProps {
  mode: CanvassMapMode;
  onModeChange: (mode: CanvassMapMode) => void;
}

export default function CanvassModeToggle({ mode, onModeChange }: CanvassModeToggleProps) {
  return (
    <ToggleGroup
      type="single"
      value={mode}
      onValueChange={(val) => {
        if (val) onModeChange(val as CanvassMapMode);
      }}
      className="bg-background/90 backdrop-blur-sm rounded-lg p-0.5 shadow-lg border border-border/50"
    >
      <ToggleGroupItem
        value="knock"
        aria-label="Knock Mode"
        className="text-xs px-2.5 py-1 h-7 gap-1 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground rounded-sm"
      >
        <Footprints className="h-3.5 w-3.5" />
        Knock
      </ToggleGroupItem>
      <ToggleGroupItem
        value="canvas"
        aria-label="Canvas Mode"
        className="text-xs px-2.5 py-1 h-7 gap-1 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground rounded-sm"
      >
        <Hand className="h-3.5 w-3.5" />
        Canvas
      </ToggleGroupItem>
    </ToggleGroup>
  );
}
