import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

export function LeadDetailsSkeleton() {
  return (
    <div className="max-w-7xl mx-auto space-y-6 animate-in fade-in duration-300">
      {/* Header Skeleton */}
      <div className="flex items-start justify-between">
        <div className="flex items-center space-x-4 flex-1">
          <Skeleton className="h-10 w-20" /> {/* Back button */}
          <div className="flex-1 space-y-3">
            <div className="flex items-center space-x-3">
              <Skeleton className="h-9 w-48" /> {/* Name */}
              <Skeleton className="h-6 w-20" /> {/* Status badge */}
            </div>
            <Skeleton className="h-5 w-96" /> {/* Address */}
            <div className="flex items-center gap-4">
              <Skeleton className="h-4 w-32" /> {/* Phone */}
              <Skeleton className="h-4 w-48" /> {/* Email */}
            </div>
          </div>
        </div>
        {/* Contact Card Skeleton */}
        <Card className="w-80">
          <CardContent className="p-4 space-y-3">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-5 w-36" />
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-4 w-40" />
          </CardContent>
        </Card>
      </div>

      {/* Approval Requirements Skeleton */}
      <Card>
        <CardHeader className="p-4">
          <Skeleton className="h-5 w-48" />
        </CardHeader>
        <CardContent className="p-4 pt-0">
          <div className="flex gap-4">
            <Skeleton className="h-12 w-24" />
            <Skeleton className="h-12 w-24" />
            <Skeleton className="h-12 w-24" />
            <Skeleton className="h-12 w-24" />
          </div>
        </CardContent>
      </Card>

      {/* Main Content Skeleton */}
      <Card>
        <CardHeader className="pb-3">
          <Skeleton className="h-10 w-64" /> {/* Tabs */}
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
