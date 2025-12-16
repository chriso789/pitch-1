import React from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Ruler, Plus, Trash2 } from 'lucide-react';
import { LinearSegment, LinearType, MeasurementType } from '@/lib/measurements/roofWorksheetCalculations';

interface LinearComponentsWorksheetProps {
  segments: LinearSegment[];
  onSegmentsChange: (segments: LinearSegment[]) => void;
}

const LINEAR_TYPES: { value: LinearType; label: string }[] = [
  { value: 'ridge', label: 'Ridge' },
  { value: 'hip', label: 'Hip' },
  { value: 'valley', label: 'Valley' },
  { value: 'eave', label: 'Eave' },
  { value: 'rake', label: 'Rake' },
  { value: 'step_flashing', label: 'Step Flashing' },
];

export const LinearComponentsWorksheet: React.FC<LinearComponentsWorksheetProps> = ({
  segments,
  onSegmentsChange,
}) => {
  const addSegment = (type: LinearType) => {
    const typeSegments = segments.filter(s => s.type === type);
    const prefix = type.charAt(0).toUpperCase();
    const newId = `${prefix}${typeSegments.length + 1}`;
    
    const newSegment: LinearSegment = {
      id: newId,
      type,
      lengthFt: 0,
      measurementType: 'true',
      notes: '',
    };
    onSegmentsChange([...segments, newSegment]);
  };
  
  const updateSegment = (index: number, updates: Partial<LinearSegment>) => {
    const updated = [...segments];
    updated[index] = { ...updated[index], ...updates };
    onSegmentsChange(updated);
  };
  
  const removeSegment = (index: number) => {
    onSegmentsChange(segments.filter((_, i) => i !== index));
  };
  
  // Calculate totals by type
  const totals = segments.reduce((acc, seg) => {
    acc[seg.type] = (acc[seg.type] || 0) + seg.lengthFt;
    return acc;
  }, {} as Record<string, number>);
  
  const perimeterTotal = (totals.eave || 0) + (totals.rake || 0);
  
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Ruler className="h-5 w-5" />
          4. Linear Components Worksheet
        </CardTitle>
        <CardDescription>
          Record each segment of ridges, hips, valleys, eaves, and rakes. Mark whether measured directly or derived.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Quick Add Buttons */}
        <div className="flex flex-wrap gap-2">
          {LINEAR_TYPES.map(type => (
            <Button
              key={type.value}
              variant="outline"
              size="sm"
              onClick={() => addSegment(type.value)}
            >
              <Plus className="h-3 w-3 mr-1" />
              {type.label}
            </Button>
          ))}
        </div>
        
        {/* Segments Table */}
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[100px]">Component</TableHead>
                <TableHead className="w-[80px]">Segment</TableHead>
                <TableHead className="w-[100px]">Length (ft)</TableHead>
                <TableHead className="w-[120px]">Type</TableHead>
                <TableHead>Notes</TableHead>
                <TableHead className="w-[40px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {segments.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                    No segments added. Click buttons above to add measurements.
                  </TableCell>
                </TableRow>
              ) : (
                segments.map((segment, idx) => (
                  <TableRow key={`${segment.type}-${segment.id}`}>
                    <TableCell className="font-medium capitalize">{segment.type.replace('_', ' ')}</TableCell>
                    <TableCell className="font-mono">{segment.id}</TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        className="w-20 h-8"
                        value={segment.lengthFt || ''}
                        onChange={(e) => updateSegment(idx, { lengthFt: parseFloat(e.target.value) || 0 })}
                      />
                    </TableCell>
                    <TableCell>
                      <Select
                        value={segment.measurementType}
                        onValueChange={(value: MeasurementType) => updateSegment(idx, { measurementType: value })}
                      >
                        <SelectTrigger className="w-[100px] h-8">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="true">True</SelectItem>
                          <SelectItem value="plan">Plan</SelectItem>
                          <SelectItem value="derived">Derived</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Input
                        placeholder="Notes..."
                        className="h-8"
                        value={segment.notes}
                        onChange={(e) => updateSegment(idx, { notes: e.target.value })}
                      />
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0"
                        onClick={() => removeSegment(idx)}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
        
        {/* Linear Totals */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 pt-4 border-t">
          <div className="bg-muted/50 rounded-lg p-2">
            <p className="text-[10px] text-muted-foreground uppercase">Ridge</p>
            <p className="text-lg font-bold font-mono">{(totals.ridge || 0).toFixed(0)} ft</p>
          </div>
          <div className="bg-muted/50 rounded-lg p-2">
            <p className="text-[10px] text-muted-foreground uppercase">Hip</p>
            <p className="text-lg font-bold font-mono">{(totals.hip || 0).toFixed(0)} ft</p>
          </div>
          <div className="bg-muted/50 rounded-lg p-2">
            <p className="text-[10px] text-muted-foreground uppercase">Valley</p>
            <p className="text-lg font-bold font-mono">{(totals.valley || 0).toFixed(0)} ft</p>
          </div>
          <div className="bg-muted/50 rounded-lg p-2">
            <p className="text-[10px] text-muted-foreground uppercase">Eave</p>
            <p className="text-lg font-bold font-mono">{(totals.eave || 0).toFixed(0)} ft</p>
          </div>
          <div className="bg-muted/50 rounded-lg p-2">
            <p className="text-[10px] text-muted-foreground uppercase">Rake</p>
            <p className="text-lg font-bold font-mono">{(totals.rake || 0).toFixed(0)} ft</p>
          </div>
          <div className="bg-primary/10 rounded-lg p-2">
            <p className="text-[10px] text-primary uppercase">Perimeter</p>
            <p className="text-lg font-bold font-mono text-primary">{perimeterTotal.toFixed(0)} ft</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
