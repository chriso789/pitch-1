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
import { Search, MapPin, CheckCircle2, AlertCircle, Home } from 'lucide-react';
import { useCompanySwitcher } from '@/hooks/useCompanySwitcher';

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
    satelliteImageUrl?: string;
    aiMeasurementId?: string;
  }) => void;
}

interface LeadOption {
  id: string;
  contact_id?: string;
  contact?: {
    first_name: string;
    last_name: string;
    latitude?: number;
    longitude?: number;
    address_street?: string;
    address_city?: string;
    address_state?: string;
    address_zip?: string;
    verified_address?: {
      lat: number;
      lng: number;
      formatted_address?: string;
    };
  };
  metadata?: {
    verified_address?: {
      formatted_address?: string;
      geometry?: {
        location?: {
          lat: number;
          lng: number;
        };
      };
    };
  };
  roof_measurement?: {
    id: string;
    satellite_image_url?: string;
  };
}

export function TrainingLeadSelector({ open, onClose, onSelect }: TrainingLeadSelectorProps) {
  const { activeCompanyId } = useCompanySwitcher();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedLead, setSelectedLead] = useState<LeadOption | null>(null);
  const [sessionName, setSessionName] = useState('');

  // Fetch leads with verified addresses
  const { data: leads = [], isLoading } = useQuery({
    queryKey: ['training-leads', activeCompanyId, searchQuery],
    queryFn: async () => {
      let query = supabase
        .from('pipeline_entries')
        .select(`
          id,
          contact_id,
          metadata,
          contact:contacts(
            first_name, last_name, latitude, longitude,
            address_street, address_city, address_state, address_zip,
            verified_address
          ),
          roof_measurement:roof_measurements(id, satellite_image_url)
        `)
        .eq('tenant_id', activeCompanyId!)
        .order('created_at', { ascending: false })
        .limit(50);

      if (searchQuery) {
        // Search in contact names or addresses
        query = query.or(`contact.first_name.ilike.%${searchQuery}%,contact.last_name.ilike.%${searchQuery}%`);
      }

      const { data, error } = await query;
      if (error) throw error;

      // Filter to only leads with coordinates and cast properly
      return (data || []).filter((lead) => {
        const metadata = lead.metadata as any;
        const contact = lead.contact as any;
        const verifiedAddr = metadata?.verified_address?.geometry?.location;
        const contactVerified = contact?.verified_address;
        const contactLatLng = contact?.latitude && contact?.longitude;
        
        return verifiedAddr || contactVerified || contactLatLng;
      }) as LeadOption[];
    },
    enabled: open && !!activeCompanyId,
  });

  const getLeadCoordinates = (lead: LeadOption): { lat: number; lng: number; address: string } | null => {
    const metadata = lead.metadata as any;
    const contact = lead.contact;

    // Priority 1: Pipeline entry verified address
    if (metadata?.verified_address?.geometry?.location) {
      return {
        lat: metadata.verified_address.geometry.location.lat,
        lng: metadata.verified_address.geometry.location.lng,
        address: metadata.verified_address.formatted_address || 'Address verified',
      };
    }

    // Priority 2: Contact verified address
    if (contact?.verified_address?.lat && contact?.verified_address?.lng) {
      return {
        lat: contact.verified_address.lat,
        lng: contact.verified_address.lng,
        address: contact.verified_address.formatted_address || 
          `${contact.address_street}, ${contact.address_city}, ${contact.address_state} ${contact.address_zip}`,
      };
    }

    // Priority 3: Contact lat/lng
    if (contact?.latitude && contact?.longitude) {
      return {
        lat: contact.latitude,
        lng: contact.longitude,
        address: `${contact.address_street}, ${contact.address_city}, ${contact.address_state} ${contact.address_zip}`,
      };
    }

    return null;
  };

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
      satelliteImageUrl: (selectedLead.roof_measurement as any)?.[0]?.satellite_image_url,
      aiMeasurementId: (selectedLead.roof_measurement as any)?.[0]?.id,
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
            ) : leads.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                <AlertCircle className="h-8 w-8 mb-2" />
                <p>No leads with verified addresses found</p>
              </div>
            ) : (
              <div className="space-y-2">
                {leads.map((lead) => {
                  const coords = getLeadCoordinates(lead);
                  const contactName = lead.contact 
                    ? `${lead.contact.first_name} ${lead.contact.last_name}`.trim()
                    : 'Unknown Contact';
                  const hasAIMeasurement = !!(lead.roof_measurement as any)?.[0];
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
                              {hasAIMeasurement && (
                                <Badge variant="outline" className="text-xs shrink-0">
                                  Has AI Measurement
                                </Badge>
                              )}
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
