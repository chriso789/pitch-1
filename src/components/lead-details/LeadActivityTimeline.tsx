import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
  Activity,
  Phone,
  Mail,
  MessageSquare,
  FileText,
  Eye,
  Pencil,
  Camera,
  RefreshCw,
  ArrowUpRight,
  ArrowDownLeft,
  DollarSign,
  CheckCircle2
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { format, isToday, isYesterday, parseISO } from 'date-fns';

interface LeadActivityTimelineProps {
  pipelineEntryId: string;
  contactId?: string;
}

interface ActivityItem {
  id: string;
  type: 'call' | 'email' | 'sms' | 'estimate' | 'proposal_view' | 'proposal_signed' | 'photo' | 'document' | 'status_change';
  title: string;
  description?: string;
  direction?: 'inbound' | 'outbound';
  metadata?: Record<string, any>;
  created_at: string;
  actor_name?: string;
}

const ACTIVITY_ICONS: Record<string, React.ReactNode> = {
  call: <Phone className="h-3.5 w-3.5" />,
  email: <Mail className="h-3.5 w-3.5" />,
  sms: <MessageSquare className="h-3.5 w-3.5" />,
  estimate: <DollarSign className="h-3.5 w-3.5" />,
  proposal_view: <Eye className="h-3.5 w-3.5" />,
  proposal_signed: <CheckCircle2 className="h-3.5 w-3.5" />,
  photo: <Camera className="h-3.5 w-3.5" />,
  document: <FileText className="h-3.5 w-3.5" />,
  status_change: <RefreshCw className="h-3.5 w-3.5" />
};

const ACTIVITY_COLORS: Record<string, string> = {
  call: 'bg-blue-500/10 text-blue-600',
  email: 'bg-purple-500/10 text-purple-600',
  sms: 'bg-green-500/10 text-green-600',
  estimate: 'bg-orange-500/10 text-orange-600',
  proposal_view: 'bg-cyan-500/10 text-cyan-600',
  proposal_signed: 'bg-emerald-500/10 text-emerald-600',
  photo: 'bg-pink-500/10 text-pink-600',
  document: 'bg-amber-500/10 text-amber-600',
  status_change: 'bg-slate-500/10 text-slate-600'
};

export const LeadActivityTimeline: React.FC<LeadActivityTimelineProps> = ({
  pipelineEntryId,
  contactId
}) => {
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchActivities = async () => {
    setLoading(true);
    const allActivities: ActivityItem[] = [];

    try {
      // Fetch communication history (emails, SMS)
      if (contactId) {
        const { data: commHistory } = await supabase
          .from('communication_history')
          .select('id, communication_type, direction, subject, content, created_at, rep_id, profiles:rep_id(first_name, last_name)')
          .eq('contact_id', contactId)
          .order('created_at', { ascending: false })
          .limit(20);

        commHistory?.forEach(item => {
          allActivities.push({
            id: `comm-${item.id}`,
            type: item.communication_type as 'email' | 'sms',
            title: item.communication_type === 'email' 
              ? (item.subject || 'Email sent')
              : 'SMS message',
            description: item.content?.substring(0, 80) + (item.content?.length > 80 ? '...' : ''),
            direction: item.direction as 'inbound' | 'outbound',
            created_at: item.created_at,
            actor_name: item.profiles 
              ? `${(item.profiles as any).first_name} ${(item.profiles as any).last_name}` 
              : undefined
          });
        });

        // Fetch call logs
        const { data: callLogs } = await supabase
          .from('call_logs')
          .select('id, direction, status, duration_seconds, disposition, created_at, created_by, profiles:created_by(first_name, last_name)')
          .eq('contact_id', contactId)
          .order('created_at', { ascending: false })
          .limit(20);

        callLogs?.forEach(item => {
          const minutes = Math.floor((item.duration_seconds || 0) / 60);
          const seconds = (item.duration_seconds || 0) % 60;
          allActivities.push({
            id: `call-${item.id}`,
            type: 'call',
            title: `Call ${item.status}`,
            description: item.duration_seconds 
              ? `Duration: ${minutes}:${seconds.toString().padStart(2, '0')}${item.disposition ? ` • ${item.disposition}` : ''}`
              : item.disposition || undefined,
            direction: item.direction as 'inbound' | 'outbound',
            created_at: item.created_at,
            actor_name: item.profiles 
              ? `${(item.profiles as any).first_name} ${(item.profiles as any).last_name}` 
              : undefined
          });
        });
      }

      // Fetch estimates
      const { data: estimates } = await supabase
        .from('enhanced_estimates')
        .select('id, estimate_number, selling_price, status, created_at, updated_at, first_viewed_at, signed_at, created_by')
        .eq('pipeline_entry_id', pipelineEntryId)
        .order('created_at', { ascending: false })
        .limit(10);

      estimates?.forEach(item => {
        // Estimate created
        allActivities.push({
          id: `est-created-${item.id}`,
          type: 'estimate',
          title: `Estimate #${item.estimate_number || 'Draft'} created`,
          description: item.selling_price ? `$${item.selling_price.toLocaleString()}` : undefined,
          created_at: item.created_at
        });

        // Proposal viewed
        if (item.first_viewed_at) {
          allActivities.push({
            id: `est-viewed-${item.id}`,
            type: 'proposal_view',
            title: 'Proposal viewed by customer',
            description: `Estimate #${item.estimate_number}`,
            created_at: item.first_viewed_at
          });
        }

        // Proposal signed
        if (item.signed_at) {
          allActivities.push({
            id: `est-signed-${item.id}`,
            type: 'proposal_signed',
            title: 'Proposal signed!',
            description: `Estimate #${item.estimate_number}`,
            created_at: item.signed_at
          });
        }
      });

      // Fetch documents (photos are stored in documents table)
      const { data: docs } = await supabase
        .from('documents')
        .select('id, document_type, filename, mime_type, created_at, uploaded_by')
        .eq('pipeline_entry_id', pipelineEntryId)
        .order('created_at', { ascending: false })
        .limit(20);

      // Group documents by minute to consolidate
      const docGroups = new Map<string, NonNullable<typeof docs>>();
      docs?.forEach(doc => {
        const key = (doc.created_at || '').substring(0, 16); // Group by minute
        if (!docGroups.has(key)) {
          docGroups.set(key, []);
        }
        docGroups.get(key)!.push(doc);
      });

      docGroups.forEach((group, key) => {
        const isPhoto = group.some(d => d.document_type?.includes('photo') || d.mime_type?.includes('image'));
        const types = [...new Set(group.map(d => d.document_type).filter(Boolean))];
        allActivities.push({
          id: `docs-${key}`,
          type: isPhoto ? 'photo' : 'document',
          title: `${group.length} ${isPhoto ? 'photo' : 'document'}${group.length !== 1 ? 's' : ''} uploaded`,
          description: types.length > 0 ? types.join(', ') : undefined,
          created_at: group[0].created_at || new Date().toISOString()
        });
      });

      // Sort all activities by date
      allActivities.sort((a, b) => 
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );

      setActivities(allActivities.slice(0, 50));
    } catch (error) {
      console.error('Error fetching activities:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchActivities();
  }, [pipelineEntryId, contactId]);

  // Group activities by day
  const groupedActivities = activities.reduce((groups, activity) => {
    const date = parseISO(activity.created_at);
    let label = format(date, 'MMM d, yyyy');
    
    if (isToday(date)) {
      label = 'Today';
    } else if (isYesterday(date)) {
      label = 'Yesterday';
    }
    
    if (!groups[label]) {
      groups[label] = [];
    }
    groups[label].push(activity);
    return groups;
  }, {} as Record<string, ActivityItem[]>);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Activity className="h-4 w-4" />
          Activity Timeline
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[300px] pr-4">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-pulse text-sm text-muted-foreground">
                Loading activity...
              </div>
            </div>
          ) : activities.length === 0 ? (
            <div className="text-center py-8 text-sm text-muted-foreground">
              No activity yet
            </div>
          ) : (
            <div className="space-y-6">
              {Object.entries(groupedActivities).map(([dateLabel, dayActivities]) => (
                <div key={dateLabel}>
                  <div className="text-xs font-medium text-muted-foreground mb-3">
                    {dateLabel}
                  </div>
                  <div className="relative space-y-0">
                    {/* Timeline line */}
                    <div className="absolute left-3 top-3 bottom-3 w-px bg-border" />
                    
                    {dayActivities.map((activity, index) => (
                      <div 
                        key={activity.id}
                        className="relative flex gap-3 pb-4 last:pb-0"
                      >
                        {/* Icon */}
                        <div className={cn(
                          "relative z-10 flex items-center justify-center w-6 h-6 rounded-full flex-shrink-0",
                          ACTIVITY_COLORS[activity.type] || 'bg-muted text-muted-foreground'
                        )}>
                          {ACTIVITY_ICONS[activity.type]}
                        </div>
                        
                        {/* Content */}
                        <div className="flex-1 min-w-0 pt-0.5">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-medium truncate">
                              {activity.title}
                            </span>
                            {activity.direction && (
                              activity.direction === 'outbound' 
                                ? <ArrowUpRight className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                                : <ArrowDownLeft className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                            )}
                          </div>
                          
                          {activity.description && (
                            <p className="text-xs text-muted-foreground mt-0.5 truncate">
                              {activity.description}
                            </p>
                          )}
                          
                          <div className="flex items-center gap-2 mt-1 text-[10px] text-muted-foreground">
                            <span>{format(parseISO(activity.created_at), 'h:mm a')}</span>
                            {activity.actor_name && (
                              <>
                                <span>•</span>
                                <span>{activity.actor_name}</span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  );
};
