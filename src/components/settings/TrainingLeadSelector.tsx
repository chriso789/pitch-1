import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Search, MapPin, CheckCircle2, AlertCircle, Home, RefreshCw } from 'lucide-react';
import { useEffectiveTenantId } from '@/hooks/useEffectiveTenantId';

interface TrainingLeadSelectorProps {
  open: boolean;
  onClose: () => void;
  onSelect: (data: {
    pipelineEntryId: string;
    contactId?: string;
    address: string;
    lat: number;
    lng: number;
    name: string;
  }) => void;
}

// Use loose typing to avoid Supabase Json type conflicts
interface LeadOption {
  id: string;
  contact_id?: string;
  contact?: any;
  metadata?: any;
}

// Robust coordinate extraction supporting multiple formats
function extractCoordinates(lead: LeadOption): { lat: number; lng: number; address: string } | null {
  const metadata = lead.metadata as any;
  const contact = lead.contact as any;

  // Priority 1: Pipeline entry metadata.verified_address with geometry.location (Google format)
  if (metadata?.verified_address?.geometry?.location) {
    const loc = metadata.verified_address.geometry.location;
    if (typeof loc.lat === 'number' && typeof loc.lng === 'number') {
      return {
        lat: loc.lat,
        lng: loc.lng,
        address: metadata.verified_address.formatted_address || 'Address verified',
      };
    }
  }

  // Priority 2: Pipeline entry metadata.verified_address with direct lat/lng
  if (metadata?.verified_address?.lat != null && metadata?.verified_address?.lng != null) {
    return {
      lat: Number(metadata.verified_address.lat),
      lng: Number(metadata.verified_address.lng),
      address: metadata.verified_address.formatted_address || 
        metadata.verified_address.street || 'Address verified',
    };
  }

  // Priority 3: Contact verified_address with geometry.location (Google format)
  if (contact?.verified_address?.geometry?.location) {
    const loc = contact.verified_address.geometry.location;
    if (typeof loc.lat === 'number' && typeof loc.lng === 'number') {
      return {
        lat: loc.lat,
        lng: loc.lng,
        address: contact.verified_address.formatted_address || buildContactAddress(contact),
      };
    }
  }

  // Priority 4: Contact verified_address with direct lat/lng
  if (contact?.verified_address?.lat != null && contact?.verified_address?.lng != null) {
    return {
      lat: Number(contact.verified_address.lat),
      lng: Number(contact.verified_address.lng),
      address: contact.verified_address.formatted_address || buildContactAddress(contact),
    };
  }

  // Priority 5: Contact latitude/longitude columns
  if (contact?.latitude != null && contact?.longitude != null) {
    return {
      lat: Number(contact.latitude),
      lng: Number(contact.longitude),
      address: buildContactAddress(contact),
    };
  }

  return null;
}

function buildContactAddress(contact: any): string {
  if (!contact) return 'No address';
  const parts = [
    contact.address_street,
    contact.address_city,
    contact.address_state,
    contact.address_zip
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : 'No address';
}

export function TrainingLeadSelector({ open, onClose, onSelect }: TrainingLeadSelectorProps) {
  const effectiveTenantId = useEffectiveTenantId();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedLead, setSelectedLead] = useState<LeadOption | null>(null);
  const [sessionName, setSessionName] = useState('');

  // Fetch leads with verified addresses (no embedded roof_measurements - no FK exists)
  const { data: leads = [], isLoading, error, isError, refetch } = useQuery({
    queryKey: ['training-leads', effectiveTenantId],
    queryFn: async () => {
      if (!effectiveTenantId) {
        console.warn('[TrainingLeadSelector] No tenant ID available');
        return [];
      }

      // Step 1: Fetch pipeline entries with contacts (valid FK relationship)
      const { data: pipelineData, error: pipelineError } = await supabase
        .from('pipeline_entries')
        .select(`
          id,
          contact_id,
          metadata,
          contact:contacts(
            first_name, last_name, latitude, longitude,
            address_street, address_city, address_state, address_zip,
            verified_address
          )
        `)
        .eq('tenant_id', effectiveTenantId)
        .order('created_at', { ascending: false })
        .limit(100);

      if (pipelineError) {
        console.error('[TrainingLeadSelector] Pipeline query error:', pipelineError);
        throw pipelineError;
      }

      // Filter to only leads with valid coordinates
      const leadsWithCoords = (pipelineData || []).filter(
        (lead) => extractCoordinates(lead as LeadOption) !== null
      ) as LeadOption[];

      console.log(`[TrainingLeadSelector] Tenant: ${effectiveTenantId}, Leads with coords: ${leadsWithCoords.length}`);

      return leadsWithCoords;
    },
    enabled: open && !!effectiveTenantId,
  });

  // Client-side search filtering
  const filteredLeads = leads.filter((lead) => {
    if (!searchQuery.trim()) return true;
    const name = lead.contact
      ? `${lead.contact.first_name || ''} ${lead.contact.last_name || ''}`.toLowerCase()
      : '';
    return name.includes(searchQuery.toLowerCase());
  });

  // Use the shared extraction function
  const getLeadCoordinates = extractCoordinates;

  const handleSubmit = () => {
    if (!selectedLead) return;
    
    const coords = getLeadCoordinates(selectedLead);
    if (!coords) return;

    const contactName = selectedLead.contact 
      ? `${selectedLead.contact.first_name} ${selectedLead.contact.last_name}`.trim()
      : 'Unknown';

    onSelect({
      pipelineEntryId: selectedLead.id,
      contactId: selectedLead.contact_id,
      address: coords.address,
      lat: coords.lat,
      lng: coords.lng,
      name: sessionName || `Training: ${contactName}`,
    });
  };

  return (
    <Dialog open={open} onOpenChange={() => onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Create Training Session</DialogTitle>
          <DialogDescription>
            Select a lead with a verified address to start a new training session
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search leads by name..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>

          {/* Lead List */}
          <ScrollArea className="h-[300px] border rounded-lg p-2">
            {isLoading ? (
              <div className="flex items-center justify-center h-full text-muted-foreground">
                Loading leads...
              </div>
            ) : isError ? (
              <div className="flex flex-col items-center justify-center h-full text-destructive text-center px-4">
                <AlertCircle className="h-8 w-8 mb-2" />
                <p className="font-medium">Error loading leads</p>
                <p className="text-sm mt-1">{(error as Error)?.message || 'Unknown error'}</p>
                <Button variant="outline" size="sm" className="mt-3" onClick={() => refetch()}>
                  <RefreshCw className="h-4 w-4 mr-1" /> Retry
                </Button>
              </div>
            ) : leads.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-muted-foreground text-center px-4">
                <AlertCircle className="h-8 w-8 mb-2" />
                <p className="font-medium">No leads with verified addresses found</p>
                <p className="text-sm mt-1">
                  {effectiveTenantId 
                    ? 'Add leads with addresses or verify existing lead addresses in this company.'
                    : 'Select a company from the sidebar to view leads.'}
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {filteredLeads.map((lead) => {
                  const coords = getLeadCoordinates(lead);
                  const contactName = lead.contact 
                    ? `${lead.contact.first_name} ${lead.contact.last_name}`.trim()
                    : 'Unknown Contact';
                  const isSelected = selectedLead?.id === lead.id;

                  return (
                    <Card
                      key={lead.id}
                      className={`cursor-pointer transition-colors ${
                        isSelected ? 'ring-2 ring-primary bg-primary/5' : 'hover:bg-accent/50'
                      }`}
                      onClick={() => setSelectedLead(lead)}
                    >
                      <CardContent className="p-3">
                        <div className="flex items-center justify-between">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <Home className="h-4 w-4 text-muted-foreground shrink-0" />
                              <span className="font-medium truncate">{contactName}</span>
                            </div>
                            <div className="flex items-center gap-1 mt-1 text-sm text-muted-foreground">
                              <MapPin className="h-3.5 w-3.5 shrink-0" />
                              <span className="truncate">{coords?.address || 'No address'}</span>
                            </div>
                          </div>
                          {isSelected && (
                            <CheckCircle2 className="h-5 w-5 text-primary shrink-0" />
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </ScrollArea>

          {/* Session Name */}
          {selectedLead && (
            <div className="space-y-2">
              <Label htmlFor="session-name">Session Name (optional)</Label>
              <Input
                id="session-name"
                placeholder="e.g., Training: Complex Hip Roof"
                value={sessionName}
                onChange={(e) => setSessionName(e.target.value)}
              />
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button 
              onClick={handleSubmit} 
              disabled={!selectedLead}
            >
              Create Session
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
