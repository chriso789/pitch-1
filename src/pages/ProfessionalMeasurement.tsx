import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useMapboxToken } from '@/hooks/useMapboxToken';
import { Card } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import { ArrowRight, Ruler, Edit, FileText, Calculator, Home, History, Loader2 } from 'lucide-react';
import { InteractiveMapCanvas } from '@/components/measurements/InteractiveMapCanvas';
import { ProfessionalMeasurementReport } from '@/components/measurements/ProfessionalMeasurementReport';
import { ComprehensiveMeasurementOverlay } from '@/components/measurements/ComprehensiveMeasurementOverlay';
import { MeasurementHistoryDialog } from '@/components/measurements/MeasurementHistoryDialog';
import { GlobalLayout } from '@/shared/components/layout/GlobalLayout';
import { toast } from 'sonner';

interface Facet {
  id: string;
  label: string;
  area: number;
  perimeter: number;
  pitch?: string;
  direction?: string;
  ridgeLength?: number;
  hipLength?: number;
  valleyLength?: number;
}

export default function ProfessionalMeasurement() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('draw');
  const [showHistoryDialog, setShowHistoryDialog] = useState(false);
  
  // Fetch Mapbox token
  const { token: mapboxToken, loading: tokenLoading } = useMapboxToken();
  
  // Fetch pipeline entry with contact data
  const { data: pipelineEntry, isLoading: entryLoading } = useQuery({
    queryKey: ['pipeline-entry-measurement', id],
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

  // Extract real property data
  const contact = pipelineEntry?.contacts as any;
  const propertyAddress = contact 
    ? [contact.address_street, contact.address_city, contact.address_state].filter(Boolean).join(', ')
    : 'Loading address...';
  const customerName = contact 
    ? `${contact.first_name || ''} ${contact.last_name || ''}`.trim() || 'Unknown'
    : 'Loading...';
  const lat = contact?.verified_address?.lat ?? contact?.latitude ?? null;
  const lng = contact?.verified_address?.lng ?? contact?.longitude ?? null;
  const hasValidCoordinates = lat !== null && lng !== null && !isNaN(lat) && !isNaN(lng) && (lat !== 0 || lng !== 0);
  
  // Build real satellite URL
  const realSatelliteUrl = mapboxToken && lat && lng
    ? `https://api.mapbox.com/styles/v1/mapbox/satellite-v9/static/${lng},${lat},20,0/1200x800?access_token=${mapboxToken}`
    : '';
  
  // Measurement state
  const [facets, setFacets] = useState<Facet[]>([]);
  const [totalArea, setTotalArea] = useState(0);
  const [satelliteImageUrl, setSatelliteImageUrl] = useState<string>('');
  const [overlayImageUrl, setOverlayImageUrl] = useState<string>('');
  const [comprehensiveMeasurement, setComprehensiveMeasurement] = useState<any>(null);
  const [adjustedMeasurement, setAdjustedMeasurement] = useState<any>(null);
  const [currentMeasurementId, setCurrentMeasurementId] = useState<string | undefined>();
  
  // Adjustment state (for Review tab)
  const [wastePercentage, setWastePercentage] = useState(10);
  const [globalPitch, setGlobalPitch] = useState('6/12');
  const [complexityFactor, setComplexityFactor] = useState(1.0);

  // Loading state
  const isLoading = tokenLoading || entryLoading;
  
  if (isLoading) {
    return (
      <GlobalLayout>
        <div className="flex items-center justify-center h-screen">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <span className="ml-2">Loading property data...</span>
        </div>
      </GlobalLayout>
    );
  }

  const handleMeasurementsComplete = (measurement: any) => {
    console.log('Measurements completed:', measurement);
    
    setComprehensiveMeasurement(measurement);
    setAdjustedMeasurement(measurement); // Initialize with same data
    setSatelliteImageUrl(measurement.satelliteImageUrl || satelliteImageUrl);
    setCurrentMeasurementId(measurement.id);
    
    // Also update facets for backward compatibility
    const newFacets: Facet[] = measurement.faces.map((face: any, index: number) => ({
      id: face.id,
      label: face.label || `Facet ${index + 1}`,
      area: face.area_sqft,
      perimeter: face.perimeter_ft,
      pitch: face.pitch || '6/12',
      direction: face.direction || 'N',
      ridgeLength: 0,
      hipLength: 0,
      valleyLength: 0,
    }));
    
    setFacets(newFacets);
    setTotalArea(measurement.summary.total_area_sqft);
    
    toast.success('Measurements saved! Ready for interactive review.');
    setActiveTab('review');
  };

  const handleMeasurementUpdate = (updatedMeasurement: any, updatedTags: any) => {
    console.log('Measurement updated:', { updatedMeasurement, updatedTags });
    
    setAdjustedMeasurement({
      ...updatedMeasurement,
      tags: updatedTags,
      summary: {
        ...updatedMeasurement.summary,
        total_area_sqft: updatedMeasurement.faces.reduce((sum: number, f: any) => sum + f.area_sqft, 0),
        total_squares: updatedMeasurement.faces.reduce((sum: number, f: any) => sum + f.area_sqft, 0) / 100,
      },
    });
  };

  const handleSatelliteImageLoaded = (imageUrl: string) => {
    setSatelliteImageUrl(imageUrl);
  };

  const handleReviewComplete = () => {
    toast.success('Adjustments saved! Generate your report.');
    setActiveTab('report');
  };

  const handleCreateEstimate = () => {
    if (!id) {
      toast.error('No pipeline entry ID found');
      return;
    }
    
    toast.success('Navigating to Estimate Builder...');
    navigate(`/lead/${id}`);
  };

  const pitchOptions = [
    '2/12', '3/12', '4/12', '5/12', '6/12', 
    '7/12', '8/12', '9/12', '10/12', '11/12', '12/12'
  ];

  return (
    <GlobalLayout>
      <div className="h-screen flex flex-col">
        {/* Header */}
        <div className="border-b bg-background p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => navigate(`/lead/${id}`)}
              >
                <Home className="h-4 w-4" />
              </Button>
              <div>
                <h1 className="text-2xl font-bold">Professional Measurement</h1>
                <p className="text-sm text-muted-foreground">{propertyAddress}</p>
              </div>
            </div>
            
            <div className="flex items-center gap-2">
              {facets.length > 0 && (
                <>
                  <Badge variant="secondary">
                    {facets.length} Facet{facets.length !== 1 ? 's' : ''}
                  </Badge>
                  <Badge variant="outline">
                    {totalArea.toFixed(0)} sq ft
                  </Badge>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Tabbed Workflow */}
        <div className="flex-1 overflow-hidden">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="h-full flex flex-col">
            <div className="border-b bg-muted/30 px-4">
              <TabsList className="h-12 bg-transparent">
                <TabsTrigger value="draw" className="gap-2">
                  <Ruler className="h-4 w-4" />
                  Draw Measurements
                </TabsTrigger>
                <TabsTrigger value="review" className="gap-2" disabled={facets.length === 0}>
                  <Edit className="h-4 w-4" />
                  Review & Adjust
                </TabsTrigger>
                <TabsTrigger value="report" className="gap-2" disabled={facets.length === 0}>
                  <FileText className="h-4 w-4" />
                  Generate Report
                </TabsTrigger>
                <TabsTrigger value="estimate" className="gap-2" disabled={facets.length === 0}>
                  <Calculator className="h-4 w-4" />
                  Create Estimate
                </TabsTrigger>
              </TabsList>
            </div>

            <div className="flex-1 overflow-auto">
              {/* Tab 1: Draw Measurements */}
              <TabsContent value="draw" className="h-full m-0 p-0">
                <div className="h-full flex flex-col min-h-[600px]">
                  {mapboxToken && hasValidCoordinates ? (
                    <InteractiveMapCanvas
                      mapboxToken={mapboxToken}
                      centerLat={lat!}
                      centerLng={lng!}
                      initialZoom={20}
                      address={propertyAddress}
                      pipelineEntryId={id}
                      onMeasurementsChange={handleMeasurementsComplete}
                    />
                  ) : !hasValidCoordinates ? (
                    <div className="flex flex-col items-center justify-center h-full bg-muted gap-4">
                      <p className="text-muted-foreground">Property coordinates are missing.</p>
                      <Button onClick={() => navigate(`/lead/${id}`)}>
                        Go to Lead to Verify Address
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-center justify-center h-full bg-muted">
                      <Loader2 className="h-8 w-8 animate-spin text-primary" />
                      <span className="ml-2">Loading map...</span>
                    </div>
                  )}
                  
                  {facets.length > 0 && (
                    <div className="p-4 border-t bg-background">
                      <Button onClick={() => setActiveTab('review')} className="w-full">
                        Continue to Review <ArrowRight className="ml-2 h-4 w-4" />
                      </Button>
                    </div>
                  )}
                </div>
              </TabsContent>

              {/* Tab 2: Review & Adjust */}
              <TabsContent value="review" className="h-full m-0 p-0">
                <div className="h-full flex flex-col">
                  {/* Header with adjustment controls */}
                  <div className="border-b bg-muted/30 p-4 space-y-4">
                    <div className="flex items-center justify-between">
                      <h2 className="text-lg font-semibold">Review & Edit Measurements</h2>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setShowHistoryDialog(true)}
                        className="gap-2"
                      >
                        <History className="h-4 w-4" />
                        View History
                      </Button>
                    </div>
                    
                    <div className="grid grid-cols-3 gap-4">
                      {/* Waste Factor */}
                      <div className="space-y-2">
                        <Label className="text-sm">Waste Factor: {wastePercentage}%</Label>
                        <Slider
                          value={[wastePercentage]}
                          onValueChange={(value) => setWastePercentage(value[0])}
                          min={0}
                          max={25}
                          step={1}
                        />
                      </div>
                      
                      {/* Global Pitch */}
                      <div className="space-y-2">
                        <Label className="text-sm">Global Pitch: {globalPitch}</Label>
                        <Slider
                          value={[pitchOptions.indexOf(globalPitch)]}
                          onValueChange={(value) => setGlobalPitch(pitchOptions[value[0]])}
                          min={0}
                          max={pitchOptions.length - 1}
                          step={1}
                        />
                      </div>
                      
                      {/* Complexity Factor */}
                      <div className="space-y-2">
                        <Label className="text-sm">Complexity: {complexityFactor.toFixed(1)}x</Label>
                        <Slider
                          value={[complexityFactor]}
                          onValueChange={(value) => setComplexityFactor(value[0])}
                          min={0.5}
                          max={2.0}
                          step={0.1}
                        />
                      </div>
                    </div>
                  </div>
                  
                  {/* Interactive Overlay Editor */}
                  <div className="flex-1 relative">
                    {adjustedMeasurement && (
                      <ComprehensiveMeasurementOverlay
                        satelliteImageUrl={satelliteImageUrl}
                        measurement={adjustedMeasurement}
                        tags={adjustedMeasurement.tags || {}}
                        centerLng={adjustedMeasurement.gps_coordinates?.lng || lng || 0}
                        centerLat={adjustedMeasurement.gps_coordinates?.lat || lat || 0}
                        zoom={adjustedMeasurement.analysis_zoom || 20}
                        canvasWidth={adjustedMeasurement.canvasWidth || 1200}
                        canvasHeight={adjustedMeasurement.canvasHeight || 800}
                        onMeasurementUpdate={handleMeasurementUpdate}
                        measurementId={currentMeasurementId}
                        propertyId={id}
                        pipelineEntryId={id}
                        verifiedAddressLat={lat || undefined}
                        verifiedAddressLng={lng || undefined}
                      />
                    )}
                  </div>
                  
                  {/* Footer with actions */}
                  <div className="border-t bg-background p-4 flex justify-between">
                    <Button variant="outline" onClick={() => setActiveTab('draw')}>
                      Back to Drawing
                    </Button>
                    <Button onClick={handleReviewComplete}>
                      Continue to Report <ArrowRight className="ml-2 h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </TabsContent>

              {/* Tab 3: Generate Report */}
              <TabsContent value="report" className="h-full m-0 p-6 overflow-auto">
                <div className="max-w-6xl mx-auto">
                  <ProfessionalMeasurementReport
                    propertyAddress={propertyAddress}
                    customerName={customerName}
                    facets={facets}
                    totalArea={totalArea}
                    satelliteImageUrl={satelliteImageUrl}
                    overlayImageUrl={overlayImageUrl}
                    wastePercentage={wastePercentage}
                    measuredBy="Professional Measurement System"
                    showMaterials={true}
                  />
                  
                  <div className="mt-6 flex gap-3">
                    <Button variant="outline" onClick={() => setActiveTab('review')} className="flex-1">
                      Back to Review
                    </Button>
                    <Button onClick={() => setActiveTab('estimate')} className="flex-1">
                      Create Estimate <ArrowRight className="ml-2 h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </TabsContent>

              {/* Tab 4: Create Estimate */}
              <TabsContent value="estimate" className="h-full m-0 p-6">
                <div className="max-w-2xl mx-auto space-y-6">
                  <Card className="p-8 text-center">
                    <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 mb-4">
                      <Calculator className="h-8 w-8 text-primary" />
                    </div>
                    
                    <h2 className="text-2xl font-bold mb-2">Ready to Create Estimate</h2>
                    <p className="text-muted-foreground mb-6">
                      Your measurements have been saved and material calculations are complete.
                      Continue to the Estimate Builder to finalize pricing.
                    </p>

                    <div className="bg-muted/50 rounded-lg p-4 mb-6 space-y-2">
                      <h3 className="font-semibold text-sm">What's Next</h3>
                      <ul className="text-sm text-left space-y-1 list-disc list-inside">
                        <li>Review pre-populated line items from measurements</li>
                        <li>Adjust material selections and quantities</li>
                        <li>Set profit margins and commission splits</li>
                        <li>Generate professional estimate PDF</li>
                        <li>Send to customer for approval</li>
                      </ul>
                    </div>

                    <div className="flex gap-3">
                      <Button variant="outline" onClick={() => setActiveTab('report')} className="flex-1">
                        Back to Report
                      </Button>
                      <Button onClick={handleCreateEstimate} size="lg" className="flex-1">
                        Open Estimate Builder <ArrowRight className="ml-2 h-4 w-4" />
                      </Button>
                    </div>
                  </Card>

                  {/* Quick Stats */}
                  <div className="grid grid-cols-3 gap-4">
                    <Card className="p-4 text-center">
                      <div className="text-2xl font-bold text-primary">
                        {facets.length}
                      </div>
                      <div className="text-xs text-muted-foreground">Roof Facets</div>
                    </Card>
                    <Card className="p-4 text-center">
                      <div className="text-2xl font-bold text-primary">
                        {((totalArea * (1 + wastePercentage / 100)) / 100).toFixed(1)}
                      </div>
                      <div className="text-xs text-muted-foreground">Total Squares</div>
                    </Card>
                    <Card className="p-4 text-center">
                      <div className="text-2xl font-bold text-primary">
                        {wastePercentage}%
                      </div>
                      <div className="text-xs text-muted-foreground">Waste Factor</div>
                    </Card>
                  </div>
                </div>
              </TabsContent>
            </div>
          </Tabs>
        </div>
        
        {/* Measurement History Dialog */}
        {currentMeasurementId && adjustedMeasurement && (
          <MeasurementHistoryDialog
            open={showHistoryDialog}
            onOpenChange={setShowHistoryDialog}
            measurementId={currentMeasurementId}
            currentMeasurement={adjustedMeasurement}
          />
        )}
      </div>
    </GlobalLayout>
  );
}
