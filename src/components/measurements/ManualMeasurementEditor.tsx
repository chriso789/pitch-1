import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { X, Save, AlertCircle, Info } from 'lucide-react';
import { useState } from 'react';
import { ComprehensiveMeasurementOverlay } from './ComprehensiveMeasurementOverlay';
import { MeasurementSummaryPanel } from './MeasurementSummaryPanel';
import { toast } from 'sonner';

interface ManualMeasurementEditorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  satelliteImageUrl: string;
  initialMeasurement: any;
  initialTags: Record<string, any>;
  centerLat: number;
  centerLng: number;
  onSave: (measurement: any, tags: Record<string, any>) => Promise<void>;
}

export function ManualMeasurementEditor({
  open,
  onOpenChange,
  satelliteImageUrl,
  initialMeasurement,
  initialTags,
  centerLat,
  centerLng,
  onSave,
}: ManualMeasurementEditorProps) {
  const [currentMeasurement, setCurrentMeasurement] = useState(initialMeasurement);
  const [currentTags, setCurrentTags] = useState(initialTags);
  const [isSaving, setIsSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  const handleMeasurementUpdate = (updatedMeasurement: any, updatedTags: Record<string, any>) => {
    setCurrentMeasurement(updatedMeasurement);
    setCurrentTags(updatedTags);
    setHasChanges(true);
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await onSave(currentMeasurement, currentTags);
      toast.success('Measurements verified and saved');
      setHasChanges(false);
      onOpenChange(false);
    } catch (error) {
      toast.error('Failed to save measurements');
      console.error('Save error:', error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleClose = () => {
    if (hasChanges) {
      const confirmed = window.confirm(
        'You have unsaved changes. Are you sure you want to close?'
      );
      if (!confirmed) return;
    }
    onOpenChange(false);
  };

  // Calculate confidence based on available data
  const getConfidence = () => {
    const ridge = currentTags['lf.ridge'] || 0;
    const hip = currentTags['lf.hip'] || 0;
    const valley = currentTags['lf.valley'] || 0;
    const eave = currentTags['lf.eave'] || 0;
    const rake = currentTags['lf.rake'] || 0;
    const faces = currentMeasurement?.faces?.length || 0;

    let score = 0;
    if (faces > 0) score += 2;
    if (ridge > 0 || hip > 0) score += 1;
    if (eave > 0 || rake > 0) score += 1;
    if (valley > 0 || (ridge === 0 && hip === 0)) score += 1; // Valley or simple roof

    return {
      score: Math.min(5, score),
      label: score >= 4 ? 'High' : score >= 3 ? 'Medium' : 'Low'
    };
  };

  const confidence = getConfidence();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] max-h-[95vh] p-0 gap-0">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b bg-muted/30">
          <div>
            <h2 className="text-lg font-semibold">Manual Measurement Verification</h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              Draw and edit roof features to improve measurement accuracy
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Confidence:</span>
              <Badge variant={confidence.score >= 4 ? 'default' : confidence.score >= 3 ? 'secondary' : 'destructive'}>
                {confidence.label}
              </Badge>
              <div className="flex items-center gap-1 ml-1">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div
                    key={i}
                    className={`h-2 w-2 rounded-full ${
                      i < confidence.score ? 'bg-primary' : 'bg-muted'
                    }`}
                  />
                ))}
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={handleClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Main Content Area */}
        <div className="flex h-[calc(95vh-140px)] overflow-hidden">
          {/* Left: Map Editor */}
          <div className="flex-1 p-4 overflow-auto">
            <ComprehensiveMeasurementOverlay
              satelliteImageUrl={satelliteImageUrl}
              measurement={currentMeasurement}
              tags={currentTags}
              centerLng={centerLng}
              centerLat={centerLat}
              zoom={20}
              onMeasurementUpdate={handleMeasurementUpdate}
              canvasWidth={900}
              canvasHeight={700}
            />

            {/* Instructions */}
            <Card className="mt-4 p-4 bg-info/5 border-info/20">
              <div className="flex items-start gap-2">
                <Info className="h-4 w-4 text-info mt-0.5" />
                <div className="space-y-2 text-sm">
                  <p className="font-medium">How to use the editor:</p>
                  <ul className="list-disc list-inside space-y-1 text-muted-foreground ml-2">
                    <li>Use the toolbar above the map to select drawing modes</li>
                    <li><strong>Add Ridge/Hip/Valley:</strong> Click two points to draw a line</li>
                    <li><strong>Add Facet:</strong> Click multiple points to draw a polygon, then click the first point to close</li>
                    <li><strong>Delete:</strong> Click "Delete" mode, then click on any feature to remove it</li>
                    <li>Toggle layers on/off to focus on specific measurements</li>
                    <li>Measurements update in real-time in the right panel</li>
                  </ul>
                </div>
              </div>
            </Card>
          </div>

          {/* Right: Measurement Summary */}
          <div className="w-[380px] border-l bg-muted/20 overflow-auto">
            <MeasurementSummaryPanel
              measurement={currentMeasurement}
              tags={currentTags}
              confidence={confidence}
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t bg-muted/30">
          <div className="flex items-center gap-2">
            {hasChanges && (
              <Badge variant="outline" className="text-warning border-warning">
                <AlertCircle className="h-3 w-3 mr-1" />
                Unsaved Changes
              </Badge>
            )}
            {confidence.score < 3 && (
              <span className="text-sm text-muted-foreground">
                Add missing features to improve confidence
              </span>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={handleClose} disabled={isSaving}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={isSaving}>
              <Save className="h-4 w-4 mr-2" />
              {isSaving ? 'Saving...' : 'Save Verified Measurements'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
