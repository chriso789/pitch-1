import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { 
  Clock,
  CheckCircle,
  XCircle,
  AlertCircle,
  User,
  DollarSign,
  Calendar,
  MessageSquare
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface ApprovalRequest {
  id: string;
  pipeline_entry_id: string;
  contact_id: string;
  requested_by: string;
  approval_type: string;
  status: string;
  priority: string;
  estimated_value: number;
  business_justification: string;
  created_at: string;
  pipeline_entries: {
    id: string;
    estimated_value: number;
    clj_formatted_number: string;
    contacts: {
      first_name: string;
      last_name: string;
      address_street: string;
      address_city: string;
      clj_formatted_number: string;
    };
  };
  profiles: {
    first_name: string;
    last_name: string;
  } | null;
}

export const ApprovalManager: React.FC = () => {
  const [requests, setRequests] = useState<ApprovalRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedRequest, setSelectedRequest] = useState<ApprovalRequest | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');
  const [approvalNotes, setApprovalNotes] = useState('');
  const { toast } = useToast();

  useEffect(() => {
    fetchApprovalRequests();
  }, []);

  const fetchApprovalRequests = async () => {
    try {
      const { data, error } = await supabase
        .from('manager_approval_queue' as any)
        .select(`
          *,
          pipeline_entries (
            id,
            estimated_value,
            clj_formatted_number,
            contacts (
              first_name,
              last_name,
              address_street,
              address_city,
              clj_formatted_number
            )
          ),
          profiles!manager_approval_queue_requested_by_fkey (
            first_name,
            last_name
          )
        `)
        .eq('status', 'pending')
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error fetching approval requests:', error);
        toast({
          title: "Error",
          description: "Failed to load approval requests",
          variant: "destructive",
        });
        return;
      }

      setRequests((data as any) || []);
    } catch (error) {
      console.error('Error in fetchApprovalRequests:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleApproval = async (requestId: string, approved: boolean) => {
    try {
      const request = requests.find(r => r.id === requestId);
      if (!request) return;

      if (approved) {
        // Use the new RPC function to approve and create project
        const { data, error } = await supabase.rpc('api_approve_job_from_lead', {
          pipeline_entry_id_param: request.pipeline_entry_id,
          approval_notes: approvalNotes || null
        });

        if (error) {
          toast({
            title: "Error",
            description: error.message || "Failed to approve request",
            variant: "destructive",
          });
          return;
        }

        if (data && typeof data === 'object' && 'success' in data) {
          const result = data as { success: boolean; project_clj_number?: string; error?: string };
          if (result.success) {
            toast({
              title: "Success",
              description: `Lead approved and converted to project. C-L-J: ${result.project_clj_number}`,
            });
          } else {
            toast({
              title: "Error",
              description: result.error || "Failed to approve request",
              variant: "destructive",
            });
            return;
          }
        } else {
          toast({
            title: "Error",
            description: "Unexpected response format",
            variant: "destructive",
          });
          return;
        }
      } else {
        // Reject the approval
        const { error } = await supabase
          .from('manager_approval_queue' as any)
          .update({
            status: 'rejected',
            rejected_by: (await supabase.auth.getUser()).data.user?.id,
            rejected_at: new Date().toISOString(),
            rejection_reason: rejectionReason || 'No reason provided',
            updated_at: new Date().toISOString()
          })
          .eq('id', requestId);

        if (error) {
          toast({
            title: "Error",
            description: "Failed to reject request",
            variant: "destructive",
          });
          return;
        }

        toast({
          title: "Success",
          description: "Request rejected successfully",
          variant: "destructive",
        });
      }

      // Reset form
      setSelectedRequest(null);
      setRejectionReason('');
      setApprovalNotes('');
      
      // Refresh requests
      await fetchApprovalRequests();

    } catch (error) {
      console.error('Error handling approval:', error);
      toast({
        title: "Error",
        description: "Failed to process approval",
        variant: "destructive",
      });
    }
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  const getTimeAgo = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffHours / 24);

    if (diffDays > 0) {
      return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
    } else if (diffHours > 0) {
      return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    } else {
      return 'Less than an hour ago';
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority?.toLowerCase()) {
      case 'high':
        return 'destructive';
      case 'medium':
        return 'default';
      case 'low':
        return 'secondary';
      default:
        return 'outline';
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
          <p className="mt-2 text-muted-foreground">Loading approval requests...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold gradient-primary bg-clip-text text-transparent">
            Project Approvals
          </h1>
          <p className="text-muted-foreground">
            Review and approve pipeline entries for project conversion
          </p>
        </div>
        <Badge variant="outline" className="text-lg px-3 py-1">
          {requests.length} Pending
        </Badge>
      </div>

      {requests.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center">
            <CheckCircle className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-semibold mb-2">No Pending Approvals</h3>
            <p className="text-muted-foreground">
              All approval requests have been processed.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {requests.map((request) => {
            const contact = request.pipeline_entries.contacts;
            const requestAge = getTimeAgo(request.created_at);
            const isOld = new Date().getTime() - new Date(request.created_at).getTime() > 24 * 60 * 60 * 1000;

            return (
              <Card key={request.id} className={isOld ? 'border-orange-200 bg-orange-50' : ''}>
                <CardContent className="p-6">
                  <div className="flex items-start justify-between">
                      <div className="space-y-3 flex-1">
                        <div className="flex items-center gap-3">
                          <div>
                            <h3 className="font-semibold text-lg">
                              {contact.first_name} {contact.last_name}
                            </h3>
                            <p className="text-muted-foreground">
                              {contact.address_street}, {contact.address_city}
                            </p>
                            <p className="text-sm font-mono text-muted-foreground">
                              C-L-J: {contact.clj_formatted_number || request.pipeline_entries.clj_formatted_number || 'Not assigned'}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            {isOld && (
                              <Badge variant="destructive">
                                <AlertCircle className="h-3 w-3 mr-1" />
                                Overdue
                              </Badge>
                            )}
                            {request.priority && (
                              <Badge variant={getPriorityColor(request.priority) as any}>
                                {request.priority.toUpperCase()}
                              </Badge>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-6 text-sm text-muted-foreground">
                          <div className="flex items-center gap-1">
                            <User className="h-4 w-4" />
                            Requested by {request.profiles?.first_name} {request.profiles?.last_name}
                          </div>
                          <div className="flex items-center gap-1">
                            <Clock className="h-4 w-4" />
                            {requestAge}
                          </div>
                          <div className="flex items-center gap-1">
                            <DollarSign className="h-4 w-4" />
                            {formatCurrency(request.estimated_value || request.pipeline_entries.estimated_value)}
                          </div>
                        </div>

                        {request.business_justification && (
                          <div className="bg-muted p-3 rounded-lg">
                            <p className="text-sm font-medium mb-1">Business Justification:</p>
                            <p className="text-sm">{request.business_justification}</p>
                          </div>
                        )}
                    </div>

                    <div className="flex gap-2 ml-4">
                      <Dialog>
                        <DialogTrigger asChild>
                          <Button 
                            variant="outline" 
                            size="sm"
                            onClick={() => setSelectedRequest(request)}
                          >
                            <XCircle className="h-4 w-4 mr-1" />
                            Reject
                          </Button>
                        </DialogTrigger>
                        <DialogContent>
                          <DialogHeader>
                            <DialogTitle>Reject Project Approval</DialogTitle>
                            <DialogDescription>
                              Please provide a reason for rejecting this project approval request.
                            </DialogDescription>
                          </DialogHeader>
                          <div className="space-y-4">
                            <Textarea
                              placeholder="Reason for rejection..."
                              value={rejectionReason}
                              onChange={(e) => setRejectionReason(e.target.value)}
                              className="min-h-[100px]"
                            />
                            <div className="flex gap-2 justify-end">
                              <DialogTrigger asChild>
                                <Button variant="outline">Cancel</Button>
                              </DialogTrigger>
                              <Button
                                variant="destructive"
                                onClick={() => handleApproval(request.id, false)}
                                disabled={!rejectionReason.trim()}
                              >
                                Reject Request
                              </Button>
                            </div>
                          </div>
                        </DialogContent>
                      </Dialog>

                      <Dialog>
                        <DialogTrigger asChild>
                          <Button 
                            size="sm"
                            onClick={() => setSelectedRequest(request)}
                          >
                            <CheckCircle className="h-4 w-4 mr-1" />
                            Approve
                          </Button>
                        </DialogTrigger>
                        <DialogContent>
                          <DialogHeader>
                            <DialogTitle>Approve Project</DialogTitle>
                            <DialogDescription>
                              This will move the pipeline entry to "Project" status and start the production workflow.
                            </DialogDescription>
                          </DialogHeader>
                          <div className="space-y-4">
                            <Textarea
                              placeholder="Optional approval notes..."
                              value={approvalNotes}
                              onChange={(e) => setApprovalNotes(e.target.value)}
                              className="min-h-[100px]"
                            />
                            <div className="flex gap-2 justify-end">
                              <DialogTrigger asChild>
                                <Button variant="outline">Cancel</Button>
                              </DialogTrigger>
                              <Button
                                onClick={() => handleApproval(request.id, true)}
                              >
                                Approve & Start Project
                              </Button>
                            </div>
                          </div>
                        </DialogContent>
                      </Dialog>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
};