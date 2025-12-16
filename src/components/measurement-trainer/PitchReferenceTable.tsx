import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Calculator, Plus, Trash2 } from 'lucide-react';
import { PITCH_REFERENCE_TABLE, parsePitch, PitchInfo } from '@/lib/measurements/roofWorksheetCalculations';

interface PitchReferenceTableProps {
  customPitches: PitchInfo[];
  onAddPitch: (pitch: PitchInfo) => void;
  onRemovePitch: (index: number) => void;
}

export const PitchReferenceTable: React.FC<PitchReferenceTableProps> = ({
  customPitches,
  onAddPitch,
  onRemovePitch,
}) => {
  const [newPitch, setNewPitch] = useState('');
  
  const handleAddPitch = () => {
    if (newPitch.trim()) {
      const pitchInfo = parsePitch(newPitch.trim());
      if (pitchInfo.pitch !== 'flat' || newPitch.toLowerCase() === 'flat') {
        onAddPitch(pitchInfo);
        setNewPitch('');
      }
    }
  };
  
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Calculator className="h-5 w-5" />
          2. Pitch → Slope Factor Table
        </CardTitle>
        <CardDescription>
          <code className="text-xs bg-muted px-1 py-0.5 rounded">
            slope_factor = √(1 + (X/12)²) | surface_area = plan_area × slope_factor
          </code>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Standard Reference Table */}
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[100px]">Pitch (X/12)</TableHead>
                <TableHead className="w-[80px]">p = X/12</TableHead>
                <TableHead className="w-[100px]">Slope Factor</TableHead>
                <TableHead className="w-[80px]">Degrees</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {PITCH_REFERENCE_TABLE.map((pitch) => (
                <TableRow key={pitch.pitch}>
                  <TableCell className="font-mono">{pitch.pitch}</TableCell>
                  <TableCell className="font-mono text-muted-foreground">{pitch.pDecimal.toFixed(4)}</TableCell>
                  <TableCell className="font-mono font-semibold">{pitch.slopeFactor.toFixed(4)}</TableCell>
                  <TableCell className="font-mono text-muted-foreground">{pitch.degrees.toFixed(2)}°</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        
        {/* Custom Pitches */}
        {customPitches.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm font-medium">Custom Pitches for This Job:</p>
            <div className="flex flex-wrap gap-2">
              {customPitches.map((pitch, idx) => (
                <Badge key={idx} variant="secondary" className="flex items-center gap-2 py-1">
                  <span className="font-mono">{pitch.pitch}</span>
                  <span className="text-muted-foreground">→ {pitch.slopeFactor.toFixed(4)}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-4 w-4 p-0 hover:bg-destructive/20"
                    onClick={() => onRemovePitch(idx)}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </Badge>
              ))}
            </div>
          </div>
        )}
        
        {/* Add Custom Pitch */}
        <div className="flex gap-2 items-center">
          <Input
            placeholder="e.g., 5.5/12"
            value={newPitch}
            onChange={(e) => setNewPitch(e.target.value)}
            className="w-32"
            onKeyDown={(e) => e.key === 'Enter' && handleAddPitch()}
          />
          <Button variant="outline" size="sm" onClick={handleAddPitch}>
            <Plus className="h-4 w-4 mr-1" />
            Add Custom
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};
