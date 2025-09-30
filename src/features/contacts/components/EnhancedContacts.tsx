import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { 
  Search, 
  Plus, 
  User, 
  Phone, 
  Mail, 
  MapPin, 
  Archive,
  AlertTriangle,
  Trash2,
  MoreVertical,
  History,
  RefreshCw
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useNavigate } from "react-router-dom";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { SkipTraceStatusBadge } from "@/components/skip-trace/SkipTraceStatusBadge";
import { SkipTraceButton } from "@/components/skip-trace/SkipTraceButton";
import { BulkSkipTraceDialog } from "@/components/skip-trace/BulkSkipTraceDialog";
import { SkipTraceHistoryDialog } from "@/components/skip-trace/SkipTraceHistoryDialog";

interface Contact {
  id: string;
  contact_number: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  address_street: string;
  address_city: string;
  address_state: string;
  address_zip: string;
  lead_source: string;
  created_at: string;
  qualification_status: string;
  lead_score: number;
  skip_trace_status?: 'completed' | 'pending' | 'failed' | null;
  skip_trace_confidence?: number;
  skip_trace_last_run?: string;
}

const EnhancedContacts = () => {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [filteredContacts, setFilteredContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [skipTraceFilter, setSkipTraceFilter] = useState<string>('all');
  const [selectedContacts, setSelectedContacts] = useState<string[]>([]);
  const [showBulkDialog, setShowBulkDialog] = useState(false);
  const [historyContactId, setHistoryContactId] = useState<string | null>(null);
  const { toast } = useToast();
  const navigate = useNavigate();

  useEffect(() => {
    fetchContacts();
  }, []);

  useEffect(() => {
    // Filter contacts based on search term and skip trace status
    let filtered = contacts.filter(contact => 
      `${contact.first_name} ${contact.last_name}`.toLowerCase().includes(searchTerm.toLowerCase()) ||
      contact.email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      contact.phone?.includes(searchTerm) ||
      contact.address_street?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      contact.contact_number?.toLowerCase().includes(searchTerm.toLowerCase())
    );

    // Apply skip trace filter
    if (skipTraceFilter !== 'all') {
      if (skipTraceFilter === 'enriched') {
        filtered = filtered.filter(c => c.skip_trace_status === 'completed');
      } else if (skipTraceFilter === 'not_traced') {
        filtered = filtered.filter(c => !c.skip_trace_status);
      } else if (skipTraceFilter === 'pending') {
        filtered = filtered.filter(c => c.skip_trace_status === 'pending');
      } else if (skipTraceFilter === 'failed') {
        filtered = filtered.filter(c => c.skip_trace_status === 'failed');
      }
    }

    setFilteredContacts(filtered);
  }, [contacts, searchTerm, skipTraceFilter]);

  const fetchContacts = async () => {
    try {
      setLoading(true);
      
      // Fetch contacts with skip trace data
      const { data: contactsData, error: contactsError } = await supabase
        .from('contacts')
        .select('*')
        .eq('is_deleted', false)
        .order('created_at', { ascending: false });

      if (contactsError) throw contactsError;

      // Fetch skip trace results for all contacts
      const { data: skipTraceData, error: skipTraceError } = await supabase
        .from('skip_trace_results')
        .select('contact_id, status, confidence_score, created_at')
        .order('created_at', { ascending: false });

      if (skipTraceError) throw skipTraceError;

      // Create a map of latest skip trace results per contact
      const skipTraceMap = new Map();
      skipTraceData?.forEach((result) => {
        if (!skipTraceMap.has(result.contact_id)) {
          skipTraceMap.set(result.contact_id, {
            status: result.status,
            confidence: result.confidence_score,
            lastRun: result.created_at
          });
        }
      });

      // Merge skip trace data with contacts
      const enrichedContacts = contactsData?.map(contact => ({
        ...contact,
        skip_trace_status: skipTraceMap.get(contact.id)?.status || null,
        skip_trace_confidence: skipTraceMap.get(contact.id)?.confidence || null,
        skip_trace_last_run: skipTraceMap.get(contact.id)?.lastRun || null,
      })) || [];

      console.log(`Fetched ${enrichedContacts.length} contacts with skip trace data`);
      setContacts(enrichedContacts);
    } catch (error) {
      console.error('Error fetching contacts:', error);
      toast({
        title: "Error",
        description: "Failed to load contacts",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSoftDelete = async (contactId: string) => {
    try {
      const { data, error } = await supabase.rpc('soft_delete_contact', {
        contact_id_param: contactId
      });

      if (error) throw error;

      toast({
        title: "Contact Archived",
        description: "Contact has been securely archived and removed from active list",
      });

      // Remove from local state
      setContacts(prev => prev.filter(c => c.id !== contactId));
    } catch (error) {
      console.error('Error deleting contact:', error);
      toast({
        title: "Error",
        description: "Failed to archive contact",
        variant: "destructive",
      });
    }
  };

  const getQualificationBadgeColor = (status: string) => {
    switch (status?.toLowerCase()) {
      case 'qualified':
        return 'bg-success/10 text-success border-success/20';
      case 'hot':
        return 'bg-destructive/10 text-destructive border-destructive/20';
      case 'warm':
        return 'bg-warning/10 text-warning border-warning/20';
      case 'cold':
        return 'bg-muted/10 text-muted-foreground border-muted/20';
      default:
        return 'bg-muted/10 text-muted-foreground border-muted/20';
    }
  };

  const getScoreBadgeColor = (score: number) => {
    if (score >= 80) return 'bg-success/10 text-success border-success/20';
    if (score >= 60) return 'bg-warning/10 text-warning border-warning/20';
    return 'bg-muted/10 text-muted-foreground border-muted/20';
  };

  const toggleContactSelection = (contactId: string) => {
    setSelectedContacts(prev => 
      prev.includes(contactId) 
        ? prev.filter(id => id !== contactId)
        : [...prev, contactId]
    );
  };

  const toggleSelectAll = () => {
    if (selectedContacts.length === filteredContacts.length) {
      setSelectedContacts([]);
    } else {
      setSelectedContacts(filteredContacts.map(c => c.id));
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
          <p className="mt-2 text-muted-foreground">Loading contacts...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold gradient-primary bg-clip-text text-transparent">
            Contact Management
          </h1>
          <p className="text-muted-foreground">
            Secure contact storage with complete data retention
          </p>
        </div>
        <div className="flex items-center gap-2">
          {selectedContacts.length > 0 && (
            <Button 
              variant="outline"
              onClick={() => setShowBulkDialog(true)}
            >
              Bulk Skip Trace ({selectedContacts.length})
            </Button>
          )}
          <Button onClick={() => navigate('/contacts/new')}>
            <Plus className="h-4 w-4 mr-2" />
            Add Contact
          </Button>
        </div>
      </div>

      {/* Search and Filters */}
      <Card className="shadow-soft border-0">
        <CardContent className="p-4">
          <div className="flex items-center gap-4">
            {filteredContacts.length > 0 && (
              <div className="flex items-center gap-2">
                <Checkbox
                  checked={selectedContacts.length === filteredContacts.length}
                  onCheckedChange={toggleSelectAll}
                />
                <span className="text-sm text-muted-foreground">
                  Select All
                </span>
              </div>
            )}
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search contacts by name, email, phone, or address..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
            <Select value={skipTraceFilter} onValueChange={setSkipTraceFilter}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Filter by status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Contacts</SelectItem>
                <SelectItem value="enriched">Enriched Only</SelectItem>
                <SelectItem value="not_traced">Not Traced</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
              </SelectContent>
            </Select>
            <Badge variant="outline" className="text-sm">
              {filteredContacts.length} of {contacts.length} contacts
            </Badge>
          </div>
        </CardContent>
      </Card>

      {/* Contacts Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredContacts.map((contact) => (
          <Card key={contact.id} className="shadow-soft border-0 hover:shadow-medium transition-smooth group">
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <Checkbox
                    checked={selectedContacts.includes(contact.id)}
                    onCheckedChange={() => toggleContactSelection(contact.id)}
                  />
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                    <User className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <CardTitle className="text-lg">
                      {contact.first_name} {contact.last_name}
                    </CardTitle>
                    <p className="text-sm text-muted-foreground">
                      #{contact.contact_number}
                    </p>
                  </div>
                </div>
                
                {/* Action Buttons */}
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => setHistoryContactId(contact.id)}>
                        <History className="h-4 w-4 mr-2" />
                        View Skip Trace History
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => navigate(`/contact/${contact.id}`)}>
                        <RefreshCw className="h-4 w-4 mr-2" />
                        Re-run Skip Trace
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button 
                        variant="ghost" 
                        size="sm"
                        className="h-8 w-8 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                      >
                        <Archive className="h-4 w-4" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle className="flex items-center gap-2">
                          <AlertTriangle className="h-5 w-5 text-warning" />
                          Archive Contact
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                          This will archive the contact and remove them from the active list. 
                          The contact data will be securely preserved and can only be accessed 
                          with master-level permissions. This action cannot be undone from this interface.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction 
                          onClick={() => handleSoftDelete(contact.id)}
                          className="bg-destructive hover:bg-destructive/90"
                        >
                          Archive Contact
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>

              {/* Status Badges */}
              <div className="flex items-center gap-2 mt-2 flex-wrap">
                <SkipTraceStatusBadge 
                  status={contact.skip_trace_status}
                  confidenceScore={contact.skip_trace_confidence}
                  lastTracedAt={contact.skip_trace_last_run}
                />
                <Badge className={`text-xs px-2 py-1 ${getQualificationBadgeColor(contact.qualification_status)}`}>
                  {contact.qualification_status || 'Unqualified'}
                </Badge>
                {contact.lead_score > 0 && (
                  <Badge className={`text-xs px-2 py-1 ${getScoreBadgeColor(contact.lead_score)}`}>
                    Score: {contact.lead_score}
                  </Badge>
                )}
                {contact.lead_source && (
                  <Badge variant="outline" className="text-xs px-2 py-1">
                    {contact.lead_source}
                  </Badge>
                )}
              </div>
            </CardHeader>

            <CardContent>
              <div className="space-y-3">
                {/* Contact Info */}
                {contact.email && (
                  <div className="flex items-center gap-2 text-sm">
                    <Mail className="h-4 w-4 text-muted-foreground" />
                    <span className="truncate">{contact.email}</span>
                  </div>
                )}
                
                {contact.phone && (
                  <div className="flex items-center gap-2 text-sm">
                    <Phone className="h-4 w-4 text-muted-foreground" />
                    <span>{contact.phone}</span>
                  </div>
                )}

                {contact.address_street && (
                  <div className="flex items-start gap-2 text-sm">
                    <MapPin className="h-4 w-4 text-muted-foreground mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <p className="truncate">{contact.address_street}</p>
                      {(contact.address_city || contact.address_state) && (
                        <p className="text-muted-foreground truncate">
                          {contact.address_city}{contact.address_city && contact.address_state ? ', ' : ''}{contact.address_state} {contact.address_zip}
                        </p>
                      )}
                    </div>
                  </div>
                )}

                {/* Action Buttons */}
                <div className="pt-2 border-t space-y-2">
                  <SkipTraceButton
                    contactId={contact.id}
                    variant="outline"
                    size="sm"
                    onComplete={fetchContacts}
                  />
                  <div className="flex gap-2">
                    <Button 
                      variant="outline" 
                      size="sm" 
                      className="flex-1"
                      onClick={() => navigate(`/contact/${contact.id}`)}
                    >
                      View Details
                    </Button>
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={() => navigate(`/contact/${contact.id}/edit`)}
                    >
                      Edit
                    </Button>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Empty State */}
      {filteredContacts.length === 0 && (
        <div className="text-center p-8 bg-card rounded-lg border-2 border-dashed border-border">
          {searchTerm ? (
            <>
              <Search className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">No contacts found</h3>
              <p className="text-muted-foreground mb-4">
                No contacts match your search criteria. Try adjusting your search terms.
              </p>
              <Button variant="outline" onClick={() => setSearchTerm('')}>
                Clear Search
              </Button>
            </>
          ) : (
            <>
              <User className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">No contacts yet</h3>
              <p className="text-muted-foreground mb-4">
                Start building your contact database by adding your first contact.
              </p>
              <Button onClick={() => navigate('/contacts/new')}>
                <Plus className="h-4 w-4 mr-2" />
                Add First Contact
              </Button>
            </>
          )}
        </div>
      )}

      {/* Security Notice */}
      <Card className="bg-muted/20 border-muted/30">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <Archive className="h-5 w-5 text-primary mt-0.5" />
            <div>
              <h4 className="font-medium text-sm mb-1">Secure Contact Management</h4>
              <p className="text-xs text-muted-foreground">
                All contact data is permanently preserved in secure archives. When contacts are "deleted", 
                they are safely stored with master-level access controls. No data is ever permanently lost.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Bulk Skip Trace Dialog */}
      <BulkSkipTraceDialog
        open={showBulkDialog}
        onOpenChange={setShowBulkDialog}
        contactIds={selectedContacts}
        onComplete={() => {
          fetchContacts();
          setSelectedContacts([]);
        }}
      />

      {/* Skip Trace History Dialog */}
      {historyContactId && (
        <SkipTraceHistoryDialog
          open={!!historyContactId}
          onOpenChange={(open) => !open && setHistoryContactId(null)}
          contactId={historyContactId}
        />
      )}
    </div>
  );
};

export default EnhancedContacts;