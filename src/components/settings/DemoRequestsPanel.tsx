import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { 
  Search, 
  Download, 
  RefreshCw, 
  Mail, 
  Phone, 
  Building2, 
  Calendar, 
  MessageSquare,
  CheckCircle,
  Clock,
  XCircle,
  UserCheck,
  Copy,
  ExternalLink,
  Plus
} from "lucide-react";
import { format } from "date-fns";
import { CreateCompanyFromDemoDialog } from "./CreateCompanyFromDemoDialog";

interface DemoRequest {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
  company_name: string;
  job_title: string | null;
  message: string | null;
  email_sent: boolean;
  email_error: string | null;
  created_at: string;
  status?: string;
  notes?: string;
  contacted_at?: string;
  converted_to_company_id?: string | null;
}

type StatusType = 'all' | 'new' | 'contacted' | 'scheduled' | 'converted' | 'declined';

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  new: { label: 'New', color: 'bg-blue-500/20 text-blue-700 border-blue-500/30', icon: <Clock className="h-3 w-3" /> },
  contacted: { label: 'Contacted', color: 'bg-yellow-500/20 text-yellow-700 border-yellow-500/30', icon: <Mail className="h-3 w-3" /> },
  scheduled: { label: 'Scheduled', color: 'bg-purple-500/20 text-purple-700 border-purple-500/30', icon: <Calendar className="h-3 w-3" /> },
  converted: { label: 'Converted', color: 'bg-green-500/20 text-green-700 border-green-500/30', icon: <CheckCircle className="h-3 w-3" /> },
  declined: { label: 'Declined', color: 'bg-red-500/20 text-red-700 border-red-500/30', icon: <XCircle className="h-3 w-3" /> },
};

export const DemoRequestsPanel: React.FC = () => {
  const [requests, setRequests] = useState<DemoRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusType>('all');
  const [selectedRequest, setSelectedRequest] = useState<DemoRequest | null>(null);
  const [notesDialogOpen, setNotesDialogOpen] = useState(false);
  const [notes, setNotes] = useState('');
  const [updating, setUpdating] = useState(false);
  const [createCompanyDialogOpen, setCreateCompanyDialogOpen] = useState(false);
  const [selectedForConversion, setSelectedForConversion] = useState<DemoRequest | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    loadDemoRequests();
  }, []);

  const loadDemoRequests = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('demo_requests')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setRequests(data || []);
    } catch (error) {
      console.error('Error loading demo requests:', error);
      toast({
        title: "Error loading requests",
        description: "Could not load demo requests",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const updateRequestStatus = async (requestId: string, newStatus: string) => {
    setUpdating(true);
    try {
      const updateData: Record<string, any> = { status: newStatus };
      if (newStatus === 'contacted') {
        updateData.contacted_at = new Date().toISOString();
      }

      const { error } = await supabase
        .from('demo_requests')
        .update(updateData)
        .eq('id', requestId);

      if (error) throw error;

      setRequests(prev => prev.map(r => 
        r.id === requestId ? { ...r, ...updateData } : r
      ));

      toast({
        title: "Status updated",
        description: `Request marked as ${STATUS_CONFIG[newStatus]?.label || newStatus}`
      });
    } catch (error) {
      console.error('Error updating status:', error);
      toast({
        title: "Error",
        description: "Could not update status",
        variant: "destructive"
      });
    } finally {
      setUpdating(false);
    }
  };

  const updateRequestNotes = async () => {
    if (!selectedRequest) return;
    setUpdating(true);
    try {
      const { error } = await supabase
        .from('demo_requests')
        .update({ notes } as any)
        .eq('id', selectedRequest.id);

      if (error) throw error;

      setRequests(prev => prev.map(r => 
        r.id === selectedRequest.id ? { ...r, notes } : r
      ));

      toast({ title: "Notes saved" });
      setNotesDialogOpen(false);
    } catch (error) {
      console.error('Error saving notes:', error);
      toast({
        title: "Error",
        description: "Could not save notes",
        variant: "destructive"
      });
    } finally {
      setUpdating(false);
    }
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: `${label} copied to clipboard` });
  };

  const exportToCSV = () => {
    const headers = ['Name', 'Email', 'Phone', 'Company', 'Job Title', 'Message', 'Status', 'Date'];
    const rows = filteredRequests.map(r => [
      `${r.first_name} ${r.last_name}`,
      r.email,
      r.phone || '',
      r.company_name,
      r.job_title || '',
      r.message || '',
      r.status || 'new',
      format(new Date(r.created_at), 'yyyy-MM-dd HH:mm')
    ]);

    const csvContent = [headers, ...rows].map(row => row.map(cell => `"${cell}"`).join(',')).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `demo-requests-${format(new Date(), 'yyyy-MM-dd')}.csv`;
    a.click();
    URL.revokeObjectURL(url);

    toast({ title: "Export complete", description: `${filteredRequests.length} requests exported` });
  };

  const handleCreateCompany = (request: DemoRequest) => {
    setSelectedForConversion(request);
    setCreateCompanyDialogOpen(true);
  };

  const handleCompanyCreated = (companyId: string) => {
    // Reload requests to get updated status
    loadDemoRequests();
  };

  const filteredRequests = requests.filter(r => {
    const matchesSearch = searchQuery === '' || 
      `${r.first_name} ${r.last_name}`.toLowerCase().includes(searchQuery.toLowerCase()) ||
      r.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
      r.company_name.toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesStatus = statusFilter === 'all' || (r.status || 'new') === statusFilter;
    
    return matchesSearch && matchesStatus;
  });

  const stats = {
    total: requests.length,
    new: requests.filter(r => !r.status || r.status === 'new').length,
    contacted: requests.filter(r => r.status === 'contacted').length,
    scheduled: requests.filter(r => r.status === 'scheduled').length,
    converted: requests.filter(r => r.status === 'converted').length,
  };

  return (
    <div className="space-y-6">
      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Card className="bg-card">
          <CardContent className="pt-4">
            <div className="text-2xl font-bold">{stats.total}</div>
            <p className="text-xs text-muted-foreground">Total Requests</p>
          </CardContent>
        </Card>
        <Card className="bg-blue-500/10 border-blue-500/20">
          <CardContent className="pt-4">
            <div className="text-2xl font-bold text-blue-600">{stats.new}</div>
            <p className="text-xs text-muted-foreground">New</p>
          </CardContent>
        </Card>
        <Card className="bg-yellow-500/10 border-yellow-500/20">
          <CardContent className="pt-4">
            <div className="text-2xl font-bold text-yellow-600">{stats.contacted}</div>
            <p className="text-xs text-muted-foreground">Contacted</p>
          </CardContent>
        </Card>
        <Card className="bg-purple-500/10 border-purple-500/20">
          <CardContent className="pt-4">
            <div className="text-2xl font-bold text-purple-600">{stats.scheduled}</div>
            <p className="text-xs text-muted-foreground">Scheduled</p>
          </CardContent>
        </Card>
        <Card className="bg-green-500/10 border-green-500/20">
          <CardContent className="pt-4">
            <div className="text-2xl font-bold text-green-600">{stats.converted}</div>
            <p className="text-xs text-muted-foreground">Converted</p>
          </CardContent>
        </Card>
      </div>

      {/* Main Panel */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <UserCheck className="h-5 w-5" />
                Demo Requests
              </CardTitle>
              <CardDescription>
                Manage incoming demo requests from the website
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={loadDemoRequests} disabled={loading}>
                <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
                Refresh
              </Button>
              <Button variant="outline" size="sm" onClick={exportToCSV}>
                <Download className="h-4 w-4 mr-2" />
                Export CSV
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {/* Filters */}
          <div className="flex flex-col sm:flex-row gap-4 mb-6">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by name, email, or company..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusType)}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Filter by status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="new">New</SelectItem>
                <SelectItem value="contacted">Contacted</SelectItem>
                <SelectItem value="scheduled">Scheduled</SelectItem>
                <SelectItem value="converted">Converted</SelectItem>
                <SelectItem value="declined">Declined</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Table */}
          {loading ? (
            <div className="text-center py-8 text-muted-foreground">Loading requests...</div>
          ) : filteredRequests.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              {requests.length === 0 ? 'No demo requests yet' : 'No requests match your filters'}
            </div>
          ) : (
            <div className="border rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Contact</TableHead>
                    <TableHead>Company</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredRequests.map((request) => {
                    const status = request.status || 'new';
                    const statusConfig = STATUS_CONFIG[status] || STATUS_CONFIG.new;
                    const isConverted = status === 'converted' || !!request.converted_to_company_id;
                    
                    return (
                      <TableRow key={request.id}>
                        <TableCell>
                          <div className="space-y-1">
                            <div className="font-medium">
                              {request.first_name} {request.last_name}
                            </div>
                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                              <Mail className="h-3 w-3" />
                              <span 
                                className="cursor-pointer hover:text-primary"
                                onClick={() => copyToClipboard(request.email, 'Email')}
                              >
                                {request.email}
                              </span>
                            </div>
                            {request.phone && (
                              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                <Phone className="h-3 w-3" />
                                <span>{request.phone}</span>
                              </div>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Building2 className="h-4 w-4 text-muted-foreground" />
                            <div>
                              <div className="font-medium">{request.company_name}</div>
                              {request.job_title && (
                                <div className="text-sm text-muted-foreground">{request.job_title}</div>
                              )}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Select
                            value={status}
                            onValueChange={(v) => updateRequestStatus(request.id, v)}
                            disabled={updating}
                          >
                            <SelectTrigger className="w-[130px] h-8">
                              <Badge className={statusConfig.color}>
                                {statusConfig.icon}
                                <span className="ml-1">{statusConfig.label}</span>
                              </Badge>
                            </SelectTrigger>
                            <SelectContent>
                              {Object.entries(STATUS_CONFIG).map(([key, config]) => (
                                <SelectItem key={key} value={key}>
                                  <div className="flex items-center gap-2">
                                    {config.icon}
                                    {config.label}
                                  </div>
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>
                          <div className="text-sm">
                            <div>{format(new Date(request.created_at), 'MMM d, yyyy')}</div>
                            <div className="text-muted-foreground">
                              {format(new Date(request.created_at), 'h:mm a')}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            {/* Create Company Button - only show if not converted */}
                            {!isConverted && (
                              <Button
                                variant="default"
                                size="sm"
                                onClick={() => handleCreateCompany(request)}
                                className="bg-green-600 hover:bg-green-700"
                              >
                                <Plus className="h-4 w-4 mr-1" />
                                Create Company
                              </Button>
                            )}
                            {isConverted && (
                              <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                                <CheckCircle className="h-3 w-3 mr-1" />
                                Company Created
                              </Badge>
                            )}
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => copyToClipboard(request.email, 'Email')}
                            >
                              <Copy className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => window.open(`mailto:${request.email}`, '_blank')}
                            >
                              <ExternalLink className="h-4 w-4" />
                            </Button>
                            <Dialog open={notesDialogOpen && selectedRequest?.id === request.id} onOpenChange={(open) => {
                              setNotesDialogOpen(open);
                              if (open) {
                                setSelectedRequest(request);
                                setNotes(request.notes || '');
                              }
                            }}>
                              <DialogTrigger asChild>
                                <Button variant="ghost" size="sm">
                                  <MessageSquare className="h-4 w-4" />
                                </Button>
                              </DialogTrigger>
                              <DialogContent>
                                <DialogHeader>
                                  <DialogTitle>
                                    Notes for {request.first_name} {request.last_name}
                                  </DialogTitle>
                                </DialogHeader>
                                <div className="space-y-4">
                                  <div className="text-sm text-muted-foreground">
                                    {request.company_name} • {request.email}
                                  </div>
                                  {request.message && (
                                    <div className="p-3 bg-muted rounded-lg">
                                      <div className="text-xs font-medium mb-1">Original Message:</div>
                                      <p className="text-sm">{request.message}</p>
                                    </div>
                                  )}
                                  <Textarea
                                    placeholder="Add follow-up notes..."
                                    value={notes}
                                    onChange={(e) => setNotes(e.target.value)}
                                    rows={4}
                                  />
                                </div>
                                <DialogFooter>
                                  <Button variant="outline" onClick={() => setNotesDialogOpen(false)}>
                                    Cancel
                                  </Button>
                                  <Button onClick={updateRequestNotes} disabled={updating}>
                                    Save Notes
                                  </Button>
                                </DialogFooter>
                              </DialogContent>
                            </Dialog>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create Company Dialog */}
      <CreateCompanyFromDemoDialog
        open={createCompanyDialogOpen}
        onOpenChange={setCreateCompanyDialogOpen}
        demoRequest={selectedForConversion}
        onSuccess={handleCompanyCreated}
      />
    </div>
  );
};

export default DemoRequestsPanel;
