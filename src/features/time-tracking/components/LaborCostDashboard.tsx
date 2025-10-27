import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';

export function LaborCostDashboard() {
  const { data: laborCosts, isLoading } = useQuery({
    queryKey: ['labor-cost-tracking'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('labor_cost_tracking')
        .select(`
          *,
          projects(name, project_number)
        `)
        .order('last_updated', { ascending: false });

      if (error) throw error;
      return data;
    },
  });

  if (isLoading) {
    return <div>Loading labor costs...</div>;
  }

  const getVarianceColor = (variance: number) => {
    if (variance > 0) return 'text-green-600';
    if (variance < -1000) return 'text-red-600';
    return 'text-yellow-600';
  };

  const getProgressVariant = (budgeted: number, actual: number): number => {
    if (budgeted === 0) return 0;
    const percentage = (actual / budgeted) * 100;
    return Math.min(percentage, 100);
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Labor Cost Tracking by Project</CardTitle>
          <CardDescription>
            Monitor actual labor costs against budgeted amounts
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-6">
            {laborCosts?.map((cost: any) => {
              const progress = getProgressVariant(
                cost.budgeted_total || 0,
                cost.actual_cost || 0
              );
              const isOverBudget = (cost.actual_cost || 0) > (cost.budgeted_total || 0);

              return (
                <div key={cost.id} className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-medium">
                        {cost.projects?.name || 'Unknown Project'}
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {cost.projects?.project_number}
                      </div>
                    </div>
                    {isOverBudget && (
                      <Badge variant="destructive">Over Budget</Badge>
                    )}
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                    <div>
                      <div className="text-muted-foreground">Budgeted Hours</div>
                      <div className="font-semibold">
                        {Number(cost.budgeted_hours || 0).toFixed(1)} hrs
                      </div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Actual Hours</div>
                      <div className="font-semibold">
                        {Number(cost.actual_hours || 0).toFixed(1)} hrs
                      </div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Budgeted Cost</div>
                      <div className="font-semibold">
                        ${Number(cost.budgeted_total || 0).toFixed(2)}
                      </div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Actual Cost</div>
                      <div className="font-semibold">
                        ${Number(cost.actual_cost || 0).toFixed(2)}
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span>Budget Usage</span>
                      <span className={getVarianceColor(cost.variance_cost || 0)}>
                        {progress.toFixed(0)}% (
                        {(cost.variance_cost || 0) > 0 ? '+' : ''}$
                        {Math.abs(cost.variance_cost || 0).toFixed(2)})
                      </span>
                    </div>
                    <Progress value={progress} className="h-2" />
                  </div>
                </div>
              );
            })}

            {!laborCosts?.length && (
              <div className="text-center py-8 text-muted-foreground">
                No labor cost data available
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
