import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/components/ui/use-toast";
import { DollarSign } from "lucide-react";

interface EstimateSummarySlideEditorProps {
  slide: any;
  onUpdate: () => void;
}

export const EstimateSummarySlideEditor = ({
  slide,
  onUpdate,
}: EstimateSummarySlideEditorProps) => {
  const { toast } = useToast();
  const [estimateId, setEstimateId] = useState(slide.content?.estimate_id || "");
  const [showMaterials, setShowMaterials] = useState(
    slide.content?.show_materials ?? true
  );
  const [showLabor, setShowLabor] = useState(slide.content?.show_labor ?? true);
  const [showProfit, setShowProfit] = useState(slide.content?.show_profit ?? true);

  const { data: estimates } = useQuery({
    queryKey: ["estimates"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("enhanced_estimates")
        .select("id, estimate_number, customer_name, selling_price")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data;
    },
  });

  const { data: estimate } = useQuery({
    queryKey: ["estimate", estimateId],
    queryFn: async () => {
      if (!estimateId) return null;
      const { data, error } = await supabase
        .from("enhanced_estimates")
        .select("*")
        .eq("id", estimateId)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!estimateId,
  });

  useEffect(() => {
    setEstimateId(slide.content?.estimate_id || "");
    setShowMaterials(slide.content?.show_materials ?? true);
    setShowLabor(slide.content?.show_labor ?? true);
    setShowProfit(slide.content?.show_profit ?? true);
  }, [slide.id]);

  const handleUpdate = async (updates: any) => {
    try {
      const updatedContent = {
        ...slide.content,
        ...updates,
      };

      const { error } = await supabase
        .from("presentation_slides")
        .update({ content: updatedContent })
        .eq("id", slide.id);

      if (error) throw error;
      onUpdate();
    } catch (error: any) {
      console.error("Error updating slide:", error);
      toast({
        title: "Failed to update",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(value);
  };

  return (
    <div className="space-y-6">
      <Card className="p-8">
        {estimate ? (
          <div className="space-y-6">
            <div className="text-center">
              <h2 className="text-3xl font-bold mb-2">Project Estimate</h2>
              <p className="text-xl text-muted-foreground">
                {estimate.customer_name}
              </p>
            </div>

            <div className="space-y-4">
              {showMaterials && (
                <div className="flex justify-between items-center py-3 border-b">
                  <span className="text-lg">Materials</span>
                  <span className="text-lg font-semibold">
                    {formatCurrency(estimate.material_cost)}
                  </span>
                </div>
              )}
              {showLabor && (
                <div className="flex justify-between items-center py-3 border-b">
                  <span className="text-lg">Labor</span>
                  <span className="text-lg font-semibold">
                    {formatCurrency(estimate.labor_cost)}
                  </span>
                </div>
              )}
              {showProfit && (
                <div className="flex justify-between items-center py-3 border-b">
                  <span className="text-lg">Profit Margin</span>
                  <span className="text-lg font-semibold">
                    {estimate.actual_profit_percent?.toFixed(1)}%
                  </span>
                </div>
              )}
              <div className="flex justify-between items-center py-4 bg-primary/5 px-4 rounded-lg">
                <span className="text-2xl font-bold">Total Investment</span>
                <span className="text-2xl font-bold text-primary">
                  {formatCurrency(estimate.selling_price)}
                </span>
              </div>
            </div>
          </div>
        ) : (
          <div className="text-center py-12 text-muted-foreground">
            <DollarSign className="h-16 w-16 mx-auto mb-4 opacity-50" />
            <p>Select an estimate to display</p>
          </div>
        )}
      </Card>

      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="estimate">Select Estimate</Label>
          <Select
            value={estimateId}
            onValueChange={(value) => {
              setEstimateId(value);
              handleUpdate({ estimate_id: value });
            }}
          >
            <SelectTrigger id="estimate">
              <SelectValue placeholder="Choose an estimate" />
            </SelectTrigger>
            <SelectContent>
              {estimates?.map((est) => (
                <SelectItem key={est.id} value={est.id}>
                  {est.estimate_number} - {est.customer_name} (
                  {formatCurrency(est.selling_price)})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-3">
          <Label>Display Options</Label>
          <div className="space-y-2">
            <div className="flex items-center space-x-2">
              <Checkbox
                id="show-materials"
                checked={showMaterials}
                onCheckedChange={(checked) => {
                  setShowMaterials(checked as boolean);
                  handleUpdate({ show_materials: checked });
                }}
              />
              <label htmlFor="show-materials" className="text-sm">
                Show Materials Cost
              </label>
            </div>
            <div className="flex items-center space-x-2">
              <Checkbox
                id="show-labor"
                checked={showLabor}
                onCheckedChange={(checked) => {
                  setShowLabor(checked as boolean);
                  handleUpdate({ show_labor: checked });
                }}
              />
              <label htmlFor="show-labor" className="text-sm">
                Show Labor Cost
              </label>
            </div>
            <div className="flex items-center space-x-2">
              <Checkbox
                id="show-profit"
                checked={showProfit}
                onCheckedChange={(checked) => {
                  setShowProfit(checked as boolean);
                  handleUpdate({ show_profit: checked });
                }}
              />
              <label htmlFor="show-profit" className="text-sm">
                Show Profit Margin
              </label>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
