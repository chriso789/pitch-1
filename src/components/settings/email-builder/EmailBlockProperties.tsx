import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { EMAIL_BLOCKS } from "./emailBlocks";

interface PlacedBlock {
  id: string;
  type: string;
  props: Record<string, any>;
}

interface EmailBlockPropertiesProps {
  block: PlacedBlock;
  onUpdate: (props: Record<string, any>) => void;
}

const GRADIENT_PRESETS = [
  { label: 'Navy Blue', value: 'linear-gradient(135deg, #1e3a5f 0%, #2d5a87 100%)' },
  { label: 'Purple', value: 'linear-gradient(135deg, #7c3aed 0%, #a855f7 100%)' },
  { label: 'Green', value: 'linear-gradient(135deg, #059669 0%, #10b981 100%)' },
  { label: 'Red', value: 'linear-gradient(135deg, #dc2626 0%, #f87171 100%)' },
  { label: 'Amber', value: 'linear-gradient(135deg, #f59e0b 0%, #fbbf24 100%)' },
  { label: 'Cyan', value: 'linear-gradient(135deg, #0891b2 0%, #22d3ee 100%)' },
  { label: 'Indigo', value: 'linear-gradient(135deg, #4f46e5 0%, #818cf8 100%)' },
  { label: 'Teal', value: 'linear-gradient(135deg, #0f766e 0%, #14b8a6 100%)' },
];

export function EmailBlockProperties({ block, onUpdate }: EmailBlockPropertiesProps) {
  const blockDef = EMAIL_BLOCKS[block.type];
  if (!blockDef) return null;

  const updateProp = (key: string, value: any) => {
    onUpdate({ ...block.props, [key]: value });
  };

  const renderField = (key: string, value: any) => {
    // Handle special fields
    if (key === 'bgGradient') {
      return (
        <div key={key} className="space-y-1.5">
          <Label className="text-xs">Background Gradient</Label>
          <Select value={value} onValueChange={(v) => updateProp(key, v)}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {GRADIENT_PRESETS.map(preset => (
                <SelectItem key={preset.value} value={preset.value} className="text-xs">
                  <div className="flex items-center gap-2">
                    <div 
                      className="w-4 h-4 rounded" 
                      style={{ background: preset.value }}
                    />
                    {preset.label}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      );
    }

    if (key === 'type' && block.type === 'alert') {
      return (
        <div key={key} className="space-y-1.5">
          <Label className="text-xs">Alert Type</Label>
          <Select value={value} onValueChange={(v) => updateProp(key, v)}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="info">Info (Blue)</SelectItem>
              <SelectItem value="success">Success (Green)</SelectItem>
              <SelectItem value="warning">Warning (Yellow)</SelectItem>
              <SelectItem value="error">Error (Red)</SelectItem>
            </SelectContent>
          </Select>
        </div>
      );
    }

    if (key === 'level' && block.type === 'heading') {
      return (
        <div key={key} className="space-y-1.5">
          <Label className="text-xs">Heading Level</Label>
          <Select value={value} onValueChange={(v) => updateProp(key, v)}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="h2">H2 - Large</SelectItem>
              <SelectItem value="h3">H3 - Medium</SelectItem>
            </SelectContent>
          </Select>
        </div>
      );
    }

    // Skip complex nested objects/arrays for now
    if (typeof value === 'object') return null;

    // Color fields
    if (key.toLowerCase().includes('color') && !key.includes('Gradient')) {
      return (
        <div key={key} className="space-y-1.5">
          <Label className="text-xs capitalize">{key.replace(/([A-Z])/g, ' $1').trim()}</Label>
          <div className="flex gap-2">
            <Input
              type="color"
              value={value}
              onChange={(e) => updateProp(key, e.target.value)}
              className="w-10 h-8 p-1 cursor-pointer"
            />
            <Input
              value={value}
              onChange={(e) => updateProp(key, e.target.value)}
              className="h-8 text-xs flex-1"
              placeholder="#000000"
            />
          </div>
        </div>
      );
    }

    // Number fields
    if (key === 'height' || key === 'thickness' || key === 'fontSize') {
      return (
        <div key={key} className="space-y-1.5">
          <Label className="text-xs capitalize">{key.replace(/([A-Z])/g, ' $1').trim()}</Label>
          <Input
            type="number"
            value={value}
            onChange={(e) => updateProp(key, e.target.value)}
            className="h-8 text-xs"
          />
        </div>
      );
    }

    // Long text fields
    if (key === 'content' || key === 'quote' || key === 'message' || key === 'leftContent' || key === 'rightContent') {
      return (
        <div key={key} className="space-y-1.5">
          <Label className="text-xs capitalize">{key.replace(/([A-Z])/g, ' $1').trim()}</Label>
          <Textarea
            value={value}
            onChange={(e) => updateProp(key, e.target.value)}
            className="text-xs min-h-[60px] resize-none"
          />
        </div>
      );
    }

    // Default text input
    return (
      <div key={key} className="space-y-1.5">
        <Label className="text-xs capitalize">{key.replace(/([A-Z])/g, ' $1').trim()}</Label>
        <Input
          value={value}
          onChange={(e) => updateProp(key, e.target.value)}
          className="h-8 text-xs"
        />
      </div>
    );
  };

  return (
    <ScrollArea className="h-[200px]">
      <div className="space-y-3 pr-3">
        {Object.entries(block.props).map(([key, value]) => renderField(key, value))}
      </div>
    </ScrollArea>
  );
}
