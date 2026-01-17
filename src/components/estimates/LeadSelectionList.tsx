import React, { useState, useEffect } from 'react';
import { Search, MapPin, Phone, Calendar, FileText, User, Loader2, Plus, CheckCircle2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';

interface Lead {
  id: string;
  clj_formatted_number: string | null;
  status: string | null;
  created_at: string | null;
  contact: {
    first_name: string;
    last_name: string;
    phone: string | null;
    address_street: string | null;
    address_city: string | null;
    address_state: string | null;
    address_zip: string | null;
  } | null;
  estimate_count: number;
  has_measurements: boolean;
}

interface LeadSelectionListProps {
  tenantId: string;
  onSelect: (lead: Lead) => void;
  onCreateNew: () => void;
  selectedLeadId?: string | null;
}

export const LeadSelectionList: React.FC<LeadSelectionListProps> = ({
  tenantId,
  onSelect,
  onCreateNew,
  selectedLeadId
}) => {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    fetchLeads();
  }, [tenantId]);

  const fetchLeads = async () => {
    try {
      setLoading(true);
      
      // Fetch pipeline entries with contacts
      const { data: pipelineEntries, error } = await supabase
        .from('pipeline_entries')
        .select(`
          id,
          clj_formatted_number,
          status,
          created_at,
          contact_id,
          metadata,
          contacts (
            first_name,
            last_name,
            phone,
            address_street,
            address_city,
            address_state,
            address_zip
          )
        `)
        .eq('tenant_id', tenantId)
        .eq('is_deleted', false)
        .order('created_at', { ascending: false });

      if (error) throw error;

      // Get estimate counts for each pipeline entry
      const pipelineIds = (pipelineEntries || []).map(p => p.id);
      
      let estimateCounts: Record<string, number> = {};
      
      if (pipelineIds.length > 0) {
        const { data: estimates } = await supabase
          .from('enhanced_estimates')
          .select('pipeline_entry_id')
          .in('pipeline_entry_id', pipelineIds);
        
        (estimates || []).forEach(e => {
          if (e.pipeline_entry_id) {
            estimateCounts[e.pipeline_entry_id] = (estimateCounts[e.pipeline_entry_id] || 0) + 1;
          }
        });
      }

      const enrichedLeads: Lead[] = (pipelineEntries || []).map(entry => {
        // Check if metadata contains measurements
        const metadata = entry.metadata as Record<string, any> | null;
        const hasMeasurements = !!(metadata?.roof_area_sq_ft || metadata?.comprehensive_measurements);
        
        return {
          id: entry.id,
          clj_formatted_number: entry.clj_formatted_number,
          status: entry.status,
          created_at: entry.created_at,
          contact: entry.contacts as Lead['contact'],
          estimate_count: estimateCounts[entry.id] || 0,
          has_measurements: hasMeasurements
        };
      });

      setLeads(enrichedLeads);
    } catch (error) {
      console.error('Error fetching leads:', error);
    } finally {
      setLoading(false);
    }
  };

  const filteredLeads = leads.filter(lead => {
    if (!searchQuery) return true;
    
    const query = searchQuery.toLowerCase();
    const contactName = lead.contact 
      ? `${lead.contact.first_name} ${lead.contact.last_name}`.toLowerCase() 
      : '';
    const address = lead.contact 
      ? `${lead.contact.address_street || ''} ${lead.contact.address_city || ''} ${lead.contact.address_state || ''} ${lead.contact.address_zip || ''}`.toLowerCase()
      : '';
    const phone = lead.contact?.phone?.toLowerCase() || '';
    const leadNumber = lead.clj_formatted_number?.toLowerCase() || '';

    return contactName.includes(query) || 
           address.includes(query) || 
           phone.includes(query) || 
           leadNumber.includes(query);
  });

  const formatAddress = (contact: Lead['contact']) => {
    if (!contact) return 'No address';
    const parts = [
      contact.address_street,
      contact.address_city,
      contact.address_state,
      contact.address_zip
    ].filter(Boolean);
    return parts.join(', ') || 'No address';
  };

  const getStatusColor = (status: string | null) => {
    if (!status) return 'bg-muted text-muted-foreground';
    const colors: Record<string, string> = {
      lead: 'bg-info/10 text-info border-info/20',
      project: 'bg-success/10 text-success border-success/20',
      completed: 'bg-success/10 text-success border-success/20',
      closed: 'bg-muted text-muted-foreground border-muted',
      canceled: 'bg-destructive/10 text-destructive border-destructive/20',
      lost: 'bg-destructive/10 text-destructive border-destructive/20'
    };
    return colors[status] || 'bg-muted text-muted-foreground';
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <span className="ml-2 text-muted-foreground">Loading leads...</span>
      </div>
    );
  }

  if (leads.length === 0) {
    return (
      <div className="text-center py-12">
        <User className="h-16 w-16 mx-auto text-muted-foreground mb-4" />
        <h3 className="text-lg font-semibold mb-2">No Leads Yet</h3>
        <p className="text-muted-foreground mb-4">
          You need to create a lead before you can generate an estimate.
        </p>
        <Button onClick={onCreateNew} className="gradient-primary">
          <Plus className="h-4 w-4 mr-2" />
          Create Your First Lead
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Search and Create New */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by name, address, phone, or lead #..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <Button variant="outline" onClick={onCreateNew}>
          <Plus className="h-4 w-4 mr-2" />
          New Lead
        </Button>
      </div>

      {/* Leads List */}
      <ScrollArea className="h-[400px] pr-4">
        <div className="space-y-2">
          {filteredLeads.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No leads match your search
            </div>
          ) : (
            filteredLeads.map((lead) => (
              <div
                key={lead.id}
                onClick={() => onSelect(lead)}
                className={cn(
                  "border rounded-lg p-4 cursor-pointer transition-all hover:border-primary/50 hover:bg-accent/50",
                  selectedLeadId === lead.id && "border-primary bg-primary/5"
                )}
              >
                <div className="flex justify-between items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium truncate">
                        {lead.contact 
                          ? `${lead.contact.first_name} ${lead.contact.last_name}` 
                          : 'Unknown Contact'}
                      </span>
                      <Badge variant="outline" className={getStatusColor(lead.status)}>
                        {(lead.status || 'unknown').replace('_', ' ')}
                      </Badge>
                    </div>
                    
                    <div className="flex items-center gap-1 text-sm text-muted-foreground mb-1">
                      <MapPin className="h-3 w-3 shrink-0" />
                      <span className="truncate">{formatAddress(lead.contact)}</span>
                    </div>
                    
                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                      {lead.contact?.phone && (
                        <span className="flex items-center gap-1">
                          <Phone className="h-3 w-3" />
                          {lead.contact.phone}
                        </span>
                      )}
                      {lead.created_at && (
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          {new Date(lead.created_at).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                  </div>
                  
                  <div className="flex flex-col items-end gap-1">
                    {selectedLeadId === lead.id && (
                      <CheckCircle2 className="h-5 w-5 text-primary" />
                    )}
                    <div className="flex gap-1">
                      {lead.estimate_count > 0 && (
                        <Badge variant="secondary" className="text-xs">
                          <FileText className="h-3 w-3 mr-1" />
                          {lead.estimate_count}
                        </Badge>
                      )}
                      {lead.has_measurements && (
                        <Badge variant="secondary" className="text-xs">
                          📐
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  );
};
