import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { 
  Phone, Mail, MapPin, Navigation, User, Plus, Home, Clock, 
  ThumbsUp, ThumbsDown, X, AlertTriangle, DollarSign, CheckCircle,
  Cloud, Sun, Compass, Calculator, FileText, Camera, CalendarPlus, BarChart3,
  History, StickyNote, UserPlus, Loader2, Sparkles, ShieldCheck, ShieldAlert
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { supabase } from '@/integrations/supabase/client';
import { useUserProfile } from '@/contexts/UserProfileContext';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import FastEstimateModal from './FastEstimateModal';
import { CanvassPhotoCapture } from './CanvassPhotoCapture';
import StormScoreWhyPanel from './StormScoreWhyPanel';
import { 
  calculateDistanceMeters, 
  getVerificationStatus, 
  type DistanceVerification 
} from '@/hooks/useDistanceVerification';

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
  const [enriching, setEnriching] = useState(false);
  const [enrichedOwners, setEnrichedOwners] = useState<any[]>([]);
  const [showFastEstimate, setShowFastEstimate] = useState(false);
  const hasAutoEnrichedRef = useRef<string | null>(null);
  const [showPhotoCapture, setShowPhotoCapture] = useState(false);

  // Local state for property data — drives UI re-renders after enrichment
  const [localProperty, setLocalProperty] = useState<any>(property);

  // handleEnrich must be declared before the useEffect that calls it
  const handleEnrich = useCallback(async () => {
    if (!property?.id || !profile?.tenant_id) {
      console.warn('[handleEnrich] Missing property_id or tenant_id');
      toast.error('Missing property data');
      return;
    }
    
    setEnriching(true);
    try {
      let addr: any = {};
      try {
        addr = typeof property.address === 'string' 
          ? JSON.parse(property.address) 
          : (property.address || {});
      } catch (parseErr) {
        console.warn('[handleEnrich] Failed to parse address:', parseErr);
        addr = { formatted: property.address };
      }
      
      console.log('[handleEnrich] Calling storm-public-lookup (free) for:', property.id, addr);
      
      const { data, error } = await supabase.functions.invoke('storm-public-lookup', {
        body: {
          lat: property.lat || addr?.lat,
          lng: property.lng || addr?.lng,
          address: addr?.formatted || addr?.street || '',
          tenant_id: profile.tenant_id,
          property_id: property.id,
        }
      });

      if (error) {
        console.error('[handleEnrich] Edge function error:', error);
        throw error;
      }

      console.log('[handleEnrich] Response:', JSON.stringify(data).slice(0, 500));

      const pipelineResult = data?.pipeline || data?.result || data;
      
      if (pipelineResult?.owner_name && pipelineResult.owner_name !== 'Unknown Owner') {
        setEnrichedOwners([{
          id: '1',
          name: pipelineResult.owner_name,
          age: pipelineResult.contact_age || null,
          is_primary: true,
        }]);
      }
      
      const { data: updatedProperty, error: fetchError } = await supabase
        .from('canvassiq_properties')
        .select('phone_numbers, emails, owner_name, searchbug_data')
        .eq('id', property.id)
        .single();
      
      if (fetchError) {
        console.warn('[handleEnrich] Failed to refetch property:', fetchError);
      } else if (updatedProperty) {
        setLocalProperty((prev: any) => ({
          ...prev,
          phone_numbers: updatedProperty.phone_numbers,
          emails: updatedProperty.emails,
          owner_name: updatedProperty.owner_name,
          searchbug_data: updatedProperty.searchbug_data,
        }));
      }
      
      const hasRealOwner = pipelineResult?.owner_name && 
        pipelineResult.owner_name !== 'Unknown Owner' && pipelineResult.owner_name !== 'Unknown';
      const hasPhones = pipelineResult?.contact_phones?.length > 0 || updatedProperty?.phone_numbers?.length > 0;
      const hasEmails = pipelineResult?.contact_emails?.length > 0 || updatedProperty?.emails?.length > 0;
      const hasUpdatedOwner = updatedProperty?.owner_name && 
        updatedProperty.owner_name !== 'Unknown Owner' && 
        updatedProperty.owner_name !== 'Unknown';
      const hasUpdatedPhones = updatedProperty?.phone_numbers?.length > 0;
      const hasUpdatedEmails = updatedProperty?.emails?.length > 0;

      if (data?.cached) {
        toast.success('Using cached data');
      } else if (hasRealOwner || hasPhones || hasEmails || hasUpdatedOwner || hasUpdatedPhones || hasUpdatedEmails) {
        toast.success('Property enriched!');
      } else {
        toast.warning('No owner data found for this property', {
          description: 'Public records may not be available for this address.',
        });
      }
    } catch (err: any) {
      console.error('[handleEnrich] Error:', err?.message || err);
      toast.error(err?.message || 'Failed to enrich property');
    } finally {
      setEnriching(false);
    }
  }, [property?.id, property?.address, property?.lat, profile?.tenant_id]);

  // Auto-enrich when panel opens and no enrichment data exists or owner is unknown
  useEffect(() => {
    if (!open || !property?.id || !profile?.tenant_id) return;
    
    // Parse existing data to check if already enriched
    const existingPhones = typeof property.phone_numbers === 'string' 
      ? JSON.parse(property.phone_numbers || '[]') 
      : (property.phone_numbers || []);
    const existingSearchbug = typeof property.searchbug_data === 'string'
      ? JSON.parse(property.searchbug_data || '{}')
      : (property.searchbug_data || {});
    
    // Check if owner is unknown or missing
    const ownerIsUnknown = !property.owner_name || 
      property.owner_name === 'Unknown' || 
      property.owner_name === 'Unknown Owner';
    
    // Auto-enrich if: no data exists OR owner is unknown
    const hasEnrichmentData = existingPhones.length > 0 || 
      (existingSearchbug && Object.keys(existingSearchbug).length > 0 && !ownerIsUnknown) ||
      enrichedOwners.length > 0;
    
    // Force re-enrich if owner is unknown even if we already tried
    const shouldEnrich = !hasEnrichmentData || ownerIsUnknown;
    
    if (shouldEnrich && hasAutoEnrichedRef.current !== property.id) {
      hasAutoEnrichedRef.current = property.id;
      handleEnrich();
    }
  }, [open, property?.id]);

  // Sync localProperty when property prop changes
  useEffect(() => {
    if (property?.id) {
      setLocalProperty(property);
      setEnrichedOwners([]);
      setSelectedOwner(null);
      setNotes('');
    }
  }, [property?.id]);

  // Calculate property coordinates (before early return for hooks consistency)
  const propertyLat = property?.lat || (typeof property?.address === 'string' 
    ? JSON.parse(property?.address || '{}')?.lat 
    : property?.address?.lat);
  const propertyLng = property?.lng || (typeof property?.address === 'string' 
    ? JSON.parse(property?.address || '{}')?.lng 
    : property?.address?.lng);

  // Calculate distance in meters for verification (MUST be before early return)
  const distanceMeters = useMemo(() => {
    if (!property || !propertyLat || !propertyLng) return 0;
    return calculateDistanceMeters(
      userLocation.lat,
      userLocation.lng,
      propertyLat,
      propertyLng
    );
  }, [property, userLocation.lat, userLocation.lng, propertyLat, propertyLng]);

  // Get verification status based on distance (MUST be before early return)
  const verification = useMemo<DistanceVerification>(() => {
    return getVerificationStatus(distanceMeters);
  }, [distanceMeters]);

  // Early return AFTER all hooks
  if (!property || !localProperty) return null;

  // Parse address and homeowner data — use localProperty for enriched fields
  const address = typeof property.address === 'string' 
    ? JSON.parse(property.address) 
    : property.address;
  const homeowner = typeof property.homeowner === 'string'
    ? JSON.parse(property.homeowner)
    : property.homeowner;
  
  // Parse enriched data from searchbug_data (use localProperty for up-to-date data)
  const searchbugData = typeof localProperty.searchbug_data === 'string'
    ? JSON.parse(localProperty.searchbug_data || '{}')
    : (localProperty.searchbug_data || {});
  
  // Get phone numbers from either searchbug_data or direct column
  const phoneNumbers = searchbugData.phones?.length > 0 
    ? searchbugData.phones 
    : (typeof localProperty.phone_numbers === 'string'
        ? JSON.parse(localProperty.phone_numbers || '[]')
        : (localProperty.phone_numbers || []));
  
  // Get emails from either searchbug_data or direct column
  const emails = searchbugData.emails?.length > 0
    ? searchbugData.emails
    : (typeof localProperty.emails === 'string'
        ? JSON.parse(localProperty.emails || '[]')
        : (localProperty.emails || []));

  // Use enriched owners from API response, then searchbug_data, then fallback
  const storedOwners = searchbugData.owners || [];
  const displayOwners = enrichedOwners.length > 0 
    ? enrichedOwners 
    : storedOwners.length > 0 
      ? storedOwners 
      : [{ 
          id: '1', 
          name: localProperty.owner_name || homeowner?.name || 'Primary Owner',
          gender: 'Unknown',
          credit_score: 'Unknown',
          is_primary: true
        }];

  // handleEnrich is defined above (useCallback) before the useEffect that calls it

  const ownerName = localProperty.owner_name || homeowner?.name || 'Unknown Owner';
  const fullAddress = address?.formatted || 
    `${address?.street || ''}, ${address?.city || ''} ${address?.state || ''} ${address?.zip || ''}`.trim();

  // Legacy distance in miles for display
  const distance = verification.distanceMiles;

  // Helper to parse first/last name from owner name
  const parseFirstName = (name: string | undefined): string => {
    if (!name) return 'Unknown';
    const parts = name.trim().split(/\s+/);
    return parts[0] || 'Unknown';
  };

  const parseLastName = (name: string | undefined): string => {
    if (!name) return 'Owner';
    const parts = name.trim().split(/\s+/);
    return parts.slice(1).join(' ') || 'Owner';
  };

  // Map disposition to qualification status
  const mapDispositionToStatus = (disposition: string): string => {
    const statusMap: Record<string, string> = {
      'interested': 'qualified',
      'new_roof': 'qualified',
      'follow_up': 'follow_up',
      'callback': 'follow_up',
      'not_home': 'new_lead',
      'not_contacted': 'new_lead',
      'not_interested': 'unqualified',
      'unqualified': 'unqualified',
    };
    return statusMap[disposition] || 'new_lead';
  };

  const handleDisposition = async (dispositionId: string) => {
    if (!profile?.tenant_id || !property.id) return;

    // Check if rep is too far (blocked)
    if (verification.isBlocked) {
      toast.error('You are too far from this property to set a disposition. Please move closer.', {
        description: `Current distance: ${Math.round(verification.distanceFeet)} ft (max: 328 ft / 100m)`,
        duration: 5000,
      });
      return;
    }

    // Show warning if in warning zone
    if (verification.isWarning) {
      toast.warning('You are far from this property. Move closer for verified visits.', {
        description: `Current distance: ${Math.round(verification.distanceFeet)} ft`,
        duration: 3000,
      });
    }

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

      // Log the visit with distance tracking
      await supabase.from('canvassiq_visits').insert({
        property_id: property.id,
        tenant_id: profile.tenant_id,
        user_id: profile.id,
        disposition: dispositionId,
        visit_type: 'door_knock',
        lat: userLocation.lat,
        lng: userLocation.lng,
        property_lat: propertyLat,
        property_lng: propertyLng,
        distance_meters: verification.distanceMeters,
        gps_accuracy: null,
        is_verified: verification.isWithinRange,
        verification_status: verification.verificationStatus,
        started_at: new Date().toISOString(),
      });

      // Log activity
      await supabase.from('canvass_activity_log').insert({
        user_id: profile.id,
        tenant_id: profile.tenant_id,
        activity_type: 'door_knock',
        metadata: { 
          property_id: property.id, 
          disposition: dispositionId,
          distance_meters: verification.distanceMeters,
          is_verified: verification.isWithinRange,
          verification_status: verification.verificationStatus
        }
      });

      // Auto-create contact for positive dispositions
      const POSITIVE_DISPOSITIONS = ['interested', 'follow_up', 'callback', 'new_roof'];
      
      if (POSITIVE_DISPOSITIONS.includes(dispositionId)) {
        // Check if contact already exists for this property
        const { data: existingContact } = await supabase
          .from('contacts')
          .select('id')
          .eq('canvassiq_property_id', property.id)
          .maybeSingle();

        if (!existingContact) {
          const selectedOwnerData = enrichedOwners.find(o => o.id === selectedOwner) || displayOwners[0];
          const ownerFullName = selectedOwnerData?.name || property.owner_name || homeowner?.name;

          const newContact = {
            tenant_id: profile.tenant_id,
            type: 'homeowner' as const,
            first_name: parseFirstName(ownerFullName),
            last_name: parseLastName(ownerFullName),
            phone: phoneNumbers?.[0] || null,
            email: emails?.[0] || null,
            address_street: address?.street || address?.formatted || fullAddress,
            address_city: address?.city || null,
            address_state: address?.state || null,
            address_zip: address?.zip || null,
            latitude: propertyLat,
            longitude: propertyLng,
            lead_source: 'Storm Canvass',
            qualification_status: mapDispositionToStatus(dispositionId),
            canvassiq_property_id: property.id,
            created_by: profile.id,
            metadata: {
              canvass_disposition: dispositionId,
              canvassed_at: new Date().toISOString(),
              canvassed_by: profile.id,
              distance_meters: verification.distanceMeters,
              is_verified: verification.isWithinRange,
            }
          };

          const { data: createdContact, error: contactError } = await supabase
            .from('contacts')
            .insert([newContact])
            .select()
            .single();

          if (createdContact && !contactError) {
            // Link property to contact
            await supabase
              .from('canvassiq_properties')
              .update({ contact_id: createdContact.id })
              .eq('id', property.id);

            toast.success(`Contact created: ${createdContact.first_name} ${createdContact.last_name}`);
          }
        }
      }

      const verifiedText = verification.isWithinRange ? ' ✓ Verified' : '';
      toast.success(`Marked as ${dispositionId.replace(/_/g, ' ')}${verifiedText}`);
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

  const handleAddCustomer = async () => {
    if (!profile?.tenant_id || !property?.id) return;

    try {
      const selectedOwnerData = enrichedOwners.find(o => o.id === selectedOwner) || displayOwners[0];
      const ownerFullName = selectedOwnerData?.name || property.owner_name || homeowner?.name;

      const newContact = {
        tenant_id: profile.tenant_id,
        type: 'homeowner' as const,
        first_name: parseFirstName(ownerFullName),
        last_name: parseLastName(ownerFullName),
        phone: phoneNumbers?.[0] || null,
        email: emails?.[0] || null,
        address_street: address?.street || address?.formatted || fullAddress,
        address_city: address?.city || null,
        address_state: address?.state || null,
        address_zip: address?.zip || null,
        latitude: propertyLat,
        longitude: propertyLng,
        lead_source: 'Storm Canvass',
        qualification_status: property.disposition ? mapDispositionToStatus(property.disposition) : 'new_lead',
        canvassiq_property_id: property.id,
        created_by: profile.id,
      };

      const { data: createdContact, error } = await supabase
        .from('contacts')
        .insert([newContact])
        .select()
        .single();

      if (error) throw error;

      // Link property to contact
      await supabase
        .from('canvassiq_properties')
        .update({ contact_id: createdContact.id })
        .eq('id', property.id);

      toast.success('Customer added successfully!');
      onOpenChange(false);
    } catch (err: any) {
      console.error('Error creating contact:', err);
      toast.error('Failed to add customer');
    }
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
        setShowFastEstimate(true);
        break;
      default:
        break;
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="h-auto max-h-[85vh] rounded-t-2xl p-0 flex flex-col">
        {/* Scrollable content wrapper for mobile */}
        <div className="flex-1 overflow-y-auto overscroll-contain p-4 pb-safe-area-inset-bottom" style={{ WebkitOverflowScrolling: 'touch' }}>
          <SheetHeader className="pb-3">
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <SheetTitle className="flex items-center gap-2 text-lg">
                  <User className="h-5 w-5 text-primary" />
                  {ownerName}
                  {/* Confidence badge from public data */}
                  {property.property_data?.confidence_score != null && (
                    <Badge 
                      variant="outline"
                      className={cn(
                        "text-[10px] ml-1",
                        property.property_data.confidence_score >= 80 && "bg-green-100 text-green-700 border-green-300",
                        property.property_data.confidence_score >= 60 && property.property_data.confidence_score < 80 && "bg-yellow-100 text-yellow-700 border-yellow-300",
                        property.property_data.confidence_score < 60 && "bg-red-100 text-red-700 border-red-300"
                      )}
                    >
                      {property.property_data.confidence_score >= 80 ? '✓' : property.property_data.confidence_score >= 60 ? '⚠' : '✗'} {property.property_data.confidence_score}%
                    </Badge>
                  )}
                </SheetTitle>
                <p className="text-sm text-muted-foreground mt-1 flex items-center gap-1">
                  <MapPin className="h-3.5 w-3.5" />
                  {fullAddress}
                </p>
                {/* Property Intelligence Row */}
                {property.property_data?.parcel_id && (
                  <div className="flex flex-wrap gap-1.5 mt-1.5">
                    {property.property_data.parcel_id && (
                      <Badge variant="outline" className="text-[9px] font-normal">APN: {property.property_data.parcel_id}</Badge>
                    )}
                    {property.property_data.living_sqft && (
                      <Badge variant="outline" className="text-[9px] font-normal">{property.property_data.living_sqft.toLocaleString()} sqft</Badge>
                    )}
                    {property.property_data.year_built && (
                      <Badge variant="outline" className="text-[9px] font-normal">Built {property.property_data.year_built}</Badge>
                    )}
                    {property.property_data.homestead && (
                      <Badge variant="outline" className="text-[9px] font-normal bg-blue-50 text-blue-700 border-blue-200">Homestead ✓</Badge>
                    )}
                  </div>
                )}
                {/* Source verification */}
                {property.property_data?.sources && (
                  <div className="flex gap-1 mt-1">
                    {property.property_data.sources.map((src: string) => (
                      <span key={src} className="text-[8px] text-green-600">✔ {src}</span>
                    ))}
                  </div>
                )}
                {/* Distance Verification Badge */}
                <Badge 
                  variant={verification.badgeVariant} 
                  className={cn(
                    "mt-2 text-xs",
                    verification.isWithinRange && "bg-green-500 hover:bg-green-600",
                    verification.isWarning && "bg-yellow-500 hover:bg-yellow-600 text-black",
                    verification.isBlocked && "bg-red-500 hover:bg-red-600"
                  )}
                >
                  {verification.isWithinRange && <ShieldCheck className="h-3 w-3 mr-1" />}
                  {verification.isBlocked && <ShieldAlert className="h-3 w-3 mr-1" />}
                  {verification.badgeText}
                </Badge>
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
            <div className="overflow-x-auto -mx-4 px-4">
              <div className="flex gap-2 pb-2 min-w-max">
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
            </div>
          </div>

          {/* Select Home Owner Section */}
          <div className="mb-4 p-3 bg-muted/50 rounded-lg">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-medium text-muted-foreground">Select Home Owner</p>
              <Button 
                variant="outline" 
                size="sm" 
                className="h-7 text-xs gap-1"
                onClick={handleEnrich}
                disabled={enriching}
              >
                {enriching ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Sparkles className="h-3 w-3" />
                )}
                {enriching ? 'Enriching...' : 'Enrich'}
              </Button>
            </div>
            <RadioGroup value={selectedOwner || ''} onValueChange={setSelectedOwner}>
              {displayOwners.map((owner) => (
                <div key={owner.id} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                  <div className="flex items-center gap-3">
                    <RadioGroupItem value={owner.id} id={owner.id} />
                    <Label htmlFor={owner.id} className="flex flex-col cursor-pointer">
                      <span className="font-medium text-sm">{owner.name}</span>
                      <span className="text-[10px] text-muted-foreground">
                        {owner.gender || 'Unknown'} • Credit: {owner.credit_score || 'Unknown'}
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

          {/* Contact Info - Enhanced display for enriched data */}
          {(phoneNumbers?.length > 0 || emails?.length > 0) && (
            <div className="space-y-2 mb-4">
              {phoneNumbers && phoneNumbers.length > 0 && (
                <div className="flex items-center gap-2">
                  <Phone className="h-4 w-4 text-muted-foreground" />
                  <div className="flex flex-wrap gap-1.5">
                    {phoneNumbers.slice(0, 3).map((phone: any, idx: number) => {
                      // Handle both string format and object format from enrichment
                      const phoneNumber = typeof phone === 'string' ? phone : phone.number;
                      const phoneType = typeof phone === 'object' ? phone.type : null;
                      return (
                        <Button
                          key={idx}
                          variant="outline"
                          size="sm"
                          onClick={() => handleCall(phoneNumber)}
                          className="text-xs h-7"
                        >
                          {phoneNumber}
                          {phoneType && <span className="text-muted-foreground ml-1">({phoneType})</span>}
                        </Button>
                      );
                    })}
                  </div>
                </div>
              )}
              {emails && emails.length > 0 && (
                <div className="flex items-center gap-2">
                  <Mail className="h-4 w-4 text-muted-foreground" />
                  <div className="flex flex-wrap gap-1.5">
                    {emails.slice(0, 2).map((email: any, idx: number) => {
                      // Handle both string format and object format from enrichment
                      const emailAddress = typeof email === 'string' ? email : email.address;
                      return (
                        <Button
                          key={idx}
                          variant="outline"
                          size="sm"
                          onClick={() => handleEmail(emailAddress)}
                          className="text-xs h-7 truncate max-w-[160px]"
                        >
                          {emailAddress}
                        </Button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Tools / Add New Tabs */}
          <Tabs value={activeTab} onValueChange={setActiveTab} className="mb-4">
            <TabsList className="grid w-full grid-cols-3 h-9">
              <TabsTrigger value="tools" className="text-xs">Tools</TabsTrigger>
              <TabsTrigger value="add_new" className="text-xs">Add New</TabsTrigger>
              <TabsTrigger value="score_intel" className="text-xs">
                <BarChart3 className="h-3 w-3 mr-1" />
                Score
              </TabsTrigger>
            </TabsList>
            <TabsContent value="tools" className="mt-2">
              <div className="grid grid-cols-5 gap-2">
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
                <Button 
                  variant="outline" 
                  size="sm" 
                  className="flex-col h-16 p-2"
                  onClick={() => setShowPhotoCapture(true)}
                >
                  <Camera className="h-5 w-5 mb-1 text-orange-500" />
                  <span className="text-[10px]">Add Photo</span>
                </Button>
              </div>
            </TabsContent>
            <TabsContent value="add_new" className="mt-2">
              <div className="grid grid-cols-3 gap-2">
                <Button variant="outline" size="sm" className="flex-col h-16 p-2">
                  <StickyNote className="h-5 w-5 mb-1 text-amber-500" />
                  <span className="text-[10px]">Add Note</span>
                </Button>
                <Button variant="outline" size="sm" className="flex-col h-16 p-2" onClick={() => setShowPhotoCapture(true)}>
                  <Camera className="h-5 w-5 mb-1 text-blue-500" />
                  <span className="text-[10px]">Add Photo</span>
                </Button>
                <Button variant="outline" size="sm" className="flex-col h-16 p-2">
                  <CalendarPlus className="h-5 w-5 mb-1 text-green-500" />
                  <span className="text-[10px]">Follow-up</span>
                </Button>
              </div>
            </TabsContent>
            <TabsContent value="score_intel" className="mt-2">
              {profile?.tenant_id && property?.normalized_address_key && property?.storm_event_id ? (
                <StormScoreWhyPanel
                  tenantId={profile.tenant_id}
                  stormEventId={property.storm_event_id}
                  normalizedAddressKey={property.normalized_address_key}
                />
              ) : (
                <div className="text-xs text-muted-foreground text-center py-4">
                  No storm intel available for this property.
                </div>
              )}
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
          
          {/* Bottom safe area padding for iOS */}
          <div className="h-6 flex-shrink-0" />
        </div>
        <FastEstimateModal 
          open={showFastEstimate}
          onOpenChange={setShowFastEstimate}
          property={property}
        />
        <CanvassPhotoCapture
          open={showPhotoCapture}
          onOpenChange={setShowPhotoCapture}
          propertyAddress={property?.address?.street || property?.owner_address}
          userLocation={userLocation}
        />
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
