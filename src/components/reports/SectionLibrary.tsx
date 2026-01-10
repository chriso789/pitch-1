import React from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { 
  FileText, 
  Image, 
  Calculator, 
  BookOpen, 
  PenTool,
  Ruler,
  ChevronDown,
  ChevronRight
} from 'lucide-react';
import type { ReportSection } from '@/pages/reports/ReportBuilderPage';

interface SectionLibraryProps {
  sections: ReportSection[];
  documents: any[];
  estimates: any[];
  onToggle: (sectionId: string, enabled: boolean) => void;
  onConfigChange: (sectionId: string, config: Partial<ReportSection>) => void;
}

const sectionIcons: Record<string, any> = {
  cover: FileText,
  measurements: Ruler,
  photos: Image,
  estimate: Calculator,
  marketing: BookOpen,
  signature: PenTool,
};

const sectionDescriptions: Record<string, string> = {
  cover: 'Company branding, property address, client name',
  measurements: 'Attach Roofr, EagleView, or other measurement PDFs',
  photos: 'Include property and damage photos',
  estimate: 'Add one or more estimates (Good/Better/Best)',
  marketing: 'Company info, warranties, certifications',
  signature: 'Electronic signature and acceptance page',
};

export function SectionLibrary({ 
  sections, 
  documents, 
  estimates, 
  onToggle, 
  onConfigChange 
}: SectionLibraryProps) {
  const [expandedSections, setExpandedSections] = React.useState<Set<string>>(new Set());

  const toggleExpand = (sectionId: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(sectionId)) {
        next.delete(sectionId);
      } else {
        next.add(sectionId);
      }
      return next;
    });
  };

  const measurementDocs = documents.filter(d => 
    d.document_type === 'measurement_report' || 
    d.document_type === 'roof_report' ||
    d.file_name?.toLowerCase().includes('measurement')
  );

  return (
    <div className="space-y-2">
      {sections.map((section) => {
        const Icon = sectionIcons[section.type] || FileText;
        const isExpanded = expandedSections.has(section.id);
        const hasSubOptions = section.type === 'measurements' || section.type === 'estimate';

        return (
          <div key={section.id} className="rounded-lg border bg-card">
            <div className="flex items-center gap-3 p-3">
              <Checkbox
                id={section.id}
                checked={section.enabled}
                onCheckedChange={(checked) => onToggle(section.id, checked === true)}
              />
              <Icon className="h-4 w-4 text-muted-foreground" />
              <div className="flex-1 min-w-0">
                <Label htmlFor={section.id} className="font-medium cursor-pointer">
                  {section.label}
                </Label>
                <p className="text-xs text-muted-foreground truncate">
                  {sectionDescriptions[section.type]}
                </p>
              </div>
              {hasSubOptions && section.enabled && (
                <button 
                  onClick={() => toggleExpand(section.id)}
                  className="p-1 hover:bg-muted rounded"
                >
                  {isExpanded ? (
                    <ChevronDown className="h-4 w-4" />
                  ) : (
                    <ChevronRight className="h-4 w-4" />
                  )}
                </button>
              )}
            </div>

            {/* Measurements sub-options */}
            {section.type === 'measurements' && section.enabled && isExpanded && (
              <div className="px-3 pb-3 pt-0 border-t bg-muted/30">
                <div className="space-y-2 pt-2">
                  <Label className="text-xs">Select Measurement Reports</Label>
                  {measurementDocs.length > 0 ? (
                    <div className="space-y-1">
                      {measurementDocs.map((doc) => (
                        <div key={doc.id} className="flex items-center gap-2 text-sm">
                          <Checkbox 
                            id={`doc-${doc.id}`}
                            checked={section.config?.selectedDocs?.includes(doc.id)}
                            onCheckedChange={(checked) => {
                              const currentDocs = section.config?.selectedDocs || [];
                              const newDocs = checked 
                                ? [...currentDocs, doc.id]
                                : currentDocs.filter((id: string) => id !== doc.id);
                              onConfigChange(section.id, { 
                                config: { ...section.config, selectedDocs: newDocs }
                              });
                            }}
                          />
                          <Label htmlFor={`doc-${doc.id}`} className="text-xs cursor-pointer truncate">
                            {doc.file_name || doc.name || 'Measurement Report'}
                          </Label>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground italic">No measurement reports attached</p>
                  )}
                </div>
              </div>
            )}

            {/* Estimate sub-options */}
            {section.type === 'estimate' && section.enabled && isExpanded && (
              <div className="px-3 pb-3 pt-0 border-t bg-muted/30">
                <div className="space-y-2 pt-2">
                  <Label className="text-xs">Select Estimates</Label>
                  {estimates.length > 0 ? (
                    <div className="space-y-1">
                      {estimates.map((est) => (
                        <div key={est.id} className="flex items-center gap-2 text-sm">
                          <Checkbox 
                            id={`est-${est.id}`}
                            checked={section.config?.selectedEstimates?.includes(est.id)}
                            onCheckedChange={(checked) => {
                              const currentEsts = section.config?.selectedEstimates || [];
                              const newEsts = checked 
                                ? [...currentEsts, est.id]
                                : currentEsts.filter((id: string) => id !== est.id);
                              onConfigChange(section.id, { 
                                config: { ...section.config, selectedEstimates: newEsts },
                                pageCount: newEsts.length * 2 // Rough estimate
                              });
                            }}
                          />
                          <Label htmlFor={`est-${est.id}`} className="text-xs cursor-pointer flex-1 truncate">
                            {est.name || `Estimate #${est.estimate_number}`}
                          </Label>
                          <Badge variant="secondary" className="text-xs">
                            ${est.total?.toLocaleString() || '0'}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground italic">No estimates created yet</p>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
