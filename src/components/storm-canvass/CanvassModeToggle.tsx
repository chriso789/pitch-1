import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { MapPinPlus } from "lucide-react";

interface CanvassModeToggleProps {
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
}

export default function CanvassModeToggle({ enabled, onToggle }: CanvassModeToggleProps) {
  return (
    <div className="flex items-center gap-2">
      <MapPinPlus className="h-4 w-4 text-muted-foreground" />
      <Label htmlFor="canvass-mode" className="text-xs font-medium cursor-pointer">
        Canvass Mode
      </Label>
      <Switch
        id="canvass-mode"
        checked={enabled}
        onCheckedChange={onToggle}
        className="scale-90"
      />
    </div>
  );
}
