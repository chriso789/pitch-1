import { Skeleton } from "@/components/ui/skeleton";

const COLUMN_COUNT = 6;

export function PipelineSkeleton() {
  return (
    <div className="space-y-6">
      {/* Header skeleton */}
      <div className="flex items-center justify-between">
        <div>
          <Skeleton className="h-9 w-48 mb-2" />
          <Skeleton className="h-4 w-96" />
        </div>
      </div>

      {/* Kanban columns skeleton */}
      <div className="flex gap-2 min-h-[600px] pb-4">
        {Array.from({ length: COLUMN_COUNT }).map((_, i) => (
          <div key={i} className="flex-shrink-0 w-[56px]">
            <div className="bg-muted/30 rounded-lg p-3 h-full min-h-[500px]">
              {/* Column header */}
              <div className="flex items-center gap-2 mb-4">
                <Skeleton className="h-4 w-4 rounded-full" />
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-5 w-6 rounded-full ml-auto" />
              </div>
              
              {/* Card skeletons - varying amounts per column */}
              {Array.from({ length: Math.max(1, 3 - i % 3) }).map((_, j) => (
                <div key={j} className="mb-2">
                  <div className="bg-card rounded-lg p-3 border">
                    <Skeleton className="h-4 w-24 mb-2" />
                    <Skeleton className="h-3 w-32 mb-1" />
                    <Skeleton className="h-3 w-28" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
