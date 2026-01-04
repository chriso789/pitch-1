import { useState } from 'react';
import { 
  Phone, Mail, MapPin, Navigation, User, Plus, Home, Clock, 
  ThumbsUp, ThumbsDown, X, AlertTriangle, DollarSign, CheckCircle,
  Cloud, Sun, Compass, Calculator, FileText, Camera, CalendarPlus,
  History, StickyNote, UserPlus
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { supabase } from '@/integrations/supabase/client';
import { useUserProfile } from '@/contexts/UserProfileContext';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface PropertyInfoPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  property: any;
  userLocation: { lat: number; lng: number };
  onDispositionUpdate: () => void;
  onNavigate: (lat: number, lng: number, address: string) => void;
}

const DISPOSITIONS = [
  { id: 'not_contacted', label: 'Not Contacted', icon: Home, color: 'border-yellow-500 text-yellow-600', bgColor: 'bg-yellow-500' },
  { id: 'new_roof', label: 'New Roof', icon: CheckCircle, color: 'border-amber-700 text-amber-700', bgColor: 'bg-amber-700' },
  { id: 'unqualified', label: 'Unqualified', icon: X, color: 'border-red-500 text-red-600', bgColor: 'bg-red-500' },
  { id: 'old_roof_marker', label: 'Old Roof', icon: AlertTriangle, color: 'border-red-600 text-red-600', bgColor: 'bg-red-600' },
  { id: 'interested', label: 'Interested', icon: DollarSign, color: 'border-green-500 text-green-600', bgColor: 'bg-green-500' },
  { id: 'not_home', label: 'Not Home', icon: Home, color: 'border-gray-400 text-gray-500', bgColor: 'bg-gray-400' },
  { id: 'not_interested', label: 'Not Interested', icon: ThumbsDown, color: 'border-red-500 text-red-600', bgColor: 'bg-red-500' },
  { id: 'follow_up', label: 'Follow Up', icon: Clock, color: 'border-yellow-500 text-yellow-600', bgColor: 'bg-yellow-500' },
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
  const [selectedOwner, setSelectedOwner] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [activeTab, setActiveTab] = useState('tools');

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

  // Mock enriched owners data (would come from skip-trace API in production)
  const enrichedOwners = [
    { 
      id: '1', 
      name: property.owner_name || homeowner?.name || 'Primary Owner',
      gender: 'Unknown',
      creditScore: '650-700',
      isPrimary: true
    },
  ];

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

      // Log activity
      await supabase.from('canvass_activity_log').insert({
        user_id: profile.id,
        tenant_id: profile.tenant_id,
        activity_type: 'door_knock',
        metadata: { property_id: property.id, disposition: dispositionId }
      });

      toast.success(`Marked as ${dispositionId.replace(/_/g, ' ')}`);
      onDispositionUpdate();
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

  const handleAddCustomer = () => {
    // Would integrate with lead creation flow
    toast.info('Opening lead creation...');
  };

  const handleToolAction = (tool: string) => {
    switch (tool) {
      case 'storm':
        window.open(`https://www.google.com/search?q=hail+storm+damage+${encodeURIComponent(fullAddress)}`, '_blank');
        break;
      case 'google_sun':
        window.open(`https://sunroof.withgoogle.com/building/${property.lat}/${property.lng}`, '_blank');
        break;
      case 'directions':
        handleNavigate();
        break;
      case 'fast_estimate':
        toast.info('Generating fast estimate...');
        break;
      default:
        break;
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="h-auto max-h-[85vh] rounded-t-2xl p-0">
        <div className="p-4 pb-2">
          <SheetHeader className="pb-3">
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
                {distance > 0 && (
                  <Badge variant="secondary" className="mt-2 text-xs">
                    📍 {distance.toFixed(2)} mi away
                  </Badge>
                )}
              </div>
              {property.disposition && (
                <Badge className={cn("text-white text-xs", getDispositionBgColor(property.disposition))}>
                  {property.disposition.replace(/_/g, ' ')}
                </Badge>
              )}
            </div>
          </SheetHeader>

          {/* Disposition Buttons - Horizontal Scrollable */}
          <div className="mb-4">
            <p className="text-xs font-medium text-muted-foreground mb-2">Set Disposition</p>
            <ScrollArea className="w-full">
              <div className="flex gap-2 pb-2">
                {DISPOSITIONS.map((disp) => {
                  const Icon = disp.icon;
                  const isSelected = property.disposition === disp.id;
                  return (
                    <Button
                      key={disp.id}
                      variant="outline"
                      size="sm"
                      className={cn(
                        "flex-shrink-0 flex items-center gap-1.5 h-9 px-3 border-2",
                        isSelected ? `${disp.bgColor} text-white border-transparent` : disp.color
                      )}
                      onClick={() => handleDisposition(disp.id)}
                    >
                      <Icon className="h-3.5 w-3.5" />
                      <span className="text-xs whitespace-nowrap">{disp.label}</span>
                    </Button>
                  );
                })}
              </div>
            </ScrollArea>
          </div>

          {/* Select Home Owner Section */}
          <div className="mb-4 p-3 bg-muted/50 rounded-lg">
            <p className="text-xs font-medium text-muted-foreground mb-2">Select Home Owner</p>
            <RadioGroup value={selectedOwner || ''} onValueChange={setSelectedOwner}>
              {enrichedOwners.map((owner) => (
                <div key={owner.id} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                  <div className="flex items-center gap-3">
                    <RadioGroupItem value={owner.id} id={owner.id} />
                    <Label htmlFor={owner.id} className="flex flex-col cursor-pointer">
                      <span className="font-medium text-sm">{owner.name}</span>
                      <span className="text-[10px] text-muted-foreground">
                        {owner.gender} • Credit: {owner.creditScore}
                      </span>
                    </Label>
                  </div>
                  <Button variant="ghost" size="icon" className="h-8 w-8">
                    <UserPlus className="h-4 w-4 text-muted-foreground" />
                  </Button>
                </div>
              ))}
            </RadioGroup>
          </div>

          {/* Add Customer Button */}
          <Button 
            onClick={handleAddCustomer}
            className="w-full mb-4 bg-primary hover:bg-primary/90"
          >
            <Plus className="h-4 w-4 mr-2" />
            Add Customer
          </Button>

          {/* Contact Info */}
          {(phoneNumbers?.length > 0 || emails?.length > 0) && (
            <div className="space-y-2 mb-4">
              {phoneNumbers && phoneNumbers.length > 0 && (
                <div className="flex items-center gap-2">
                  <Phone className="h-4 w-4 text-muted-foreground" />
                  <div className="flex flex-wrap gap-1.5">
                    {phoneNumbers.slice(0, 2).map((phone: string, idx: number) => (
                      <Button
                        key={idx}
                        variant="outline"
                        size="sm"
                        onClick={() => handleCall(phone)}
                        className="text-xs h-7"
                      >
                        {phone}
                      </Button>
                    ))}
                  </div>
                </div>
              )}
              {emails && emails.length > 0 && (
                <div className="flex items-center gap-2">
                  <Mail className="h-4 w-4 text-muted-foreground" />
                  <div className="flex flex-wrap gap-1.5">
                    {emails.slice(0, 2).map((email: string, idx: number) => (
                      <Button
                        key={idx}
                        variant="outline"
                        size="sm"
                        onClick={() => handleEmail(email)}
                        className="text-xs h-7 truncate max-w-[140px]"
                      >
                        {email}
                      </Button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Tools / Add New Tabs */}
          <Tabs value={activeTab} onValueChange={setActiveTab} className="mb-4">
            <TabsList className="grid w-full grid-cols-2 h-9">
              <TabsTrigger value="tools" className="text-xs">Tools</TabsTrigger>
              <TabsTrigger value="add_new" className="text-xs">Add New</TabsTrigger>
            </TabsList>
            <TabsContent value="tools" className="mt-2">
              <div className="grid grid-cols-4 gap-2">
                <Button 
                  variant="outline" 
                  size="sm" 
                  className="flex-col h-16 p-2"
                  onClick={() => handleToolAction('storm')}
                >
                  <Cloud className="h-5 w-5 mb-1 text-blue-500" />
                  <span className="text-[10px]">Storm</span>
                </Button>
                <Button 
                  variant="outline" 
                  size="sm" 
                  className="flex-col h-16 p-2"
                  onClick={() => handleToolAction('google_sun')}
                >
                  <Sun className="h-5 w-5 mb-1 text-yellow-500" />
                  <span className="text-[10px]">Google Sun</span>
                </Button>
                <Button 
                  variant="outline" 
                  size="sm" 
                  className="flex-col h-16 p-2"
                  onClick={() => handleToolAction('directions')}
                >
                  <Compass className="h-5 w-5 mb-1 text-green-500" />
                  <span className="text-[10px]">Directions</span>
                </Button>
                <Button 
                  variant="outline" 
                  size="sm" 
                  className="flex-col h-16 p-2"
                  onClick={() => handleToolAction('fast_estimate')}
                >
                  <Calculator className="h-5 w-5 mb-1 text-purple-500" />
                  <span className="text-[10px]">Fast Est.</span>
                </Button>
              </div>
            </TabsContent>
            <TabsContent value="add_new" className="mt-2">
              <div className="grid grid-cols-3 gap-2">
                <Button variant="outline" size="sm" className="flex-col h-16 p-2">
                  <StickyNote className="h-5 w-5 mb-1 text-amber-500" />
                  <span className="text-[10px]">Add Note</span>
                </Button>
                <Button variant="outline" size="sm" className="flex-col h-16 p-2">
                  <Camera className="h-5 w-5 mb-1 text-blue-500" />
                  <span className="text-[10px]">Add Photo</span>
                </Button>
                <Button variant="outline" size="sm" className="flex-col h-16 p-2">
                  <CalendarPlus className="h-5 w-5 mb-1 text-green-500" />
                  <span className="text-[10px]">Follow-up</span>
                </Button>
              </div>
            </TabsContent>
          </Tabs>

          {/* Notes / History Tabs */}
          <Tabs defaultValue="notes">
            <TabsList className="grid w-full grid-cols-2 h-8">
              <TabsTrigger value="notes" className="text-xs">
                <StickyNote className="h-3 w-3 mr-1" />
                Notes
              </TabsTrigger>
              <TabsTrigger value="history" className="text-xs">
                <History className="h-3 w-3 mr-1" />
                History
              </TabsTrigger>
            </TabsList>
            <TabsContent value="notes" className="mt-2">
              <Textarea 
                placeholder="Add notes about this property..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="min-h-[60px] text-sm"
              />
            </TabsContent>
            <TabsContent value="history" className="mt-2">
              <div className="text-xs text-muted-foreground text-center py-4">
                No visit history yet
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function calculateDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  if (!lat2 || !lng2) return 0;
  const R = 3959;
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

function getDispositionBgColor(disposition: string): string {
  switch (disposition) {
    case 'interested':
    case 'qualified':
      return 'bg-green-500';
    case 'not_interested':
    case 'unqualified':
      return 'bg-red-500';
    case 'follow_up':
    case 'not_contacted':
      return 'bg-yellow-500';
    case 'not_home':
      return 'bg-gray-400';
    case 'new_roof':
      return 'bg-amber-700';
    case 'old_roof_marker':
      return 'bg-red-600';
    default:
      return 'bg-blue-500';
  }
}
