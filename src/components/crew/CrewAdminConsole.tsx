import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useCrewAuth } from '@/hooks/useCrewAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  ArrowLeft, 
  Users, 
  Briefcase,
  AlertTriangle,
  CheckCircle,
  Clock,
  Loader2,
  ChevronRight
} from 'lucide-react';

interface CrewAdminConsoleProps {
  onBack: () => void;
}

interface Subcontractor {
  id: string;
  userId: string;
  legalBusinessName: string;
  primaryTrade: string;
  activeJobs: number;
  complianceScore: number;
  docsExpiring: number;
  docsExpired: number;
}

interface AdminJob {
  id: string;
  jobId: string;
  scheduledDate: string | null;
  status: string;
  subcontractorName: string;
  isLocked: boolean;
  photoProgress: number;
  checklistProgress: number;
}

export function CrewAdminConsole({ onBack }: CrewAdminConsoleProps) {
  const { companyId, isAdmin } = useCrewAuth();
  const [subcontractors, setSubcontractors] = useState<Subcontractor[]>([]);
  const [jobs, setJobs] = useState<AdminJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('subcontractors');

  useEffect(() => {
    if (companyId && isAdmin) {
      fetchData();
    }
  }, [companyId, isAdmin]);

  const fetchData = async () => {
    if (!companyId) return;

    try {
      setLoading(true);

      // Fetch subcontractors
      const { data: profilesData } = await supabase
        .from('crew.subcontractor_profiles' as any)
        .select('*')
        .eq('company_id', companyId);

      // Fetch job assignments
      const { data: assignmentsData } = await supabase
        .from('crew.job_assignments' as any)
        .select('*')
        .eq('company_id', companyId)
        .order('scheduled_date', { ascending: true });

      // Fetch documents for compliance calculation
      const { data: docsData } = await supabase
        .from('crew.subcontractor_documents' as any)
        .select('subcontractor_user_id, expiration_date')
        .eq('company_id', companyId);

      const today = new Date().toISOString().split('T')[0];
      const thirtyDaysFromNow = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

      // Process subcontractors
      const subs: Subcontractor[] = (profilesData || []).map((profile: any) => {
        const userDocs = (docsData || []).filter((d: any) => d.subcontractor_user_id === profile.user_id);
        const expiredDocs = userDocs.filter((d: any) => d.expiration_date < today);
        const expiringDocs = userDocs.filter((d: any) => 
          d.expiration_date >= today && d.expiration_date < thirtyDaysFromNow
        );
        const validDocs = userDocs.filter((d: any) => d.expiration_date >= today);
        
        const userJobs = (assignmentsData || []).filter(
          (a: any) => a.subcontractor_user_id === profile.user_id && a.status !== 'completed'
        );

        return {
          id: profile.id,
          userId: profile.user_id,
          legalBusinessName: profile.legal_business_name || profile.primary_contact_name || 'Unknown',
          primaryTrade: profile.primary_trade,
          activeJobs: userJobs.length,
          complianceScore: userDocs.length > 0 
            ? Math.round((validDocs.length / userDocs.length) * 100) 
            : 0,
          docsExpiring: expiringDocs.length,
          docsExpired: expiredDocs.length,
        };
      });

      setSubcontractors(subs);

      // Process jobs with subcontractor names
      const jobsList: AdminJob[] = (assignmentsData || []).map((assignment: any) => {
        const sub = subs.find(s => s.userId === assignment.subcontractor_user_id);
        return {
          id: assignment.id,
          jobId: assignment.job_id,
          scheduledDate: assignment.scheduled_date,
          status: assignment.status,
          subcontractorName: sub?.legalBusinessName || 'Unknown',
          isLocked: assignment.is_locked,
          photoProgress: 0, // Would need to calculate from photo counts
          checklistProgress: 0, // Would need to calculate from checklist responses
        };
      });

      setJobs(jobsList);
    } catch (err) {
      console.error('[CrewAdminConsole] Error fetching data:', err);
    } finally {
      setLoading(false);
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
      case 'completed':
        return <Badge className="bg-green-500">Completed</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  if (!isAdmin) {
    return null;
  }

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
        <div className="px-4 py-3 flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={onBack}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <span className="font-semibold">Admin Console</span>
        </div>
      </header>

      <div className="p-4">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="subcontractors">
              <Users className="h-4 w-4 mr-2" />
              Subs
            </TabsTrigger>
            <TabsTrigger value="jobs">
              <Briefcase className="h-4 w-4 mr-2" />
              Jobs
            </TabsTrigger>
          </TabsList>

          {/* Subcontractors Tab */}
          <TabsContent value="subcontractors" className="space-y-3">
            {subcontractors.length === 0 ? (
              <Card>
                <CardContent className="p-6 text-center text-muted-foreground">
                  <Users className="h-12 w-12 mx-auto mb-2 opacity-50" />
                  <p>No subcontractors found</p>
                </CardContent>
              </Card>
            ) : (
              subcontractors.map((sub) => (
                <Card key={sub.id}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="font-medium">{sub.legalBusinessName}</p>
                        <p className="text-sm text-muted-foreground">{sub.primaryTrade}</p>
                      </div>
                      <ChevronRight className="h-5 w-5 text-muted-foreground" />
                    </div>
                    <div className="mt-3 flex items-center gap-4 text-sm">
                      <div className="flex items-center gap-1">
                        <Briefcase className="h-4 w-4 text-muted-foreground" />
                        <span>{sub.activeJobs} active</span>
                      </div>
                      <div className="flex items-center gap-1">
                        {sub.complianceScore >= 100 ? (
                          <CheckCircle className="h-4 w-4 text-green-500" />
                        ) : sub.complianceScore >= 50 ? (
                          <Clock className="h-4 w-4 text-yellow-500" />
                        ) : (
                          <AlertTriangle className="h-4 w-4 text-red-500" />
                        )}
                        <span>{sub.complianceScore}%</span>
                      </div>
                    </div>
                    {(sub.docsExpired > 0 || sub.docsExpiring > 0) && (
                      <div className="mt-2 flex gap-2">
                        {sub.docsExpired > 0 && (
                          <Badge variant="destructive" className="text-xs">
                            {sub.docsExpired} expired
                          </Badge>
                        )}
                        {sub.docsExpiring > 0 && (
                          <Badge className="bg-yellow-500 text-xs">
                            {sub.docsExpiring} expiring
                          </Badge>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))
            )}
          </TabsContent>

          {/* Jobs Tab */}
          <TabsContent value="jobs" className="space-y-3">
            {jobs.length === 0 ? (
              <Card>
                <CardContent className="p-6 text-center text-muted-foreground">
                  <Briefcase className="h-12 w-12 mx-auto mb-2 opacity-50" />
                  <p>No jobs found</p>
                </CardContent>
              </Card>
            ) : (
              jobs.map((job) => (
                <Card 
                  key={job.id}
                  className={job.isLocked ? 'border-red-500/30 bg-red-500/5' : ''}
                >
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="font-medium text-sm">Job #{job.jobId.slice(0, 8)}</p>
                        <p className="text-sm text-muted-foreground">{job.subcontractorName}</p>
                        {job.scheduledDate && (
                          <p className="text-xs text-muted-foreground mt-1">
                            {new Date(job.scheduledDate).toLocaleDateString()}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        {getStatusBadge(job.status, job.isLocked)}
                        <ChevronRight className="h-5 w-5 text-muted-foreground" />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
