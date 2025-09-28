import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ArrowLeft, MapPin } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import SatelliteMeasurement from '@/components/SatelliteMeasurement';

interface PipelineEntry {
  id: string;
  contacts?: {
    first_name: string;
    last_name: string;
    address_street?: string;
    address_city?: string;
    address_state?: string;
    latitude?: number;
    longitude?: number;
  };
}

const EnhancedMeasurement: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [pipelineEntry, setPipelineEntry] = useState<PipelineEntry | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (id) {
      loadPipelineEntry();
    }
  }, [id]);

  const loadPipelineEntry = async () => {
    try {
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
            longitude
          )
        `)
        .eq('id', id)
        .single();

      if (error) throw error;
      setPipelineEntry(data);
    } catch (error) {
      console.error('Error loading pipeline entry:', error);
      toast({
        title: "Error",
        description: "Failed to load pipeline entry details.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleMeasurementsSaved = (measurements: any) => {
    toast({
      title: "Success",
      description: "Measurements saved successfully! You can now close this window.",
    });
    
    // Close the window after a brief delay
    setTimeout(() => {
      window.close();
    }, 2000);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background p-4">
        <div className="max-w-6xl mx-auto">
          <div className="animate-pulse">
            <div className="h-8 bg-muted rounded w-1/3 mb-4"></div>
            <div className="h-64 bg-muted rounded"></div>
          </div>
        </div>
      </div>
    );
  }

  if (!pipelineEntry) {
    return (
      <div className="min-h-screen bg-background p-4">
        <div className="max-w-6xl mx-auto">
          <Card>
            <CardContent className="p-6 text-center">
              <p>Pipeline entry not found.</p>
              <Button onClick={() => window.close()} className="mt-4">
                Close Window
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  const address = [
    pipelineEntry.contacts?.address_street,
    pipelineEntry.contacts?.address_city,
    pipelineEntry.contacts?.address_state
  ].filter(Boolean).join(', ');

  const customerName = [
    pipelineEntry.contacts?.first_name,
    pipelineEntry.contacts?.last_name
  ].filter(Boolean).join(' ') || 'Customer';

  return (
    <div className="min-h-screen bg-background p-4">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-4">
              <Button 
                variant="outline" 
                size="sm"
                onClick={() => window.close()}
              >
                <ArrowLeft className="h-4 w-4 mr-2" />
                Close
              </Button>
              <div>
                <CardTitle className="flex items-center gap-2">
                  <MapPin className="h-5 w-5" />
                  Professional Roof Measurement
                </CardTitle>
                <p className="text-muted-foreground">
                  {customerName} - {address}
                </p>
              </div>
            </div>
          </CardHeader>
        </Card>

        {/* Measurement Interface */}
        <SatelliteMeasurement
          address={address}
          latitude={pipelineEntry.contacts?.latitude}
          longitude={pipelineEntry.contacts?.longitude}
          pipelineEntryId={id!}
          onMeasurementsSaved={handleMeasurementsSaved}
        />

        {/* Instructions */}
        <Card>
          <CardHeader>
            <CardTitle>How to Use the Measurement Tool</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              <div>
                <h4 className="font-medium mb-2">Basic Measurements:</h4>
                <ul className="space-y-1 text-muted-foreground">
                  <li>• Click "Start Drawing" to begin outlining the roof</li>
                  <li>• Click around the roof perimeter to create points</li>
                  <li>• The system calculates area and perimeter automatically</li>
                  <li>• Adjust roof pitch and complexity settings</li>
                </ul>
              </div>
              <div>
                <h4 className="font-medium mb-2">Advanced Features:</h4>
                <ul className="space-y-1 text-muted-foreground">
                  <li>• Set waste factor for material calculations</li>
                  <li>• Choose appropriate roof complexity level</li>
                  <li>• Save measurements to integrate with estimates</li>
                  <li>• Use high-resolution satellite imagery for accuracy</li>
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default EnhancedMeasurement;