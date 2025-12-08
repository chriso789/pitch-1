import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DollarSign, TrendingUp, Clock, CheckCircle } from 'lucide-react';
import { formatCurrency } from '@/lib/commission-calculator';

interface CommissionSummaryCardsProps {
  totalJobs: number;
  totalRevenue: number;
  totalCommissions: number;
  pendingCommissions: number;
  paidCommissions: number;
}

export function CommissionSummaryCards({
  totalJobs,
  totalRevenue,
  totalCommissions,
  pendingCommissions,
  paidCommissions,
}: CommissionSummaryCardsProps) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Closed Jobs</CardTitle>
          <TrendingUp className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{totalJobs}</div>
          <p className="text-xs text-muted-foreground">Commission-eligible jobs</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Total Revenue</CardTitle>
          <DollarSign className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{formatCurrency(totalRevenue)}</div>
          <p className="text-xs text-muted-foreground">From closed jobs</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Total Commissions</CardTitle>
          <DollarSign className="h-4 w-4 text-green-500" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-green-600">
            {formatCurrency(totalCommissions)}
          </div>
          <p className="text-xs text-muted-foreground">Earned commissions</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Pending</CardTitle>
          <Clock className="h-4 w-4 text-yellow-500" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-yellow-600">
            {formatCurrency(pendingCommissions)}
          </div>
          <p className="text-xs text-muted-foreground">
            <CheckCircle className="h-3 w-3 inline mr-1 text-green-500" />
            {formatCurrency(paidCommissions)} paid
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
