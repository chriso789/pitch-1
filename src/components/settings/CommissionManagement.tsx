import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { 
  Calculator, 
  Plus, 
  Edit, 
  DollarSign, 
  Users, 
  TrendingUp,
  CheckCircle,
  Clock,
  AlertTriangle
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

interface CommissionPlan {
  id: string;
  name: string;
  commission_type: string;
  plan_config: any;
  is_active: boolean;
  include_overhead: boolean;
  payment_method: string;
  created_at: string;
}

interface UserProfile {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  role: string;
  personal_overhead_rate: number;
  photo_url?: string;
}

interface CommissionCalculation {
  id: string;
  project_id: string;
  sales_rep_id: string;
  commission_amount: number;
  status: string;
  calculated_at: string;
  calculation_details: any;
}

export const CommissionManagement = () => {
  const [showNewPlan, setShowNewPlan] = useState(false);
  const [editingPlan, setEditingPlan] = useState<CommissionPlan | null>(null);
  const [newPlan, setNewPlan] = useState({
    name: '',
    commission_type: 'gross_percent',
    commission_rate: 5,
    tier_rates: [{ threshold: 0, rate: 5 }],
    include_overhead: false,
    payment_method: 'first_check',
    description: ''
  });

  const formatPayRelease = (value: string) => {
    const labels: Record<string, string> = {
      'first_check': '1st Check',
      'first_and_last_check': '1st Check & Last Check',
      'final_check': 'Final Check',
      // Backward compatibility
      'percentage_selling_price': '1st Check',
      'commission_after_costs': 'Final Check'
    };
    return labels[value] || value;
  };
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // React Query for commission plans with caching
  const { data: commissionPlans = [], isLoading: plansLoading } = useQuery({
    queryKey: ['commission-plans'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('commission_plans')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
    staleTime: 30 * 1000, // 30 seconds
  });

  // React Query for sales reps with caching - filtered by current user's tenant
  const { data: salesReps = [], isLoading: repsLoading } = useQuery({
    queryKey: ['sales-reps-commission'],
    queryFn: async () => {
      // Get current user's tenant first
      const { data: { user: authUser } } = await supabase.auth.getUser();
      const { data: currentProfile } = await supabase
        .from('profiles')
        .select('tenant_id')
        .eq('id', authUser?.id)
        .single();
      
      const { data, error } = await supabase
        .from('profiles')
        .select('id, first_name, last_name, email, role, personal_overhead_rate, photo_url')
        .eq('tenant_id', currentProfile?.tenant_id)
        .in('role', ['owner', 'corporate', 'regional_manager', 'sales_manager', 'project_manager'])
        .eq('is_active', true);
      if (error) throw error;
      return data || [];
    },
    staleTime: 60 * 1000, // 1 minute
  });

  // React Query for commission calculations with caching
  const { data: commissionCalculations = [], isLoading: calcsLoading } = useQuery({
    queryKey: ['commission-calculations'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('commission_calculations')
        .select('*')
        .order('calculated_at', { ascending: false })
        .limit(10);
      if (error) throw error;
      return data || [];
    },
    staleTime: 30 * 1000, // 30 seconds
  });

  const loading = plansLoading || repsLoading || calcsLoading;

  const savePlan = async () => {
    try {
      const user = await supabase.auth.getUser();
      const planData = {
        name: newPlan.name,
        commission_type: newPlan.commission_type as 'gross_percent' | 'net_percent' | 'tiered_margin' | 'flat_fee',
        plan_config: {
          commission_rate: newPlan.commission_rate,
          tier_rates: newPlan.tier_rates,
          description: newPlan.description
        },
        include_overhead: newPlan.include_overhead,
        payment_method: newPlan.payment_method,
        tenant_id: user.data.user?.user_metadata?.tenant_id,
        created_by: user.data.user?.id
      };

      const { error } = editingPlan
        ? await supabase
            .from('commission_plans')
            .update(planData)
            .eq('id', editingPlan.id)
        : await supabase
            .from('commission_plans')
            .insert(planData);

      if (error) throw error;

      toast({
        title: "Success",
        description: `Commission plan ${editingPlan ? 'updated' : 'created'} successfully`,
      });

      setNewPlan({
        name: '',
        commission_type: 'gross_percent',
        commission_rate: 5,
        tier_rates: [{ threshold: 0, rate: 5 }],
        include_overhead: false,
        payment_method: 'first_check',
        description: ''
      });
      setShowNewPlan(false);
      setEditingPlan(null);
      queryClient.invalidateQueries({ queryKey: ['commission-plans'] });
    } catch (error) {
      console.error('Error saving plan:', error);
      toast({
        title: "Error",
        description: "Failed to save commission plan",
        variant: "destructive",
      });
    }
  };

  const togglePlanStatus = async (planId: string, isActive: boolean) => {
    try {
      const { error } = await supabase
        .from('commission_plans')
        .update({ is_active: isActive })
        .eq('id', planId);

      if (error) throw error;

      toast({
        title: "Success",
        description: `Commission plan ${isActive ? 'activated' : 'deactivated'}`,
      });

      queryClient.invalidateQueries({ queryKey: ['commission-plans'] });
    } catch (error) {
      console.error('Error updating plan status:', error);
      toast({
        title: "Error",
        description: "Failed to update plan status",
        variant: "destructive",
      });
    }
  };

  const addTierRate = () => {
    setNewPlan(prev => ({
      ...prev,
      tier_rates: [...prev.tier_rates, { threshold: 0, rate: 0 }]
    }));
  };

  const updateTierRate = (index: number, field: 'threshold' | 'rate', value: number) => {
    setNewPlan(prev => ({
      ...prev,
      tier_rates: prev.tier_rates.map((tier, i) => 
        i === index ? { ...tier, [field]: value } : tier
      )
    }));
  };

  const removeTierRate = (index: number) => {
    if (newPlan.tier_rates.length > 1) {
      setNewPlan(prev => ({
        ...prev,
        tier_rates: prev.tier_rates.filter((_, i) => i !== index)
      }));
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        {/* Header Skeleton */}
        <div className="flex items-center justify-between">
          <div className="space-y-2">
            <Skeleton className="h-8 w-64" />
            <Skeleton className="h-4 w-96" />
          </div>
          <Skeleton className="h-10 w-44" />
        </div>

        {/* Tabs Skeleton */}
        <Skeleton className="h-10 w-96" />

        {/* Plans Cards Skeleton */}
        <div className="grid gap-4">
          {[1, 2].map((i) => (
            <Card key={i}>
              <CardContent className="p-6">
                <div className="flex items-start justify-between">
                  <div className="space-y-3">
                    <Skeleton className="h-6 w-48" />
                    <Skeleton className="h-4 w-64" />
                    <div className="flex gap-2">
                      <Skeleton className="h-6 w-16" />
                      <Skeleton className="h-6 w-32" />
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Skeleton className="h-6 w-12" />
                    <Skeleton className="h-8 w-8" />
                  </div>
                </div>
                <div className="mt-4 p-4 bg-muted/30 rounded-lg">
                  <Skeleton className="h-5 w-24 mb-3" />
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-4 w-40" />
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Commission Management</h2>
          <p className="text-muted-foreground">
            Configure representative pay structures and commission plans
          </p>
        </div>
        <Dialog open={showNewPlan} onOpenChange={setShowNewPlan}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              New Commission Plan
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>
                {editingPlan ? 'Edit Commission Plan' : 'Create Commission Plan'}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="plan-name">Plan Name</Label>
                  <Input
                    id="plan-name"
                    value={newPlan.name}
                    onChange={(e) => setNewPlan(prev => ({ ...prev, name: e.target.value }))}
                    placeholder="e.g., Standard Rep Plan, Manager Override"
                  />
                </div>
                <div>
                  <Label htmlFor="commission-type">Commission Type</Label>
                  <Select 
                    value={newPlan.commission_type} 
                    onValueChange={(value) => setNewPlan(prev => ({ ...prev, commission_type: value }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="gross_percent">Percent of Selling Price</SelectItem>
                      <SelectItem value="net_percent">Profit Split</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="flex items-center space-x-2">
                  <Switch
                    id="include-overhead"
                    checked={newPlan.include_overhead}
                    onCheckedChange={(checked) => setNewPlan(prev => ({ ...prev, include_overhead: checked }))}
                  />
                  <Label htmlFor="include-overhead">Include Rep Overhead</Label>
                </div>
                <div>
                  <Label htmlFor="pay-release">Pay Release</Label>
                  <Select 
                    value={newPlan.payment_method} 
                    onValueChange={(value) => setNewPlan(prev => ({ ...prev, payment_method: value }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="first_check">1st Check</SelectItem>
                      <SelectItem value="first_and_last_check">1st Check & Last Check</SelectItem>
                      <SelectItem value="final_check">Final Check</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground mt-1">
                    When commission is released to rep
                  </p>
                </div>
              </div>

              <div>
                <Label htmlFor="commission-rate">Commission Rate</Label>
                <Select 
                  value={newPlan.commission_rate.toString()} 
                  onValueChange={(value) => setNewPlan(prev => ({ ...prev, commission_rate: parseInt(value) }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15].map(rate => (
                      <SelectItem key={rate} value={rate.toString()}>{rate}%</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {newPlan.commission_type === 'net_percent' && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Percentage of profit (Selling Price - Costs) paid as commission
                  </p>
                )}
              </div>

              <div>
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  value={newPlan.description}
                  onChange={(e) => setNewPlan(prev => ({ ...prev, description: e.target.value }))}
                  placeholder="Optional description for this commission plan"
                />
              </div>

              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => {
                  setShowNewPlan(false);
                  setEditingPlan(null);
                }}>
                  Cancel
                </Button>
                <Button onClick={savePlan} disabled={!newPlan.name}>
                  {editingPlan ? 'Update Plan' : 'Create Plan'}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <Tabs defaultValue="plans" className="space-y-4">
        <TabsList>
          <TabsTrigger value="plans">Commission Plans</TabsTrigger>
          <TabsTrigger value="assignments">Rep Assignments</TabsTrigger>
          <TabsTrigger value="calculations">Commission History</TabsTrigger>
        </TabsList>

        <TabsContent value="plans" className="space-y-4">
          <div className="grid gap-4">
            {commissionPlans.map((plan) => (
              <Card key={plan.id}>
                <CardContent className="p-6">
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="font-semibold text-lg">{plan.name}</h3>
                      <p className="text-sm text-muted-foreground">
                        {plan.commission_type === 'gross_percent' ? 'Percent of Selling Price' : 'Profit Split'} • {formatPayRelease(plan.payment_method)}
                      </p>
                      <div className="flex items-center gap-4 mt-2">
                        <Badge variant={plan.is_active ? "default" : "secondary"}>
                          {plan.is_active ? 'Active' : 'Inactive'}
                        </Badge>
                        {plan.include_overhead && (
                          <Badge variant="outline">Includes Overhead</Badge>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={plan.is_active}
                        onCheckedChange={(checked) => togglePlanStatus(plan.id, checked)}
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setEditingPlan(plan);
                          const config = plan.plan_config as any;
                          setNewPlan({
                            name: plan.name,
                            commission_type: plan.commission_type,
                            commission_rate: config?.commission_rate || 5,
                            tier_rates: config?.tier_rates || [{ threshold: 0, rate: 5 }],
                            include_overhead: plan.include_overhead,
                            payment_method: plan.payment_method,
                            description: config?.description || ''
                          });
                          setShowNewPlan(true);
                        }}
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  
                  <div className="mt-4 p-4 bg-muted/30 rounded-lg">
                    <h4 className="font-medium mb-2">Plan Details</h4>
                    <div className="space-y-1 text-sm">
                      <p>
                        <strong>Rate:</strong> {(plan.plan_config as any)?.commission_rate || 0}%
                      </p>
                      <p>
                        <strong>Pay Release:</strong> {formatPayRelease(plan.payment_method)}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="assignments" className="space-y-4">
          <div className="grid gap-4">
            {salesReps.map((rep) => (
              <Card key={rep.id}>
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div>
                        <h3 className="font-semibold">
                          {rep.first_name} {rep.last_name}
                        </h3>
                        <p className="text-muted-foreground">{rep.email}</p>
                        <Badge variant="outline" className="mt-1">
                          {rep.role} • {rep.personal_overhead_rate || 0}% overhead
                        </Badge>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-sm text-muted-foreground">Current Plan</p>
                      <p className="font-medium">Standard Commission</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="calculations" className="space-y-4">
          <div className="grid gap-4">
            {commissionCalculations.map((calc) => (
              <Card key={calc.id}>
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-semibold">
                        Project Commission - ${calc.commission_amount.toLocaleString()}
                      </h3>
                      <p className="text-muted-foreground">
                        Calculated on {new Date(calc.calculated_at).toLocaleDateString()}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge 
                        variant={
                          calc.status === 'paid' ? 'default' : 
                          calc.status === 'approved' ? 'secondary' : 'outline'
                        }
                      >
                        {calc.status === 'paid' && <CheckCircle className="h-3 w-3 mr-1" />}
                        {calc.status === 'approved' && <Clock className="h-3 w-3 mr-1" />}
                        {calc.status === 'pending' && <AlertTriangle className="h-3 w-3 mr-1" />}
                        {calc.status}
                      </Badge>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
};