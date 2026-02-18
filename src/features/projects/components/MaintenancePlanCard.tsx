import { CalendarCheck, Clock } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { format } from 'date-fns';

interface MaintenancePlanCardProps {
  plan: {
    id: string;
    plan_type: string;
    frequency: string;
    price: number;
    status: string;
    next_service_date: string | null;
    maintenance_visits?: any[];
  };
}

const STATUS_COLORS: Record<string, string> = {
  active: 'bg-green-500/15 text-green-700 dark:text-green-400',
  paused: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  cancelled: 'bg-red-500/15 text-red-700 dark:text-red-400',
  expired: 'bg-muted text-muted-foreground',
};

const FREQ_LABELS: Record<string, string> = {
  annual: 'Annual',
  semi_annual: 'Semi-Annual',
  quarterly: 'Quarterly',
};

const TYPE_LABELS: Record<string, string> = {
  roof_inspection: 'Roof Inspection',
  gutter_cleaning: 'Gutter Cleaning',
  full_maintenance: 'Full Maintenance',
};

export const MaintenancePlanCard = ({ plan }: MaintenancePlanCardProps) => {
  const completedVisits = plan.maintenance_visits?.filter((v: any) => v.status === 'completed').length || 0;

  return (
    <div className="flex items-center justify-between p-3 rounded-lg border bg-card">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm">{TYPE_LABELS[plan.plan_type] || plan.plan_type}</span>
          <Badge variant="outline" className={`border-0 text-xs ${STATUS_COLORS[plan.status] || ''}`}>
            {plan.status}
          </Badge>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {FREQ_LABELS[plan.frequency] || plan.frequency}
          </span>
          {plan.next_service_date && (
            <span className="flex items-center gap-1">
              <CalendarCheck className="h-3 w-3" />
              Next: {format(new Date(plan.next_service_date), 'MMM d, yyyy')}
            </span>
          )}
          <span>{completedVisits} visit{completedVisits !== 1 ? 's' : ''} completed</span>
        </div>
      </div>
      <span className="text-sm font-semibold">${Number(plan.price).toFixed(2)}</span>
    </div>
  );
};
