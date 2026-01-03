import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { 
  Send, 
  Mail, 
  Building2, 
  Users, 
  CheckCircle2, 
  Clock, 
  AlertCircle,
  Loader2,
  RefreshCw,
  Eye
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

interface Company {
  id: string;
  name: string;
  email: string | null;
  onboarded_at: string | null;
  created_at: string;
  owner_name?: string;
  owner_email?: string;
}

interface EmailLog {
  id: string;
  tenant_id: string;
  recipient_email: string;
  recipient_name: string | null;
  sent_at: string;
  status: string;
}

export const BulkOnboardingPanel = () => {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [emailLogs, setEmailLogs] = useState<EmailLog[]>([]);
  const [selectedCompanies, setSelectedCompanies] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      
      // Load companies without onboarded_at
      const { data: tenants, error: tenantError } = await supabase
        .from('tenants')
        .select('id, name, email, onboarded_at, created_at')
        .order('created_at', { ascending: false });

      if (tenantError) throw tenantError;

      // Load email logs
      const { data: logs, error: logError } = await supabase
        .from('onboarding_email_log')
        .select('*')
        .order('sent_at', { ascending: false });

      if (logError) console.warn('Could not load email logs:', logError);

      // Get owner info for each tenant
      const companiesWithOwners = await Promise.all((tenants || []).map(async (tenant) => {
        // Check for owner-level roles: master, corporate, office_admin
        const { data: owner } = await supabase
          .from('profiles')
          .select('first_name, last_name, email')
          .eq('tenant_id', tenant.id)
          .in('role', ['master', 'corporate', 'office_admin'])
          .limit(1)
          .maybeSingle();

        return {
          ...tenant,
          owner_name: owner ? `${owner.first_name} ${owner.last_name}` : 'Business Owner',
          owner_email: owner?.email || tenant.email
        };
      }));

      setCompanies(companiesWithOwners);
      setEmailLogs(logs || []);
    } catch (error: any) {
      console.error('Error loading data:', error);
      toast({
        title: "Error loading data",
        description: error.message,
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const pendingCompanies = companies.filter(c => !c.onboarded_at);
  const onboardedCompanies = companies.filter(c => c.onboarded_at);

  const getEmailStatus = (companyId: string): { sent: boolean; date?: string } => {
    const log = emailLogs.find(l => l.tenant_id === companyId);
    return log ? { sent: true, date: log.sent_at } : { sent: false };
  };

  const toggleCompany = (id: string) => {
    const newSelected = new Set(selectedCompanies);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedCompanies(newSelected);
  };

  const selectAll = () => {
    if (selectedCompanies.size === pendingCompanies.length) {
      setSelectedCompanies(new Set());
    } else {
      setSelectedCompanies(new Set(pendingCompanies.map(c => c.id)));
    }
  };

  const sendOnboardingEmail = async (company: Company) => {
    if (!company.owner_email) {
      toast({
        title: "No email address",
        description: `${company.name} doesn't have an owner email configured`,
        variant: "destructive"
      });
      return;
    }

    setSendingId(company.id);
    
    try {
      const { data, error } = await supabase.functions.invoke('send-company-onboarding', {
        body: {
          tenant_id: company.id,
          email: company.owner_email,
          first_name: company.owner_name?.split(' ')[0] || 'there',
          last_name: company.owner_name?.split(' ').slice(1).join(' ') || '',
          company_name: company.name
        }
      });

      if (error) throw error;

      toast({
        title: "Onboarding email sent! 🎉",
        description: `Premium onboarding email sent to ${company.owner_email}`
      });

      loadData();
    } catch (error: any) {
      console.error('Error sending onboarding email:', error);
      toast({
        title: "Failed to send email",
        description: error.message,
        variant: "destructive"
      });
    } finally {
      setSendingId(null);
    }
  };

  const sendBulkEmails = async () => {
    if (selectedCompanies.size === 0) return;

    setSending(true);
    let successCount = 0;
    let failCount = 0;

    for (const companyId of selectedCompanies) {
      const company = companies.find(c => c.id === companyId);
      if (!company || !company.owner_email) {
        failCount++;
        continue;
      }

      try {
        await supabase.functions.invoke('send-company-onboarding', {
          body: {
            tenant_id: company.id,
            email: company.owner_email,
            first_name: company.owner_name?.split(' ')[0] || 'there',
            last_name: company.owner_name?.split(' ').slice(1).join(' ') || '',
            company_name: company.name
          }
        });
        successCount++;
      } catch {
        failCount++;
      }
    }

    setSending(false);
    setSelectedCompanies(new Set());

    toast({
      title: "Bulk send complete",
      description: `Sent ${successCount} emails${failCount > 0 ? `, ${failCount} failed` : ''}`
    });

    loadData();
  };

  const [sendingTest, setSendingTest] = useState(false);

  const handleSendTestEmail = async () => {
    setSendingTest(true);
    try {
      const { data, error } = await supabase.functions.invoke('send-test-onboarding', {
        body: {
          email: 'support@obriencontractingusa.com',
          first_name: 'Chris',
          company_name: "O'Brien Contracting"
        }
      });
      
      if (error) throw error;
      
      toast({
        title: "Test email sent! 🎉",
        description: `Email sent to support@obriencontractingusa.com`
      });
      
      console.log('Test email result:', data);
    } catch (error: any) {
      console.error('Test email error:', error);
      toast({
        title: "Failed to send test email",
        description: error.message,
        variant: "destructive"
      });
    } finally {
      setSendingTest(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Mail className="h-5 w-5 text-primary" />
            Bulk Onboarding Invites
          </h3>
          <p className="text-sm text-muted-foreground">
            Send premium onboarding emails to company owners
          </p>
        </div>
        <div className="flex gap-2">
          <Button 
            variant="outline" 
            size="sm" 
            onClick={handleSendTestEmail} 
            disabled={sendingTest}
            className="border-amber-500 text-amber-600 hover:bg-amber-50"
          >
            {sendingTest ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Send className="h-4 w-4 mr-2" />
            )}
            Send Test Email
          </Button>
          <Button variant="outline" size="sm" onClick={loadData} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm">
                <Eye className="h-4 w-4 mr-2" />
                Preview Email
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Email Preview</DialogTitle>
              </DialogHeader>
              <div className="bg-muted/50 rounded-lg p-4">
                <p className="text-sm text-muted-foreground mb-4">
                  This is a preview of the premium onboarding email template. 
                  The actual email includes personalized company names, owner names, and unique onboarding links.
                </p>
                <div className="bg-background border rounded-lg p-6 space-y-4">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 bg-primary rounded-xl flex items-center justify-center text-primary-foreground font-bold text-xl">
                      P
                    </div>
                    <div>
                      <h4 className="font-bold text-lg">PITCH CRM</h4>
                      <p className="text-xs text-muted-foreground">The #1 Construction Sales Platform</p>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <h3 className="text-xl font-bold">Welcome aboard, [First Name]! 🎉</h3>
                    <p className="text-muted-foreground">
                      Your account for <strong className="text-primary">[Company Name]</strong> is ready...
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="p-3 bg-muted rounded-lg">
                      <p className="font-semibold text-sm">📞 Power Dialer</p>
                      <p className="text-xs text-muted-foreground">$149/mo value</p>
                    </div>
                    <div className="p-3 bg-muted rounded-lg">
                      <p className="font-semibold text-sm">📐 AI Measurements</p>
                      <p className="text-xs text-muted-foreground">$50/report saved</p>
                    </div>
                    <div className="p-3 bg-muted rounded-lg">
                      <p className="font-semibold text-sm">📋 Smart Estimates</p>
                      <p className="text-xs text-muted-foreground">$99/mo value</p>
                    </div>
                    <div className="p-3 bg-muted rounded-lg">
                      <p className="font-semibold text-sm">🗺️ Territory Mapping</p>
                      <p className="text-xs text-muted-foreground">$125/mo value</p>
                    </div>
                  </div>
                  <Button className="w-full">Complete Your Setup →</Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-yellow-500/10 rounded-lg">
                <Clock className="h-5 w-5 text-yellow-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">{pendingCompanies.length}</p>
                <p className="text-sm text-muted-foreground">Pending Onboarding</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-green-500/10 rounded-lg">
                <CheckCircle2 className="h-5 w-5 text-green-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">{onboardedCompanies.length}</p>
                <p className="text-sm text-muted-foreground">Onboarded</p>
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
                <p className="text-sm text-muted-foreground">Emails Sent</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Pending Companies */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">Pending Onboarding</CardTitle>
              <CardDescription>Companies that haven't completed setup</CardDescription>
            </div>
            {pendingCompanies.length > 0 && (
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={selectAll}>
                  {selectedCompanies.size === pendingCompanies.length ? 'Deselect All' : 'Select All'}
                </Button>
                <Button 
                  size="sm" 
                  onClick={sendBulkEmails}
                  disabled={selectedCompanies.size === 0 || sending}
                >
                  {sending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4 mr-2" />
                  )}
                  Send to Selected ({selectedCompanies.size})
                </Button>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : pendingCompanies.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <CheckCircle2 className="h-12 w-12 mx-auto mb-3 text-green-500" />
              <p>All companies have been onboarded!</p>
            </div>
          ) : (
            <ScrollArea className="h-[400px]">
              <div className="space-y-2">
                {pendingCompanies.map((company) => {
                  const emailStatus = getEmailStatus(company.id);
                  return (
                    <div 
                      key={company.id} 
                      className="flex items-center justify-between p-4 border rounded-lg hover:bg-muted/50 transition-colors"
                    >
                      <div className="flex items-center gap-4">
                        <Checkbox
                          checked={selectedCompanies.has(company.id)}
                          onCheckedChange={() => toggleCompany(company.id)}
                        />
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
                            <Building2 className="h-5 w-5 text-primary" />
                          </div>
                          <div>
                            <p className="font-medium">{company.name}</p>
                            <p className="text-sm text-muted-foreground">
                              {company.owner_email || 'No owner email'}
                            </p>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        {emailStatus.sent && (
                          <Badge variant="outline" className="text-xs">
                            <Mail className="h-3 w-3 mr-1" />
                            Sent {new Date(emailStatus.date!).toLocaleDateString()}
                          </Badge>
                        )}
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => sendOnboardingEmail(company)}
                          disabled={sendingId === company.id || !company.owner_email}
                        >
                          {sendingId === company.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <>
                              <Send className="h-4 w-4 mr-2" />
                              {emailStatus.sent ? 'Resend' : 'Send Invite'}
                            </>
                          )}
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>

      {/* Recent Email Log */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent Email Log</CardTitle>
          <CardDescription>History of sent onboarding emails</CardDescription>
        </CardHeader>
        <CardContent>
          {emailLogs.length === 0 ? (
            <p className="text-center py-4 text-muted-foreground">No emails sent yet</p>
          ) : (
            <ScrollArea className="h-[200px]">
              <div className="space-y-2">
                {emailLogs.slice(0, 10).map((log) => (
                  <div key={log.id} className="flex items-center justify-between p-3 border rounded-lg">
                    <div className="flex items-center gap-3">
                      <div className={`w-2 h-2 rounded-full ${
                        log.status === 'sent' ? 'bg-green-500' : 
                        log.status === 'failed' ? 'bg-red-500' : 'bg-yellow-500'
                      }`} />
                      <div>
                        <p className="text-sm font-medium">{log.recipient_email}</p>
                        <p className="text-xs text-muted-foreground">{log.recipient_name}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <Badge variant={log.status === 'sent' ? 'default' : 'destructive'} className="text-xs">
                        {log.status}
                      </Badge>
                      <p className="text-xs text-muted-foreground mt-1">
                        {new Date(log.sent_at).toLocaleString()}
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
