import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/components/ui/use-toast";
import { Plus, Trash2 } from "lucide-react";

interface PricingOption {
  tier: string;
  name: string;
  price: string;
  features: string[];
  recommended?: boolean;
  badge?: string;
}

interface PricingComparisonSlideEditorProps {
  slide: any;
  onUpdate: () => void;
}

export function PricingComparisonSlideEditor({ slide, onUpdate }: PricingComparisonSlideEditorProps) {
  const { toast } = useToast();
  const [title, setTitle] = useState(slide.content?.title || "Your Investment Options");
  const [options, setOptions] = useState<PricingOption[]>(
    slide.content?.options || [
      {
        tier: "good",
        name: "Standard Protection",
        price: "{{estimate.good_price}}",
        features: ["25-year shingles", "Standard underlayment", "5-year workmanship warranty"],
        recommended: false,
      },
      {
        tier: "better",
        name: "Enhanced Protection",
        price: "{{estimate.better_price}}",
        features: ["30-year shingles", "Peel & stick underlayment", "10-year workmanship warranty"],
        recommended: true,
        badge: "Most Popular",
      },
      {
        tier: "best",
        name: "Premium Protection",
        price: "{{estimate.best_price}}",
        features: ["50-year shingles", "Full synthetic underlayment", "Lifetime workmanship warranty"],
        recommended: false,
      },
    ]
  );

  useEffect(() => {
    setTitle(slide.content?.title || "Your Investment Options");
    setOptions(slide.content?.options || options);
  }, [slide.id]);

  const handleUpdate = async () => {
    try {
      const { error } = await supabase
        .from("presentation_slides")
        .update({
          content: {
            ...slide.content,
            title,
            options,
          },
        })
        .eq("id", slide.id);

      if (error) throw error;
      onUpdate();
    } catch (error: any) {
      toast({
        title: "Error saving slide",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const updateOption = (index: number, updates: Partial<PricingOption>) => {
    const newOptions = [...options];
    newOptions[index] = { ...newOptions[index], ...updates };
    setOptions(newOptions);
  };

  const updateFeature = (optionIndex: number, featureIndex: number, value: string) => {
    const newOptions = [...options];
    newOptions[optionIndex].features[featureIndex] = value;
    setOptions(newOptions);
  };

  const addFeature = (optionIndex: number) => {
    const newOptions = [...options];
    newOptions[optionIndex].features.push("New feature");
    setOptions(newOptions);
  };

  const removeFeature = (optionIndex: number, featureIndex: number) => {
    const newOptions = [...options];
    newOptions[optionIndex].features = newOptions[optionIndex].features.filter(
      (_, i) => i !== featureIndex
    );
    setOptions(newOptions);
  };

  return (
    <div className="space-y-6">
      {/* Preview */}
      <Card className="p-6 bg-gradient-to-br from-background to-muted">
        <h2 className="text-2xl font-bold text-center mb-6">{title}</h2>
        <div className="grid grid-cols-3 gap-4">
          {options.map((option, i) => (
            <Card
              key={i}
              className={`p-4 text-center ${option.recommended ? "ring-2 ring-primary" : ""}`}
            >
              {option.badge && (
                <div className="bg-primary text-primary-foreground px-2 py-0.5 rounded-full text-xs font-medium inline-block mb-2">
                  {option.badge}
                </div>
              )}
              <h3 className="font-semibold">{option.name}</h3>
              <p className="text-lg font-bold text-primary">{option.price}</p>
              <ul className="text-xs text-left mt-2 space-y-1">
                {option.features.slice(0, 2).map((f, j) => (
                  <li key={j} className="flex items-start gap-1">
                    <span className="text-primary">✓</span>
                    <span className="truncate">{f}</span>
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      </Card>

      {/* Editor */}
      <div className="space-y-4">
        <div className="space-y-2">
          <Label>Section Title</Label>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={handleUpdate}
            placeholder="Your Investment Options"
          />
        </div>

        {/* Pricing Options */}
        {options.map((option, index) => (
          <Card key={index} className="p-4">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h4 className="font-medium capitalize">{option.tier} Option</h4>
                <div className="flex items-center gap-2">
                  <Label className="text-xs">Recommended</Label>
                  <Switch
                    checked={option.recommended}
                    onCheckedChange={(checked) => {
                      updateOption(index, { recommended: checked });
                      handleUpdate();
                    }}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Name</Label>
                  <Input
                    value={option.name}
                    onChange={(e) => updateOption(index, { name: e.target.value })}
                    onBlur={handleUpdate}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Price (or variable)</Label>
                  <Input
                    value={option.price}
                    onChange={(e) => updateOption(index, { price: e.target.value })}
                    onBlur={handleUpdate}
                    placeholder="$15,000 or {{estimate.good_price}}"
                  />
                </div>
                {option.recommended && (
                  <div className="col-span-2 space-y-1">
                    <Label className="text-xs">Badge Text</Label>
                    <Input
                      value={option.badge || ""}
                      onChange={(e) => updateOption(index, { badge: e.target.value })}
                      onBlur={handleUpdate}
                      placeholder="Most Popular"
                    />
                  </div>
                )}
              </div>

              {/* Features */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs">Features</Label>
                  <Button variant="ghost" size="sm" onClick={() => addFeature(index)}>
                    <Plus className="h-3 w-3 mr-1" />
                    Add
                  </Button>
                </div>
                {option.features.map((feature, fIndex) => (
                  <div key={fIndex} className="flex items-center gap-2">
                    <Input
                      value={feature}
                      onChange={(e) => updateFeature(index, fIndex, e.target.value)}
                      onBlur={handleUpdate}
                      className="flex-1"
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive"
                      onClick={() => {
                        removeFeature(index, fIndex);
                        handleUpdate();
                      }}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          </Card>
        ))}

        <p className="text-xs text-muted-foreground">
          💡 Tip: Use variables like <code className="bg-muted px-1 rounded">{"{{estimate.good_price}}"}</code> for dynamic pricing
        </p>
      </div>
    </div>
  );
}
