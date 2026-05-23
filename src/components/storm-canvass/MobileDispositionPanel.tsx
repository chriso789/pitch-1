import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Check, X, Home, RefreshCw, Navigation, ChevronDown, ChevronUp } from 'lucide-react';
import { locationService } from '@/services/locationService';
import { useStormCanvass } from '@/hooks/useStormCanvass';
import { useToast } from '@/hooks/use-toast';
import { useNavigate } from 'react-router-dom';

interface MobileDispositionPanelProps {
  contact: Contact | null;
  userLocation: { lat: number; lng: number };
  dispositions: Disposition[];
  onClose: () => void;
  onUpdate: () => void;
  onNavigate?: (contact: Contact) => void;
}

interface Contact {
  id: string;
  first_name: string;
  last_name: string;
  address_street: string;
  address_city?: string;
  address_state?: string;
  address_zip?: string;
  latitude: number;
  longitude: number;
  qualification_status?: string;
  metadata?: any;
  phone?: string;
  email?: string;
}

interface Disposition {
  id: string;
  name: string;
  qualification_status?: string;
  is_qualified?: boolean;
  color?: string;
}

export default function MobileDispositionPanel({
  contact,
  userLocation,
  dispositions,
  onClose,
  onUpdate,
  onNavigate,
}: MobileDispositionPanelProps) {
  const { toast } = useToast();
  const navigate = useNavigate();
  const { updateDisposition } = useStormCanvass();
  const [notes, setNotes] = useState('');
  const [showNotes, setShowNotes] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);

  if (!contact) return null;

  const fullAddress = [
    contact.address_street,
    contact.address_city,
    contact.address_state,
    contact.address_zip,
  ]
    .filter(Boolean)
    .join(', ');

  const distanceData = locationService.calculateDistance(
    userLocation.lat,
    userLocation.lng,
    contact.latitude,
    contact.longitude,
    'miles'
  );

  const formattedDistance =
    distanceData.distance < 0.1
      ? `${Math.round(distanceData.distance * 5280)} ft away`
      : `${distanceData.distance.toFixed(2)} mi away`;

  const handleDispositionSelect = async (dispositionId: string, dispositionName: string) => {
    setIsUpdating(true);
    try {
      await updateDisposition(contact.id, dispositionId, notes || `Set to ${dispositionName} from field`);
      
      toast({
        title: 'Disposition Updated',
        description: `Contact set to ${dispositionName}`,
      });
      
      onUpdate();
      onClose();
    } catch (error) {
      console.error('Failed to update disposition:', error);
      toast({
        title: 'Update Failed',
        description: 'Could not update disposition. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsUpdating(false);
    }
  };

  const getDispositionIcon = (disposition: Disposition) => {
    const name = disposition.name.toLowerCase();
    if (name.includes('interested') || name.includes('qualified')) return Check;
    if (name.includes('not home') || name.includes('callback')) return Home;
    if (name.includes('not interested') || name.includes('declined')) return X;
    if (name.includes('follow') || name.includes('reschedule')) return RefreshCw;
    return Check;
  };

  const getDispositionColor = (disposition: Disposition) => {
    const name = disposition.name.toLowerCase();
    if (name.includes('interested') || name.includes('qualified')) return 'default';
    if (name.includes('not home') || name.includes('callback')) return 'secondary';
    if (name.includes('not interested') || name.includes('declined')) return 'destructive';
    if (name.includes('follow') || name.includes('reschedule')) return 'outline';
    return 'default';
  };

  return (
    <Sheet open={!!contact} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="bottom"
        className="max-h-[90dvh] h-auto rounded-t-3xl p-0 flex flex-col overflow-hidden"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 16px)' }}
      >
        <SheetHeader className="sticky top-0 z-10 bg-background border-b px-5 pt-5 pb-3">
          <SheetTitle className="text-left text-base">
            {contact.first_name} {contact.last_name}
          </SheetTitle>
          <div className="space-y-1.5">
            <p className="text-sm text-muted-foreground">{fullAddress}</p>
            <div className="flex items-center gap-2 text-sm">
              <Navigation className="h-4 w-4 text-primary" />
              <span className="font-medium">{formattedDistance}</span>
              {contact.qualification_status && (
                <Badge variant="outline" className="ml-auto text-[10px]">
                  {contact.qualification_status}
                </Badge>
              )}
            </div>
          </div>
        </SheetHeader>

        <div
          className="flex-1 overflow-y-auto overscroll-contain px-5 pt-4"
          style={{ WebkitOverflowScrolling: 'touch' } as any}
        >
          {/* Disposition Buttons */}
          <div className="space-y-2.5">
            <h3 className="text-sm font-medium">Update Disposition</h3>
            {dispositions.map((disposition) => {
              const Icon = getDispositionIcon(disposition);
              return (
                <Button
                  key={disposition.id}
                  onClick={() => handleDispositionSelect(disposition.id, disposition.name)}
                  disabled={isUpdating}
                  variant={getDispositionColor(disposition)}
                  className="w-full h-12 text-base justify-start gap-3"
                  size="lg"
                >
                  <Icon className="h-5 w-5" />
                  {disposition.name}
                </Button>
              );
            })}
          </div>

          {/* Navigate Button */}
          {onNavigate && (
            <Button
              variant="outline"
              onClick={async () => {
                if (contact.latitude && contact.longitude) {
                  const { openNativeMaps } = await import('@/utils/nativeBridge');
                  void openNativeMaps(contact.latitude, contact.longitude, fullAddress);
                }
                onNavigate(contact);
              }}
              className="w-full h-12 text-base justify-start gap-3 mt-4"
              size="lg"
            >
              <Navigation className="h-5 w-5" />
              Navigate Here · {formattedDistance}
            </Button>
          )}


          {/* Optional Notes Section */}
          <div className="space-y-2">
            <Button
              variant="ghost"
              onClick={() => setShowNotes(!showNotes)}
              className="w-full justify-between"
            >
              <span className="text-sm">Add Notes (Optional)</span>
              {showNotes ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>
            {showNotes && (
              <Textarea
                placeholder="Add any notes about this contact..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                className="resize-none"
              />
            )}
          </div>

          {/* View Full Profile */}
          <Button
            variant="outline"
            onClick={() => navigate(`/contact/${contact.id}`)}
            className="w-full"
          >
            View Full Profile
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
