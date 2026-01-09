import { useCrewDashboard } from '@/hooks/useCrewDashboard';
import { useCrewAuth } from '@/hooks/useCrewAuth';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { 
  HardHat, 
  Calendar, 
  AlertTriangle, 
  CheckCircle, 
  Clock, 
  MapPin,
  User,
  Shield,
  Loader2,
  ChevronRight,
  FileWarning
} from 'lucide-react';
import { format, parseISO } from 'date-fns';

interface CrewDashboardProps {
  onJobSelect: (jobId: string) => void;
  onNavigate: (view: 'dashboard' | 'job' | 'profile' | 'admin') => void;
  isAdmin: boolean;
}

export function CrewDashboard({ onJobSelect, onNavigate, isAdmin }: CrewDashboardProps) {
  const { crewProfile } = useCrewAuth();
  const { jobs, counts, docsStatus, loading, error } = useCrewDashboard();

  const getDocsStatusBadge = () => {
    switch (docsStatus) {
      case 'valid':
        return (
          <Badge variant="outline" className="bg-green-500/10 text-green-600 border-green-500/20">
            <CheckCircle className="h-3 w-3 mr-1" />
            Docs: Valid
          </Badge>
        );
      case 'expiring':
        return (
          <Badge variant="outline" className="bg-yellow-500/10 text-yellow-600 border-yellow-500/20">
            <AlertTriangle className="h-3 w-3 mr-1" />
            Docs: Expiring
          </Badge>
        );
      case 'expired':
        return (
          <Badge variant="outline" className="bg-red-500/10 text-red-600 border-red-500/20">
            <FileWarning className="h-3 w-3 mr-1" />
            Docs: Expired
          </Badge>
        );
    }
  };

  const getStatusBadge = (status: string, isLocked: boolean) => {
    if (isLocked) {
      return <Badge variant="destructive">Blocked</Badge>;
    }
    switch (status) {
      case 'assigned':
        return <Badge variant="secondary">Assigned</Badge>;
      case 'en_route':
        return <Badge className="bg-blue-500">En Route</Badge>;
      case 'on_site':
        return <Badge className="bg-purple-500">On Site</Badge>;
      case 'work_started':
        return <Badge className="bg-orange-500">Working</Badge>;
      case 'waiting':
        return <Badge variant="outline">Waiting</Badge>;
      case 'completed':
        return <Badge className="bg-green-500">Completed</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-background border-b">
        <div className="px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <HardHat className="h-6 w-6 text-primary" />
            <span className="font-semibold text-lg">Crew Portal</span>
          </div>
          <div className="flex items-center gap-2">
            {getDocsStatusBadge()}
          </div>
        </div>
      </header>

      <div className="p-4 space-y-4">
        {/* Quick Actions */}
        <div className="flex gap-2">
          <Button 
            variant="outline" 
            size="sm"
            onClick={() => onNavigate('profile')}
          >
            <User className="h-4 w-4 mr-1" />
            Profile
          </Button>
          {isAdmin && (
            <Button 
              variant="outline" 
              size="sm"
              onClick={() => onNavigate('admin')}
            >
              <Shield className="h-4 w-4 mr-1" />
              Admin
            </Button>
          )}
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-2 gap-3">
          <Card className="bg-primary/5 border-primary/10">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                  <Calendar className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{counts.today}</p>
                  <p className="text-xs text-muted-foreground">Today's Jobs</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center">
                  <Clock className="h-5 w-5 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{counts.upcoming}</p>
                  <p className="text-xs text-muted-foreground">Upcoming</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className={counts.blocked > 0 ? 'bg-red-500/5 border-red-500/10' : ''}>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className={`h-10 w-10 rounded-full flex items-center justify-center ${
                  counts.blocked > 0 ? 'bg-red-500/10' : 'bg-muted'
                }`}>
                  <AlertTriangle className={`h-5 w-5 ${
                    counts.blocked > 0 ? 'text-red-500' : 'text-muted-foreground'
                  }`} />
                </div>
                <div>
                  <p className="text-2xl font-bold">{counts.blocked}</p>
                  <p className="text-xs text-muted-foreground">Blocked</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-green-500/5 border-green-500/10">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-green-500/10 flex items-center justify-center">
                  <CheckCircle className="h-5 w-5 text-green-500" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{counts.completedThisWeek}</p>
                  <p className="text-xs text-muted-foreground">This Week</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Jobs List */}
        <div className="space-y-2">
          <h2 className="font-semibold text-lg">Your Jobs</h2>

          {error && (
            <Card className="bg-red-500/5 border-red-500/10">
              <CardContent className="p-4 text-red-600 text-sm">
                {error}
              </CardContent>
            </Card>
          )}

          {jobs.length === 0 ? (
            <Card>
              <CardContent className="p-6 text-center text-muted-foreground">
                <Calendar className="h-12 w-12 mx-auto mb-2 opacity-50" />
                <p>No jobs assigned</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {jobs.map((job) => (
                <Card 
                  key={job.id} 
                  className={`cursor-pointer transition-colors hover:bg-accent/50 ${
                    job.isLocked ? 'border-red-500/30 bg-red-500/5' : ''
                  }`}
                  onClick={() => onJobSelect(job.jobId)}
                >
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1 text-sm text-muted-foreground mb-1">
                          <MapPin className="h-3 w-3" />
                          <span className="truncate">
                            {job.scopeSummary?.split('\n')[0] || 'Job Site'}
                          </span>
                        </div>
                        {job.scheduledDate && (
                          <p className="text-sm font-medium">
                            {format(parseISO(job.scheduledDate), 'EEE, MMM d')}
                            {job.arrivalWindowStart && ` • ${job.arrivalWindowStart.slice(0, 5)}`}
                            {job.arrivalWindowEnd && ` - ${job.arrivalWindowEnd.slice(0, 5)}`}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        {getStatusBadge(job.status, job.isLocked)}
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      </div>
                    </div>

                    {/* Progress Bars */}
                    {job.photoProgress && (
                      <div className="space-y-1 mt-3">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-muted-foreground">Photos</span>
                          <span>{job.photoProgress.current}/{job.photoProgress.required}</span>
                        </div>
                        <Progress 
                          value={(job.photoProgress.current / job.photoProgress.required) * 100} 
                          className="h-1.5"
                        />
                      </div>
                    )}

                    {job.checklistProgress && (
                      <div className="space-y-1 mt-2">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-muted-foreground">Checklist</span>
                          <span>{job.checklistProgress.current}/{job.checklistProgress.required}</span>
                        </div>
                        <Progress 
                          value={(job.checklistProgress.current / job.checklistProgress.required) * 100} 
                          className="h-1.5"
                        />
                      </div>
                    )}

                    {job.isLocked && job.lockReason && (
                      <p className="text-xs text-red-600 mt-2">
                        ⚠️ {job.lockReason}
                      </p>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
