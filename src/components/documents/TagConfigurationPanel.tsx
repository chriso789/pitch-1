/**
 * Tag Configuration Panel
 * Configures interactive tag properties like type, recipient, required status
 */

import { useState, useEffect } from "react";
import { Settings2, User, Building2, CheckSquare, FileSignature, TextCursor } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

export type TagType = "smart_tag" | "text_input" | "signature" | "checkbox" | "date_input" | "testimonial";
export type RecipientType = "system" | "homeowner" | "contractor";

export interface TagConfiguration {
  tag_key: string;
  tag_type: TagType;
  recipient_type: RecipientType;
  is_required: boolean;
  placeholder_text?: string;
  validation_rules?: {
    min_length?: number;
    max_length?: number;
    pattern?: string;
  };
  field_options?: {
    options?: string[];
    allow_multiple?: boolean;
    default_value?: string;
  };
}

interface TagConfigurationPanelProps {
  selectedTag: TagConfiguration | null;
  onConfigChange: (config: TagConfiguration) => void;
}

const TAG_TYPE_OPTIONS = [
  { value: "smart_tag", label: "Smart Tag (Auto-fill)", icon: Settings2, description: "Automatically filled from CRM data" },
  { value: "text_input", label: "Text Input Box", icon: TextCursor, description: "Recipient enters text" },
  { value: "signature", label: "Signature Field", icon: FileSignature, description: "Capture digital signature" },
  { value: "checkbox", label: "Checkbox Selection", icon: CheckSquare, description: "Yes/No or multiple choice" },
  { value: "date_input", label: "Date Field", icon: Settings2, description: "Date picker input" },
  { value: "testimonial", label: "Testimonial Box", icon: TextCursor, description: "Multi-line text for reviews" },
];

const RECIPIENT_OPTIONS = [
  { value: "system", label: "System (Auto-fill)", icon: Settings2, color: "bg-blue-500/10 text-blue-600" },
  { value: "homeowner", label: "Homeowner Must Fill", icon: User, color: "bg-green-500/10 text-green-600" },
  { value: "contractor", label: "Contractor Must Fill", icon: Building2, color: "bg-orange-500/10 text-orange-600" },
];

export function TagConfigurationPanel({ selectedTag, onConfigChange }: TagConfigurationPanelProps) {
  const [localConfig, setLocalConfig] = useState<TagConfiguration | null>(null);

  useEffect(() => {
    setLocalConfig(selectedTag);
  }, [selectedTag]);

  if (!localConfig) {
    return (
      <Card className="h-full">
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <Settings2 className="h-4 w-4" />
            Tag Configuration
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground text-center py-8">
            Select a tag on the document to configure its properties
          </p>
        </CardContent>
      </Card>
    );
  }

  const updateConfig = <K extends keyof TagConfiguration>(field: K, value: TagConfiguration[K]) => {
    const updated = { ...localConfig, [field]: value };
    setLocalConfig(updated);
    onConfigChange(updated);
  };

  const selectedTypeOption = TAG_TYPE_OPTIONS.find(t => t.value === localConfig.tag_type);
  const selectedRecipientOption = RECIPIENT_OPTIONS.find(r => r.value === localConfig.recipient_type);

  return (
    <Card className="h-full overflow-auto">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Settings2 className="h-4 w-4" />
          Configure: <code className="text-xs bg-muted px-1 rounded">{localConfig.tag_key}</code>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Tag Type */}
        <div className="space-y-2">
          <Label>Field Type</Label>
          <Select
            value={localConfig.tag_type}
            onValueChange={(value) => updateConfig("tag_type", value as TagType)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TAG_TYPE_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  <div className="flex items-center gap-2">
                    <option.icon className="h-4 w-4" />
                    <span>{option.label}</span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {selectedTypeOption && (
            <p className="text-xs text-muted-foreground">{selectedTypeOption.description}</p>
          )}
        </div>

        <Separator />

        {/* Recipient Type - only show for interactive types */}
        {localConfig.tag_type !== "smart_tag" && (
          <div className="space-y-2">
            <Label>Who Fills This Out?</Label>
            <Select
              value={localConfig.recipient_type}
              onValueChange={(value) => updateConfig("recipient_type", value as RecipientType)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RECIPIENT_OPTIONS.filter(o => o.value !== "system").map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    <div className="flex items-center gap-2">
                      <option.icon className="h-4 w-4" />
                      <span>{option.label}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedRecipientOption && (
              <Badge variant="outline" className={selectedRecipientOption.color}>
                {selectedRecipientOption.label}
              </Badge>
            )}
          </div>
        )}

        {/* Required Toggle */}
        {localConfig.tag_type !== "smart_tag" && (
          <div className="flex items-center justify-between">
            <div>
              <Label>Required Field</Label>
              <p className="text-xs text-muted-foreground">Must be completed before submission</p>
            </div>
            <Switch
              checked={localConfig.is_required}
              onCheckedChange={(checked) => updateConfig("is_required", checked)}
            />
          </div>
        )}

        <Separator />

        {/* Type-specific options */}
        {(localConfig.tag_type === "text_input" || localConfig.tag_type === "testimonial") && (
          <div className="space-y-3">
            <div className="space-y-2">
              <Label>Placeholder Text</Label>
              <Input
                value={localConfig.placeholder_text || ""}
                onChange={(e) => updateConfig("placeholder_text", e.target.value)}
                placeholder="Enter placeholder text..."
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">Min Length</Label>
                <Input
                  type="number"
                  min={0}
                  value={localConfig.validation_rules?.min_length || ""}
                  onChange={(e) =>
                    updateConfig("validation_rules", {
                      ...localConfig.validation_rules,
                      min_length: parseInt(e.target.value) || undefined,
                    })
                  }
                  placeholder="0"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Max Length</Label>
                <Input
                  type="number"
                  min={0}
                  value={localConfig.validation_rules?.max_length || ""}
                  onChange={(e) =>
                    updateConfig("validation_rules", {
                      ...localConfig.validation_rules,
                      max_length: parseInt(e.target.value) || undefined,
                    })
                  }
                  placeholder="500"
                />
              </div>
            </div>
          </div>
        )}

        {localConfig.tag_type === "checkbox" && (
          <div className="space-y-3">
            <div className="space-y-2">
              <Label>Checkbox Options</Label>
              <p className="text-xs text-muted-foreground">
                Enter each option on a new line (leave empty for single checkbox)
              </p>
              <Textarea
                value={(localConfig.field_options?.options || []).join("\n")}
                onChange={(e) =>
                  updateConfig("field_options", {
                    ...localConfig.field_options,
                    options: e.target.value.split("\n").filter(Boolean),
                  })
                }
                placeholder="Option 1&#10;Option 2&#10;Option 3"
                rows={4}
              />
            </div>
            {(localConfig.field_options?.options?.length || 0) > 1 && (
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-sm">Allow Multiple Selections</Label>
                </div>
                <Switch
                  checked={localConfig.field_options?.allow_multiple || false}
                  onCheckedChange={(checked) =>
                    updateConfig("field_options", {
                      ...localConfig.field_options,
                      allow_multiple: checked,
                    })
                  }
                />
              </div>
            )}
          </div>
        )}

        {localConfig.tag_type === "signature" && (
          <div className="space-y-2">
            <Label>Signature Type</Label>
            <p className="text-sm text-muted-foreground">
              {localConfig.recipient_type === "homeowner"
                ? "Homeowner will be prompted to sign when viewing the document"
                : "Contractor will sign during document preparation"}
            </p>
            <div className="bg-muted/50 border border-dashed rounded-lg p-4 text-center">
              <FileSignature className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
              <p className="text-xs text-muted-foreground">Signature capture area</p>
            </div>
          </div>
        )}

        {/* Preview */}
        <Separator />
        <div className="space-y-2">
          <Label>Preview</Label>
          <div className="border rounded-lg p-3 bg-muted/30">
            {renderTagPreview(localConfig)}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function renderTagPreview(config: TagConfiguration) {
  const recipientLabel = config.recipient_type === "homeowner" ? "HO" : config.recipient_type === "contractor" ? "CO" : "SYS";
  
  switch (config.tag_type) {
    case "smart_tag":
      return (
        <div className="flex items-center gap-2 text-sm">
          <Badge variant="outline" className="bg-blue-500/10 text-blue-600 border-blue-300">
            Auto-fill
          </Badge>
          <code className="text-xs">{`{{${config.tag_key}}}`}</code>
        </div>
      );
    case "text_input":
      return (
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="bg-green-500/10 text-green-600 border-green-300">
              {recipientLabel}: Text
            </Badge>
            {config.is_required && <Badge variant="destructive" className="text-xs">Required</Badge>}
          </div>
          <Input disabled placeholder={config.placeholder_text || "Enter text..."} className="h-8 text-sm" />
        </div>
      );
    case "signature":
      return (
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="bg-orange-500/10 text-orange-600 border-orange-300">
              {recipientLabel}: Signature
            </Badge>
            {config.is_required && <Badge variant="destructive" className="text-xs">Required</Badge>}
          </div>
          <div className="h-12 border-b-2 border-gray-400 flex items-end justify-center pb-1">
            <span className="text-xs text-muted-foreground italic">Sign here</span>
          </div>
        </div>
      );
    case "checkbox":
      return (
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="bg-purple-500/10 text-purple-600 border-purple-300">
              {recipientLabel}: Checkbox
            </Badge>
            {config.is_required && <Badge variant="destructive" className="text-xs">Required</Badge>}
          </div>
          {(config.field_options?.options?.length || 0) > 0 ? (
            <div className="space-y-1">
              {config.field_options?.options?.slice(0, 3).map((opt, i) => (
                <label key={i} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" disabled className="rounded" />
                  {opt}
                </label>
              ))}
            </div>
          ) : (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" disabled className="rounded" />
              Checkbox
            </label>
          )}
        </div>
      );
    case "testimonial":
      return (
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="bg-green-500/10 text-green-600 border-green-300">
              {recipientLabel}: Testimonial
            </Badge>
            {config.is_required && <Badge variant="destructive" className="text-xs">Required</Badge>}
          </div>
          <Textarea disabled placeholder={config.placeholder_text || "Share your experience..."} rows={2} className="text-sm" />
        </div>
      );
    default:
      return <code className="text-xs">{`{{${config.tag_key}}}`}</code>;
  }
}

export default TagConfigurationPanel;
