import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Ruler, Upload, MapPin, Layers, Package, FileText, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useCompanySwitcher } from '@/hooks/useCompanySwitcher';
import { toast } from 'sonner';

interface RoofFacet {
  id: number;
  area_sqft: number;
  pitch: string;
  pitch_degrees: number;
  orientation: string;
}

interface MaterialTakeoff {
  [key: string]: {
    quantity?: number;
    bundles?: number;
    rolls?: number;
    pieces?: number;
    count?: number;
    linear_feet?: number;
    sqft?: number;
    description: string;
  };
}

interface AnalysisResult {
  analysis_id: string;
  measurements: {
    total_roof_area: number;
    total_facets: number;
    predominant_pitch: string;
    ridge_length: number;
    valley_length: number;
    hip_length: number;
    eave_length: number;
    rake_length: number;
  };
  facets: RoofFacet[];
  material_takeoff: MaterialTakeoff;
  confidence_score: number;
  processing_time_ms: number;
  imagery_url?: string;
}

interface AIRoofAnalyzerProps {
  projectId?: string;
  contactId?: string;
  onAnalysisComplete?: (result: AnalysisResult) => void;
}

export const AIRoofAnalyzer: React.FC<AIRoofAnalyzerProps> = ({
  projectId,
  contactId,
  onAnalysisComplete
}) => {
  const { activeCompany } = useCompanySwitcher();
  const [address, setAddress] = useState('');
  const [latitude, setLatitude] = useState<number | null>(null);
  const [longitude, setLongitude] = useState<number | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<AnalysisResult | null>(null);

  const handleAddressSearch = async () => {
    if (!address) {
      toast.error('Please enter an address');
      return;
    }

    try {
      // Use Google Maps geocoding or similar
      const response = await fetch(
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(address)}.json?access_token=${import.meta.env.VITE_MAPBOX_PUBLIC_TOKEN || ''}`
      );
      const data = await response.json();

      if (data.features && data.features.length > 0) {
        const [lng, lat] = data.features[0].center;
        setLatitude(lat);
        setLongitude(lng);
        toast.success('Location found');
      } else {
        toast.error('Address not found');
      }
    } catch (error) {
      console.error('Geocoding error:', error);
      toast.error('Failed to find address');
    }
  };

  const startAnalysis = async () => {
    if (!activeCompany?.tenant_id) {
      toast.error('No company selected');
      return;
    }

    if (!latitude || !longitude) {
      toast.error('Please search for an address first');
      return;
    }

    setIsAnalyzing(true);
    setProgress(10);

    try {
      // Simulate progress
      const progressInterval = setInterval(() => {
        setProgress(prev => Math.min(prev + 10, 90));
      }, 500);

      const { data, error } = await supabase.functions.invoke('ai-measurement-analyzer', {
        body: {
          tenant_id: activeCompany.tenant_id,
          project_id: projectId,
          contact_id: contactId,
          property_address: address,
          latitude,
          longitude,
          imagery_source: 'satellite'
        }
      });

      clearInterval(progressInterval);

      if (error) throw error;

      if (data.success) {
        setProgress(100);
        setResult(data);
        onAnalysisComplete?.(data);
        toast.success('Roof analysis complete!');
      } else {
        throw new Error(data.error || 'Analysis failed');
      }
    } catch (error: any) {
      console.error('Analysis error:', error);
      toast.error(error.message || 'Analysis failed');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const getConfidenceColor = (score: number) => {
    if (score >= 90) return 'text-green-500';
    if (score >= 75) return 'text-yellow-500';
    return 'text-orange-500';
  };

  return (
    <div className="space-y-6">
      {/* Address Input */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Ruler className="h-5 w-5" />
            AI Roof Measurement Analyzer
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <div className="flex-1">
              <Label htmlFor="address">Property Address</Label>
              <div className="flex gap-2 mt-1">
                <Input
                  id="address"
                  placeholder="Enter property address..."
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && handleAddressSearch()}
                />
                <Button variant="outline" onClick={handleAddressSearch}>
                  <MapPin className="h-4 w-4 mr-2" />
                  Find
                </Button>
              </div>
            </div>
          </div>

          {latitude && longitude && (
            <div className="flex items-center gap-4 text-sm text-muted-foreground">
              <span>Lat: {latitude.toFixed(6)}</span>
              <span>Lng: {longitude.toFixed(6)}</span>
              <Badge variant="outline" className="ml-auto">
                <CheckCircle className="h-3 w-3 mr-1" />
                Location Verified
              </Badge>
            </div>
          )}

          <Button 
            onClick={startAnalysis} 
            disabled={isAnalyzing || !latitude || !longitude}
            className="w-full"
          >
            {isAnalyzing ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Analyzing Roof...
              </>
            ) : (
              <>
                <Layers className="h-4 w-4 mr-2" />
                Start AI Analysis
              </>
            )}
          </Button>

          {isAnalyzing && (
            <div className="space-y-2">
              <Progress value={progress} />
              <p className="text-sm text-center text-muted-foreground">
                {progress < 30 && 'Fetching satellite imagery...'}
                {progress >= 30 && progress < 60 && 'Detecting roof planes...'}
                {progress >= 60 && progress < 90 && 'Calculating measurements...'}
                {progress >= 90 && 'Generating material takeoff...'}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Results */}
      {result && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Analysis Results</CardTitle>
              <Badge variant="outline" className={getConfidenceColor(result.confidence_score)}>
                {result.confidence_score.toFixed(1)}% Confidence
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="measurements">
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="measurements">Measurements</TabsTrigger>
                <TabsTrigger value="facets">Facets</TabsTrigger>
                <TabsTrigger value="materials">Materials</TabsTrigger>
              </TabsList>

              <TabsContent value="measurements" className="space-y-4">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
                  <Card>
                    <CardContent className="p-4 text-center">
                      <p className="text-3xl font-bold text-primary">
                        {result.measurements.total_roof_area.toLocaleString()}
                      </p>
                      <p className="text-sm text-muted-foreground">Total Sq Ft</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-4 text-center">
                      <p className="text-3xl font-bold">
                        {result.measurements.total_facets}
                      </p>
                      <p className="text-sm text-muted-foreground">Facets</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-4 text-center">
                      <p className="text-3xl font-bold">
                        {result.measurements.predominant_pitch}
                      </p>
                      <p className="text-sm text-muted-foreground">Pitch</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-4 text-center">
                      <p className="text-3xl font-bold">
                        {Math.ceil(result.measurements.total_roof_area / 100)}
                      </p>
                      <p className="text-sm text-muted-foreground">Squares</p>
                    </CardContent>
                  </Card>
                </div>

                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Measurement</TableHead>
                      <TableHead className="text-right">Linear Feet</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <TableRow>
                      <TableCell>Ridge</TableCell>
                      <TableCell className="text-right">{result.measurements.ridge_length.toFixed(0)} LF</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>Valley</TableCell>
                      <TableCell className="text-right">{result.measurements.valley_length.toFixed(0)} LF</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>Hip</TableCell>
                      <TableCell className="text-right">{result.measurements.hip_length.toFixed(0)} LF</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>Eave</TableCell>
                      <TableCell className="text-right">{result.measurements.eave_length.toFixed(0)} LF</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>Rake</TableCell>
                      <TableCell className="text-right">{result.measurements.rake_length.toFixed(0)} LF</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </TabsContent>

              <TabsContent value="facets">
                <Table className="mt-4">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Facet</TableHead>
                      <TableHead>Orientation</TableHead>
                      <TableHead>Pitch</TableHead>
                      <TableHead className="text-right">Area (sq ft)</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {result.facets.map(facet => (
                      <TableRow key={facet.id}>
                        <TableCell>Facet {facet.id}</TableCell>
                        <TableCell>{facet.orientation}</TableCell>
                        <TableCell>{facet.pitch} ({facet.pitch_degrees.toFixed(1)}°)</TableCell>
                        <TableCell className="text-right">{facet.area_sqft.toLocaleString()}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TabsContent>

              <TabsContent value="materials">
                <Table className="mt-4">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Material</TableHead>
                      <TableHead>Quantity</TableHead>
                      <TableHead>Description</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {Object.entries(result.material_takeoff).map(([key, value]) => (
                      <TableRow key={key}>
                        <TableCell className="font-medium capitalize">
                          {key.replace(/_/g, ' ')}
                        </TableCell>
                        <TableCell>
                          {value.bundles && `${value.bundles} bundles`}
                          {value.rolls && `${value.rolls} rolls`}
                          {value.pieces && `${value.pieces} pieces`}
                          {value.count && `${value.count} units`}
                          {value.linear_feet && `${value.linear_feet.toFixed(0)} LF`}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {value.description}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TabsContent>
            </Tabs>

            <div className="flex justify-end gap-2 mt-6">
              <Button variant="outline">
                <FileText className="h-4 w-4 mr-2" />
                Export PDF
              </Button>
              <Button>
                <Package className="h-4 w-4 mr-2" />
                Create Estimate
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};
