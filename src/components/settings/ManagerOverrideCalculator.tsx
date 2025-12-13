import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { DollarSign, Users, TrendingUp, Calculator } from "lucide-react";
import { formatCurrency, calculateManagerOverride } from "@/lib/commission-calculator";

interface ManagerOverrideCalculatorProps {
  managerId: string;
  managerOverrideRate: number;
  tenantId: string;
}

export const ManagerOverrideCalculator: React.FC<ManagerOverrideCalculatorProps> = ({
  managerId,
  managerOverrideRate,
  tenantId
}) => {
  // Fetch reps assigned to this manager
  const { data: assignedReps } = useQuery({
    queryKey: ['manager-reps', managerId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, first_name, last_name, email')
        .eq('reports_to_manager_id', managerId)
        .eq('tenant_id', tenantId);
      
      if (error) throw error;
      return data || [];
    }
  });

  // Fetch override earnings for this manager
  const { data: overrideEarnings } = useQuery({
    queryKey: ['manager-override-earnings', managerId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('manager_override_earnings')
        .select(`
          *,
          sales_rep:profiles!manager_override_earnings_sales_rep_id_fkey(first_name, last_name)
        `)
        .eq('manager_id', managerId)
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      return data || [];
    }
  });

  // Fetch commission earnings for reps under this manager (for production stats)
  const { data: repProduction } = useQuery({
    queryKey: ['manager-rep-production', managerId, assignedReps?.map(r => r.id)],
    queryFn: async () => {
      if (!assignedReps?.length) return [];
      
      const repIds = assignedReps.map(r => r.id);
      const { data, error } = await supabase
        .from('commission_earnings')
        .select('user_id, contract_value, status, created_at')
        .in('user_id', repIds);
      
      if (error) throw error;
      return data || [];
    },
    enabled: !!assignedReps?.length
  });

  // Calculate totals
  const totalOverrideEarnings = overrideEarnings?.reduce((sum, e) => sum + Number(e.override_amount || 0), 0) || 0;
  const pendingOverrideEarnings = overrideEarnings?.filter(e => e.status === 'pending').reduce((sum, e) => sum + Number(e.override_amount || 0), 0) || 0;
  
  // Calculate this month's earnings
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthlyOverrideEarnings = overrideEarnings?.filter(e => new Date(e.created_at) >= startOfMonth).reduce((sum, e) => sum + Number(e.override_amount || 0), 0) || 0;

  // Group production by rep
  const repStats = assignedReps?.map(rep => {
    const repEarnings = repProduction?.filter(p => p.user_id === rep.id) || [];
    const totalContractValue = repEarnings.reduce((sum, e) => sum + Number(e.contract_value || 0), 0);
    const jobCount = repEarnings.length;
    const overrideFromRep = calculateManagerOverride({
      contractValue: totalContractValue,
      managerOverrideRate
    }).overrideAmount;

    return {
      ...rep,
      jobCount,
      totalContractValue,
      overrideFromRep
    };
  }) || [];

  // Example calculation
  const exampleContract = 50000;
  const exampleOverride = calculateManagerOverride({
    contractValue: exampleContract,
    managerOverrideRate
  });

  return (
    <div className="space-y-4">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="bg-primary/5 border-primary/20">
          <CardContent className="p-3">
            <div className="flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-primary" />
              <span className="text-xs text-muted-foreground">Total Override</span>
            </div>
            <p className="text-lg font-bold text-primary mt-1">
              {formatCurrency(totalOverrideEarnings)}
            </p>
          </CardContent>
        </Card>

        <Card className="bg-green-500/5 border-green-500/20">
          <CardContent className="p-3">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-green-600" />
              <span className="text-xs text-muted-foreground">This Month</span>
            </div>
            <p className="text-lg font-bold text-green-600 mt-1">
              {formatCurrency(monthlyOverrideEarnings)}
            </p>
          </CardContent>
        </Card>

        <Card className="bg-orange-500/5 border-orange-500/20">
          <CardContent className="p-3">
            <div className="flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-orange-600" />
              <span className="text-xs text-muted-foreground">Pending</span>
            </div>
            <p className="text-lg font-bold text-orange-600 mt-1">
              {formatCurrency(pendingOverrideEarnings)}
            </p>
          </CardContent>
        </Card>

        <Card className="bg-blue-500/5 border-blue-500/20">
          <CardContent className="p-3">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-blue-600" />
              <span className="text-xs text-muted-foreground">Reps Managed</span>
            </div>
            <p className="text-lg font-bold text-blue-600 mt-1">
              {assignedReps?.length || 0}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Example Calculation */}
      <Card className="bg-muted/30">
        <CardContent className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <Calculator className="h-4 w-4 text-primary" />
            <h4 className="font-medium">Manager Override Example</h4>
          </div>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Rep closes job:</span>
              <span className="font-medium">{formatCurrency(exampleContract)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Your override rate:</span>
              <span className="font-medium">{managerOverrideRate}%</span>
            </div>
            <hr className="border-border" />
            <div className="flex justify-between text-base">
              <span className="font-medium">Your Override Earned:</span>
              <span className="font-bold text-primary">{formatCurrency(exampleOverride.overrideAmount)}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Team Production Table */}
      {repStats.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Your Team's Production</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left p-3 font-medium">Rep Name</th>
                    <th className="text-right p-3 font-medium">Jobs</th>
                    <th className="text-right p-3 font-medium">Revenue</th>
                    <th className="text-right p-3 font-medium">Your Override</th>
                  </tr>
                </thead>
                <tbody>
                  {repStats.map((rep) => (
                    <tr key={rep.id} className="border-t">
                      <td className="p-3">{rep.first_name} {rep.last_name}</td>
                      <td className="p-3 text-right">{rep.jobCount}</td>
                      <td className="p-3 text-right">{formatCurrency(rep.totalContractValue)}</td>
                      <td className="p-3 text-right font-medium text-primary">
                        {formatCurrency(rep.overrideFromRep)}
                      </td>
                    </tr>
                  ))}
                  {repStats.length > 0 && (
                    <tr className="border-t bg-muted/30 font-medium">
                      <td className="p-3">TOTAL</td>
                      <td className="p-3 text-right">{repStats.reduce((s, r) => s + r.jobCount, 0)}</td>
                      <td className="p-3 text-right">{formatCurrency(repStats.reduce((s, r) => s + r.totalContractValue, 0))}</td>
                      <td className="p-3 text-right text-primary">
                        {formatCurrency(repStats.reduce((s, r) => s + r.overrideFromRep, 0))}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* No Reps Message */}
      {assignedReps?.length === 0 && (
        <Card className="bg-muted/30">
          <CardContent className="p-6 text-center">
            <Users className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">
              No sales reps are currently assigned to you.
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Reps can be assigned through their profile settings.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
};
