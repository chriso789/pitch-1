import { Phone, Mail, MapPin, Navigation, User, X, Home, Clock, ThumbsUp, ThumbsDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { useUserProfile } from '@/contexts/UserProfileContext';
import { toast } from 'sonner';

interface PropertyInfoPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  property: any;
  userLocation: { lat: number; lng: number };
  onDispositionUpdate: () => void;
  onNavigate: (lat: number, lng: number, address: string) => void;
}

const DISPOSITIONS = [
  { id: 'interested', label: 'Interested', icon: ThumbsUp, color: 'bg-green-500' },
  { id: 'not_home', label: 'Not Home', icon: Home, color: 'bg-gray-500' },
  { id: 'not_interested', label: 'Not Interested', icon: ThumbsDown, color: 'bg-red-500' },
  { id: 'follow_up', label: 'Follow Up', icon: Clock, color: 'bg-yellow-500' },
];

export default function PropertyInfoPanel({
  open,
  onOpenChange,
  property,
  userLocation,
  onDispositionUpdate,
  onNavigate,
}: PropertyInfoPanelProps) {
  const { profile } = useUserProfile();

  if (!property) return null;

  // Parse address and homeowner data
  const address = typeof property.address === 'string' 
    ? JSON.parse(property.address) 
    : property.address;
  const homeowner = typeof property.homeowner === 'string'
    ? JSON.parse(property.homeowner)
    : property.homeowner;
  const phoneNumbers = typeof property.phone_numbers === 'string'
    ? JSON.parse(property.phone_numbers)
    : property.phone_numbers;
  const emails = typeof property.emails === 'string'
    ? JSON.parse(property.emails)
    : property.emails;

  const ownerName = property.owner_name || homeowner?.name || 'Unknown Owner';
  const fullAddress = address?.formatted || 
    `${address?.street || ''}, ${address?.city || ''} ${address?.state || ''} ${address?.zip || ''}`.trim();

  // Calculate distance
  const distance = calculateDistance(
    userLocation.lat,
    userLocation.lng,
    property.lat || address?.lat,
    property.lng || address?.lng
  );

  const handleDisposition = async (dispositionId: string) => {
    if (!profile?.tenant_id || !property.id) return;

    try {
      // Update property disposition
      const { error } = await supabase
        .from('canvassiq_properties')
        .update({
          disposition: dispositionId,
          disposition_updated_at: new Date().toISOString(),
          disposition_updated_by: profile.id,
        })
        .eq('id', property.id);

      if (error) throw error;

      // Log the visit
      await supabase.from('canvassiq_visits').insert({
        property_id: property.id,
        tenant_id: profile.tenant_id,
        user_id: profile.id,
        disposition: dispositionId,
        visit_type: 'door_knock',
        lat: userLocation.lat,
        lng: userLocation.lng,
        started_at: new Date().toISOString(),
      });

      toast.success(`Marked as ${dispositionId.replace('_', ' ')}`);
      onDispositionUpdate();
      onOpenChange(false);
    } catch (err) {
      console.error('Error updating disposition:', err);
      toast.error('Failed to update disposition');
    }
  };

  const handleCall = (phone: string) => {
    window.location.href = `tel:${phone}`;
  };

  const handleEmail = (email: string) => {
    window.location.href = `mailto:${email}`;
  };

  const handleNavigate = () => {
    const lat = property.lat || address?.lat;
    const lng = property.lng || address?.lng;
    if (lat && lng) {
      onNavigate(lat, lng, fullAddress);
      onOpenChange(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="h-auto max-h-[70vh] rounded-t-2xl">
        <SheetHeader className="pb-4">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <SheetTitle className="flex items-center gap-2 text-lg">
                <User className="h-5 w-5 text-primary" />
                {ownerName}
              </SheetTitle>
              <p className="text-sm text-muted-foreground mt-1 flex items-center gap-1">
                <MapPin className="h-3.5 w-3.5" />
                {fullAddress}
              </p>
              {distance && (
                <Badge variant="secondary" className="mt-2">
                  📍 {distance.toFixed(2)} mi away
                </Badge>
              )}
            </div>
            {property.disposition && (
              <Badge 
                className={`${getDispositionColor(property.disposition)} text-white`}
              >
                {property.disposition.replace('_', ' ')}
              </Badge>
            )}
          </div>
        </SheetHeader>

        {/* Contact Info */}
        <div className="space-y-3 mb-6">
          {phoneNumbers && phoneNumbers.length > 0 && (
            <div className="flex items-center gap-3">
              <Phone className="h-4 w-4 text-muted-foreground" />
              <div className="flex flex-wrap gap-2">
                {phoneNumbers.slice(0, 2).map((phone: string, idx: number) => (
                  <Button
                    key={idx}
                    variant="outline"
                    size="sm"
                    onClick={() => handleCall(phone)}
                    className="text-xs"
                  >
                    {phone}
                  </Button>
                ))}
              </div>
            </div>
          )}
          {emails && emails.length > 0 && (
            <div className="flex items-center gap-3">
              <Mail className="h-4 w-4 text-muted-foreground" />
              <div className="flex flex-wrap gap-2">
                {emails.slice(0, 2).map((email: string, idx: number) => (
                  <Button
                    key={idx}
                    variant="outline"
                    size="sm"
                    onClick={() => handleEmail(email)}
                    className="text-xs truncate max-w-[150px]"
                  >
                    {email}
                  </Button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Disposition Buttons */}
        <div className="grid grid-cols-2 gap-2 mb-4">
          {DISPOSITIONS.map((disp) => (
            <Button
              key={disp.id}
              variant={property.disposition === disp.id ? 'default' : 'outline'}
              className={`flex items-center gap-2 ${
                property.disposition === disp.id ? disp.color : ''
              }`}
              onClick={() => handleDisposition(disp.id)}
            >
              <disp.icon className="h-4 w-4" />
              {disp.label}
            </Button>
          ))}
        </div>

        {/* Action Buttons */}
        <div className="flex gap-2">
          <Button
            variant="secondary"
            className="flex-1"
            onClick={handleNavigate}
          >
            <Navigation className="h-4 w-4 mr-2" />
            Navigate Here
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function calculateDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  if (!lat2 || !lng2) return 0;
  const R = 3959; // Earth's radius in miles
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRad(deg: number): number {
  return deg * (Math.PI / 180);
}

function getDispositionColor(disposition: string): string {
  switch (disposition) {
    case 'interested':
    case 'qualified':
      return 'bg-green-500';
    case 'not_interested':
      return 'bg-red-500';
    case 'follow_up':
      return 'bg-yellow-500';
    case 'not_home':
      return 'bg-gray-500';
    default:
      return 'bg-blue-500';
  }
}
