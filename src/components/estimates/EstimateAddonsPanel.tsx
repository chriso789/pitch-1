import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { 
  FileText, 
  Image as ImageIcon, 
  ChevronDown, 
  ChevronRight,
  Ruler,
  Shield,
  ExternalLink,
  Check
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { type PDFComponentOptions } from './PDFComponentOptions';

interface Photo {
  id: string;
  file_url: string;
  category: string;
  description?: string;
  include_in_estimate: boolean;
}

interface EstimateAddonsPanelProps {
  pipelineEntryId: string;
  pdfOptions: PDFComponentOptions;
  onOptionsChange: (options: Partial<PDFComponentOptions>) => void;
  className?: string;
}

export const EstimateAddonsPanel: React.FC<EstimateAddonsPanelProps> = ({
  pipelineEntryId,
  pdfOptions,
  onOptionsChange,
  className
}) => {
  const [isOpen, setIsOpen] = useState(true);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loadingPhotos, setLoadingPhotos] = useState(false);

  useEffect(() => {
    if (pipelineEntryId) {
      fetchPhotos();
    }
  }, [pipelineEntryId]);

  const fetchPhotos = async () => {
    setLoadingPhotos(true);
    try {
      const { data, error } = await supabase
        .from('customer_photos')
        .select('id, file_url, category, description, include_in_estimate')
        .eq('lead_id', pipelineEntryId)
        .order('display_order');

      if (error) throw error;
      setPhotos(data || []);
    } catch (err) {
      console.error('Error fetching photos:', err);
    } finally {
      setLoadingPhotos(false);
    }
  };

  const togglePhotoInclude = async (photoId: string, currentValue: boolean) => {
    try {
      const { error } = await supabase
        .from('customer_photos')
        .update({ include_in_estimate: !currentValue })
        .eq('id', photoId);

      if (error) throw error;
      
      setPhotos(prev => 
        prev.map(p => p.id === photoId ? { ...p, include_in_estimate: !currentValue } : p)
      );
    } catch (err) {
      console.error('Error toggling photo:', err);
    }
  };

  const selectedPhotoCount = photos.filter(p => p.include_in_estimate).length;

  return (
    <Card className={cn("", className)}>
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors py-3">
            <CardTitle className="flex items-center justify-between text-sm font-medium">
              <span className="flex items-center gap-2">
                <FileText className="h-4 w-4" />
                Estimate Add-ons
              </span>
              {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </CardTitle>
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="space-y-4 pt-0">
            {/* Fine Print Toggle */}
            <div className="flex items-start gap-3 p-3 rounded-lg border bg-muted/30">
              <Checkbox
                id="fine-print"
                checked={pdfOptions.showCustomFinePrint}
                onCheckedChange={(checked) => onOptionsChange({ showCustomFinePrint: !!checked })}
              />
              <div className="flex-1">
                <Label htmlFor="fine-print" className="text-sm font-medium cursor-pointer">
                  Include Fine Print
                </Label>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Terms, conditions, and legal disclaimers
                </p>
                <Button
                  variant="link"
                  size="sm"
                  className="h-auto p-0 text-xs mt-1"
                  onClick={() => window.open('/settings?tab=estimate-pdf', '_blank')}
                >
                  Edit in Settings <ExternalLink className="h-3 w-3 ml-1" />
                </Button>
              </div>
            </div>

            {/* Photos Section */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium flex items-center gap-2">
                  <ImageIcon className="h-4 w-4" />
                  Job Photos
                </Label>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="show-photos"
                    checked={pdfOptions.showJobPhotos}
                    onCheckedChange={(checked) => onOptionsChange({ showJobPhotos: !!checked })}
                  />
                  {photos.length > 0 && (
                    <Badge variant="secondary" className="text-xs">
                      {selectedPhotoCount} of {photos.length}
                    </Badge>
                  )}
                </div>
              </div>
              
              {loadingPhotos ? (
                <p className="text-xs text-muted-foreground">Loading photos...</p>
              ) : photos.length === 0 ? (
                <p className="text-xs text-muted-foreground">No photos uploaded for this lead</p>
              ) : (
                <div className="grid grid-cols-3 gap-2">
                  {photos.slice(0, 9).map(photo => (
                    <button
                      key={photo.id}
                      onClick={() => togglePhotoInclude(photo.id, photo.include_in_estimate)}
                      className={cn(
                        "relative aspect-square rounded-md overflow-hidden border-2 transition-all",
                        photo.include_in_estimate 
                          ? "border-primary ring-2 ring-primary/20" 
                          : "border-transparent hover:border-muted-foreground/30"
                      )}
                    >
                      <img
                        src={photo.file_url}
                        alt={photo.description || 'Job photo'}
                        className="w-full h-full object-cover"
                      />
                      {photo.include_in_estimate && (
                        <div className="absolute inset-0 bg-primary/20 flex items-center justify-center">
                          <Check className="h-6 w-6 text-primary-foreground bg-primary rounded-full p-1" />
                        </div>
                      )}
                      <Badge 
                        variant="secondary" 
                        className="absolute bottom-0.5 left-0.5 text-[8px] px-1 py-0"
                      >
                        {photo.category}
                      </Badge>
                    </button>
                  ))}
                </div>
              )}
              {photos.length > 9 && (
                <p className="text-xs text-muted-foreground text-center">
                  +{photos.length - 9} more photos
                </p>
              )}
            </div>

            {/* Measurement Details Toggle */}
            <div className="flex items-start gap-3 p-3 rounded-lg border bg-muted/30">
              <Checkbox
                id="measurement-details"
                checked={pdfOptions.showMeasurementDetails}
                onCheckedChange={(checked) => onOptionsChange({ showMeasurementDetails: !!checked })}
              />
              <div className="flex-1">
                <Label htmlFor="measurement-details" className="text-sm font-medium cursor-pointer flex items-center gap-2">
                  <Ruler className="h-4 w-4" />
                  Measurement Details
                </Label>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Include roof measurements and specifications
                </p>
              </div>
            </div>

            {/* Warranty Info Toggle */}
            <div className="flex items-start gap-3 p-3 rounded-lg border bg-muted/30">
              <Checkbox
                id="warranty-info"
                checked={pdfOptions.showWarrantyInfo}
                onCheckedChange={(checked) => onOptionsChange({ showWarrantyInfo: !!checked })}
              />
              <div className="flex-1">
                <Label htmlFor="warranty-info" className="text-sm font-medium cursor-pointer flex items-center gap-2">
                  <Shield className="h-4 w-4" />
                  Warranty Information
                </Label>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Include warranty terms and coverage details
                </p>
              </div>
            </div>
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
};
