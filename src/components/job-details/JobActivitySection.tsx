import React, { useEffect, useState } from 'react';
import { Card, CardContent } from "@/components/ui/card";
import { 
  FileText, Camera, CreditCard, MessageSquare, Clock, TrendingUp 
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { formatDistanceToNow } from 'date-fns';

interface JobActivitySectionProps {
  projectId: string;
  contactId?: string;
}

interface ActivityMetrics {
  documentsCount: number;
  photosCount: number;
  paymentsCount: number;
  paymentTotal: number;
  communicationsCount: number;
  lastTouched: {
    timestamp: string;
    userName: string;
  } | null;
  statusChanges: number;
}

export const JobActivitySection = ({ projectId, contactId }: JobActivitySectionProps) => {
  const [metrics, setMetrics] = useState<ActivityMetrics>({
    documentsCount: 0,
    photosCount: 0,
    paymentsCount: 0,
    paymentTotal: 0,
    communicationsCount: 0,
    lastTouched: null,
    statusChanges: 0
  });

  useEffect(() => {
    fetchActivityMetrics();
  }, [projectId, contactId]);

  const fetchActivityMetrics = async () => {
    try {
      // Fetch documents count
      const { count: docsCount } = await supabase
        .from('documents')
        .select('*', { count: 'exact', head: true })
        .eq('project_id', projectId);

      // Fetch photos count (documents with specific types)
      const { count: photosCount } = await supabase
        .from('documents')
        .select('*', { count: 'exact', head: true })
        .eq('project_id', projectId)
        .in('mime_type', ['image/jpeg', 'image/png', 'image/jpg', 'image/webp']);

      // Fetch payments
      const { data: payments } = await supabase
        .from('payments')
        .select('amount')
        .eq('project_id', projectId);

      const paymentTotal = payments?.reduce((sum, p) => sum + (p.amount || 0), 0) || 0;

      // Fetch communications
      const { count: commsCount } = await supabase
        .from('communication_history')
        .select('*', { count: 'exact', head: true })
        .or(`project_id.eq.${projectId}${contactId ? `,contact_id.eq.${contactId}` : ''}`);

      // Fetch last touched (most recent audit log entry)
      const { data: lastAudit } = await supabase
        .from('audit_log')
        .select('changed_at, changed_by')
        .eq('table_name', 'projects')
        .eq('record_id', projectId)
        .order('changed_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      let lastTouched = null;
      if (lastAudit) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('first_name, last_name')
          .eq('id', lastAudit.changed_by)
          .maybeSingle();

        if (profile) {
          lastTouched = {
            timestamp: lastAudit.changed_at,
            userName: `${profile.first_name} ${profile.last_name}`
          };
        }
      }

      // Fetch status changes count
      const { count: statusChanges } = await supabase
        .from('production_stage_history')
        .select('*', { count: 'exact', head: true })
        .eq('production_workflow_id', projectId);

      setMetrics({
        documentsCount: docsCount || 0,
        photosCount: photosCount || 0,
        paymentsCount: payments?.length || 0,
        paymentTotal,
        communicationsCount: commsCount || 0,
        lastTouched,
        statusChanges: statusChanges || 0
      });

    } catch (error) {
      console.error('Error fetching activity metrics:', error);
    }
  };

  const MetricCard = ({ 
    icon: Icon, 
    label, 
    value, 
    subValue, 
    color 
  }: { 
    icon: any; 
    label: string; 
    value: string | number; 
    subValue?: string; 
    color: string;
  }) => (
    <div className="flex items-center gap-3 p-4 rounded-lg border bg-card">
      <div className={`p-2 rounded-lg ${color}`}>
        <Icon className="h-5 w-5 text-white" />
      </div>
      <div className="flex-1">
        <div className="text-sm text-muted-foreground">{label}</div>
        <div className="text-xl font-bold">{value}</div>
        {subValue && <div className="text-xs text-muted-foreground">{subValue}</div>}
      </div>
    </div>
  );

  return (
    <Card>
      <CardContent className="p-6">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <MetricCard
            icon={FileText}
            label="Documents"
            value={metrics.documentsCount}
            color="bg-blue-500"
          />
          <MetricCard
            icon={Camera}
            label="Photos"
            value={metrics.photosCount}
            color="bg-purple-500"
          />
          <MetricCard
            icon={CreditCard}
            label="Payments"
            value={metrics.paymentsCount}
            subValue={`$${metrics.paymentTotal.toLocaleString()}`}
            color="bg-green-500"
          />
          <MetricCard
            icon={MessageSquare}
            label="Communications"
            value={metrics.communicationsCount}
            color="bg-orange-500"
          />
          <MetricCard
            icon={Clock}
            label="Last Touched"
            value={metrics.lastTouched 
              ? formatDistanceToNow(new Date(metrics.lastTouched.timestamp), { addSuffix: true })
              : 'Never'
            }
            subValue={metrics.lastTouched?.userName}
            color="bg-cyan-500"
          />
          <MetricCard
            icon={TrendingUp}
            label="Status Changes"
            value={metrics.statusChanges}
            color="bg-pink-500"
          />
        </div>
      </CardContent>
    </Card>
  );
};