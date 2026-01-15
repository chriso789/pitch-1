import { useState } from 'react';
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle,
  DialogDescription,
  DialogFooter
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, Upload, FileText, MapPin, AlertTriangle, CheckCircle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface FootprintImportDialogProps {
  open: boolean;
  onClose: () => void;
  measurementId: string;
  currentAreaSqft?: number;
  onSave: (data: {
    areaSqft: number;
    perimeterFt: number;
    vertexCount: number;
    source: string;
  }) => void;
}

interface ParsedVertex {
  lat: number;
  lng: number;
}

export function FootprintImportDialog({
  open,
  onClose,
  measurementId,
  currentAreaSqft,
  onSave
}: FootprintImportDialogProps) {
  const [activeTab, setActiveTab] = useState('wkt');
  const [wktInput, setWktInput] = useState('');
  const [jsonInput, setJsonInput] = useState('');
  const [manualReferenceArea, setManualReferenceArea] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [parsedVertices, setParsedVertices] = useState<ParsedVertex[] | null>(null);
  const [calculatedArea, setCalculatedArea] = useState<number | null>(null);

  const resetState = () => {
    setWktInput('');
    setJsonInput('');
    setParseError(null);
    setParsedVertices(null);
    setCalculatedArea(null);
  };

  const handleClose = () => {
    resetState();
    onClose();
  };

  // Parse WKT POLYGON string
  const parseWKT = (wkt: string): ParsedVertex[] | null => {
    try {
      // Match POLYGON((coords)) pattern
      const match = wkt.match(/POLYGON\s*\(\s*\(\s*([^)]+)\s*\)\s*\)/i);
      if (!match) {
        throw new Error('Invalid WKT format. Expected: POLYGON((lng lat, lng lat, ...))');
      }

      const coordsStr = match[1];
      const pairs = coordsStr.split(',').map(p => p.trim());
      
      const vertices: ParsedVertex[] = [];
      for (const pair of pairs) {
        const parts = pair.split(/\s+/).filter(Boolean);
        if (parts.length !== 2) {
          throw new Error(`Invalid coordinate pair: "${pair}". Expected "lng lat"`);
        }
        const lng = parseFloat(parts[0]);
        const lat = parseFloat(parts[1]);
        
        if (isNaN(lng) || isNaN(lat)) {
          throw new Error(`Invalid numbers in coordinate: "${pair}"`);
        }
        if (Math.abs(lat) > 90 || Math.abs(lng) > 180) {
          throw new Error(`Coordinates out of range: lat=${lat}, lng=${lng}`);
        }
        
        vertices.push({ lat, lng });
      }
      
      if (vertices.length < 3) {
        throw new Error('Polygon must have at least 3 vertices');
      }
      
      return vertices;
    } catch (err: any) {
      throw new Error(`WKT Parse Error: ${err.message}`);
    }
  };

  // Parse JSON array of coordinates
  const parseJSON = (json: string): ParsedVertex[] | null => {
    try {
      const parsed = JSON.parse(json);
      
      // Support multiple formats:
      // 1. Array of {lat, lng} objects
      // 2. Array of [lng, lat] arrays (GeoJSON style)
      // 3. { coordinates: [...] } wrapper
      
      let coords = parsed;
      if (parsed.coordinates) {
        coords = parsed.coordinates;
      }
      
      if (!Array.isArray(coords)) {
        throw new Error('Expected array of coordinates');
      }
      
      const vertices: ParsedVertex[] = [];
      for (const item of coords) {
        if (Array.isArray(item)) {
          // [lng, lat] format
          if (item.length !== 2) {
            throw new Error('Coordinate arrays must have exactly 2 elements [lng, lat]');
          }
          vertices.push({ lat: item[1], lng: item[0] });
        } else if (typeof item === 'object' && item !== null) {
          // {lat, lng} format
          const lat = item.lat ?? item.latitude;
          const lng = item.lng ?? item.lon ?? item.longitude;
          if (lat === undefined || lng === undefined) {
            throw new Error('Objects must have lat/lng or latitude/longitude properties');
          }
          vertices.push({ lat, lng });
        } else {
          throw new Error('Coordinates must be arrays or objects');
        }
      }
      
      if (vertices.length < 3) {
        throw new Error('Polygon must have at least 3 vertices');
      }
      
      return vertices;
    } catch (err: any) {
      if (err instanceof SyntaxError) {
        throw new Error('Invalid JSON syntax');
      }
      throw new Error(`JSON Parse Error: ${err.message}`);
    }
  };

  // Calculate area from vertices
  const calculateArea = (vertices: ParsedVertex[]): number => {
    const midLat = vertices.reduce((s, v) => s + v.lat, 0) / vertices.length;
    const metersPerDegLat = 111320;
    const metersPerDegLng = 111320 * Math.cos(midLat * Math.PI / 180);
    
    let sum = 0;
    for (let i = 0; i < vertices.length; i++) {
      const j = (i + 1) % vertices.length;
      const x1 = vertices[i].lng * metersPerDegLng;
      const y1 = vertices[i].lat * metersPerDegLat;
      const x2 = vertices[j].lng * metersPerDegLng;
      const y2 = vertices[j].lat * metersPerDegLat;
      sum += (x1 * y2 - x2 * y1);
    }
    
    const areaM2 = Math.abs(sum) / 2;
    return areaM2 * 10.764; // Convert to sqft
  };

  const handleParse = () => {
    setParseError(null);
    setParsedVertices(null);
    setCalculatedArea(null);
    
    try {
      let vertices: ParsedVertex[] | null = null;
      
      if (activeTab === 'wkt') {
        if (!wktInput.trim()) {
          setParseError('Please enter WKT polygon data');
          return;
        }
        vertices = parseWKT(wktInput);
      } else {
        if (!jsonInput.trim()) {
          setParseError('Please enter JSON coordinate data');
          return;
        }
        vertices = parseJSON(jsonInput);
      }
      
      if (vertices) {
        setParsedVertices(vertices);
        const area = calculateArea(vertices);
        setCalculatedArea(area);
      }
    } catch (err: any) {
      setParseError(err.message);
    }
  };

  const handleSave = async () => {
    if (!parsedVertices || parsedVertices.length < 3) {
      toast.error('Please parse valid footprint data first');
      return;
    }
    
    setIsProcessing(true);
    
    try {
      const { data, error } = await supabase.functions.invoke('save-manual-footprint', {
        body: {
          measurementId,
          vertices: parsedVertices,
          source: activeTab === 'wkt' ? 'wkt_import' : 'manual_import',
          manualReferenceArea: manualReferenceArea ? parseFloat(manualReferenceArea) : undefined,
        }
      });
      
      if (error) {
        throw new Error(error.message);
      }
      
      if (!data?.success) {
        throw new Error(data?.error || 'Failed to save footprint');
      }
      
      toast.success('Manual footprint saved successfully!', {
        description: `${data.data.vertexCount} vertices, ${data.data.areaSqft.toFixed(0)} sqft`
      });
      
      onSave({
        areaSqft: data.data.areaSqft,
        perimeterFt: data.data.perimeterFt,
        vertexCount: data.data.vertexCount,
        source: data.data.source,
      });
      
      handleClose();
      
    } catch (err: any) {
      console.error('Failed to save footprint:', err);
      toast.error('Failed to save footprint', { description: err.message });
    } finally {
      setIsProcessing(false);
    }
  };

  const areaVariance = currentAreaSqft && calculatedArea 
    ? ((calculatedArea - currentAreaSqft) / currentAreaSqft * 100)
    : null;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MapPin className="h-5 w-5" />
            Import Manual Footprint
          </DialogTitle>
          <DialogDescription>
            Import a verified footprint to override the AI-detected perimeter. 
            This will recalculate all measurements based on the correct boundary.
          </DialogDescription>
        </DialogHeader>
        
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="wkt" className="flex items-center gap-1">
              <FileText className="h-4 w-4" />
              WKT Polygon
            </TabsTrigger>
            <TabsTrigger value="json" className="flex items-center gap-1">
              <Upload className="h-4 w-4" />
              JSON Coordinates
            </TabsTrigger>
          </TabsList>
          
          <TabsContent value="wkt" className="space-y-3 mt-3">
            <div className="space-y-2">
              <Label>WKT Polygon Data</Label>
              <Textarea
                placeholder="POLYGON((-82.5893 27.4875, -82.5891 27.4875, -82.5891 27.4873, -82.5893 27.4873, -82.5893 27.4875))"
                value={wktInput}
                onChange={(e) => setWktInput(e.target.value)}
                rows={4}
                className="font-mono text-xs"
              />
              <p className="text-xs text-muted-foreground">
                Format: POLYGON((lng lat, lng lat, ...)) - coordinates in WGS84
              </p>
            </div>
          </TabsContent>
          
          <TabsContent value="json" className="space-y-3 mt-3">
            <div className="space-y-2">
              <Label>JSON Coordinates</Label>
              <Textarea
                placeholder='[{"lat": 27.4875, "lng": -82.5893}, {"lat": 27.4875, "lng": -82.5891}, ...]'
                value={jsonInput}
                onChange={(e) => setJsonInput(e.target.value)}
                rows={4}
                className="font-mono text-xs"
              />
              <p className="text-xs text-muted-foreground">
                Accepts: [{"{lat, lng}"}] objects or [[lng, lat]] GeoJSON arrays
              </p>
            </div>
          </TabsContent>
        </Tabs>
        
        <div className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="manualArea">Manual Reference Area (optional)</Label>
            <div className="flex items-center gap-2">
              <Input
                id="manualArea"
                type="number"
                placeholder="e.g., 3005"
                value={manualReferenceArea}
                onChange={(e) => setManualReferenceArea(e.target.value)}
                className="w-32"
              />
              <span className="text-sm text-muted-foreground">sq ft</span>
            </div>
            <p className="text-xs text-muted-foreground">
              Enter the known flat area for accuracy comparison
            </p>
          </div>
          
          <Button 
            variant="outline" 
            onClick={handleParse}
            className="w-full"
          >
            Validate & Preview
          </Button>
          
          {parseError && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>{parseError}</AlertDescription>
            </Alert>
          )}
          
          {parsedVertices && calculatedArea && (
            <Alert>
              <CheckCircle className="h-4 w-4 text-green-600" />
              <AlertDescription className="space-y-2">
                <div className="flex flex-wrap gap-2 mt-1">
                  <Badge variant="outline">
                    {parsedVertices.length} vertices
                  </Badge>
                  <Badge variant="outline">
                    {calculatedArea.toFixed(0)} sqft
                  </Badge>
                  {areaVariance !== null && (
                    <Badge 
                      variant={Math.abs(areaVariance) > 10 ? "destructive" : "secondary"}
                    >
                      {areaVariance > 0 ? '+' : ''}{areaVariance.toFixed(1)}% vs AI
                    </Badge>
                  )}
                </div>
              </AlertDescription>
            </Alert>
          )}
        </div>
        
        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            Cancel
          </Button>
          <Button 
            onClick={handleSave}
            disabled={!parsedVertices || isProcessing}
          >
            {isProcessing ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : null}
            Save Footprint
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
