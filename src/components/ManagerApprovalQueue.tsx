import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { 
  Clock, 
  CheckCircle, 
  XCircle, 
  DollarSign,
  User,
  MapPin,
  Phone,
  AlertCircle,
  Loader2
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface ApprovalRequest {
  id: string;
  pipeline_entry_id: string;
  estimated_value: number;
  business_justification: string;
  priority: string;
  status: string;
  created_at: string;
  requested_by: string;
  contact_id: string;
  contacts: {
    id: string;
    first_name: string;
    last_name: string;
    email: string;
    phone: string;
    address_street: string;
    address_city: string;
    address_state: string;
    address_zip: string;
  } | null;
  profiles: {
    id: string;
    first_name: string;
    last_name: string;
  } | null;
}

const ManagerApprovalQueue: React.FC = () => {
  const [approvalRequests, setApprovalRequests] = useState<ApprovalRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [approvalNotes, setApprovalNotes] = useState<Record<string, string>>({});
  const { toast } = useToast();

  useEffect(() => {
    fetchApprovalRequests();
  }, []);

  const fetchApprovalRequests = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('manager_approval_queue')
        .select(`
          id,
          pipeline_entry_id,
          estimated_value,
          business_justification,
          priority,
          status,
          created_at,
          requested_by,
          contact_id
        `)
        .eq('status', 'pending')
        .order('created_at', { ascending: false });

      if (error) {
        throw error;
      }

      // Fetch contacts and profiles separately
      const contactIds = [...new Set(data?.map(req => req.contact_id).filter(Boolean) || [])];
      const userIds = [...new Set(data?.map(req => req.requested_by).filter(Boolean) || [])];

      const [contactsResponse, profilesResponse] = await Promise.all([
        contactIds.length > 0 ? supabase
          .from('contacts')
          .select('id, first_name, last_name, email, phone, address_street, address_city, address_state, address_zip')
          .in('id', contactIds) : Promise.resolve({ data: [], error: null }),
        userIds.length > 0 ? supabase
          .from('profiles')
          .select('id, first_name, last_name')
          .in('id', userIds) : Promise.resolve({ data: [], error: null })
      ]);

      // Create lookup maps
      const contactsMap = new Map((contactsResponse.data || []).map(c => [c.id, c]));
      const profilesMap = new Map((profilesResponse.data || []).map(p => [p.id, p]));

      // Combine the data
      const enrichedRequests = (data || []).map(request => ({
        ...request,
        contacts: contactsMap.get(request.contact_id) || null,
        profiles: profilesMap.get(request.requested_by) || null
      })).filter(req => req.contacts); // Only include requests with valid contacts

      setApprovalRequests(enrichedRequests);
    } catch (error) {
      console.error('Error fetching approval requests:', error);
      toast({
        title: "Error",
        description: "Failed to load approval requests",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async (requestId: string) => {
    try {
      setProcessingId(requestId);
      
      const { data, error } = await supabase.functions.invoke('api-approve-job-from-lead', {
        body: {
          pipeline_entry_id: approvalRequests.find(r => r.id === requestId)?.pipeline_entry_id,
          approval_notes: approvalNotes[requestId] || ''
        }
      });

      if (error) {
        throw error;
      }

      if (data.error) {
        toast({
          title: "Error",
          description: data.error,
          variant: "destructive",
        });
        return;
      }

      toast({
        title: "Success",
        description: data.message || "Request approved successfully",
      });

      // Refresh the requests
      await fetchApprovalRequests();
      
      // Clear the notes for this request
      setApprovalNotes(prev => {
        const newNotes = { ...prev };
        delete newNotes[requestId];
        return newNotes;
      });

    } catch (error) {
      console.error('Error approving request:', error);
      toast({
        title: "Error",
        description: "Failed to approve request",
        variant: "destructive",
      });
    } finally {
      setProcessingId(null);
    }
  };

  const handleReject = async (requestId: string) => {
    try {
      setProcessingId(requestId);

      const { error } = await supabase
        .from('manager_approval_queue')
        .update({
          status: 'rejected',
          manager_notes: approvalNotes[requestId] || '',
          approved_by: (await supabase.auth.getUser()).data.user?.id,
          approved_at: new Date().toISOString()
        })
        .eq('id', requestId);

      if (error) {
        throw error;
      }

      toast({
        title: "Success",
        description: "Request rejected",
      });

      // Refresh the requests
      await fetchApprovalRequests();
      
      // Clear the notes for this request
      setApprovalNotes(prev => {
        const newNotes = { ...prev };
        delete newNotes[requestId];
        return newNotes;
      });

    } catch (error) {
      console.error('Error rejecting request:', error);
      toast({
        title: "Error",
        description: "Failed to reject request",
        variant: "destructive",
      });
    } finally {
      setProcessingId(null);
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority?.toLowerCase()) {
      case 'high':
        return 'bg-destructive text-destructive-foreground';
      case 'medium':
        return 'bg-warning text-warning-foreground';
      case 'low':
        return 'bg-muted text-muted-foreground';
      default:
        return 'bg-muted text-muted-foreground';
    }
  };

  const formatCurrency = (amount: number) => {
    if (!amount) return '$0';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  const formatAddress = (contact: ApprovalRequest['contacts']) => {
    if (!contact) return 'No address';
    return `${contact.address_street}, ${contact.address_city}, ${contact.address_state} ${contact.address_zip}`;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin" />
        <span className="ml-2">Loading approval requests...</span>
      </div>
    );
  }

  if (approvalRequests.length === 0) {
    return (
      <Card>
        <CardContent className="p-8 text-center">
          <CheckCircle className="h-12 w-12 mx-auto text-success mb-4" />
          <h3 className="text-lg font-semibold mb-2">All Caught Up!</h3>
          <p className="text-muted-foreground">
            No pending approval requests at this time.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold gradient-primary bg-clip-text text-transparent">
            Manager Approval Queue
          </h2>
          <p className="text-muted-foreground">
            Review and approve pipeline entries awaiting manager approval
          </p>
        </div>
        <Badge variant="secondary" className="px-3 py-1">
          {approvalRequests.length} Pending
        </Badge>
      </div>

      <div className="grid gap-6">
        {approvalRequests.map((request) => (
          <Card key={request.id} className="shadow-soft border-0">
            <CardHeader>
              <div className="flex items-start justify-between">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm text-muted-foreground">
                      REQ-{request.id.slice(-4)}
                    </span>
                    <Badge className={getPriorityColor(request.priority)}>
                      {request.priority} Priority
                    </Badge>
                  </div>
                  <CardTitle className="text-xl">
                    {request.contacts?.first_name} {request.contacts?.last_name}
                  </CardTitle>
                </div>
                <div className="text-right">
                  <div className="text-2xl font-bold text-success">
                    {formatCurrency(request.estimated_value)}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    Estimated Value
                  </div>
                </div>
              </div>
            </CardHeader>
            
            <CardContent className="space-y-4">
              {/* Contact Information */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-sm">
                    <MapPin className="h-4 w-4 text-muted-foreground" />
                    <span>{formatAddress(request.contacts)}</span>
                  </div>
                  {request.contacts?.phone && (
                    <div className="flex items-center gap-2 text-sm">
                      <Phone className="h-4 w-4 text-muted-foreground" />
                      <span>{request.contacts.phone}</span>
                    </div>
                  )}
                </div>
                
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-sm">
                    <User className="h-4 w-4 text-muted-foreground" />
                    <span>
                      Requested by: {request.profiles?.first_name} {request.profiles?.last_name}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <Clock className="h-4 w-4 text-muted-foreground" />
                    <span>
                      Requested: {new Date(request.created_at).toLocaleDateString()}
                    </span>
                  </div>
                </div>
              </div>

              {/* Business Justification */}
              {request.business_justification && (
                <Alert>
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    <strong>Business Justification:</strong> {request.business_justification}
                  </AlertDescription>
                </Alert>
              )}

              {/* Project Type */}
              <div className="flex items-center gap-2 text-sm">
                <DollarSign className="h-4 w-4 text-primary" />
                <span className="font-medium">
                  Roofing Project
                </span>
              </div>

              {/* Manager Notes */}
              <div className="space-y-2">
                <label className="text-sm font-medium">Manager Notes (Optional)</label>
                <Textarea
                  placeholder="Add notes about your decision..."
                  value={approvalNotes[request.id] || ''}
                  onChange={(e) => setApprovalNotes(prev => ({
                    ...prev,
                    [request.id]: e.target.value
                  }))}
                  rows={3}
                />
              </div>

              {/* Action Buttons */}
              <div className="flex gap-3 pt-4">
                <Button
                  onClick={() => handleApprove(request.id)}
                  disabled={processingId === request.id}
                  className="flex-1 gradient-primary"
                >
                  {processingId === request.id ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <CheckCircle className="h-4 w-4 mr-2" />
                  )}
                  Approve & Convert to Project
                </Button>
                
                <Button
                  variant="destructive"
                  onClick={() => handleReject(request.id)}
                  disabled={processingId === request.id}
                  className="flex-1"
                >
                  {processingId === request.id ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <XCircle className="h-4 w-4 mr-2" />
                  )}
                  Reject Request
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
};

export default ManagerApprovalQueue;