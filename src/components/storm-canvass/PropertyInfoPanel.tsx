import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { 
  Phone, Mail, MapPin, Navigation, User, Plus, Home, Clock, 
  ThumbsUp, ThumbsDown, X, AlertTriangle, DollarSign, CheckCircle,
  Cloud, Sun, Compass, Calculator, FileText, Camera, CalendarPlus, BarChart3,
  History, StickyNote, UserPlus, Loader2, Sparkles, ShieldCheck, ShieldAlert, RefreshCw,
  Brain, TrendingUp, Building2, HardHat, PhoneOff
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

function validOwner(name: any): string | null {
  if (!name) return null;
  const s = String(name).trim().toLowerCase();
  if (!s || s === 'null' || s === 'undefined' || s === 'unknown' || s === 'unknown owner') return null;
  return String(name).trim();
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
  const [showStormReports, setShowStormReports] = useState(false);
  const [stormReports, setStormReports] = useState<any[]>([]);
  const [loadingStorm, setLoadingStorm] = useState(false);
  const [generatingStrategy, setGeneratingStrategy] = useState(false);
  const [doorStrategy, setDoorStrategy] = useState<any>(null);
  const [pipelineScores, setPipelineScores] = useState<any>(null);
  const [stormFilter, setStormFilter] = useState<'all' | 'hail' | 'wind' | 'tornado'>('all');

  // Local state for property data — drives UI re-renders after enrichment
  const [localProperty, setLocalProperty] = useState<any>(property);

  // handleEnrich must be declared before the useEffect that calls it
  const handleEnrich = useCallback(async (forceBypass = false) => {
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
      
      console.log('[handleEnrich] Step 1: storm-public-lookup for:', property.id);
      
      // Step 1: County scrape for owner/parcel data
      const { data, error } = await supabase.functions.invoke('storm-public-lookup', {
        body: {
          lat: property.lat || addr?.lat,
          lng: property.lng || addr?.lng,
          address: addr?.formatted || addr?.street || '',
          tenant_id: profile.tenant_id,
          property_id: property.id,
          force: forceBypass,
        }
      });

      if (error) {
        console.error('[handleEnrich] storm-public-lookup error:', error);
        throw error;
      }

      const pipelineResult = data?.pipeline || data?.result || data;

      // Capture scores from pipeline response
      if (data?.scores) {
        setPipelineScores(data.scores);
      } else if (data?.result?.scores) {
        setPipelineScores(data.result.scores);
      }

      // Update owner from county data
      if (validOwner(pipelineResult?.owner_name)) {
        setLocalProperty((prev: any) => ({
          ...prev,
          owner_name: validOwner(pipelineResult.owner_name) || prev.owner_name,
        }));
      }

      // Step 2: BatchData skip trace for contact enrichment
      console.log('[handleEnrich] Step 2: canvassiq-skip-trace (BatchData)');
      
      const { data: skipData, error: skipError } = await supabase.functions.invoke('canvassiq-skip-trace', {
        body: {
          property_id: property.id,
          owner_name: validOwner(pipelineResult?.owner_name) || validOwner(localProperty.owner_name) || '',
          address: {
            street: addr?.street || addr?.formatted || '',
            city: addr?.city || '',
            state: addr?.state || '',
            zip: addr?.zip || '',
            formatted: addr?.formatted || '',
          },
          tenant_id: profile.tenant_id,
        }
      });

      if (skipError) {
        console.warn('[handleEnrich] skip-trace error:', skipError);
      }

      const skipResult = skipData?.data || {};
      const skipOwners = skipResult.owners || [];
      const skipPhones = skipResult.phones || [];
      const skipEmails = skipResult.emails || [];

      if (skipOwners.length > 0) {
        setEnrichedOwners(skipOwners);
      } else if (validOwner(pipelineResult?.owner_name)) {
        setEnrichedOwners([{
          id: '1',
          name: validOwner(pipelineResult.owner_name)!,
          age: pipelineResult.contact_age || null,
          is_primary: true,
        }]);
      }

      // Update localProperty with all enriched data
      setLocalProperty((prev: any) => ({
        ...prev,
        owner_name: skipOwners[0]?.name || validOwner(pipelineResult?.owner_name) || prev.owner_name,
        phone_numbers: skipPhones.length > 0
          ? skipPhones.map((p: any) => typeof p === 'string' ? p : p.number)
          : prev.phone_numbers,
        emails: skipEmails.length > 0
          ? skipEmails.map((e: any) => typeof e === 'string' ? e : e.address)
          : prev.emails,
        searchbug_data: {
          owners: skipOwners.length > 0 ? skipOwners : prev.searchbug_data?.owners || [],
          phones: skipPhones,
          emails: skipEmails,
          relatives: skipResult.relatives || prev.searchbug_data?.relatives || [],
          source: skipResult.source || 'batchdata',
          enriched_at: new Date().toISOString(),
        },
      }));

      const hasRealOwner = skipOwners[0]?.name && skipOwners[0].name !== 'Unknown Owner';
      const hasPhones = skipPhones.length > 0;
      const hasEmails = skipEmails.length > 0;

      if (skipData?.cached) {
        toast.success('Contact data loaded (cached)');
      } else if (hasRealOwner || hasPhones || hasEmails) {
        toast.success('Property enriched with BatchData!');
      } else {
        toast.warning('No contact data found for this property');
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
    const ownerIsUnknown = !property?.owner_name || 
      property?.owner_name === 'Unknown' || 
      property?.owner_name === 'Unknown Owner';
    
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
      setDoorStrategy(null);
      setPipelineScores(null);
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
          name: validOwner(localProperty.owner_name) || validOwner(homeowner?.name) || 'Primary Owner',
          is_primary: true
        }];

  // handleEnrich is defined above (useCallback) before the useEffect that calls it

  // Derive owner name: prefer enriched displayOwners (which have first/last from pipeline), then direct fields
  const primaryOwner = displayOwners.find((o: any) => o.is_primary) || displayOwners[0];
  const enrichedName = primaryOwner 
    ? ([primaryOwner.first_name, primaryOwner.last_name].filter(Boolean).join(' ') || primaryOwner.name)
    : null;
  const ownerName = validOwner(enrichedName) || validOwner(localProperty.owner_name) || validOwner(homeowner?.name) || 'Unknown Owner';
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
          const ownerFullName = selectedOwnerData?.name || property?.owner_name || homeowner?.name;

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
    const lat = property?.lat || address?.lat;
    const lng = property?.lng || address?.lng;
    if (lat && lng) {
      onNavigate(lat, lng, fullAddress);
      onOpenChange(false);
    }
  };

  const handleAddCustomer = async () => {
    if (!profile?.tenant_id || !property?.id) return;

    try {
      const selectedOwnerData = enrichedOwners.find(o => o.id === selectedOwner) || displayOwners[0];
      const ownerFullName = selectedOwnerData?.name || property?.owner_name || homeowner?.name;

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

  const handleStormReports = async () => {
    setShowStormReports(true);
    setLoadingStorm(true);
    try {
      const { data, error } = await supabase.functions.invoke('noaa-storm-reports', {
        body: { lat: propertyLat, lng: propertyLng, radius_miles: 15, years_back: 3 },
      });
      if (error) throw error;
      setStormReports(data?.reports || []);
    } catch (err: any) {
      console.error('[storm-reports]', err);
      toast.error('Failed to fetch storm reports');
      setStormReports([]);
    } finally {
      setLoadingStorm(false);
    }
  };

  const handleGenerateStrategy = async () => {
    setGeneratingStrategy(true);
    try {
      const addr = typeof property?.address === 'string' 
        ? JSON.parse(property?.address) 
        : (property?.address || {});
      const { data, error } = await supabase.functions.invoke('door-knock-strategy', {
        body: {
          property: {
            address: addr?.formatted || fullAddress,
            owner_name: ownerName,
            year_built: property?.property_data?.year_built,
            homestead: property?.property_data?.homestead,
            assessed_value: property?.property_data?.assessed_value,
          },
          scores: pipelineScores,
          contact: {
            phones: phoneNumbers?.map((p: any) => ({
              number: typeof p === 'string' ? p : p.number,
              dnc: typeof p === 'object' && p.dnc === true,
            })),
            age: displayOwners[0]?.age,
          },
          time_of_day: new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 17 ? 'afternoon' : 'evening',
        },
      });
      if (error) throw error;
      setDoorStrategy(data?.strategy || null);
      toast.success('Strategy generated!');
    } catch (err: any) {
      console.error('[strategy]', err);
      toast.error('Failed to generate strategy');
    } finally {
      setGeneratingStrategy(false);
    }
  };

  const handleToolAction = (tool: string) => {
    switch (tool) {
      case 'storm':
        handleStormReports();
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
                onClick={() => handleEnrich(true)}
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
              {displayOwners.map((owner) => {
                const firstName = owner.first_name || (owner.name ? owner.name.split(/\s+/)[0] : null);
                const lastName = owner.last_name || (owner.name ? owner.name.split(/\s+/).slice(1).join(' ') : null);
                const displayName = [firstName, lastName].filter(Boolean).join(' ') || 'Primary Owner';
                const ageLine = owner.age ? `Age ${owner.age}` : null;
                return (
                  <div key={owner.id} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                    <div className="flex items-center gap-3">
                      <RadioGroupItem value={owner.id} id={owner.id} />
                      <Label htmlFor={owner.id} className="flex flex-col cursor-pointer">
                        <span className="font-medium text-sm">{displayName}</span>
                        {ageLine && (
                          <span className="text-[10px] text-muted-foreground">{ageLine}</span>
                        )}
                      </Label>
                    </div>
                    <Button variant="ghost" size="icon" className="h-8 w-8">
                      <UserPlus className="h-4 w-4 text-muted-foreground" />
                    </Button>
                  </div>
                );
              })}
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
                    {[...phoneNumbers]
                      .sort((a: any, b: any) => {
                        const aDnc = typeof a === 'object' && a.dnc === true ? 1 : 0;
                        const bDnc = typeof b === 'object' && b.dnc === true ? 1 : 0;
                        return aDnc - bDnc;
                      })
                      .slice(0, 3).map((phone: any, idx: number) => {
                      const phoneNumber = typeof phone === 'string' ? phone : phone.number;
                      const phoneType = typeof phone === 'object' ? phone.type : null;
                      const isDnc = typeof phone === 'object' && phone.dnc === true;
                      return (
                        <div key={idx} className="flex items-center gap-1">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => !isDnc && handleCall(phoneNumber)}
                            className={cn("text-xs h-7", isDnc && "opacity-40 line-through cursor-not-allowed")}
                            disabled={isDnc}
                          >
                            {isDnc && <PhoneOff className="h-3 w-3 mr-1 text-destructive" />}
                            {phoneNumber}
                            {phoneType && phoneType !== 'Unknown' && (
                              <span className="text-muted-foreground ml-1">({phoneType})</span>
                            )}
                          </Button>
                          {isDnc && (
                            <Badge variant="destructive" className="text-[9px] h-5 px-1">DNC</Badge>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              {emails && emails.length > 0 && (
                <div className="flex items-center gap-2">
                  <Mail className="h-4 w-4 text-muted-foreground" />
                  <div className="flex flex-wrap gap-1.5">
                    {emails.slice(0, 3).map((email: any, idx: number) => {
                      const emailAddress = typeof email === 'string' ? email : email.address;
                      return (
                        <Button
                          key={idx}
                          variant="outline"
                          size="sm"
                          onClick={() => handleEmail(emailAddress)}
                          className="text-xs h-7 truncate max-w-[220px]"
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
              <div className="grid grid-cols-3 gap-2">
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
                <Button 
                  variant="outline" 
                  size="sm" 
                  className="flex-col h-16 p-2"
                  onClick={handleGenerateStrategy}
                  disabled={generatingStrategy}
                >
                  {generatingStrategy ? (
                    <Loader2 className="h-5 w-5 mb-1 animate-spin text-primary" />
                  ) : (
                    <Brain className="h-5 w-5 mb-1 text-primary" />
                  )}
                  <span className="text-[10px]">{generatingStrategy ? 'AI...' : 'Strategy'}</span>
                </Button>
              </div>
              {/* AI Strategy Card */}
              {doorStrategy && (
                <div className="mt-3 border rounded-lg p-3 bg-muted/30 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <Brain className="h-4 w-4 text-primary" />
                      <span className="text-xs font-semibold">Door Knock Strategy</span>
                    </div>
                    <Badge variant="outline" className="text-[9px]">{doorStrategy.angle}</Badge>
                  </div>
                  <p className="text-xs leading-relaxed">{doorStrategy.opener}</p>
                  {doorStrategy.objections?.length > 0 && (
                    <div className="space-y-1">
                      <p className="text-[10px] font-medium text-muted-foreground">Objections:</p>
                      {doorStrategy.objections.slice(0, 2).map((obj: any, i: number) => (
                        <div key={i} className="text-[10px] pl-2 border-l-2 border-primary/30">
                          <p className="font-medium">"{obj.objection}"</p>
                          <p className="text-muted-foreground">→ {obj.response}</p>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="flex items-center justify-between text-[10px] text-muted-foreground pt-1 border-t">
                    <span>Next: {doorStrategy.next_action?.replace(/_/g, ' ')}</span>
                    {doorStrategy.compliance_notes && (
                      <span className="text-destructive">{doorStrategy.compliance_notes}</span>
                    )}
                  </div>
                </div>
              )}
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
            <TabsContent value="score_intel" className="mt-2 space-y-3">
              {/* Pipeline Intelligence Scores */}
              {pipelineScores && (
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { label: 'Equity', data: pipelineScores.equity, icon: TrendingUp, color: 'text-green-600' },
                    { label: 'Absentee', data: pipelineScores.absentee, icon: Building2, color: 'text-blue-600' },
                    { label: 'Roof Age', data: pipelineScores.roof_age, icon: HardHat, color: 'text-orange-600' },
                  ].map(({ label, data, icon: Icon, color }) => (
                    <div key={label} className="border rounded-lg p-2 text-center">
                      <Icon className={cn("h-4 w-4 mx-auto mb-1", color)} />
                      <p className="text-lg font-bold">{data?.score ?? '—'}</p>
                      <p className="text-[9px] text-muted-foreground">{label}</p>
                    </div>
                  ))}
                </div>
              )}
              {/* Storm Intel */}
              {profile?.tenant_id && property?.normalized_address_key && property?.storm_event_id ? (
                <StormScoreWhyPanel
                  tenantId={profile.tenant_id}
                  stormEventId={property.storm_event_id}
                  normalizedAddressKey={property.normalized_address_key}
                />
              ) : !pipelineScores ? (
                <div className="text-xs text-muted-foreground text-center py-4">
                  No intel available. Enrich property to see scores.
                </div>
              ) : null}
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

        {/* Storm Reports Dialog */}
        {showStormReports && (
          <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4" onClick={() => setShowStormReports(false)}>
            <div className="bg-background rounded-xl w-full max-w-lg max-h-[70vh] overflow-hidden shadow-xl flex flex-col" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between p-4 border-b">
                <div>
                  <h3 className="font-semibold text-sm">Storm Reports</h3>
                  <p className="text-xs text-muted-foreground">NOAA data within 15mi • Last 3 years</p>
                </div>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setShowStormReports(false)}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
              {/* Filter Tabs */}
              {!loadingStorm && stormReports.length > 0 && (
                <div className="flex gap-1.5 px-4 pt-3 pb-1 flex-wrap">
                  {(['all', 'hail', 'wind', 'tornado'] as const).map((filter) => {
                    const count = filter === 'all'
                      ? stormReports.length
                      : stormReports.filter(r => r.event_type?.toLowerCase().includes(filter)).length;
                    const isActive = stormFilter === filter;
                    const colorMap = { all: '', hail: 'bg-blue-500 text-white', wind: 'bg-orange-500 text-white', tornado: 'bg-red-500 text-white' };
                    return (
                      <Button
                        key={filter}
                        variant={isActive ? 'default' : 'outline'}
                        size="sm"
                        className={cn("h-7 text-xs gap-1", isActive && filter !== 'all' && colorMap[filter])}
                        onClick={() => setStormFilter(filter)}
                      >
                        {filter.charAt(0).toUpperCase() + filter.slice(1)}
                        <Badge variant="secondary" className="text-[9px] h-4 px-1 ml-0.5">{count}</Badge>
                      </Button>
                    );
                  })}
                </div>
              )}
              <ScrollArea className="flex-1 overflow-hidden">
                <div className="p-4">
                {loadingStorm ? (
                  <div className="flex items-center justify-center py-8 gap-2">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">Fetching NOAA reports...</span>
                  </div>
                ) : stormReports.length === 0 ? (
                  <div className="text-center py-8">
                    <Cloud className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                    <p className="text-sm text-muted-foreground">No storm reports found in this area</p>
                  </div>
                ) : (() => {
                  const filtered = stormFilter === 'all'
                    ? stormReports
                    : stormReports.filter(r => r.event_type?.toLowerCase().includes(stormFilter));
                  return (
                    <div className="space-y-2">
                      <p className="text-xs text-muted-foreground mb-3">{filtered.length} report{filtered.length !== 1 ? 's' : ''} shown</p>
                      {filtered.map((report, i) => {
                        const et = (report.event_type || '').toLowerCase();
                        const badgeClass = et.includes('hail') ? 'bg-blue-100 text-blue-700 border-blue-300'
                          : et.includes('wind') ? 'bg-orange-100 text-orange-700 border-orange-300'
                          : et.includes('tornado') ? 'bg-red-100 text-red-700 border-red-300'
                          : 'bg-muted text-muted-foreground';
                        return (
                          <div key={i} className="border rounded-lg p-3 text-xs space-y-1">
                            <div className="flex items-center justify-between">
                              <Badge variant="outline" className={cn("text-[10px]", badgeClass)}>
                                {report.event_type}
                              </Badge>
                              <span className="text-muted-foreground">
                                {report.date ? new Date(report.date).toLocaleDateString() : 'Unknown date'}
                              </span>
                            </div>
                            {report.magnitude && (
                              <p className="font-medium">Magnitude: {report.magnitude}</p>
                            )}
                            {report.description && (
                              <p className="text-muted-foreground line-clamp-2">{report.description}</p>
                            )}
                            <div className="flex items-center gap-2 text-muted-foreground">
                              {report.location && <span>{report.location}</span>}
                              {report.distance_miles > 0 && <span>• {report.distance_miles}mi away</span>}
                              <span>• {report.source}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
                </div>
              </ScrollArea>
            </div>
          </div>
        )}
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
