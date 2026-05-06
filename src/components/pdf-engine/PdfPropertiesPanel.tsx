import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useState } from 'react';
import type { PdfEngineObject } from '@/lib/pdf-engine/engineTypes';

interface PdfPropertiesPanelProps {
  selectedObject: PdfEngineObject | null;
  onReplaceText?: (objectId: string, newText: string) => void;
  onDeleteObject?: (objectId: string) => void;
}

export function PdfPropertiesPanel({ selectedObject, onReplaceText, onDeleteObject }: PdfPropertiesPanelProps) {
  const [replaceText, setReplaceText] = useState('');

  if (!selectedObject) {
    return (
      <div className="p-4 text-center text-muted-foreground text-sm">
        Select an object to view its properties
      </div>
    );
  }

  const content = selectedObject.content as any;
  const fontInfo = selectedObject.font_info as any;

  return (
    <Card>
      <CardHeader className="py-2 px-3">
        <CardTitle className="text-sm flex items-center gap-2">
          Object Properties
          <Badge variant="outline" className="text-[10px]">{selectedObject.object_type}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="px-3 pb-3 space-y-2">
        <div className="grid grid-cols-2 gap-1 text-xs">
          <span className="text-muted-foreground">Key:</span>
          <span>{selectedObject.object_key}</span>
          <span className="text-muted-foreground">Position:</span>
          <span>{Math.round(selectedObject.bounds.x)}, {Math.round(selectedObject.bounds.y)}</span>
          <span className="text-muted-foreground">Size:</span>
          <span>{Math.round(selectedObject.bounds.width)} × {Math.round(selectedObject.bounds.height)}</span>
          {fontInfo?.fontFamily && (
            <>
              <span className="text-muted-foreground">Font:</span>
              <span>{fontInfo.fontFamily}</span>
            </>
          )}
          {fontInfo?.fontSize && (
            <>
              <span className="text-muted-foreground">Size:</span>
              <span>{fontInfo.fontSize}px</span>
            </>
          )}
        </div>

        {selectedObject.object_type === 'text' && content?.text && (
          <div className="space-y-1 pt-2 border-t">
            <p className="text-xs text-muted-foreground">Current text:</p>
            <p className="text-xs bg-muted p-1.5 rounded break-words">{content.text}</p>
            <Input
              placeholder="Replacement text..."
              value={replaceText}
              onChange={e => setReplaceText(e.target.value)}
              className="text-xs h-8"
            />
            <div className="flex gap-1">
              <Button
                size="sm"
                className="flex-1 h-7 text-xs"
                disabled={!replaceText}
                onClick={() => {
                  onReplaceText?.(selectedObject.id, replaceText);
                  setReplaceText('');
                }}
              >
                Replace
              </Button>
              <Button
                size="sm"
                variant="destructive"
                className="h-7 text-xs"
                onClick={() => onDeleteObject?.(selectedObject.id)}
              >
                Delete
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
