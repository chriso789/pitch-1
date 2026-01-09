import React, { useState, useEffect } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Calculator, Save, Users, AlertTriangle } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { ManagerOverrideCalculator } from "./ManagerOverrideCalculator";

interface UserCommissionSettingsProps {
  userId: string;
  user: any;
  canEdit: boolean;
}

const MANAGER_ROLES = ['owner', 'sales_manager', 'regional_manager', 'project_manager', 'office_admin', 'corporate', 'master'] as const;
type ManagerRole = typeof MANAGER_ROLES[number];

export const UserCommissionSettings: React.FC<UserCommissionSettingsProps> = ({
  userId,
  user,
  canEdit
}) => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [commissionType, setCommissionType] = useState<string>('profit_split');
  const [commissionRate, setCommissionRate] = useState<number>(10);
  const [repOverheadRate, setRepOverheadRate] = useState<number>(15);
  const [managerOverrideRate, setManagerOverrideRate] = useState<number>(0);
  const [reportsToManagerId, setReportsToManagerId] = useState<string | null>(null);
  const [existingPlanId, setExistingPlanId] = useState<string | null>(null);
  const [tenantId, setTenantId] = useState<string | null>(null);
  
  // New manager override configuration state
  const [overrideAppliesTo, setOverrideAppliesTo] = useState<string>('assigned_reps');
  const [overrideBasis, setOverrideBasis] = useState<string>('contract_value');
  const [overrideMinProfitPercent, setOverrideMinProfitPercent] = useState<number>(0);
  const [overrideSelectedReps, setOverrideSelectedReps] = useState<string[]>([]);
  const [overrideLocationId, setOverrideLocationId] = useState<string | null>(null);
  
  const { toast } = useToast();

  // Check if user is a manager role
  const isManager = MANAGER_ROLES.includes(user?.role);

  // Fetch managers for the "Reports To" dropdown
  const { data: managers } = useQuery({
    queryKey: ['managers-list', tenantId],
    queryFn: async () => {
      if (!tenantId) return [];
      const { data, error } = await supabase
        .from('profiles')
        .select('id, first_name, last_name, role')
        .eq('tenant_id', tenantId)
        .in('role', MANAGER_ROLES)
        .neq('id', userId);
      
      if (error) throw error;
      return data || [];
    },
    enabled: !!tenantId && !isManager
  });

  // Fetch all reps for selection (when override applies to selected_reps)
  const { data: allReps } = useQuery({
    queryKey: ['all-reps-list', tenantId],
    queryFn: async () => {
      if (!tenantId) return [];
      const { data, error } = await supabase
        .from('profiles')
        .select('id, first_name, last_name, role')
        .eq('tenant_id', tenantId)
        .not('role', 'in', `(${MANAGER_ROLES.join(',')})`)
        .neq('id', userId);
      
      if (error) throw error;
      return data || [];
    },
    enabled: !!tenantId && isManager && managerOverrideRate > 0
  });

  // Fetch locations for location-based override
  const { data: locations } = useQuery({
    queryKey: ['locations-list', tenantId],
    queryFn: async () => {
      if (!tenantId) return [];
      const { data, error } = await (supabase as any)
        .from('locations')
        .select('id, name')
        .eq('tenant_id', tenantId)
        .eq('active', true);
      
      if (error) throw error;
      return (data || []) as { id: string; name: string }[];
    },
    enabled: !!tenantId && isManager && managerOverrideRate > 0
  });

  useEffect(() => {
    loadUserCommission();
  }, [userId]);

  const loadUserCommission = async () => {
    try {
      setLoading(true);
      
      const { data: authUser } = await supabase.auth.getUser();
      const userTenantId = authUser.user?.user_metadata?.tenant_id;
      setTenantId(userTenantId);

      // Load rep's profile data including manager override settings
      const { data: profile } = await supabase
        .from('profiles')
        .select('personal_overhead_rate, manager_override_rate, reports_to_manager_id, manager_override_applies_to, manager_override_basis, manager_override_min_profit_percent, manager_override_selected_reps, manager_override_location_id')
        .eq('id', userId)
        .single();
      
      if (profile) {
        if (profile.personal_overhead_rate !== null && profile.personal_overhead_rate !== undefined) {
          setRepOverheadRate(Number(profile.personal_overhead_rate));
        }
        if (profile.manager_override_rate !== null && profile.manager_override_rate !== undefined) {
          setManagerOverrideRate(Number(profile.manager_override_rate));
        }
        if (profile.reports_to_manager_id) {
          setReportsToManagerId(profile.reports_to_manager_id);
        }
        // Load new override configuration fields
        if (profile.manager_override_applies_to) {
          setOverrideAppliesTo(profile.manager_override_applies_to);
        }
        if (profile.manager_override_basis) {
          setOverrideBasis(profile.manager_override_basis);
        }
        if (profile.manager_override_min_profit_percent !== null) {
          setOverrideMinProfitPercent(Number(profile.manager_override_min_profit_percent));
        }
        if (profile.manager_override_selected_reps) {
          setOverrideSelectedReps(profile.manager_override_selected_reps as string[]);
        }
        if (profile.manager_override_location_id) {
          setOverrideLocationId(profile.manager_override_location_id);
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
          setCommissionType('percentage_contract_price');
        } else if (plan.commission_type === 'net_percent' || plan.payment_method === 'commission_after_costs') {
          setCommissionType('profit_split');
        } else {
          setCommissionType('profit_split');
        }
        setCommissionRate(planConfig?.commission_rate || 10);
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
      
      // Call edge function to save commission settings (bypasses RLS issues)
      const { data, error } = await supabase.functions.invoke('save-commission-settings', {
        body: {
          target_user_id: userId,
          commission_type: commissionType,
          commission_rate: commissionRate,
          rep_overhead_rate: repOverheadRate,
          manager_override_rate: isManager ? managerOverrideRate : undefined,
          reports_to_manager_id: !isManager ? reportsToManagerId : undefined,
          is_manager: isManager,
          // New manager override configuration fields
          manager_override_applies_to: isManager ? overrideAppliesTo : undefined,
          manager_override_basis: isManager ? overrideBasis : undefined,
          manager_override_min_profit_percent: isManager ? overrideMinProfitPercent : undefined,
          manager_override_selected_reps: isManager && overrideAppliesTo === 'selected_reps' ? overrideSelectedReps : undefined,
          manager_override_location_id: isManager && overrideAppliesTo === 'location_reps' ? overrideLocationId : undefined,
        }
      });

      if (error) throw error;
      if (!data.success) throw new Error(data.error || 'Failed to save commission settings');

      setExistingPlanId(data.plan_id);

      toast({
        title: "Commission Settings Saved",
        description: "Commission configuration has been updated successfully.",
      });
    } catch (error: any) {
      console.error('Error saving commission settings:', error);
      toast({
        title: "Error",
        description: error.message || "Failed to save commission settings.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  // Toggle rep selection
  const handleRepToggle = (repId: string, checked: boolean) => {
    if (checked) {
      setOverrideSelectedReps(prev => [...prev, repId]);
    } else {
      setOverrideSelectedReps(prev => prev.filter(id => id !== repId));
    }
  };

  // Select/deselect all reps
  const handleSelectAllReps = () => {
    if (allReps) {
      setOverrideSelectedReps(allReps.map(rep => rep.id));
    }
  };

  const handleClearAllReps = () => {
    setOverrideSelectedReps([]);
  };

  // Calculate example commission with full breakdown
  const exampleContractValue = 50000;
  const materialsRate = 0.325;
  const laborRate = 0.325;
  
  const calculateProfitBreakdown = () => {
    const materialsCost = exampleContractValue * materialsRate;
    const laborCost = exampleContractValue * laborRate;
    const totalJobCosts = materialsCost + laborCost;
    const overheadCost = exampleContractValue * (repOverheadRate / 100);
    
    const grossProfit = exampleContractValue - totalJobCosts;
    const netProfit = grossProfit - overheadCost;
    
    // Commission based on type
    let commission: number;
    let commissionBase: number;
    
    if (commissionType === 'percentage_contract_price') {
      commissionBase = exampleContractValue;
      commission = (exampleContractValue * commissionRate) / 100;
    } else {
      commissionBase = netProfit;
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
      commission,
      commissionBase
    };
  };

  const breakdown = calculateProfitBreakdown();

  if (loading) {
    return <div className="text-center py-4">Loading commission settings...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4">
        {/* Commission Type */}
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
              <SelectItem value="profit_split">Profit Split</SelectItem>
              <SelectItem value="percentage_contract_price">Percent of Contract Price</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-sm text-muted-foreground">
            {commissionType === 'profit_split' 
              ? 'Commission calculated as a percentage of Net Profit (after costs & overhead)'
              : 'Commission calculated as a percentage of Contract Value (before costs)'}
          </p>
        </div>

        {/* Commission Rate */}
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

        {/* Rep Overhead Rate - only for profit split */}
        {commissionType === 'profit_split' && (
          <div className="space-y-2">
            <Label htmlFor="rep-overhead-rate">Rep Overhead Rate (%)</Label>
            <Input
              id="rep-overhead-rate"
              type="number"
              step="0.5"
              min="0"
              max="50"
              value={repOverheadRate}
              onChange={(e) => setRepOverheadRate(parseFloat(e.target.value) || 0)}
              disabled={!canEdit}
            />
            <p className="text-sm text-muted-foreground">
              Company overhead charged to this rep (deducted from profit before commission split)
            </p>
          </div>
        )}

        {/* Manager Override Rate - only for manager roles */}
        {isManager && (
          <div className="space-y-2">
            <Label htmlFor="manager-override-rate">Manager Override Rate (%)</Label>
            <Select
              value={managerOverrideRate.toString()}
              onValueChange={(val) => setManagerOverrideRate(parseFloat(val))}
              disabled={!canEdit}
            >
              <SelectTrigger id="manager-override-rate">
                <SelectValue placeholder="Select override rate" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="0">0% - No Override</SelectItem>
                <SelectItem value="1">1%</SelectItem>
                <SelectItem value="2">2%</SelectItem>
                <SelectItem value="3">3%</SelectItem>
                <SelectItem value="4">4%</SelectItem>
                <SelectItem value="5">5%</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-sm text-muted-foreground">
              Percentage earned from jobs closed by your assigned reps
            </p>
          </div>
        )}

        {/* Manager Override Configuration - only shown when override rate > 0 */}
        {isManager && managerOverrideRate > 0 && (
          <Card className="border-primary/20 bg-primary/5">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Users className="h-4 w-4" />
                Manager Override Configuration
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Override Applies To */}
              <div className="space-y-3">
                <Label>Override Applies To</Label>
                <RadioGroup
                  value={overrideAppliesTo}
                  onValueChange={setOverrideAppliesTo}
                  disabled={!canEdit}
                  className="space-y-2"
                >
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="all_reps" id="all_reps" />
                    <Label htmlFor="all_reps" className="font-normal cursor-pointer">
                      All Reps in Company
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="assigned_reps" id="assigned_reps" />
                    <Label htmlFor="assigned_reps" className="font-normal cursor-pointer">
                      Assigned Reps (reports to me)
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="location_reps" id="location_reps" />
                    <Label htmlFor="location_reps" className="font-normal cursor-pointer">
                      Reps in Location
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="selected_reps" id="selected_reps" />
                    <Label htmlFor="selected_reps" className="font-normal cursor-pointer">
                      Selected Reps
                    </Label>
                  </div>
                </RadioGroup>
              </div>

              {/* Location Selector - when override applies to location_reps */}
              {overrideAppliesTo === 'location_reps' && (
                <div className="space-y-2 pl-4 border-l-2 border-primary/20">
                  <Label>Select Location</Label>
                  <Select
                    value={overrideLocationId || "none"}
                    onValueChange={(val) => setOverrideLocationId(val === "none" ? null : val)}
                    disabled={!canEdit}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Choose a location" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Select a location...</SelectItem>
                      {locations?.map((location) => (
                        <SelectItem key={location.id} value={location.id}>
                          {location.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Rep Multi-Select - when override applies to selected_reps */}
              {overrideAppliesTo === 'selected_reps' && (
                <div className="space-y-2 pl-4 border-l-2 border-primary/20">
                  <div className="flex items-center justify-between">
                    <Label>Select Reps ({overrideSelectedReps.length} selected)</Label>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={handleSelectAllReps}
                        disabled={!canEdit}
                      >
                        Select All
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={handleClearAllReps}
                        disabled={!canEdit}
                      >
                        Clear All
                      </Button>
                    </div>
                  </div>
                  <div className="max-h-48 overflow-y-auto border rounded-md p-2 space-y-1">
                    {allReps && allReps.length > 0 ? (
                      allReps.map((rep) => (
                        <div key={rep.id} className="flex items-center space-x-2 py-1">
                          <Checkbox
                            id={`rep-${rep.id}`}
                            checked={overrideSelectedReps.includes(rep.id)}
                            onCheckedChange={(checked) => handleRepToggle(rep.id, !!checked)}
                            disabled={!canEdit}
                          />
                          <Label htmlFor={`rep-${rep.id}`} className="font-normal cursor-pointer text-sm">
                            {rep.first_name} {rep.last_name}
                          </Label>
                        </div>
                      ))
                    ) : (
                      <p className="text-sm text-muted-foreground py-2 text-center">
                        No reps found
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* Override Calculation Basis */}
              <div className="space-y-3 pt-2">
                <Label>Override Calculated On</Label>
                <RadioGroup
                  value={overrideBasis}
                  onValueChange={setOverrideBasis}
                  disabled={!canEdit}
                  className="space-y-2"
                >
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="contract_value" id="basis_contract" />
                    <Label htmlFor="basis_contract" className="font-normal cursor-pointer">
                      Contract/Selling Price
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="gross_profit" id="basis_gross" />
                    <Label htmlFor="basis_gross" className="font-normal cursor-pointer">
                      Gross Profit (Selling - Costs)
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="net_profit" id="basis_net" />
                    <Label htmlFor="basis_net" className="font-normal cursor-pointer">
                      Net Profit (Gross - Overhead)
                    </Label>
                  </div>
                </RadioGroup>
              </div>

              {/* Minimum Profit Margin Requirement */}
              <div className="space-y-2 pt-2">
                <Label htmlFor="min-profit">Minimum Profit Margin Required (%)</Label>
                <Input
                  id="min-profit"
                  type="number"
                  step="1"
                  min="0"
                  max="100"
                  value={overrideMinProfitPercent}
                  onChange={(e) => setOverrideMinProfitPercent(parseFloat(e.target.value) || 0)}
                  disabled={!canEdit}
                  className="max-w-[120px]"
                />
                {overrideMinProfitPercent > 0 && (
                  <div className="flex items-center gap-2 text-sm text-amber-600 dark:text-amber-400">
                    <AlertTriangle className="h-4 w-4" />
                    <span>Override not earned on jobs under {overrideMinProfitPercent}% profit margin</span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Reports To Manager - only for non-manager roles */}
        {!isManager && managers && managers.length > 0 && (
          <div className="space-y-2">
            <Label htmlFor="reports-to">Reports To (Manager)</Label>
            <Select
              value={reportsToManagerId || "none"}
              onValueChange={(val) => setReportsToManagerId(val === "none" ? null : val)}
              disabled={!canEdit}
            >
              <SelectTrigger id="reports-to">
                <SelectValue placeholder="Select manager" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No Direct Manager</SelectItem>
                {managers.map((manager) => (
                  <SelectItem key={manager.id} value={manager.id}>
                    {manager.first_name} {manager.last_name} ({manager.role})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-sm text-muted-foreground">
              Your manager earns an override on jobs you close
            </p>
          </div>
        )}
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
            
            {commissionType === 'profit_split' && (
              <>
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
                  <span className="text-muted-foreground">Rep Overhead ({repOverheadRate}%):</span>
                  <span className="font-medium text-destructive">-${breakdown.overheadCost.toLocaleString()}</span>
                </div>
                <hr className="border-border" />
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Net Profit:</span>
                  <span className="font-medium">${breakdown.netProfit.toLocaleString()}</span>
                </div>
              </>
            )}
            
            <div className="flex justify-between">
              <span className="text-muted-foreground">Commission Rate:</span>
              <span className="font-medium">{commissionRate}%</span>
            </div>
            <p className="text-xs text-muted-foreground italic">
              ({commissionRate}% of ${breakdown.commissionBase.toLocaleString()} {commissionType === 'profit_split' ? 'Net Profit' : 'Contract Value'})
            </p>
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

      {/* Manager Override Calculator - only for managers */}
      {isManager && tenantId && managerOverrideRate > 0 && (
        <div className="pt-4 border-t">
          <div className="flex items-center gap-2 mb-4">
            <Users className="h-5 w-5 text-primary" />
            <h3 className="font-semibold">Manager Override Earnings</h3>
          </div>
          <ManagerOverrideCalculator
            managerId={userId}
            managerOverrideRate={managerOverrideRate}
            tenantId={tenantId}
          />
        </div>
      )}
    </div>
  );
};