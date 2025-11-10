import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Card } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import { ArrowRight, Ruler, Edit, FileText, Calculator, Home } from 'lucide-react';
import { SimpleMeasurementCanvas } from '@/components/measurements/SimpleMeasurementCanvas';
import { ProfessionalMeasurementReport } from '@/components/measurements/ProfessionalMeasurementReport';
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
  
  // Measurement state
  const [facets, setFacets] = useState<Facet[]>([]);
  const [totalArea, setTotalArea] = useState(0);
  const [satelliteImageUrl, setSatelliteImageUrl] = useState<string>('');
  const [overlayImageUrl, setOverlayImageUrl] = useState<string>('');
  
  // Adjustment state (for Review tab)
  const [wastePercentage, setWastePercentage] = useState(10);
  const [globalPitch, setGlobalPitch] = useState('6/12');
  const [complexityFactor, setComplexityFactor] = useState(1.0);
  
  // Property info
  const [propertyAddress] = useState('123 Main St, City, ST 12345');
  const [customerName] = useState('John Doe');

  const handleMeasurementsComplete = (measurements: any) => {
    console.log('Measurements completed:', measurements);
    
    // Convert measurements to facets format
    const newFacets: Facet[] = measurements.polygons.map((polygon: any, index: number) => ({
      id: polygon.id,
      label: `Facet ${index + 1}`,
      area: polygon.area,
      perimeter: polygon.perimeter,
      pitch: '6/12', // Default pitch
      direction: 'N', // Default direction
      ridgeLength: 0,
      hipLength: 0,
      valleyLength: 0,
    }));
    
    setFacets(newFacets);
    setTotalArea(measurements.totalArea);
    
    toast.success('Measurements saved! Ready for review.');
    setActiveTab('review');
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
                onClick={() => navigate(-1)}
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
                <div className="h-full flex flex-col">
                  <SimpleMeasurementCanvas
                    satelliteImageUrl={satelliteImageUrl || 'https://api.mapbox.com/styles/v1/mapbox/satellite-v9/static/-122.4,37.8,18,0/1200x800?access_token=pk.eyJ1IjoibG92YWJsZS1kZW1vIiwiYSI6ImNtMXoxZHdwejBhMnAyanM0dzA3ZW1yMG4ifQ.demo'}
                    address={propertyAddress}
                    onMeasurementsChange={handleMeasurementsComplete}
                  />
                  
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
              <TabsContent value="review" className="h-full m-0 p-6">
                <div className="max-w-4xl mx-auto space-y-6">
                  <Card className="p-6">
                    <h2 className="text-xl font-semibold mb-6">Adjust Measurements & Parameters</h2>
                    
                    <div className="space-y-6">
                      {/* Waste Percentage */}
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <Label>Waste Factor</Label>
                          <Badge variant="secondary">{wastePercentage}%</Badge>
                        </div>
                        <Slider
                          value={[wastePercentage]}
                          onValueChange={(value) => setWastePercentage(value[0])}
                          min={0}
                          max={25}
                          step={1}
                          className="w-full"
                        />
                        <p className="text-xs text-muted-foreground">
                          Accounts for cuts, overlaps, and installation waste
                        </p>
                      </div>

                      {/* Global Pitch */}
                      <div className="space-y-2">
                        <Label>Global Roof Pitch</Label>
                        <div className="grid grid-cols-6 gap-2">
                          {pitchOptions.map((pitch) => (
                            <Button
                              key={pitch}
                              variant={globalPitch === pitch ? 'default' : 'outline'}
                              size="sm"
                              onClick={() => setGlobalPitch(pitch)}
                            >
                              {pitch}
                            </Button>
                          ))}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Apply this pitch to all facets (can be adjusted individually later)
                        </p>
                      </div>

                      {/* Complexity Factor */}
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <Label>Job Complexity Factor</Label>
                          <Badge variant="secondary">{complexityFactor.toFixed(1)}x</Badge>
                        </div>
                        <Slider
                          value={[complexityFactor]}
                          onValueChange={(value) => setComplexityFactor(value[0])}
                          min={0.5}
                          max={2.0}
                          step={0.1}
                          className="w-full"
                        />
                        <p className="text-xs text-muted-foreground">
                          Adjusts labor estimates based on roof complexity and access difficulty
                        </p>
                      </div>

                      {/* Live Material Calculations Preview */}
                      <div className="bg-muted/50 rounded-lg p-4 space-y-2">
                        <h3 className="font-semibold text-sm">Live Material Calculations</h3>
                        <div className="grid grid-cols-2 gap-4 text-sm">
                          <div>
                            <span className="text-muted-foreground">Base Area:</span>
                            <span className="ml-2 font-semibold">{totalArea.toFixed(0)} sq ft</span>
                          </div>
                          <div>
                            <span className="text-muted-foreground">With Waste:</span>
                            <span className="ml-2 font-semibold">
                              {(totalArea * (1 + wastePercentage / 100)).toFixed(0)} sq ft
                            </span>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Squares:</span>
                            <span className="ml-2 font-semibold">
                              {((totalArea * (1 + wastePercentage / 100)) / 100).toFixed(2)}
                            </span>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Complexity:</span>
                            <span className="ml-2 font-semibold">{complexityFactor.toFixed(1)}x</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </Card>

                  <div className="flex gap-3">
                    <Button variant="outline" onClick={() => setActiveTab('draw')} className="flex-1">
                      Back to Drawing
                    </Button>
                    <Button onClick={handleReviewComplete} className="flex-1">
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
      </div>
    </GlobalLayout>
  );
}
