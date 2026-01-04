import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { 
  Mail, 
  CheckCircle, 
  XCircle, 
  Clock, 
  RefreshCw,
  Eye,
  Send,
  Search,
  Filter,
  ExternalLink,
  AlertCircle
} from "lucide-react";
import { format } from "date-fns";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface EmailLog {
  id: string;
  tenant_id: string | null;
  recipient_email: string;
  recipient_name: string | null;
  status: string | null;
  resend_message_id: string | null;
  sent_at: string | null;
  sent_by: string | null;
  delivered_at: string | null;
  bounced_at: string | null;
  last_opened_at: string | null;
  last_clicked_at: string | null;
  opens_count: number | null;
  clicks_count: number | null;
  email_type: string | null;
  email_body: string | null;
  expires_at: string | null;
  metadata: any;
  company_name?: string;
}

export const EmailLogViewer = () => {
  const [emailLogs, setEmailLogs] = useState<EmailLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [selectedEmail, setSelectedEmail] = useState<EmailLog | null>(null);
  const [resending, setResending] = useState<string | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    loadEmailLogs();
  }, []);

  const loadEmailLogs = async () => {
    try {
      setLoading(true);
      
      const { data: logs, error } = await supabase
        .from('onboarding_email_log')
        .select(`
          *,
          tenants:tenant_id (name)
        `)
        .order('created_at', { ascending: false })
        .limit(100);

      if (error) throw error;

      const logsWithCompanyNames: EmailLog[] = (logs || []).map(log => ({
        ...log,
        company_name: (log.tenants as any)?.name || 'Unknown'
      }));

      setEmailLogs(logsWithCompanyNames);
    } catch (error: any) {
      console.error('Error loading email logs:', error);
      toast({
        title: "Error loading email logs",
        description: error.message,
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const resendEmail = async (log: EmailLog) => {
    if (!log.tenant_id) {
      toast({
        title: "Cannot resend",
        description: "No tenant ID associated with this email",
        variant: "destructive"
      });
      return;
    }

    setResending(log.id);
    try {
      const { error } = await supabase.functions.invoke('send-user-invitation', {
        body: {
          email: log.recipient_email,
          firstName: log.recipient_name?.split(' ')[0] || 'User',
          lastName: log.recipient_name?.split(' ').slice(1).join(' ') || '',
          role: log.metadata?.role || 'owner',
          companyName: log.company_name || 'Your Company',
          tenantId: log.tenant_id,
        }
      });

      if (error) throw error;

      toast({
        title: "Email resent!",
        description: `Onboarding email resent to ${log.recipient_email}`
      });

      loadEmailLogs();
    } catch (error: any) {
      console.error('Error resending email:', error);
      toast({
        title: "Failed to resend",
        description: error.message,
        variant: "destructive"
      });
    } finally {
      setResending(null);
    }
  };

  const getStatusBadge = (log: EmailLog) => {
    if (log.bounced_at) {
      return <Badge variant="destructive">Bounced</Badge>;
    }
    if (log.status === 'failed') {
      return <Badge variant="destructive">Failed</Badge>;
    }
    if (log.status === 'sent' && log.resend_message_id) {
      if (log.last_opened_at) {
        return <Badge className="bg-green-500/10 text-green-600 border-green-500/20">Opened</Badge>;
      }
      return <Badge className="bg-blue-500/10 text-blue-600 border-blue-500/20">Sent</Badge>;
    }
    return <Badge variant="secondary">{log.status || 'Pending'}</Badge>;
  };

  const getTypeBadge = (type: string | null) => {
    const typeColors: Record<string, string> = {
      owner_invite: 'bg-purple-500/10 text-purple-600 border-purple-500/20',
      user_invite: 'bg-blue-500/10 text-blue-600 border-blue-500/20',
      password_reset: 'bg-amber-500/10 text-amber-600 border-amber-500/20',
      demo_request: 'bg-green-500/10 text-green-600 border-green-500/20',
    };
    
    return (
      <Badge className={typeColors[type || ''] || 'bg-gray-500/10 text-gray-600'}>
        {type?.replace('_', ' ') || 'unknown'}
      </Badge>
    );
  };

  const filteredLogs = emailLogs.filter(log => {
    const matchesSearch = 
      log.recipient_email.toLowerCase().includes(searchQuery.toLowerCase()) ||
      log.recipient_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      log.company_name?.toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesStatus = statusFilter === 'all' || log.status === statusFilter;
    const matchesType = typeFilter === 'all' || log.email_type === typeFilter;
    
    return matchesSearch && matchesStatus && matchesType;
  });

  const stats = {
    total: emailLogs.length,
    sent: emailLogs.filter(l => l.status === 'sent').length,
    failed: emailLogs.filter(l => l.status === 'failed' || l.bounced_at).length,
    opened: emailLogs.filter(l => l.last_opened_at).length,
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Mail className="h-5 w-5 text-primary" />
            Email Log Viewer
          </h3>
          <p className="text-sm text-muted-foreground">
            View all sent emails across all tenants
          </p>
        </div>
        <Button 
          variant="outline" 
          size="sm" 
          onClick={loadEmailLogs}
          disabled={loading}
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <Mail className="h-4 w-4 text-muted-foreground" />
              <span className="text-2xl font-bold">{stats.total}</span>
            </div>
            <p className="text-xs text-muted-foreground">Total Emails</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <CheckCircle className="h-4 w-4 text-green-500" />
              <span className="text-2xl font-bold">{stats.sent}</span>
            </div>
            <p className="text-xs text-muted-foreground">Sent</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <XCircle className="h-4 w-4 text-destructive" />
              <span className="text-2xl font-bold">{stats.failed}</span>
            </div>
            <p className="text-xs text-muted-foreground">Failed</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <Eye className="h-4 w-4 text-blue-500" />
              <span className="text-2xl font-bold">{stats.opened}</span>
            </div>
            <p className="text-xs text-muted-foreground">Opened</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by email, name, or company..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[140px]">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="sent">Sent</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
              </SelectContent>
            </Select>
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder="Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                <SelectItem value="owner_invite">Owner Invite</SelectItem>
                <SelectItem value="user_invite">User Invite</SelectItem>
                <SelectItem value="password_reset">Password Reset</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Email List */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Email History</CardTitle>
          <CardDescription>
            {filteredLogs.length} emails found
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : filteredLogs.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Mail className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p>No emails found</p>
            </div>
          ) : (
            <ScrollArea className="h-[500px]">
              <div className="space-y-2">
                {filteredLogs.map((log) => (
                  <div 
                    key={log.id} 
                    className="flex items-center justify-between p-4 border rounded-lg hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex items-center gap-4 flex-1 min-w-0">
                      <div className="flex-shrink-0">
                        {log.status === 'sent' && log.resend_message_id ? (
                          <CheckCircle className="h-5 w-5 text-green-500" />
                        ) : log.status === 'failed' || log.bounced_at ? (
                          <XCircle className="h-5 w-5 text-destructive" />
                        ) : (
                          <Clock className="h-5 w-5 text-muted-foreground" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-medium truncate">{log.recipient_email}</p>
                          {getStatusBadge(log)}
                          {getTypeBadge(log.email_type)}
                        </div>
                        <div className="flex items-center gap-2 text-sm text-muted-foreground mt-1">
                          <span>{log.company_name}</span>
                          {log.sent_at && (
                            <>
                              <span>•</span>
                              <span>{format(new Date(log.sent_at), 'MMM d, yyyy h:mm a')}</span>
                            </>
                          )}
                          {log.opens_count && log.opens_count > 0 && (
                            <>
                              <span>•</span>
                              <span className="text-green-600">{log.opens_count} opens</span>
                            </>
                          )}
                        </div>
                        {log.expires_at && new Date(log.expires_at) < new Date() && (
                          <p className="text-xs text-amber-600 mt-1 flex items-center gap-1">
                            <AlertCircle className="h-3 w-3" />
                            Link expired
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {log.email_body && (
                        <Dialog>
                          <DialogTrigger asChild>
                            <Button variant="ghost" size="sm" onClick={() => setSelectedEmail(log)}>
                              <Eye className="h-4 w-4" />
                            </Button>
                          </DialogTrigger>
                          <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
                            <DialogHeader>
                              <DialogTitle>Email Preview</DialogTitle>
                            </DialogHeader>
                            <div className="space-y-4">
                              <div className="grid grid-cols-2 gap-4 text-sm">
                                <div>
                                  <span className="text-muted-foreground">To:</span>
                                  <span className="ml-2 font-medium">{log.recipient_email}</span>
                                </div>
                                <div>
                                  <span className="text-muted-foreground">Status:</span>
                                  <span className="ml-2">{getStatusBadge(log)}</span>
                                </div>
                                <div>
                                  <span className="text-muted-foreground">Sent:</span>
                                  <span className="ml-2">{log.sent_at ? format(new Date(log.sent_at), 'PPpp') : 'N/A'}</span>
                                </div>
                                <div>
                                  <span className="text-muted-foreground">Type:</span>
                                  <span className="ml-2">{getTypeBadge(log.email_type)}</span>
                                </div>
                              </div>
                              <div className="border rounded-lg overflow-hidden">
                                <iframe
                                  srcDoc={log.email_body || '<p>No content</p>'}
                                  className="w-full h-[400px] border-0"
                                  title="Email Preview"
                                />
                              </div>
                            </div>
                          </DialogContent>
                        </Dialog>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => resendEmail(log)}
                        disabled={resending === log.id}
                      >
                        {resending === log.id ? (
                          <RefreshCw className="h-4 w-4 animate-spin" />
                        ) : (
                          <>
                            <Send className="h-4 w-4 mr-1" />
                            Resend
                          </>
                        )}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default EmailLogViewer;
