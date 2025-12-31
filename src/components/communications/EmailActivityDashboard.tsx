import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { 
  Mail, Send, CheckCircle2, Eye, MousePointerClick, 
  AlertTriangle, Search, RefreshCw, ExternalLink, Calendar
} from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';

interface EmailRecord {
  id: string;
  recipient: string;
  subject: string;
  sent_at: string;
  email_status: string;
  delivered_at: string | null;
  opened_at: string | null;
  opened_count: number;
  clicked_at: string | null;
  clicked_count: number;
  bounced_at: string | null;
  bounce_reason: string | null;
  resend_message_id: string | null;
  contact?: {
    first_name: string;
    last_name: string;
  };
}

const statusConfig = {
  sent: { label: 'Sent', color: 'bg-blue-500/10 text-blue-600 border-blue-500/20', icon: Send },
  delivered: { label: 'Delivered', color: 'bg-green-500/10 text-green-600 border-green-500/20', icon: CheckCircle2 },
  opened: { label: 'Opened', color: 'bg-purple-500/10 text-purple-600 border-purple-500/20', icon: Eye },
  clicked: { label: 'Clicked', color: 'bg-orange-500/10 text-orange-600 border-orange-500/20', icon: MousePointerClick },
  bounced: { label: 'Bounced', color: 'bg-destructive/10 text-destructive border-destructive/20', icon: AlertTriangle },
  failed: { label: 'Failed', color: 'bg-destructive/10 text-destructive border-destructive/20', icon: AlertTriangle },
};

export function EmailActivityDashboard() {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [dateRange, setDateRange] = useState<string>('7d');

  // Fetch emails with engagement data
  const { data: emails, isLoading, refetch } = useQuery({
    queryKey: ['email-activity', dateRange],
    queryFn: async () => {
      const daysAgo = dateRange === '7d' ? 7 : dateRange === '30d' ? 30 : 90;
      const fromDate = new Date();
      fromDate.setDate(fromDate.getDate() - daysAgo);

      const { data, error } = await supabase
        .from('communication_history')
        .select(`
          id,
          subject,
          created_at,
          email_status,
          delivered_at,
          opened_at,
          opened_count,
          clicked_at,
          clicked_count,
          bounced_at,
          bounce_reason,
          resend_message_id,
          metadata,
          contact:contacts(first_name, last_name)
        `)
        .eq('communication_type', 'email')
        .gte('created_at', fromDate.toISOString())
        .order('created_at', { ascending: false });

      if (error) throw error;
      
      // Map data to expected format
      return (data || []).map((item: any) => ({
        id: item.id,
        recipient: item.metadata?.to?.[0] || 'Unknown',
        subject: item.subject,
        sent_at: item.created_at,
        email_status: item.email_status || 'sent',
        delivered_at: item.delivered_at,
        opened_at: item.opened_at,
        opened_count: item.opened_count || 0,
        clicked_at: item.clicked_at,
        clicked_count: item.clicked_count || 0,
        bounced_at: item.bounced_at,
        bounce_reason: item.bounce_reason,
        resend_message_id: item.resend_message_id,
        contact: item.contact
      })) as EmailRecord[];
    }
  });

  // Calculate metrics
  const metrics = useMemo(() => {
    if (!emails?.length) return { total: 0, delivered: 0, opened: 0, clicked: 0, bounced: 0, deliveryRate: 0, openRate: 0, clickRate: 0 };

    const total = emails.length;
    const delivered = emails.filter(e => e.email_status === 'delivered' || e.email_status === 'opened' || e.email_status === 'clicked').length;
    const opened = emails.filter(e => e.opened_count > 0).length;
    const clicked = emails.filter(e => e.clicked_count > 0).length;
    const bounced = emails.filter(e => e.email_status === 'bounced' || e.email_status === 'failed').length;

    return {
      total,
      delivered,
      opened,
      clicked,
      bounced,
      deliveryRate: total > 0 ? Math.round((delivered / total) * 100) : 0,
      openRate: delivered > 0 ? Math.round((opened / delivered) * 100) : 0,
      clickRate: opened > 0 ? Math.round((clicked / opened) * 100) : 0,
    };
  }, [emails]);

  // Filter emails
  const filteredEmails = useMemo(() => {
    if (!emails) return [];
    
    return emails.filter(email => {
      const matchesSearch = 
        searchQuery === '' ||
        email.recipient?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        email.subject?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        email.contact?.first_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        email.contact?.last_name?.toLowerCase().includes(searchQuery.toLowerCase());

      const matchesStatus = 
        statusFilter === 'all' ||
        email.email_status === statusFilter ||
        (statusFilter === 'opened' && email.opened_count > 0) ||
        (statusFilter === 'clicked' && email.clicked_count > 0);

      return matchesSearch && matchesStatus;
    });
  }, [emails, searchQuery, statusFilter]);

  const getEmailStatus = (email: EmailRecord): keyof typeof statusConfig => {
    if (email.clicked_count > 0) return 'clicked';
    if (email.opened_count > 0) return 'opened';
    if (email.bounced_at) return 'bounced';
    if (email.delivered_at) return 'delivered';
    return 'sent';
  };

  const StatusBadge = ({ email }: { email: EmailRecord }) => {
    const status = getEmailStatus(email);
    const config = statusConfig[status];
    const Icon = config.icon;

    return (
      <Badge variant="outline" className={`${config.color} gap-1`}>
        <Icon className="h-3 w-3" />
        {config.label}
        {status === 'opened' && email.opened_count > 1 && (
          <span className="ml-1">({email.opened_count}x)</span>
        )}
        {status === 'clicked' && email.clicked_count > 1 && (
          <span className="ml-1">({email.clicked_count}x)</span>
        )}
      </Badge>
    );
  };

  return (
    <div className="space-y-6 p-4">
      {/* Metrics Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total Sent</p>
                <p className="text-2xl font-bold">{metrics.total}</p>
              </div>
              <Send className="h-8 w-8 text-blue-500 opacity-50" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Delivered</p>
                <p className="text-2xl font-bold">{metrics.delivered}</p>
                <p className="text-xs text-muted-foreground">{metrics.deliveryRate}%</p>
              </div>
              <CheckCircle2 className="h-8 w-8 text-green-500 opacity-50" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Opened</p>
                <p className="text-2xl font-bold">{metrics.opened}</p>
                <p className="text-xs text-muted-foreground">{metrics.openRate}% open rate</p>
              </div>
              <Eye className="h-8 w-8 text-purple-500 opacity-50" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Clicked</p>
                <p className="text-2xl font-bold">{metrics.clicked}</p>
                <p className="text-xs text-muted-foreground">{metrics.clickRate}% click rate</p>
              </div>
              <MousePointerClick className="h-8 w-8 text-orange-500 opacity-50" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Bounced</p>
                <p className="text-2xl font-bold">{metrics.bounced}</p>
                <p className="text-xs text-muted-foreground">
                  {metrics.total > 0 ? Math.round((metrics.bounced / metrics.total) * 100) : 0}% bounce
                </p>
              </div>
              <AlertTriangle className="h-8 w-8 text-destructive opacity-50" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-primary/5 border-primary/20">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Engagement</p>
                <p className="text-2xl font-bold text-primary">{metrics.openRate}%</p>
                <p className="text-xs text-muted-foreground">avg open rate</p>
              </div>
              <Mail className="h-8 w-8 text-primary opacity-50" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg flex items-center gap-2">
              <Mail className="h-5 w-5" />
              Email Activity Log
            </CardTitle>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col sm:flex-row gap-3 mb-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by recipient or subject..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[150px]">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="sent">Sent</SelectItem>
                <SelectItem value="delivered">Delivered</SelectItem>
                <SelectItem value="opened">Opened</SelectItem>
                <SelectItem value="clicked">Clicked</SelectItem>
                <SelectItem value="bounced">Bounced</SelectItem>
              </SelectContent>
            </Select>
            <Select value={dateRange} onValueChange={setDateRange}>
              <SelectTrigger className="w-[130px]">
                <Calendar className="h-4 w-4 mr-2" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7d">Last 7 days</SelectItem>
                <SelectItem value="30d">Last 30 days</SelectItem>
                <SelectItem value="90d">Last 90 days</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Email List */}
          <ScrollArea className="h-[400px]">
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : filteredEmails.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <Mail className="h-12 w-12 mx-auto mb-4 opacity-30" />
                <p>No emails found</p>
              </div>
            ) : (
              <div className="space-y-2">
                {filteredEmails.map((email) => (
                  <div
                    key={email.id}
                    className="flex items-center justify-between p-3 rounded-lg border hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <p className="font-medium truncate">
                          {email.contact 
                            ? `${email.contact.first_name} ${email.contact.last_name}`
                            : email.recipient}
                        </p>
                        <StatusBadge email={email} />
                      </div>
                      <p className="text-sm text-muted-foreground truncate">
                        {email.subject || '(No subject)'}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Sent {email.sent_at ? formatDistanceToNow(new Date(email.sent_at), { addSuffix: true }) : 'recently'}
                      </p>
                    </div>
                    <div className="flex items-center gap-4 text-sm text-muted-foreground ml-4">
                      {email.opened_count > 0 && (
                        <div className="flex items-center gap-1">
                          <Eye className="h-3.5 w-3.5" />
                          <span>{email.opened_count}</span>
                        </div>
                      )}
                      {email.clicked_count > 0 && (
                        <div className="flex items-center gap-1">
                          <MousePointerClick className="h-3.5 w-3.5" />
                          <span>{email.clicked_count}</span>
                        </div>
                      )}
                      {email.resend_message_id && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0"
                          onClick={() => window.open(`https://resend.com/emails/${email.resend_message_id}`, '_blank')}
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}
