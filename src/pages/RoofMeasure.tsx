import React from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { GlobalLayout } from '@/shared/components/layout/GlobalLayout';
import { RoofMeasurementTool } from '@/components/roof-measurement';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

const RoofMeasurePage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  
  // Get coordinates from URL params or fetch from pipeline entry
  const urlLat = searchParams.get('lat');
  const urlLng = searchParams.get('lng');
  const urlAddress = searchParams.get('address');

  // Fetch pipeline entry data if we have an ID
  const { data: pipelineEntry, isLoading } = useQuery({
    queryKey: ['pipeline-entry-for-measurement', id],
    queryFn: async () => {
      if (!id) return null;
      
      const { data, error } = await supabase
        .from('pipeline_entries')
        .select(`
          id,
          contacts (
            first_name,
            last_name,
            address_street,
            address_city,
            address_state,
            latitude,
            longitude,
            verified_address
          )
        `)
        .eq('id', id)
        .single();

      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  // Determine coordinates
  const contact = (pipelineEntry as any)?.contacts;
  const lat = urlLat 
    ? parseFloat(urlLat) 
    : contact?.verified_address?.lat || contact?.latitude || 0;
  const lng = urlLng 
    ? parseFloat(urlLng) 
    : contact?.verified_address?.lng || contact?.longitude || 0;
  
  const address = urlAddress || [
    contact?.address_street,
    contact?.address_city,
    contact?.address_state,
  ].filter(Boolean).join(', ');

  const handleSave = () => {
    // Navigate back to lead detail
    if (id) {
      navigate(`/lead/${id}?tab=estimate`);
    } else {
      navigate(-1);
    }
  };

  const handleCancel = () => {
    if (id) {
      navigate(`/lead/${id}`);
    } else {
      navigate(-1);
    }
  };

  if (isLoading) {
    return (
      <GlobalLayout>
        <div className="flex items-center justify-center h-96">
          <div className="animate-pulse text-muted-foreground">Loading...</div>
        </div>
      </GlobalLayout>
    );
  }

  // Check for valid coordinates (not just falsy check since 0 is valid)
  const hasValidCoordinates = lat !== null && lat !== undefined && !isNaN(lat) && 
                              lng !== null && lng !== undefined && !isNaN(lng) &&
                              (lat !== 0 || lng !== 0);

  if (!hasValidCoordinates) {
    return (
      <GlobalLayout>
        <div className="p-6">
          <Button variant="ghost" onClick={() => id ? navigate(`/lead/${id}`) : navigate(-1)} className="mb-4">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Lead
          </Button>
          <div className="text-center py-12">
            <p className="text-muted-foreground mb-4">Missing property coordinates. Please verify the address first.</p>
            {id && (
              <Button onClick={() => navigate(`/lead/${id}`)}>
                Go to Lead to Verify Address
              </Button>
            )}
          </div>
        </div>
      </GlobalLayout>
    );
  }

  return (
    <GlobalLayout>
      <div className="p-4 h-[calc(100vh-4rem)]">
        <div className="mb-4 flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={() => id ? navigate(`/lead/${id}`) : navigate(-1)}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Lead
          </Button>
          <h1 className="text-lg font-semibold">Roof Measurement Tool</h1>
        </div>
        
        <div className="h-[calc(100%-3rem)]">
          <RoofMeasurementTool
            propertyId={id || ''}
            lat={lat}
            lng={lng}
            address={address}
            onSave={handleSave}
            onCancel={handleCancel}
          />
        </div>
      </div>
    </GlobalLayout>
  );
};

export default RoofMeasurePage;
