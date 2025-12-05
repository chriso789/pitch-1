import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { 
  Mail, 
  CheckCircle, 
  XCircle, 
  AlertTriangle, 
  Send, 
  RefreshCw,
  Clock,
  ExternalLink,
  Server,
  Shield,
  Globe,
  AlertCircle
} from "lucide-react";
import { format } from "date-fns";

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
  metadata: any;
  company_name?: string;
}

interface DiagnosticCheck {
  name: string;
  status: 'success' | 'warning' | 'error' | 'checking';
  message: string;
  details?: string;
}

export const EmailDiagnosticsPanel = () => {
  const [emailLogs, setEmailLogs] = useState<EmailLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [testEmail, setTestEmail] = useState("");
  const [sendingTest, setSendingTest] = useState(false);
  const [diagnostics, setDiagnostics] = useState<DiagnosticCheck[]>([]);
  const [runningDiagnostics, setRunningDiagnostics] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    loadEmailLogs();
    runDiagnostics();
  }, []);

  const loadEmailLogs = async () => {
    try {
      setLoading(true);
      
      // Fetch email logs with company names
      const { data: logs, error } = await supabase
        .from('onboarding_email_log')
        .select(`
          *,
          tenants:tenant_id (name)
        `)
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) throw error;

      const logsWithCompanyNames: EmailLog[] = (logs || []).map(log => ({
        id: log.id,
        tenant_id: log.tenant_id,
        recipient_email: log.recipient_email,
        recipient_name: log.recipient_name,
        status: log.status,
        resend_message_id: log.resend_message_id,
        sent_at: log.sent_at,
        sent_by: log.sent_by,
        delivered_at: log.delivered_at,
        bounced_at: log.bounced_at,
        last_opened_at: log.last_opened_at,
        last_clicked_at: log.last_clicked_at,
        opens_count: log.opens_count,
        clicks_count: log.clicks_count,
        metadata: log.metadata,
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

  const runDiagnostics = async () => {
    setRunningDiagnostics(true);
    const checks: DiagnosticCheck[] = [];

    // Check 1: Resend API Key configured
    checks.push({
      name: 'Resend API Key',
      status: 'checking',
      message: 'Checking configuration...'
    });
    setDiagnostics([...checks]);

    // We can't directly check secrets, but we can infer from logs
    const hasApiKey = emailLogs.some(log => log.resend_message_id || log.status === 'sent');
    checks[0] = {
      name: 'Resend API Key',
      status: hasApiKey ? 'success' : 'warning',
      message: hasApiKey ? 'API key appears configured' : 'Unable to verify - check Supabase secrets',
      details: 'RESEND_API_KEY should be set in Supabase Edge Function secrets'
    };
    setDiagnostics([...checks]);

    // Check 2: Domain verification
    const failedDomainLogs = emailLogs.filter(log => 
      log.metadata?.error?.includes('verify a domain') || 
      log.metadata?.error?.includes('validation_error')
    );
    
    checks.push({
      name: 'Domain Verification',
      status: failedDomainLogs.length > 0 ? 'error' : 'success',
      message: failedDomainLogs.length > 0 
        ? 'Domain NOT verified - emails failing' 
        : 'Domain appears verified',
      details: failedDomainLogs.length > 0 
        ? 'Go to resend.com/domains to verify your sending domain. Currently using test mode (onboarding@resend.dev) which only works for your own email.'
        : 'Emails are being sent successfully'
    });
    setDiagnostics([...checks]);

    // Check 3: Recent email success rate
    const recentLogs = emailLogs.slice(0, 20);
    const successCount = recentLogs.filter(log => log.status === 'sent' && log.resend_message_id).length;
    const failCount = recentLogs.filter(log => log.status === 'failed' || !log.resend_message_id).length;
    const successRate = recentLogs.length > 0 ? Math.round((successCount / recentLogs.length) * 100) : 0;

    checks.push({
      name: 'Email Delivery Rate',
      status: successRate >= 80 ? 'success' : successRate >= 50 ? 'warning' : 'error',
      message: `${successRate}% success rate (${successCount}/${recentLogs.length} recent emails)`,
      details: failCount > 0 ? `${failCount} emails failed recently` : 'All recent emails delivered'
    });
    setDiagnostics([...checks]);

    // Check 4: From domain configuration
    checks.push({
      name: 'From Domain (RESEND_FROM_DOMAIN)',
      status: 'warning',
      message: 'Check Supabase secrets for RESEND_FROM_DOMAIN',
      details: 'Should be set to your verified domain (e.g., pitch-crm.ai). Without this, emails use onboarding@resend.dev which is test-only.'
    });
    setDiagnostics([...checks]);

    setRunningDiagnostics(false);
  };

  const sendTestEmail = async () => {
    if (!testEmail) {
      toast({
        title: "Email required",
        description: "Please enter an email address",
        variant: "destructive"
      });
      return;
    }

    setSendingTest(true);
    try {
      const { data, error } = await supabase.functions.invoke('send-company-onboarding', {
        body: {
          tenantId: 'test-diagnostic',
          companyName: 'Email Diagnostic Test',
          ownerEmail: testEmail,
          ownerName: 'Test User',
          isTest: true
        }
      });

      if (error) throw error;

      if (data?.success) {
        toast({
          title: "Test email sent!",
          description: `Email sent to ${testEmail}. Check inbox (and spam folder).`
        });
      } else {
        throw new Error(data?.error || 'Failed to send test email');
      }

      // Refresh logs
      setTimeout(loadEmailLogs, 2000);
    } catch (error: any) {
      console.error('Test email error:', error);
      toast({
        title: "Failed to send test email",
        description: error.message || 'Check edge function logs for details',
        variant: "destructive"
      });
    } finally {
      setSendingTest(false);
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'success':
        return <CheckCircle className="h-5 w-5 text-green-500" />;
      case 'warning':
        return <AlertTriangle className="h-5 w-5 text-yellow-500" />;
      case 'error':
        return <XCircle className="h-5 w-5 text-destructive" />;
      case 'checking':
        return <RefreshCw className="h-5 w-5 text-muted-foreground animate-spin" />;
      default:
        return <AlertCircle className="h-5 w-5 text-muted-foreground" />;
    }
  };

  const getLogStatusBadge = (log: EmailLog) => {
    if (log.status === 'sent' && log.resend_message_id) {
      return <Badge className="bg-green-500/10 text-green-600 border-green-500/20">Sent</Badge>;
    }
    if (log.bounced_at) {
      return <Badge variant="destructive">Bounced</Badge>;
    }
    if (log.status === 'failed' || !log.resend_message_id) {
      return <Badge variant="destructive">Failed</Badge>;
    }
    return <Badge variant="secondary">{log.status || 'Pending'}</Badge>;
  };

  const failedLogs = emailLogs.filter(log => log.status === 'failed' || !log.resend_message_id);
  const successLogs = emailLogs.filter(log => log.status === 'sent' && log.resend_message_id);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Mail className="h-5 w-5 text-primary" />
            Email Diagnostics
          </h3>
          <p className="text-sm text-muted-foreground">
            Monitor Resend email configuration and delivery status
          </p>
        </div>
        <Button 
          variant="outline" 
          size="sm" 
          onClick={() => { loadEmailLogs(); runDiagnostics(); }}
          disabled={loading || runningDiagnostics}
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${(loading || runningDiagnostics) ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* Stats Overview */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-green-500/10 rounded-lg">
                <CheckCircle className="h-5 w-5 text-green-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">{successLogs.length}</p>
                <p className="text-sm text-muted-foreground">Delivered</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-destructive/10 rounded-lg">
                <XCircle className="h-5 w-5 text-destructive" />
              </div>
              <div>
                <p className="text-2xl font-bold">{failedLogs.length}</p>
                <p className="text-sm text-muted-foreground">Failed</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-500/10 rounded-lg">
                <Mail className="h-5 w-5 text-blue-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">{emailLogs.length}</p>
                <p className="text-sm text-muted-foreground">Total Emails</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-primary/10 rounded-lg">
                <Server className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-bold">
                  {emailLogs.length > 0 
                    ? Math.round((successLogs.length / emailLogs.length) * 100) 
                    : 0}%
                </p>
                <p className="text-sm text-muted-foreground">Success Rate</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Diagnostic Checks */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Configuration Checks
          </CardTitle>
          <CardDescription>
            Automated checks for email infrastructure
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {diagnostics.map((check, index) => (
            <div 
              key={index} 
              className="flex items-start gap-3 p-3 rounded-lg border bg-muted/30"
            >
              {getStatusIcon(check.status)}
              <div className="flex-1">
                <p className="font-medium">{check.name}</p>
                <p className="text-sm text-muted-foreground">{check.message}</p>
                {check.details && (
                  <p className="text-xs text-muted-foreground mt-1">{check.details}</p>
                )}
              </div>
            </div>
          ))}

          <Separator className="my-4" />

          {/* Quick Fix Guide */}
          <div className="p-4 rounded-lg border border-yellow-500/30 bg-yellow-500/5">
            <h4 className="font-medium flex items-center gap-2 text-yellow-600">
              <AlertTriangle className="h-4 w-4" />
              Domain Verification Required
            </h4>
            <ol className="text-sm text-muted-foreground mt-2 space-y-2 list-decimal list-inside">
              <li>Go to <a href="https://resend.com/domains" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline inline-flex items-center gap-1">resend.com/domains <ExternalLink className="h-3 w-3" /></a></li>
              <li>Add your domain (e.g., pitch-crm.ai)</li>
              <li>Add the DNS records (SPF, DKIM, DMARC) to your domain</li>
              <li>Wait for verification (5-15 minutes)</li>
              <li>Add <code className="bg-muted px-1 rounded">RESEND_FROM_DOMAIN</code> secret in Supabase with your verified domain</li>
            </ol>
          </div>
        </CardContent>
      </Card>

      {/* Test Email */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Send className="h-5 w-5" />
            Send Test Email
          </CardTitle>
          <CardDescription>
            Send a test onboarding email to verify configuration
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-3">
            <div className="flex-1">
              <Label htmlFor="test-email" className="sr-only">Email Address</Label>
              <Input
                id="test-email"
                type="email"
                placeholder="Enter email address to test..."
                value={testEmail}
                onChange={(e) => setTestEmail(e.target.value)}
              />
            </div>
            <Button onClick={sendTestEmail} disabled={sendingTest}>
              {sendingTest ? (
                <>
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                  Sending...
                </>
              ) : (
                <>
                  <Send className="h-4 w-4 mr-2" />
                  Send Test
                </>
              )}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            Note: In test mode, emails can only be sent to your verified email address (support@obriencontractingusa.com)
          </p>
        </CardContent>
      </Card>

      {/* Failed Emails */}
      {failedLogs.length > 0 && (
        <Card className="border-destructive/50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-destructive">
              <XCircle className="h-5 w-5" />
              Failed Emails ({failedLogs.length})
            </CardTitle>
            <CardDescription>
              Recent emails that failed to deliver
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-64">
              <div className="space-y-3">
                {failedLogs.map(log => (
                  <div 
                    key={log.id} 
                    className="p-3 rounded-lg border bg-destructive/5 border-destructive/20"
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="font-medium">{log.recipient_email}</p>
                        <p className="text-sm text-muted-foreground">
                          {log.company_name} • Onboarding
                        </p>
                      </div>
                      {getLogStatusBadge(log)}
                    </div>
                    {log.metadata?.error && (
                      <div className="mt-2 p-2 bg-destructive/10 rounded text-xs text-destructive">
                        <strong>Error:</strong> {log.metadata.error}
                      </div>
                    )}
                    <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {log.sent_at ? format(new Date(log.sent_at), 'MMM d, yyyy h:mm a') : 'Pending'}
                    </p>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      )}

      {/* All Email Logs */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" />
            Email History
          </CardTitle>
          <CardDescription>
            Recent email activity (last 50 emails)
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : emailLogs.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No email logs found
            </div>
          ) : (
            <ScrollArea className="h-96">
              <div className="space-y-2">
                {emailLogs.map(log => (
                  <div 
                    key={log.id} 
                    className="flex items-center justify-between p-3 rounded-lg border hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div className={`p-2 rounded-full ${
                        log.status === 'sent' && log.resend_message_id 
                          ? 'bg-green-500/10' 
                          : 'bg-destructive/10'
                      }`}>
                        {log.status === 'sent' && log.resend_message_id 
                          ? <CheckCircle className="h-4 w-4 text-green-500" />
                          : <XCircle className="h-4 w-4 text-destructive" />
                        }
                      </div>
                      <div>
                        <p className="font-medium text-sm">{log.recipient_email}</p>
                        <p className="text-xs text-muted-foreground">
                          {log.company_name} • Onboarding
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      {getLogStatusBadge(log)}
                      <p className="text-xs text-muted-foreground mt-1">
                        {log.sent_at ? format(new Date(log.sent_at), 'MMM d, h:mm a') : 'Pending'}
                      </p>
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
