import { useMemo } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Copy, MapPin, Ruler } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

interface EdgeData {
  id: string;
  type: 'eave' | 'rake' | 'ridge' | 'hip' | 'valley';
  length: number;
  gpsStart?: { lat: number; lng: number };
  gpsEnd?: { lat: number; lng: number };
}

interface EdgeVerificationPanelProps {
  eaveSegments: Array<{
    start: { x: number; y: number };
    end: { x: number; y: number };
    length: number;
    gpsStart?: { lat: number; lng: number };
    gpsEnd?: { lat: number; lng: number };
  }>;
  rakeSegments: Array<{
    start: { x: number; y: number };
    end: { x: number; y: number };
    length: number;
    gpsStart?: { lat: number; lng: number };
    gpsEnd?: { lat: number; lng: number };
  }>;
  perimeterLength: number;
  flatArea: number;
  adjustedArea: number;
  pitch: string;
}

const FEATURE_COLORS = {
  eave: '#006400',
  rake: '#17A2B8',
  ridge: '#90EE90',
  hip: '#9B59B6',
  valley: '#DC3545',
};

export function EdgeVerificationPanel({
  eaveSegments,
  rakeSegments,
  perimeterLength,
  flatArea,
  adjustedArea,
  pitch,
}: EdgeVerificationPanelProps) {
  // Build edge list with IDs
  const edges = useMemo(() => {
    const allEdges: EdgeData[] = [];
    
    eaveSegments.forEach((seg, i) => {
      allEdges.push({
        id: `E${i + 1}`,
        type: 'eave',
        length: seg.length || 0,
        gpsStart: seg.gpsStart,
        gpsEnd: seg.gpsEnd,
      });
    });
    
    rakeSegments.forEach((seg, i) => {
      allEdges.push({
        id: `R${i + 1}`,
        type: 'rake',
        length: seg.length || 0,
        gpsStart: seg.gpsStart,
        gpsEnd: seg.gpsEnd,
      });
    });
    
    return allEdges;
  }, [eaveSegments, rakeSegments]);

  // Calculate totals
  const totals = useMemo(() => {
    const eaveTotal = edges.filter(e => e.type === 'eave').reduce((sum, e) => sum + e.length, 0);
    const rakeTotal = edges.filter(e => e.type === 'rake').reduce((sum, e) => sum + e.length, 0);
    return {
      eave: eaveTotal,
      rake: rakeTotal,
      combined: eaveTotal + rakeTotal,
    };
  }, [edges]);

  // Copy GPS coordinates to clipboard
  const copyGPS = (edge: EdgeData) => {
    if (!edge.gpsStart || !edge.gpsEnd) {
      toast.error('GPS coordinates not available');
      return;
    }
    const text = `${edge.id}: (${edge.gpsStart.lat.toFixed(6)}, ${edge.gpsStart.lng.toFixed(6)}) → (${edge.gpsEnd.lat.toFixed(6)}, ${edge.gpsEnd.lng.toFixed(6)})`;
    navigator.clipboard.writeText(text);
    toast.success('GPS coordinates copied');
  };

  // Copy all edges as CSV
  const copyAllAsCSV = () => {
    const header = 'Edge ID,Type,Length (ft),Start Lat,Start Lng,End Lat,End Lng';
    const rows = edges.map(e => {
      const startLat = e.gpsStart?.lat?.toFixed(6) || '';
      const startLng = e.gpsStart?.lng?.toFixed(6) || '';
      const endLat = e.gpsEnd?.lat?.toFixed(6) || '';
      const endLng = e.gpsEnd?.lng?.toFixed(6) || '';
      return `${e.id},${e.type},${e.length.toFixed(1)},${startLat},${startLng},${endLat},${endLng}`;
    });
    const csv = [header, ...rows].join('\n');
    navigator.clipboard.writeText(csv);
    toast.success('Edge data copied as CSV');
  };

  // Calculate pitch multiplier
  const pitchParts = pitch.split('/');
  const pitchNum = parseFloat(pitchParts[0]) || 6;
  const pitchMultiplier = Math.sqrt(1 + (pitchNum / 12) ** 2);

  return (
    <Card className="mt-4">
      <CardHeader className="py-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Ruler className="h-4 w-4" />
            Edge Verification Table
          </CardTitle>
          <Button variant="outline" size="sm" onClick={copyAllAsCSV} className="h-7 text-xs">
            <Copy className="h-3 w-3 mr-1" />
            Copy CSV
          </Button>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {/* Summary Row */}
        <div className="grid grid-cols-4 gap-3 mb-4 p-3 bg-muted/50 rounded-lg text-sm">
          <div>
            <div className="text-muted-foreground text-xs">Perimeter</div>
            <div className="font-semibold">{perimeterLength.toFixed(1)} LF</div>
          </div>
          <div>
            <div className="text-muted-foreground text-xs">Eaves Total</div>
            <div className="font-semibold" style={{ color: FEATURE_COLORS.eave }}>{totals.eave.toFixed(1)}'</div>
          </div>
          <div>
            <div className="text-muted-foreground text-xs">Rakes Total</div>
            <div className="font-semibold" style={{ color: FEATURE_COLORS.rake }}>{totals.rake.toFixed(1)}'</div>
          </div>
          <div>
            <div className="text-muted-foreground text-xs">E+R Combined</div>
            <div className="font-semibold">{totals.combined.toFixed(1)}'</div>
          </div>
        </div>

        {/* Area Calculation */}
        <div className="grid grid-cols-3 gap-3 mb-4 p-3 bg-blue-50 dark:bg-blue-950/30 rounded-lg text-sm">
          <div>
            <div className="text-muted-foreground text-xs">Flat Area</div>
            <div className="font-bold text-lg">{flatArea.toFixed(0)} sq ft</div>
          </div>
          <div className="flex items-center justify-center">
            <div className="text-center">
              <div className="text-muted-foreground text-xs">× Pitch Factor</div>
              <div className="font-semibold">{pitchMultiplier.toFixed(3)} ({pitch})</div>
            </div>
          </div>
          <div>
            <div className="text-muted-foreground text-xs">Adjusted Area</div>
            <div className="font-bold text-lg text-primary">{adjustedArea.toFixed(0)} sq ft</div>
          </div>
        </div>

        {/* Edge Table */}
        <div className="border rounded-lg overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30">
                <TableHead className="w-16 font-semibold">ID</TableHead>
                <TableHead className="w-20 font-semibold">Type</TableHead>
                <TableHead className="w-24 font-semibold text-right">Length</TableHead>
                <TableHead className="font-semibold">GPS Coordinates</TableHead>
                <TableHead className="w-12"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {edges.map((edge) => (
                <TableRow key={edge.id} className="text-sm">
                  <TableCell className="font-mono font-bold" style={{ color: FEATURE_COLORS[edge.type] }}>
                    {edge.id}
                  </TableCell>
                  <TableCell>
                    <Badge 
                      variant="outline" 
                      className="text-xs capitalize"
                      style={{ 
                        borderColor: FEATURE_COLORS[edge.type],
                        color: FEATURE_COLORS[edge.type],
                      }}
                    >
                      {edge.type}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right font-mono font-semibold">
                    {edge.length.toFixed(1)}'
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {edge.gpsStart && edge.gpsEnd ? (
                      <span>
                        ({edge.gpsStart.lat.toFixed(5)}, {edge.gpsStart.lng.toFixed(5)}) → 
                        ({edge.gpsEnd.lat.toFixed(5)}, {edge.gpsEnd.lng.toFixed(5)})
                      </span>
                    ) : (
                      <span className="text-amber-600">Not available</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {edge.gpsStart && edge.gpsEnd && (
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="h-6 w-6"
                        onClick={() => copyGPS(edge)}
                      >
                        <Copy className="h-3 w-3" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              
              {/* Totals Row */}
              <TableRow className="bg-muted/30 font-semibold">
                <TableCell colSpan={2}>TOTALS</TableCell>
                <TableCell className="text-right font-mono">
                  {totals.combined.toFixed(1)}'
                </TableCell>
                <TableCell colSpan={2} className="text-muted-foreground text-xs">
                  {edges.filter(e => e.type === 'eave').length} eaves + {edges.filter(e => e.type === 'rake').length} rakes
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>

        {/* Coverage Analysis */}
        <div className="mt-3 text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <MapPin className="h-3 w-3" />
            <span>
              Edge coverage: {perimeterLength > 0 ? ((totals.combined / perimeterLength) * 100).toFixed(0) : 0}% of perimeter
            </span>
            {perimeterLength > 0 && Math.abs(totals.combined - perimeterLength) > 5 && (
              <Badge variant="outline" className="text-amber-600 border-amber-300 text-xs">
                Δ {Math.abs(totals.combined - perimeterLength).toFixed(1)}' difference
              </Badge>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
