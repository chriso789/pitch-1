import React, { useState, useEffect } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Calculator, Save } from "lucide-react";

interface UserCommissionSettingsProps {
  userId: string;
  user: any;
  canEdit: boolean;
}

export const UserCommissionSettings: React.FC<UserCommissionSettingsProps> = ({
  userId,
  user,
  canEdit
}) => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [commissionType, setCommissionType] = useState<string>('percentage_selling_price');
  const [commissionRate, setCommissionRate] = useState<number>(10);
  const [companyOverheadRate, setCompanyOverheadRate] = useState<number>(15);
  const [includeOverhead, setIncludeOverhead] = useState<boolean>(false);
  const [existingPlanId, setExistingPlanId] = useState<string | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    loadUserCommission();
  }, [userId]);

  const loadUserCommission = async () => {
    try {
      setLoading(true);
      
      const { data: authUser } = await supabase.auth.getUser();
      const tenantId = authUser.user?.user_metadata?.tenant_id;

      // Load company overhead from tenant
      if (tenantId) {
        const { data: tenant } = await supabase
          .from('tenants')
          .select('company_overhead_rate')
          .eq('id', tenantId)
          .single();
        
        if (tenant?.company_overhead_rate) {
          setCompanyOverheadRate(Number(tenant.company_overhead_rate));
        }
      }
      
      // Load user's commission plan from user_commission_plans
      const { data: userPlan, error } = await supabase
        .from('user_commission_plans')
        .select(`
          *,
          commission_plans (
            id,
            name,
            commission_type,
            plan_config,
            include_overhead,
            payment_method
          )
        `)
        .eq('user_id', userId)
        .eq('is_active', true)
        .maybeSingle();

      if (error && error.code !== 'PGRST116') {
        console.error('Error loading user commission:', error);
      }

      if (userPlan?.commission_plans) {
        const plan = userPlan.commission_plans;
        const planConfig = plan.plan_config as { commission_rate?: number } | null;
        setExistingPlanId(plan.id);
        // Map database types to our simplified types
        if (plan.commission_type === 'gross_percent' || plan.payment_method === 'percentage_selling_price') {
          setCommissionType('percentage_selling_price');
        } else if (plan.commission_type === 'net_percent' || plan.payment_method === 'commission_after_costs') {
          setCommissionType('profit_split');
        } else {
          setCommissionType('percentage_selling_price');
        }
        setCommissionRate(planConfig?.commission_rate || 10);
        setIncludeOverhead(plan.include_overhead || false);
      }
    } catch (error) {
      console.error('Error loading commission settings:', error);
    } finally {
      setLoading(false);
    }
  };

  const saveCommissionSettings = async () => {
    try {
      setSaving(true);
      
      const { data: authUser } = await supabase.auth.getUser();
      const tenantId = authUser.user?.user_metadata?.tenant_id;

      // Save company overhead to tenant
      if (tenantId) {
        await supabase
          .from('tenants')
          .update({ company_overhead_rate: companyOverheadRate })
          .eq('id', tenantId);
      }

      // Create or update commission plan for this user
      const planName = `${user.first_name} ${user.last_name} - Commission Plan`;
      const dbCommissionType = commissionType === 'profit_split' ? 'net_percent' : 'gross_percent';
      const dbPaymentMethod = commissionType === 'profit_split' ? 'commission_after_costs' : 'percentage_selling_price';

      // Upsert the commission plan
      const planData = {
        name: planName,
        commission_type: dbCommissionType,
        plan_config: {
          commission_rate: commissionRate,
          description: `Personal commission plan for ${user.first_name} ${user.last_name}`
        },
        include_overhead: includeOverhead,
        payment_method: dbPaymentMethod,
        tenant_id: tenantId,
        is_active: true,
        created_by: authUser.user?.id
      };

      let planId = existingPlanId;

      if (existingPlanId) {
        // Update existing plan
        const { error: updateError } = await supabase
          .from('commission_plans')
          .update(planData)
          .eq('id', existingPlanId);
        
        if (updateError) throw updateError;
      } else {
        // Create new plan
        const { data: newPlan, error: insertError } = await supabase
          .from('commission_plans')
          .insert(planData)
          .select('id')
          .single();
        
        if (insertError) throw insertError;
        planId = newPlan.id;

        // Link user to the plan
        const { error: linkError } = await supabase
          .from('user_commission_plans')
          .upsert({
            user_id: userId,
            commission_plan_id: planId,
            tenant_id: tenantId,
            is_active: true
          }, {
            onConflict: 'user_id,commission_plan_id'
          });

        if (linkError) throw linkError;
        setExistingPlanId(planId);
      }

      toast({
        title: "Commission Settings Saved",
        description: "Commission configuration has been updated successfully.",
      });
    } catch (error) {
      console.error('Error saving commission settings:', error);
      toast({
        title: "Error",
        description: "Failed to save commission settings.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  // Calculate example commission with full breakdown
  // Industry standard: Materials ~32.5%, Labor ~32.5% = 65% combined
  const exampleContractValue = 50000;
  const materialsRate = 0.325; // 32.5% materials
  const laborRate = 0.325; // 32.5% labor
  const companyOverheadDefault = 0.15; // 15% company overhead (internal default)
  
  const calculateProfitBreakdown = () => {
    const materialsCost = exampleContractValue * materialsRate;
    const laborCost = exampleContractValue * laborRate;
    const totalJobCosts = materialsCost + laborCost;
    const overheadCost = exampleContractValue * companyOverheadDefault;
    
    const grossProfit = exampleContractValue - totalJobCosts;
    const netProfit = grossProfit - overheadCost;
    
    let commission = 0;
    if (commissionType === 'percentage_selling_price') {
      commission = (exampleContractValue * commissionRate) / 100;
    } else {
      commission = (netProfit * commissionRate) / 100;
    }
    
    return {
      contractValue: exampleContractValue,
      materialsCost,
      laborCost,
      totalJobCosts,
      overheadCost,
      grossProfit,
      netProfit,
      commission
    };
  };

  const breakdown = calculateProfitBreakdown();

  if (loading) {
    return <div className="text-center py-4">Loading commission settings...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4">
        <div className="space-y-2">
          <Label htmlFor="commission-type">Commission Type</Label>
          <Select 
            value={commissionType} 
            onValueChange={setCommissionType}
            disabled={!canEdit}
          >
            <SelectTrigger id="commission-type">
              <SelectValue placeholder="Select commission type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="percentage_selling_price">Percent of Selling Price</SelectItem>
              <SelectItem value="profit_split">Profit Split</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-sm text-muted-foreground">
            {commissionType === 'percentage_selling_price' 
              ? 'Commission calculated as a percentage of total contract value'
              : 'Commission calculated as a percentage of profit (after costs & overhead)'}
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="commission-rate">Commission Rate (%)</Label>
          <Input
            id="commission-rate"
            type="number"
            step="0.5"
            min="0"
            max="100"
            value={commissionRate}
            onChange={(e) => setCommissionRate(parseFloat(e.target.value) || 0)}
            disabled={!canEdit}
          />
        </div>

      </div>

      {/* Example Calculation with Full Breakdown */}
      <Card className="bg-muted/30">
        <CardContent className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <Calculator className="h-4 w-4 text-primary" />
            <h4 className="font-medium">Example Calculation</h4>
          </div>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Contract Value:</span>
              <span className="font-medium">${breakdown.contractValue.toLocaleString()}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Materials (~32.5%):</span>
              <span className="font-medium text-destructive">-${breakdown.materialsCost.toLocaleString()}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Labor (~32.5%):</span>
              <span className="font-medium text-destructive">-${breakdown.laborCost.toLocaleString()}</span>
            </div>
            <hr className="border-border" />
            <div className="flex justify-between">
              <span className="text-muted-foreground">Gross Profit (35%):</span>
              <span className="font-medium">${breakdown.grossProfit.toLocaleString()}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Company Overhead (15%):</span>
              <span className="font-medium text-destructive">-${breakdown.overheadCost.toLocaleString()}</span>
            </div>
            <hr className="border-border" />
            <div className="flex justify-between">
              <span className="text-muted-foreground">Net Profit (20%):</span>
              <span className="font-medium">${breakdown.netProfit.toLocaleString()}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Commission Rate:</span>
              <span className="font-medium">{commissionRate}%</span>
            </div>
            {commissionType === 'profit_split' && (
              <p className="text-xs text-muted-foreground italic">
                (Applied to Net Profit)
              </p>
            )}
            {commissionType === 'percentage_selling_price' && (
              <p className="text-xs text-muted-foreground italic">
                (Applied to Contract Value)
              </p>
            )}
            <hr className="border-border" />
            <div className="flex justify-between text-base">
              <span className="font-medium">Commission Earned:</span>
              <span className="font-bold text-primary">${breakdown.commission.toLocaleString()}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {canEdit && (
        <Button onClick={saveCommissionSettings} disabled={saving} className="w-full">
          <Save className="h-4 w-4 mr-2" />
          {saving ? "Saving..." : "Save Commission Settings"}
        </Button>
      )}
    </div>
  );
};