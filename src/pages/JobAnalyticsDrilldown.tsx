import React, { useEffect, useState } from 'react';
import { GlobalLayout } from "@/shared/components/layout/GlobalLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";

interface Job {
  id: string;
  contact_id: string;
  status: 'lead' | 'legal' | 'contingency' | 'ready_for_approval' | 'production' | 'final_payment' | 'closed';
  created_at: string;
  contacts?: {
    first_name: string;
    last_name: string;
  };
}

const JobAnalyticsDrilldown = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);

  const metric = searchParams.get('metric') || 'total';
  const from = searchParams.get('from');
  const to = searchParams.get('to');

  const metricTitles: Record<string, string> = {
    total: 'All Jobs',
    leads: 'Lead Jobs',
    production: 'Production Jobs',
    closed: 'Closed Jobs'
  };

  const statusFilters: Record<string, Array<'lead' | 'legal' | 'contingency' | 'ready_for_approval' | 'production' | 'final_payment' | 'closed'>> = {
    leads: ['lead'],
    production: ['production'],
    closed: ['closed'],
    total: []
  };

  useEffect(() => {
    fetchJobs();
  }, [metric, from, to]);

  const fetchJobs = async () => {
    try {
      let query = supabase
        .from('jobs')
        .select(`
          id,
          contact_id,
          status,
          created_at,
          contacts (
            first_name,
            last_name
          )
        `)
        .order('created_at', { ascending: false });

      // Apply status filter
      const statuses = statusFilters[metric];
      if (statuses && statuses.length > 0) {
        query = query.in('status', statuses);
      }

      // Apply date range
      if (from) {
        query = query.gte('created_at', from);
      }
      if (to) {
        query = query.lte('created_at', to);
      }

      const { data, error } = await query;

      if (error) throw error;

      setJobs(data || []);
    } catch (error) {
      console.error('Error fetching jobs:', error);
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      lead: 'bg-status-lead text-foreground',
      legal: 'bg-status-legal text-status-legal-foreground',
      contingency: 'bg-status-contingency text-status-contingency-foreground',
      production: 'bg-status-project text-status-project-foreground',
      closed: 'bg-status-closed text-status-closed-foreground'
    };
    return colors[status] || 'bg-muted text-foreground';
  };

  return (
    <GlobalLayout>
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate('/job-analytics')}
            className="gap-2"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Analytics
          </Button>
        </div>

        <div>
          <h1 className="text-3xl font-bold">{metricTitles[metric]}</h1>
          <p className="text-muted-foreground">
            {from && to && `${format(new Date(from), 'PP')} - ${format(new Date(to), 'PP')}`}
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Job Details ({jobs.length} total)</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="text-center py-8 text-muted-foreground">
                Loading jobs...
              </div>
            ) : jobs.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                No jobs found for this criteria
              </div>
            ) : (
              <div className="space-y-3">
                {jobs.map((job) => (
                  <div 
                    key={job.id}
                    className="flex items-center justify-between p-4 rounded-lg bg-muted/50 hover:bg-muted transition-smooth cursor-pointer"
                    onClick={() => navigate(`/jobs/${job.id}`)}
                  >
                    <div className="flex-1">
                      <div className="flex items-center gap-3">
                        <span className="font-mono text-sm text-muted-foreground">{job.id}</span>
                        <Badge variant="outline" className={getStatusColor(job.status)}>
                          {job.status}
                        </Badge>
                      </div>
                      <h3 className="font-semibold mt-1">
                        {job.contacts?.first_name} {job.contacts?.last_name}
                      </h3>
                      <p className="text-sm text-muted-foreground">
                        Created: {format(new Date(job.created_at), 'PPp')}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </GlobalLayout>
  );
};

export default JobAnalyticsDrilldown;
