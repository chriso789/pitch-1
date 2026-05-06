import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useState } from 'react';
import { Wand2, Trash2, Replace, Loader2 } from 'lucide-react';
import type { PdfEngineObject } from '@/lib/pdf-engine/engineTypes';
import type { RewriteMode } from '@/lib/pdf-engine/PdfAiRewriter';

interface PdfPropertiesPanelProps {
  selectedObject: PdfEngineObject | null;
  onReplaceText?: (objectId: string, newText: string) => void;
  onDeleteObject?: (objectId: string) => void;
  onAiRewrite?: (objectId: string, mode: RewriteMode, customInstruction?: string) => Promise<void>;
}

export function PdfPropertiesPanel({
  selectedObject, onReplaceText, onDeleteObject, onAiRewrite,
}: PdfPropertiesPanelProps) {
  const [replaceText, setReplaceText] = useState('');
  const [rewriteMode, setRewriteMode] = useState<RewriteMode>('professional');
  const [customInstruction, setCustomInstruction] = useState('');
  const [isRewriting, setIsRewriting] = useState(false);

  if (!selectedObject) {
    return (
      <div className="p-4 text-center text-muted-foreground text-sm">
        Select an object to view its properties
      </div>
    );
  }

  const content = selectedObject.content as any;
  const fontInfo = selectedObject.font_info as any;
  const isOcr = (selectedObject.metadata as any)?.ocr === true;

  const handleAiRewrite = async () => {
    if (!onAiRewrite) return;
    setIsRewriting(true);
    try {
      await onAiRewrite(
        selectedObject.id,
        rewriteMode,
        rewriteMode === 'custom' ? customInstruction : undefined
      );
    } finally {
      setIsRewriting(false);
    }
  };

  return (
    <div className="space-y-3">
      <Card>
        <CardHeader className="py-2 px-3">
          <CardTitle className="text-sm flex items-center gap-2">
            Object Properties
            <Badge variant="outline" className="text-[10px]">{selectedObject.object_type}</Badge>
            {isOcr && <Badge variant="secondary" className="text-[10px]">OCR</Badge>}
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
                <span className="truncate">{fontInfo.fontFamily}</span>
              </>
            )}
            {fontInfo?.fontSize && (
              <>
                <span className="text-muted-foreground">Size:</span>
                <span>{fontInfo.fontSize}px</span>
              </>
            )}
            {isOcr && (
              <>
                <span className="text-muted-foreground">Confidence:</span>
                <span>{Math.round((content as any)?.confidence || 0)}%</span>
              </>
            )}
          </div>

          {selectedObject.object_type === 'text' && content?.text && (
            <div className="space-y-1 pt-2 border-t">
              <p className="text-xs text-muted-foreground">Current text:</p>
              <p className="text-xs bg-muted p-1.5 rounded break-words max-h-20 overflow-auto">{content.text}</p>
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
                  <Replace className="h-3 w-3 mr-1" />Replace
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  className="h-7 text-xs"
                  onClick={() => onDeleteObject?.(selectedObject.id)}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* AI Rewrite Panel */}
      {selectedObject.object_type === 'text' && content?.text && onAiRewrite && (
        <Card>
          <CardHeader className="py-2 px-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Wand2 className="h-3.5 w-3.5" />AI Rewrite
            </CardTitle>
          </CardHeader>
          <CardContent className="px-3 pb-3 space-y-2">
            <Select value={rewriteMode} onValueChange={(v) => setRewriteMode(v as RewriteMode)}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="professional">Professional</SelectItem>
                <SelectItem value="concise">Concise</SelectItem>
                <SelectItem value="formal">Formal</SelectItem>
                <SelectItem value="friendly">Friendly</SelectItem>
                <SelectItem value="custom">Custom</SelectItem>
              </SelectContent>
            </Select>
            {rewriteMode === 'custom' && (
              <Textarea
                placeholder="Custom instruction..."
                value={customInstruction}
                onChange={e => setCustomInstruction(e.target.value)}
                className="text-xs min-h-[60px]"
              />
            )}
            <Button
              size="sm"
              className="w-full h-7 text-xs"
              onClick={handleAiRewrite}
              disabled={isRewriting}
            >
              {isRewriting ? (
                <><Loader2 className="h-3 w-3 mr-1 animate-spin" />Rewriting...</>
              ) : (
                <><Wand2 className="h-3 w-3 mr-1" />Rewrite with AI</>
              )}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
