import { CheckCircle, Circle, Clock, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

interface TimelineStage {
  id: string;
  label: string;
  description?: string;
  completedAt?: string;
  estimatedDate?: string;
}

interface SimplifiedProjectTimelineProps {
  currentStage: string;
  stages?: TimelineStage[];
  className?: string;
}

const DEFAULT_STAGES: TimelineStage[] = [
  { id: 'approved', label: 'Quote Approved', description: 'Your project has been approved' },
  { id: 'permit_submitted', label: 'Permit Submitted', description: 'Permit application filed with the county' },
  { id: 'permit_approved', label: 'Permit Approved', description: 'Building permit has been approved' },
  { id: 'materials_ordered', label: 'Materials Ordered', description: 'Materials have been ordered from suppliers' },
  { id: 'scheduled', label: 'Installation Scheduled', description: 'Your installation date has been set' },
  { id: 'in_progress', label: 'Installation In Progress', description: 'Work is currently being done' },
  { id: 'inspection', label: 'Final Inspection', description: 'Awaiting or passed final inspection' },
  { id: 'completed', label: 'Project Complete', description: 'Your project is finished!' },
];

export function SimplifiedProjectTimeline({ 
  currentStage, 
  stages = DEFAULT_STAGES,
  className 
}: SimplifiedProjectTimelineProps) {
  const currentIndex = stages.findIndex(s => s.id === currentStage);

  const getStageStatus = (index: number) => {
    if (index < currentIndex) return 'completed';
    if (index === currentIndex) return 'current';
    return 'upcoming';
  };

  return (
    <div className={cn("py-4", className)}>
      <div className="relative">
        {stages.map((stage, index) => {
          const status = getStageStatus(index);
          const isLast = index === stages.length - 1;

          return (
            <div key={stage.id} className="relative flex items-start pb-8 last:pb-0">
              {/* Connector Line */}
              {!isLast && (
                <div 
                  className={cn(
                    "absolute left-[15px] top-[30px] w-0.5 h-full -translate-x-1/2",
                    status === 'completed' ? "bg-primary" : "bg-border"
                  )}
                />
              )}

              {/* Icon */}
              <div className="relative z-10 flex-shrink-0">
                {status === 'completed' ? (
                  <div className="h-8 w-8 rounded-full bg-primary flex items-center justify-center">
                    <CheckCircle className="h-5 w-5 text-primary-foreground" />
                  </div>
                ) : status === 'current' ? (
                  <div className="h-8 w-8 rounded-full bg-primary/20 border-2 border-primary flex items-center justify-center animate-pulse">
                    <Clock className="h-4 w-4 text-primary" />
                  </div>
                ) : (
                  <div className="h-8 w-8 rounded-full bg-muted border-2 border-border flex items-center justify-center">
                    <Circle className="h-4 w-4 text-muted-foreground" />
                  </div>
                )}
              </div>

              {/* Content */}
              <div className="ml-4 flex-1">
                <div className="flex items-center gap-2">
                  <h4 
                    className={cn(
                      "font-medium",
                      status === 'completed' && "text-primary",
                      status === 'current' && "text-foreground",
                      status === 'upcoming' && "text-muted-foreground"
                    )}
                  >
                    {stage.label}
                  </h4>
                  {status === 'current' && (
                    <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                      Current
                    </span>
                  )}
                </div>
                
                {stage.description && (
                  <p className="text-sm text-muted-foreground mt-0.5">
                    {stage.description}
                  </p>
                )}
                
                {stage.completedAt && status === 'completed' && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Completed {new Date(stage.completedAt).toLocaleDateString()}
                  </p>
                )}
                
                {stage.estimatedDate && status === 'upcoming' && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Estimated: {new Date(stage.estimatedDate).toLocaleDateString()}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}