import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Trash2, Lock, Unlock, Link2 } from 'lucide-react';
import type { PdfEngineObject, PdfEngineOperationType } from '@/lib/pdf-engine/engineTypes';

interface PdfObjectPropertiesPanelProps {
  selectedObject: PdfEngineObject | null;
  onPushOperation: (type: PdfEngineOperationType, payload: Record<string, unknown>, targetObjectId?: string) => void;
}

export function PdfObjectPropertiesPanel({ selectedObject, onPushOperation }: PdfObjectPropertiesPanelProps) {
  const [x, setX] = useState(0);
  const [y, setY] = useState(0);
  const [width, setWidth] = useState(0);
  const [height, setHeight] = useState(0);
  const [fontSize, setFontSize] = useState(12);
  const [fontFamily, setFontFamily] = useState('Helvetica');
  const [zIndex, setZIndex] = useState(0);
  const [isLocked, setIsLocked] = useState(false);

  useEffect(() => {
    if (!selectedObject) return;
    setX(Math.round(selectedObject.bounds.x));
    setY(Math.round(selectedObject.bounds.y));
    setWidth(Math.round(selectedObject.bounds.width));
    setHeight(Math.round(selectedObject.bounds.height));
    const fi = selectedObject.font_info as any;
    setFontSize(fi?.fontSize || 12);
    setFontFamily(fi?.fontFamily || 'Helvetica');
    setZIndex(selectedObject.z_index || 0);
    setIsLocked(!(selectedObject.is_editable ?? true));
  }, [selectedObject?.id]);

  if (!selectedObject) {
    return (
      <div className="p-4 text-center text-muted-foreground text-sm">
        Select an object to edit properties
      </div>
    );
  }

  const commitMove = () => {
    if (x !== Math.round(selectedObject.bounds.x) || y !== Math.round(selectedObject.bounds.y)) {
      onPushOperation('move_object', { x, y }, selectedObject.id);
    }
  };

  const commitResize = () => {
    onPushOperation('move_object', { x, y, width, height }, selectedObject.id);
  };

  const commitStyle = (updates: Record<string, unknown>) => {
    onPushOperation('replace_text', { style_update: updates }, selectedObject.id);
  };

  const handleDelete = () => {
    onPushOperation('delete_object', {}, selectedObject.id);
  };

  const handleToggleLock = () => {
    const newLocked = !isLocked;
    setIsLocked(newLocked);
    onPushOperation('move_object', { locked: newLocked }, selectedObject.id);
  };

  return (
    <div className="space-y-2 p-2">
      <Card>
        <CardHeader className="py-2 px-3">
          <CardTitle className="text-xs flex items-center gap-2">
            Properties
            <Badge variant="outline" className="text-[10px]">{selectedObject.object_type}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="px-3 pb-3 space-y-3">
          {/* Position */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-[10px]">X</Label>
              <Input type="number" value={x} onChange={e => setX(+e.target.value)} onBlur={commitMove} className="h-7 text-xs" />
            </div>
            <div>
              <Label className="text-[10px]">Y</Label>
              <Input type="number" value={y} onChange={e => setY(+e.target.value)} onBlur={commitMove} className="h-7 text-xs" />
            </div>
          </div>

          {/* Size */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-[10px]">Width</Label>
              <Input type="number" value={width} onChange={e => setWidth(+e.target.value)} onBlur={commitResize} className="h-7 text-xs" />
            </div>
            <div>
              <Label className="text-[10px]">Height</Label>
              <Input type="number" value={height} onChange={e => setHeight(+e.target.value)} onBlur={commitResize} className="h-7 text-xs" />
            </div>
          </div>

          {/* Font (text objects only) */}
          {selectedObject.object_type === 'text' && (
            <>
              <div>
                <Label className="text-[10px]">Font Family</Label>
                <Select value={fontFamily} onValueChange={v => { setFontFamily(v); commitStyle({ fontFamily: v }); }}>
                  <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Helvetica">Helvetica</SelectItem>
                    <SelectItem value="Times-Roman">Times Roman</SelectItem>
                    <SelectItem value="Courier">Courier</SelectItem>
                    <SelectItem value="Arial">Arial</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-[10px]">Font Size: {fontSize}px</Label>
                <Slider value={[fontSize]} min={6} max={72} step={1} onValueChange={([v]) => { setFontSize(v); }} onValueCommit={([v]) => commitStyle({ fontSize: v })} />
              </div>
            </>
          )}

          {/* Z-Index */}
          <div>
            <Label className="text-[10px]">Z-Index: {zIndex}</Label>
            <Slider value={[zIndex]} min={0} max={999} step={1} onValueChange={([v]) => setZIndex(v)} onValueCommit={([v]) => commitStyle({ z_index: v })} />
          </div>

          {/* Actions */}
          <div className="flex gap-1 pt-2 border-t">
            <Button variant="outline" size="sm" className="h-7 text-xs flex-1" onClick={handleToggleLock}>
              {isLocked ? <Lock className="h-3 w-3 mr-1" /> : <Unlock className="h-3 w-3 mr-1" />}
              {isLocked ? 'Unlock' : 'Lock'}
            </Button>
            <Button variant="destructive" size="sm" className="h-7 text-xs" onClick={handleDelete}>
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
