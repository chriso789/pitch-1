import React from 'react';
import { cn } from '@/lib/utils';
import { 
  FileText, FileCheck, CheckCircle, Calendar, 
  Hammer, ClipboardCheck, DollarSign 
} from 'lucide-react';
import { JOB_STATUS_STAGES } from '../hooks/useCustomerPortal';

interface JobStatusTimelineProps {
  currentStatus: string;
  onStageClick: (stageKey: string) => void;
}

const iconMap: Record<string, React.ComponentType<any>> = {
  FileText,
  FileCheck,
  CheckCircle,
  Calendar,
  Hammer,
  ClipboardCheck,
  DollarSign,
};

export function JobStatusTimeline({ currentStatus, onStageClick }: JobStatusTimelineProps) {
  const currentIndex = JOB_STATUS_STAGES.findIndex(s => s.key === currentStatus);

  return (
    <div className="w-full py-4">
      <h3 className="text-lg font-semibold mb-4 text-foreground">Project Status</h3>
      
      {/* Mobile: Vertical Timeline */}
      <div className="md:hidden space-y-4">
        {JOB_STATUS_STAGES.map((stage, index) => {
          const Icon = iconMap[stage.icon] || FileText;
          const isComplete = index < currentIndex;
          const isCurrent = index === currentIndex;
          const isPending = index > currentIndex;

          return (
            <button
              key={stage.key}
              onClick={() => onStageClick(stage.key)}
              className={cn(
                "w-full flex items-center gap-4 p-4 rounded-lg border transition-all",
                isComplete && "bg-green-500/10 border-green-500/30 hover:bg-green-500/20",
                isCurrent && "bg-primary/10 border-primary/50 ring-2 ring-primary/30 hover:bg-primary/20",
                isPending && "bg-muted/50 border-border/50 hover:bg-muted"
              )}
            >
              <div className={cn(
                "w-10 h-10 rounded-full flex items-center justify-center shrink-0",
                isComplete && "bg-green-500 text-white",
                isCurrent && "bg-primary text-primary-foreground",
                isPending && "bg-muted-foreground/20 text-muted-foreground"
              )}>
                <Icon className="w-5 h-5" />
              </div>
              <div className="text-left flex-1">
                <p className={cn(
                  "font-medium",
                  isComplete && "text-green-700 dark:text-green-400",
                  isCurrent && "text-primary",
                  isPending && "text-muted-foreground"
                )}>
                  {stage.name}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {isComplete ? 'Completed' : isCurrent ? 'In Progress' : 'Pending'}
                </p>
              </div>
              {isComplete && (
                <CheckCircle className="w-5 h-5 text-green-500" />
              )}
            </button>
          );
        })}
      </div>

      {/* Desktop: Horizontal Timeline */}
      <div className="hidden md:block">
        <div className="relative flex items-center justify-between">
          {/* Progress Line */}
          <div className="absolute top-5 left-0 right-0 h-1 bg-muted rounded-full">
            <div 
              className="h-full bg-gradient-to-r from-green-500 to-primary rounded-full transition-all duration-500"
              style={{ 
                width: `${Math.max(0, (currentIndex / (JOB_STATUS_STAGES.length - 1)) * 100)}%` 
              }}
            />
          </div>

          {JOB_STATUS_STAGES.map((stage, index) => {
            const Icon = iconMap[stage.icon] || FileText;
            const isComplete = index < currentIndex;
            const isCurrent = index === currentIndex;
            const isPending = index > currentIndex;

            return (
              <button
                key={stage.key}
                onClick={() => onStageClick(stage.key)}
                className="relative flex flex-col items-center group z-10"
              >
                <div className={cn(
                  "w-10 h-10 rounded-full flex items-center justify-center transition-all duration-300",
                  "hover:scale-110 cursor-pointer",
                  isComplete && "bg-green-500 text-white shadow-lg shadow-green-500/30",
                  isCurrent && "bg-primary text-primary-foreground shadow-lg shadow-primary/30 ring-4 ring-primary/20",
                  isPending && "bg-muted text-muted-foreground"
                )}>
                  <Icon className="w-5 h-5" />
                </div>
                <span className={cn(
                  "mt-3 text-xs font-medium text-center max-w-[80px] leading-tight",
                  isComplete && "text-green-600 dark:text-green-400",
                  isCurrent && "text-primary",
                  isPending && "text-muted-foreground"
                )}>
                  {stage.name}
                </span>
                
                {/* Tooltip */}
                <div className="absolute -top-12 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                  <div className="bg-popover text-popover-foreground text-xs px-3 py-1.5 rounded-md shadow-lg whitespace-nowrap">
                    {stage.description}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
