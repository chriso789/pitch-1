import React from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { User, TrendingUp, Briefcase, ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';

interface JobNumberBreakdownProps {
  contactNumber?: string;
  contactName?: string;
  pipelineNumber?: string;
  pipelineStatus?: string;
  jobNumber?: string;
  projectNumber?: string;
  cljNumber?: string;
  className?: string;
  compact?: boolean;
}

export const JobNumberBreakdown: React.FC<JobNumberBreakdownProps> = ({
  contactNumber,
  contactName,
  pipelineNumber,
  pipelineStatus,
  jobNumber,
  projectNumber,
  cljNumber,
  className,
  compact = false
}) => {
  // Parse CLJ number if provided
  const parsedCLJ = React.useMemo(() => {
    if (!cljNumber) return null;
    
    const match = cljNumber.match(/C(\d+)-L(\d+)-J(\d+)/);
    if (match) {
      return {
        contact: match[1],
        lead: match[2],
        job: match[3]
      };
    }
    return null;
  }, [cljNumber]);

  if (compact) {
    return (
      <div className={cn("flex items-center gap-2 text-sm", className)}>
        {(contactNumber || parsedCLJ?.contact) && (
          <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20">
            <User className="h-3 w-3 mr-1" />
            C{parsedCLJ?.contact || contactNumber}
          </Badge>
        )}
        
        {(pipelineNumber || parsedCLJ?.lead) && (
          <>
            <ArrowRight className="h-3 w-3 text-muted-foreground" />
            <Badge variant="outline" className="bg-warning/10 text-warning border-warning/20">
              <TrendingUp className="h-3 w-3 mr-1" />
              L{parsedCLJ?.lead || pipelineNumber}
            </Badge>
          </>
        )}
        
        {(jobNumber || projectNumber || parsedCLJ?.job) && (
          <>
            <ArrowRight className="h-3 w-3 text-muted-foreground" />
            <Badge variant="outline" className="bg-success/10 text-success border-success/20">
              <Briefcase className="h-3 w-3 mr-1" />
              J{parsedCLJ?.job || jobNumber || projectNumber}
            </Badge>
          </>
        )}
        
        {cljNumber && (
          <Badge variant="secondary" className="ml-2 font-mono text-xs">
            {cljNumber}
          </Badge>
        )}
      </div>
    );
  }

  return (
    <Card className={cn("p-4", className)}>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-muted-foreground">Job Number Lineage</h3>
          {cljNumber && (
            <Badge variant="secondary" className="font-mono">
              {cljNumber}
            </Badge>
          )}
        </div>
        
        <div className="flex items-start gap-3">
          {/* Contact Bubble */}
          <div className="flex-1">
            <div className="relative">
              <div className="w-full aspect-square rounded-full bg-gradient-to-br from-primary to-primary/70 flex items-center justify-center shadow-soft max-w-[80px] mx-auto">
                <User className="h-6 w-6 text-primary-foreground" />
              </div>
              <div className="text-center mt-2 space-y-1">
                <div className="text-xs font-semibold text-primary">
                  Contact
                </div>
                <Badge variant="outline" className="text-xs">
                  #{parsedCLJ?.contact || contactNumber || 'N/A'}
                </Badge>
                {contactName && (
                  <div className="text-xs text-muted-foreground truncate">
                    {contactName}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Arrow */}
          <div className="flex items-center justify-center pt-8">
            <ArrowRight className="h-5 w-5 text-muted-foreground" />
          </div>

          {/* Lead Bubble */}
          <div className="flex-1">
            <div className="relative">
              <div className="w-full aspect-square rounded-full bg-gradient-to-br from-warning to-warning/70 flex items-center justify-center shadow-soft max-w-[80px] mx-auto">
                <TrendingUp className="h-6 w-6 text-warning-foreground" />
              </div>
              <div className="text-center mt-2 space-y-1">
                <div className="text-xs font-semibold text-warning">
                  Lead
                </div>
                <Badge variant="outline" className="text-xs">
                  #{parsedCLJ?.lead || pipelineNumber || 'N/A'}
                </Badge>
                {pipelineStatus && (
                  <div className="text-xs text-muted-foreground">
                    {pipelineStatus}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Arrow */}
          {(jobNumber || projectNumber || parsedCLJ?.job) && (
            <>
              <div className="flex items-center justify-center pt-8">
                <ArrowRight className="h-5 w-5 text-muted-foreground" />
              </div>

              {/* Job Bubble */}
              <div className="flex-1">
                <div className="relative">
                  <div className="w-full aspect-square rounded-full bg-gradient-to-br from-success to-success/70 flex items-center justify-center shadow-soft max-w-[80px] mx-auto">
                    <Briefcase className="h-6 w-6 text-success-foreground" />
                  </div>
                  <div className="text-center mt-2 space-y-1">
                    <div className="text-xs font-semibold text-success">
                      Job
                    </div>
                    <Badge variant="outline" className="text-xs">
                      #{parsedCLJ?.job || jobNumber || projectNumber || 'N/A'}
                    </Badge>
                    <div className="text-xs text-muted-foreground">
                      Active
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </Card>
  );
};
