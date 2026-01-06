import { useState, useEffect } from 'react';
import { useNavigate, useLocation, useParams } from 'react-router-dom';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
  ArrowLeft, 
  Phone, 
  Mail, 
  Navigation, 
  Camera, 
  Home,
  User,
  MapPin,
  Save,
  X,
  CheckCircle2
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useUserProfile } from '@/contexts/UserProfileContext';
import { useToast } from '@/hooks/use-toast';
import { CanvassPhotoCapture } from '@/components/storm-canvass/CanvassPhotoCapture';

// Disposition options with colors and icons
const DISPOSITION_OPTIONS = [
  { value: 'not_home', label: 'Not Home', color: 'bg-gray-500', icon: '🏠' },
  { value: 'interested', label: 'Interested', color: 'bg-green-500', icon: '✓' },
  { value: 'not_interested', label: 'Not Interested', color: 'bg-red-500', icon: '✕' },
  { value: 'follow_up', label: 'Follow Up', color: 'bg-yellow-500', icon: '📅' },
  { value: 'new_roof', label: 'New Roof', color: 'bg-amber-700', icon: '🏠' },
  { value: 'unqualified', label: 'Unqualified', color: 'bg-red-600', icon: '✕' },
];

export default function PropertyInteractionPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { propertyId } = useParams();
  const { profile } = useUserProfile();
  const { toast } = useToast();
  
  const [property, setProperty] = useState<any>(location.state?.property || null);
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(
    location.state?.userLocation || null
  );
  const [selectedDisposition, setSelectedDisposition] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [showPhotoCapture, setShowPhotoCapture] = useState(false);

  // Load property if not passed via state
  useEffect(() => {
    if (!property && propertyId && profile?.tenant_id) {
      loadProperty();
    }
  }, [propertyId, profile?.tenant_id]);

  // Set initial disposition from property
  useEffect(() => {
    if (property) {
      setSelectedDisposition(property.disposition || null);
      setNotes(property.notes || '');
    }
  }, [property]);

  const loadProperty = async () => {
    try {
      const { data, error } = await supabase
        .from('canvassiq_properties')
        .select('*')
        .eq('id', propertyId)
        .single();

      if (error) throw error;
      setProperty(data);
    } catch (err) {
      console.error('Error loading property:', err);
      toast({
        title: 'Error',
        description: 'Failed to load property details',
        variant: 'destructive',
      });
    }
  };

  const getStreetNumber = (address: any): string => {
    if (!address) return '';
    if (typeof address === 'string') {
      try {
        address = JSON.parse(address);
      } catch {
        return '';
      }
    }
    const street = address.street || address.formatted || '';
    const match = street.match(/^(\d+)/);
    return match ? match[1] : '';
  };

  const getFormattedAddress = (address: any): string => {
    if (!address) return 'Address unavailable';
    if (typeof address === 'string') {
      try {
        address = JSON.parse(address);
      } catch {
        return address;
      }
    }
    return address.formatted || address.street || 'Address unavailable';
  };

  const handleDispositionSelect = (disposition: string) => {
    setSelectedDisposition(disposition);
  };

  const handleSave = async () => {
    if (!property || !profile?.tenant_id) return;

    setIsSaving(true);
    try {
      const { error } = await supabase
        .from('canvassiq_properties')
        .update({
          disposition: selectedDisposition,
          notes: notes,
          updated_at: new Date().toISOString(),
        })
        .eq('id', property.id);

      if (error) throw error;

      toast({
        title: 'Saved!',
        description: 'Property interaction logged successfully',
      });

      navigate(-1);
    } catch (err) {
      console.error('Error saving:', err);
      toast({
        title: 'Error',
        description: 'Failed to save interaction',
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleCall = () => {
    const phone = property?.phone_numbers?.[0];
    if (phone) {
      window.open(`tel:${phone}`, '_self');
    } else {
      toast({
        title: 'No Phone Number',
        description: 'No phone number available for this property',
        variant: 'destructive',
      });
    }
  };

  const handleEmail = () => {
    const email = property?.emails?.[0];
    if (email) {
      window.open(`mailto:${email}`, '_self');
    } else {
      toast({
        title: 'No Email',
        description: 'No email available for this property',
        variant: 'destructive',
      });
    }
  };

  const handleNavigate = () => {
    if (!property?.lat || !property?.lng) return;

    const destCoords = `${property.lat},${property.lng}`;
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);

    if (isIOS) {
      window.open(`maps://?daddr=${destCoords}&dirflg=d`, '_blank');
    } else {
      window.open(`https://www.google.com/maps/dir/?api=1&destination=${destCoords}&travelmode=driving`, '_blank');
    }
  };

  if (!property) {
    return (
      <div className="h-screen flex items-center justify-center bg-background">
        <div className="animate-pulse text-muted-foreground">Loading property...</div>
      </div>
    );
  }

  const streetNumber = getStreetNumber(property.address);
  const fullAddress = getFormattedAddress(property.address);
  const ownerName = property.owner_name || property.homeowner?.name || 'Unknown Owner';

  return (
    <div className="h-screen w-full flex flex-col bg-background">
      {/* Header */}
      <Card className="rounded-none border-x-0 border-t-0 shrink-0">
        <div className="p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => navigate(-1)}
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div className="min-w-0">
              <h1 className="text-xl font-bold flex items-center gap-2">
                <Home className="h-5 w-5 text-primary" />
                {streetNumber || 'Property'}
              </h1>
              <p className="text-sm text-muted-foreground truncate max-w-[250px]">
                {fullAddress}
              </p>
            </div>
          </div>
          {selectedDisposition && (
            <Badge 
              className={`${DISPOSITION_OPTIONS.find(d => d.value === selectedDisposition)?.color || 'bg-gray-500'} text-white`}
            >
              {DISPOSITION_OPTIONS.find(d => d.value === selectedDisposition)?.label}
            </Badge>
          )}
        </div>
      </Card>

      <ScrollArea className="flex-1">
        <div className="p-4 space-y-6">
          {/* Owner Info */}
          <Card className="p-4">
            <div className="flex items-center gap-3 mb-3">
              <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                <User className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h3 className="font-semibold">{ownerName}</h3>
                <p className="text-sm text-muted-foreground flex items-center gap-1">
                  <MapPin className="h-3 w-3" />
                  {fullAddress}
                </p>
              </div>
            </div>

            {/* Quick Actions */}
            <div className="flex gap-2 mt-4">
              <Button 
                variant="outline" 
                size="sm" 
                className="flex-1"
                onClick={handleCall}
              >
                <Phone className="h-4 w-4 mr-2" />
                Call
              </Button>
              <Button 
                variant="outline" 
                size="sm" 
                className="flex-1"
                onClick={handleEmail}
              >
                <Mail className="h-4 w-4 mr-2" />
                Email
              </Button>
              <Button 
                variant="outline" 
                size="sm" 
                className="flex-1"
                onClick={handleNavigate}
              >
                <Navigation className="h-4 w-4 mr-2" />
                Navigate
              </Button>
            </div>
          </Card>

          {/* Disposition Selection */}
          <div>
            <h3 className="font-semibold mb-3">Log Interaction</h3>
            <div className="grid grid-cols-2 gap-3">
              {DISPOSITION_OPTIONS.map((option) => (
                <Button
                  key={option.value}
                  variant={selectedDisposition === option.value ? 'default' : 'outline'}
                  className={`h-16 flex flex-col items-center justify-center gap-1 ${
                    selectedDisposition === option.value 
                      ? `${option.color} text-white border-0` 
                      : ''
                  }`}
                  onClick={() => handleDispositionSelect(option.value)}
                >
                  <span className="text-lg">{option.icon}</span>
                  <span className="text-sm font-medium">{option.label}</span>
                  {selectedDisposition === option.value && (
                    <CheckCircle2 className="h-4 w-4 absolute top-2 right-2" />
                  )}
                </Button>
              ))}
            </div>
          </div>

          {/* Notes */}
          <div>
            <h3 className="font-semibold mb-3">Notes</h3>
            <Textarea
              placeholder="Add notes about this interaction..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="min-h-[100px]"
            />
          </div>

          {/* Photo Capture */}
          <Button
            variant="outline"
            className="w-full"
            onClick={() => setShowPhotoCapture(true)}
          >
            <Camera className="h-4 w-4 mr-2" />
            Take Photo
          </Button>
        </div>
      </ScrollArea>

      {/* Bottom Action Bar */}
      <Card className="rounded-none border-x-0 border-b-0 p-4 shrink-0">
        <div className="flex gap-3">
          <Button
            variant="outline"
            className="flex-1"
            onClick={() => navigate(-1)}
          >
            <X className="h-4 w-4 mr-2" />
            Cancel
          </Button>
          <Button
            className="flex-1"
            onClick={handleSave}
            disabled={isSaving || !selectedDisposition}
          >
            <Save className="h-4 w-4 mr-2" />
            {isSaving ? 'Saving...' : 'Save & Exit'}
          </Button>
        </div>
      </Card>

      {/* Photo Capture Dialog */}
      <CanvassPhotoCapture
        open={showPhotoCapture}
        onOpenChange={setShowPhotoCapture}
        propertyId={property.id}
        propertyAddress={fullAddress}
        userLocation={userLocation || undefined}
      />
    </div>
  );
}
