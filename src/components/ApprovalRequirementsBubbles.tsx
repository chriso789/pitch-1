import React from 'react';
import { FileText, DollarSign, Package, Hammer, CheckCircle, ArrowRight } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface ApprovalRequirements {
  hasContract: boolean;
  hasEstimate: boolean;
  hasMaterials: boolean;
  hasLabor: boolean;
  allComplete: boolean;
}

interface ApprovalRequirementsBubblesProps {
  requirements: ApprovalRequirements;
  onApprove: () => void;
  disabled?: boolean;
}

const bubbleSteps = [
  { key: 'hasContract', label: 'Contract', icon: FileText, color: 'from-blue-500 to-blue-400' },
  { key: 'hasEstimate', label: 'Estimate', icon: DollarSign, color: 'from-yellow-500 to-yellow-400' },
  { key: 'hasMaterials', label: 'Materials', icon: Package, color: 'from-purple-500 to-purple-400' },
  { key: 'hasLabor', label: 'Labor', icon: Hammer, color: 'from-orange-500 to-orange-400' },
] as const;

export const ApprovalRequirementsBubbles: React.FC<ApprovalRequirementsBubblesProps> = ({
  requirements,
  onApprove,
  disabled = false,
}) => {
  const completedCount = Object.entries(requirements)
    .filter(([key, value]) => key !== 'allComplete' && value === true)
    .length;
  
  const progressPercentage = (completedCount / 4) * 100;

  return (
    <div className="space-y-6">
      {/* Header with Progress and Action Button */}
      <div className="flex items-center justify-between">
        <div className="flex-1 mr-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium">Progress</span>
            <span className="text-sm text-muted-foreground">
              {completedCount} / 4 complete
            </span>
          </div>
          <Progress value={progressPercentage} className="h-2" />
        </div>
        
        {requirements.allComplete ? (
          <Button 
            onClick={onApprove} 
            disabled={disabled}
            className="gradient-primary whitespace-nowrap"
          >
            Approve to Project
          </Button>
        ) : (
          <Button disabled variant="outline" className="whitespace-nowrap">
            Complete Requirements
          </Button>
        )}
      </div>

      {/* Floating Bubbles Timeline */}
      <div className="relative">
        <div className="flex items-center justify-between md:justify-around flex-wrap gap-4 md:gap-0">
          {bubbleSteps.map((step, index) => {
            const isComplete = requirements[step.key as keyof ApprovalRequirements];
            const Icon = step.icon;
            
            return (
              <React.Fragment key={step.key}>
                {/* Bubble */}
                <div className="flex flex-col items-center space-y-2 relative">
                  {/* Circular Bubble */}
                  <div
                    className={cn(
                      "relative w-20 h-20 rounded-full flex items-center justify-center transition-all duration-300",
                      "border-4",
                      isComplete
                        ? `bg-gradient-to-br ${step.color} border-white shadow-lg animate-scale-in`
                        : "bg-muted border-border opacity-50"
                    )}
                  >
                    <Icon 
                      className={cn(
                        "h-8 w-8 transition-colors",
                        isComplete ? "text-white" : "text-muted-foreground"
                      )} 
                    />
                    
                    {/* Checkmark Badge */}
                    {isComplete && (
                      <div className="absolute -top-1 -right-1 w-6 h-6 bg-success rounded-full flex items-center justify-center border-2 border-background shadow-md animate-fade-in">
                        <CheckCircle className="h-4 w-4 text-success-foreground" />
                      </div>
                    )}
                  </div>
                  
                  {/* Label */}
                  <span className={cn(
                    "text-sm font-medium text-center",
                    isComplete ? "text-foreground" : "text-muted-foreground"
                  )}>
                    {step.label}
                  </span>
                  
                  {/* Status Badge */}
                  <span className={cn(
                    "text-xs px-2 py-0.5 rounded-full",
                    isComplete 
                      ? "bg-success/10 text-success" 
                      : "bg-muted text-muted-foreground"
                  )}>
                    {isComplete ? "Complete" : "Pending"}
                  </span>
                </div>
                
                {/* Arrow Connector */}
                {index < bubbleSteps.length - 1 && (
                  <div className="hidden md:flex items-center">
                    <ArrowRight 
                      className={cn(
                        "h-6 w-6 transition-colors",
                        isComplete ? "text-primary" : "text-muted-foreground/30"
                      )}
                    />
                  </div>
                )}
              </React.Fragment>
            );
          })}
        </div>
      </div>
    </div>
  );
};
