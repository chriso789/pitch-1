import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { formatDistanceToNow, format } from 'date-fns';
import {
  Building2,
  Calendar,
  CreditCard,
  DollarSign,
  FileText,
  MessageSquare,
  Package,
  Clock,
  ExternalLink,
  Send,
  CheckCircle,
  AlertCircle,
  Loader2,
  Download,
  Image,
} from 'lucide-react';

interface PortalData {
  project: any;
  contact: any;
  payment_links: any[];
  messages: any[];
  documents: any[];
  company: any;
}

const CustomerPortalPublic: React.FC = () => {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<PortalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newMessage, setNewMessage] = useState('');
  const [sendingMessage, setSendingMessage] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (token) {
      validateAndFetch();
    }
  }, [token]);

  const validateAndFetch = async () => {
    try {
      setLoading(true);
      setError(null);

      const { data: response, error: invokeError } = await supabase.functions.invoke(
        'customer-portal-access',
        {
          body: { action: 'validate', token },
        }
      );

      if (invokeError) throw invokeError;
      if (!response.success) {
        setError(response.error || 'Invalid access link');
        return;
      }

      setData(response);
    } catch (err: any) {
      console.error('Portal access error:', err);
      setError(err.message || 'Failed to load portal');
    } finally {
      setLoading(false);
    }
  };

  const sendMessage = async () => {
    if (!newMessage.trim() || !token) return;

    try {
      setSendingMessage(true);

      const { data: response, error: sendError } = await supabase.functions.invoke(
        'customer-portal-access',
        {
          body: { action: 'send_message', token, message: newMessage.trim() },
        }
      );

      if (sendError) throw sendError;
      if (!response.success) throw new Error(response.error);

      // Add message to local state
      setData(prev => prev ? {
        ...prev,
        messages: [...prev.messages, response.message],
      } : null);

      setNewMessage('');
      toast({
        title: 'Message Sent',
        description: 'Your message has been sent to the team.',
      });
    } catch (err: any) {
      toast({
        title: 'Error',
        description: err.message || 'Failed to send message',
        variant: 'destructive',
      });
    } finally {
      setSendingMessage(false);
    }
  };

  const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      active: 'bg-green-500/10 text-green-600 border-green-500/20',
      planning: 'bg-blue-500/10 text-blue-600 border-blue-500/20',
      on_hold: 'bg-yellow-500/10 text-yellow-600 border-yellow-500/20',
      completed: 'bg-purple-500/10 text-purple-600 border-purple-500/20',
      cancelled: 'bg-destructive/10 text-destructive border-destructive/20',
    };
    return colors[status] || 'bg-muted text-muted-foreground';
  };

  const getProgressPercentage = () => {
    const project = data?.project;
    if (!project) return 0;
    if (project.actual_completion_date) return 100;
    if (!project.start_date || !project.estimated_completion_date) return 0;

    const start = new Date(project.start_date).getTime();
    const end = new Date(project.estimated_completion_date).getTime();
    const now = Date.now();

    if (now < start) return 0;
    if (now > end) return 100;

    return Math.round(((now - start) / (end - start)) * 100);
  };

  // Loading state
  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="h-12 w-12 animate-spin text-primary mx-auto mb-4" />
          <p className="text-muted-foreground">Loading your project portal...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="max-w-md w-full p-8 text-center">
          <AlertCircle className="h-16 w-16 text-destructive mx-auto mb-4" />
          <h1 className="text-2xl font-bold mb-2">Access Denied</h1>
          <p className="text-muted-foreground mb-4">{error}</p>
          <p className="text-sm text-muted-foreground">
            If you believe this is an error, please contact your project manager.
          </p>
        </Card>
      </div>
    );
  }

  if (!data) return null;

  const { project, contact, payment_links, messages, documents, company } = data;
  const totalPaid = project?.payments?.reduce((sum: number, p: any) => sum + Number(p.amount), 0) || 0;
  const contractValue = project?.estimates?.[0]?.selling_price || 0;
  const balanceOwed = contractValue - totalPaid;

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b bg-card sticky top-0 z-10">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {company?.logo_url && (
                <img src={company.logo_url} alt={company.name} className="h-10 w-auto" />
              )}
              <div>
                <h1 className="text-xl font-bold">{company?.name || 'Customer Portal'}</h1>
                <p className="text-sm text-muted-foreground">
                  Welcome, {contact?.first_name || 'Customer'}
                </p>
              </div>
            </div>
            {company?.phone && (
              <Button variant="outline" asChild>
                <a href={`tel:${company.phone}`}>Call Us</a>
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 py-6 space-y-6">
        {/* Project Overview Card */}
        <Card className="p-6">
          <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Package className="h-5 w-5 text-primary" />
                <h2 className="text-2xl font-bold">{project?.name || 'Your Project'}</h2>
              </div>
              <Badge variant="outline" className={getStatusColor(project?.status)}>
                {project?.status?.replace('_', ' ').toUpperCase()}
              </Badge>
              <p className="text-muted-foreground">{project?.description}</p>
            </div>
            <div className="flex flex-col gap-2 min-w-[200px]">
              <div className="text-right">
                <p className="text-sm text-muted-foreground">Balance Due</p>
                <p className="text-3xl font-bold text-primary">
                  ${balanceOwed.toLocaleString()}
                </p>
              </div>
              {payment_links.length > 0 && (
                <Button asChild className="w-full">
                  <a href={payment_links[0].stripe_payment_link_url} target="_blank" rel="noopener noreferrer">
                    <CreditCard className="h-4 w-4 mr-2" />
                    Pay Now
                    <ExternalLink className="h-3 w-3 ml-2" />
                  </a>
                </Button>
              )}
            </div>
          </div>

          {/* Progress Bar */}
          <div className="mt-6 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Project Progress</span>
              <span className="font-medium">{getProgressPercentage()}%</span>
            </div>
            <Progress value={getProgressPercentage()} className="h-3" />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>
                Started: {project?.start_date ? format(new Date(project.start_date), 'MMM d, yyyy') : 'TBD'}
              </span>
              <span>
                Est. Complete: {project?.estimated_completion_date ? format(new Date(project.estimated_completion_date), 'MMM d, yyyy') : 'TBD'}
              </span>
            </div>
          </div>
        </Card>

        {/* Tabs */}
        <Tabs defaultValue="overview" className="space-y-4">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="overview">
              <FileText className="h-4 w-4 mr-2 hidden sm:inline" />
              Overview
            </TabsTrigger>
            <TabsTrigger value="payments">
              <DollarSign className="h-4 w-4 mr-2 hidden sm:inline" />
              Payments
            </TabsTrigger>
            <TabsTrigger value="documents">
              <FileText className="h-4 w-4 mr-2 hidden sm:inline" />
              Documents
            </TabsTrigger>
            <TabsTrigger value="messages">
              <MessageSquare className="h-4 w-4 mr-2 hidden sm:inline" />
              Messages
              {messages.filter(m => m.sender_type === 'staff' && !m.is_read).length > 0 && (
                <Badge variant="destructive" className="ml-1 h-5 w-5 p-0 text-xs">
                  {messages.filter(m => m.sender_type === 'staff' && !m.is_read).length}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>

          {/* Overview Tab */}
          <TabsContent value="overview" className="space-y-4">
            <div className="grid md:grid-cols-2 gap-4">
              <Card className="p-4">
                <h3 className="font-semibold mb-3 flex items-center gap-2">
                  <Calendar className="h-4 w-4" />
                  Project Timeline
                </h3>
                <div className="space-y-3">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Start Date</span>
                    <span className="font-medium">
                      {project?.start_date ? format(new Date(project.start_date), 'MMM d, yyyy') : 'TBD'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Est. Completion</span>
                    <span className="font-medium">
                      {project?.estimated_completion_date ? format(new Date(project.estimated_completion_date), 'MMM d, yyyy') : 'TBD'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Days Remaining</span>
                    <span className="font-medium">
                      {project?.estimated_completion_date
                        ? Math.max(0, Math.ceil((new Date(project.estimated_completion_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
                        : '-'}
                    </span>
                  </div>
                </div>
              </Card>

              <Card className="p-4">
                <h3 className="font-semibold mb-3 flex items-center gap-2">
                  <DollarSign className="h-4 w-4" />
                  Financial Summary
                </h3>
                <div className="space-y-3">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Contract Value</span>
                    <span className="font-medium">${contractValue.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Amount Paid</span>
                    <span className="font-medium text-green-600">${totalPaid.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between border-t pt-2">
                    <span className="font-medium">Balance Due</span>
                    <span className="font-bold text-primary">${balanceOwed.toLocaleString()}</span>
                  </div>
                </div>
              </Card>
            </div>
          </TabsContent>

          {/* Payments Tab */}
          <TabsContent value="payments" className="space-y-4">
            {/* Pay Now Section */}
            {balanceOwed > 0 && payment_links.length > 0 && (
              <Card className="p-6 bg-primary/5 border-primary/20">
                <div className="flex flex-col md:flex-row items-center justify-between gap-4">
                  <div>
                    <h3 className="text-lg font-semibold">Ready to Pay?</h3>
                    <p className="text-muted-foreground">
                      Securely pay your balance of ${balanceOwed.toLocaleString()} online
                    </p>
                  </div>
                  <Button size="lg" asChild>
                    <a href={payment_links[0].stripe_payment_link_url} target="_blank" rel="noopener noreferrer">
                      <CreditCard className="h-5 w-5 mr-2" />
                      Pay ${balanceOwed.toLocaleString()}
                      <ExternalLink className="h-4 w-4 ml-2" />
                    </a>
                  </Button>
                </div>
              </Card>
            )}

            {/* Payment History */}
            <Card className="p-4">
              <h3 className="font-semibold mb-4">Payment History</h3>
              {project?.payments?.length === 0 ? (
                <p className="text-muted-foreground text-center py-8">No payments recorded yet</p>
              ) : (
                <div className="space-y-3">
                  {project?.payments?.map((payment: any) => (
                    <div key={payment.id} className="flex items-center justify-between p-3 border rounded-lg">
                      <div className="flex items-center gap-3">
                        <div className="p-2 rounded-full bg-green-500/10">
                          <CheckCircle className="h-4 w-4 text-green-600" />
                        </div>
                        <div>
                          <p className="font-medium">{payment.description || 'Payment'}</p>
                          <p className="text-sm text-muted-foreground">
                            {formatDistanceToNow(new Date(payment.created_at), { addSuffix: true })}
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-lg font-bold text-green-600">
                          ${Number(payment.amount).toLocaleString()}
                        </p>
                        <Badge variant="outline" className="text-green-600 border-green-600/20">
                          {payment.status}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </TabsContent>

          {/* Documents Tab */}
          <TabsContent value="documents">
            <Card className="p-4">
              <h3 className="font-semibold mb-4">Project Documents</h3>
              {documents.length === 0 ? (
                <p className="text-muted-foreground text-center py-8">No documents available yet</p>
              ) : (
                <div className="grid gap-3">
                  {documents.map((doc: any) => (
                    <div key={doc.id} className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/50 transition-colors">
                      <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-primary/10">
                          {doc.mime_type?.startsWith('image') ? (
                            <Image className="h-5 w-5 text-primary" />
                          ) : (
                            <FileText className="h-5 w-5 text-primary" />
                          )}
                        </div>
                        <div>
                          <p className="font-medium">{doc.file_name}</p>
                          <p className="text-sm text-muted-foreground">
                            {doc.document_type} • {formatDistanceToNow(new Date(doc.created_at), { addSuffix: true })}
                          </p>
                        </div>
                      </div>
                      <Button variant="ghost" size="sm" asChild>
                        <a href={doc.file_url} target="_blank" rel="noopener noreferrer">
                          <Download className="h-4 w-4" />
                        </a>
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </TabsContent>

          {/* Messages Tab */}
          <TabsContent value="messages">
            <Card className="p-4">
              <h3 className="font-semibold mb-4">Messages</h3>
              
              <ScrollArea className="h-[300px] mb-4 pr-4">
                {messages.length === 0 ? (
                  <p className="text-muted-foreground text-center py-8">No messages yet. Start a conversation!</p>
                ) : (
                  <div className="space-y-3">
                    {messages.map((msg: any) => (
                      <div
                        key={msg.id}
                        className={`p-3 rounded-lg ${
                          msg.sender_type === 'customer'
                            ? 'bg-primary/10 ml-8'
                            : 'bg-muted mr-8'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-medium">
                            {msg.sender_type === 'customer' ? 'You' : company?.name || 'Team'}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {formatDistanceToNow(new Date(msg.created_at), { addSuffix: true })}
                          </span>
                        </div>
                        <p className="text-sm">{msg.message}</p>
                      </div>
                    ))}
                  </div>
                )}
              </ScrollArea>

              <div className="flex gap-2">
                <Textarea
                  placeholder="Type your message..."
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  className="min-h-[80px]"
                />
                <Button
                  onClick={sendMessage}
                  disabled={!newMessage.trim() || sendingMessage}
                  className="self-end"
                >
                  {sendingMessage ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* Footer */}
      <div className="border-t mt-8 py-6 text-center text-sm text-muted-foreground">
        <p>Powered by PITCH CRM</p>
        {company?.website && (
          <a href={company.website} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
            {company.website}
          </a>
        )}
      </div>
    </div>
  );
};

export default CustomerPortalPublic;