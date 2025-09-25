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
  requested_by: string;
  requested_at: string;
  status: string;
  notes?: string;
  rejection_reason?: string;
  pipeline_entries: {
    id: string;
    estimated_value: number;
    contacts: {
      first_name: string;
      last_name: string;
      address_street: string;
      address_city: string;
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
        .from('project_approval_requests')
        .select(`
          *,
          pipeline_entries (
            id,
            estimated_value,
            contacts (
              first_name,
              last_name,
              address_street,
              address_city
            )
          ),
          profiles!project_approval_requests_requested_by_fkey (
            first_name,
            last_name
          )
        `)
        .eq('status', 'pending')
        .order('requested_at', { ascending: false });

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

      // Update approval request
      const { error: updateError } = await supabase
        .from('project_approval_requests')
        .update({
          status: approved ? 'approved' : 'rejected',
          reviewed_at: new Date().toISOString(),
          notes: approved ? approvalNotes : undefined,
          rejection_reason: approved ? undefined : rejectionReason
        })
        .eq('id', requestId);

      if (updateError) {
        toast({
          title: "Error",
          description: "Failed to update approval request",
          variant: "destructive",
        });
        return;
      }

      if (approved) {
        // Move pipeline entry to project status
        const { error: pipelineError } = await supabase
          .from('pipeline_entries')
          .update({ status: 'project' })
          .eq('id', request.pipeline_entry_id);

        if (pipelineError) {
          toast({
            title: "Error",
            description: "Failed to move pipeline entry to project",
            variant: "destructive",
          });
          return;
        }
      }

      toast({
        title: "Success",
        description: `Request ${approved ? 'approved' : 'rejected'} successfully`,
      });

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
            const requestAge = getTimeAgo(request.requested_at);
            const isOld = new Date().getTime() - new Date(request.requested_at).getTime() > 24 * 60 * 60 * 1000;

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
                        </div>
                        {isOld && (
                          <Badge variant="destructive">
                            <AlertCircle className="h-3 w-3 mr-1" />
                            Overdue
                          </Badge>
                        )}
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
                          {formatCurrency(request.pipeline_entries.estimated_value)}
                        </div>
                      </div>

                      {request.notes && (
                        <div className="bg-muted p-3 rounded-lg">
                          <p className="text-sm">{request.notes}</p>
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