import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { FileText, Ruler, Image, Calculator, BookOpen, PenTool, Building2 } from 'lucide-react';
import type { ReportSection } from '@/pages/reports/ReportBuilderPage';

interface LivePreviewProps {
  sections: ReportSection[];
  subjectData: any;
  title: string;
}

const sectionIcons: Record<string, any> = {
  cover: FileText,
  measurements: Ruler,
  photos: Image,
  estimate: Calculator,
  marketing: BookOpen,
  signature: PenTool,
};

export function LivePreview({ sections, subjectData, title }: LivePreviewProps) {
  const contact = subjectData?.contacts || subjectData;
  const address = subjectData?.address || contact?.address || '';
  const contactName = contact?.first_name 
    ? `${contact.first_name} ${contact.last_name || ''}`
    : 'Homeowner';

  if (sections.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        <div className="text-center">
          <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
          <p>Select sections to preview</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 max-w-2xl mx-auto">
      <div className="text-center mb-6">
        <Badge variant="outline" className="mb-2">Preview</Badge>
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="text-sm text-muted-foreground">
          {sections.length} sections • {sections.reduce((sum, s) => sum + (s.pageCount || 1), 0)} estimated pages
        </p>
      </div>

      {sections.map((section, index) => (
        <PreviewSection 
          key={section.id} 
          section={section} 
          index={index}
          contactName={contactName}
          address={address}
        />
      ))}
    </div>
  );
}

function PreviewSection({ 
  section, 
  index, 
  contactName, 
  address 
}: { 
  section: ReportSection; 
  index: number;
  contactName: string;
  address: string;
}) {
  const Icon = sectionIcons[section.type] || FileText;

  return (
    <Card className="overflow-hidden">
      <div className="bg-muted/50 px-4 py-2 flex items-center gap-2 border-b">
        <Badge variant="secondary" className="text-xs">{index + 1}</Badge>
        <Icon className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium">{section.label}</span>
        <span className="text-xs text-muted-foreground ml-auto">
          {section.pageCount || 1} page{(section.pageCount || 1) !== 1 ? 's' : ''}
        </span>
      </div>
      <CardContent className="p-4">
        {section.type === 'cover' && (
          <CoverPagePreview contactName={contactName} address={address} />
        )}
        {section.type === 'measurements' && (
          <MeasurementsPreview config={section.config} />
        )}
        {section.type === 'photos' && (
          <PhotosPreview />
        )}
        {section.type === 'estimate' && (
          <EstimatePreview config={section.config} />
        )}
        {section.type === 'marketing' && (
          <MarketingPreview />
        )}
        {section.type === 'signature' && (
          <SignaturePreview contactName={contactName} />
        )}
      </CardContent>
    </Card>
  );
}

function CoverPagePreview({ contactName, address }: { contactName: string; address: string }) {
  return (
    <div className="text-center space-y-4 py-6">
      <div className="w-20 h-20 mx-auto bg-primary/10 rounded-lg flex items-center justify-center">
        <Building2 className="h-10 w-10 text-primary" />
      </div>
      <div>
        <p className="text-xs text-muted-foreground uppercase tracking-wide">Company Name</p>
        <h3 className="text-xl font-bold mt-1">Your Roofing Report</h3>
      </div>
      <Separator className="my-4" />
      <div className="text-left space-y-2">
        <div>
          <p className="text-xs text-muted-foreground">Prepared For</p>
          <p className="font-medium">{contactName}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Property Address</p>
          <p className="font-medium">{address || '123 Main Street, City, ST 12345'}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Date</p>
          <p className="font-medium">{new Date().toLocaleDateString()}</p>
        </div>
      </div>
    </div>
  );
}

function MeasurementsPreview({ config }: { config?: Record<string, any> }) {
  const selectedCount = config?.selectedDocs?.length || 0;
  
  return (
    <div className="text-center py-8 bg-muted/30 rounded-lg">
      <Ruler className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
      <p className="text-sm text-muted-foreground">
        {selectedCount > 0 
          ? `${selectedCount} measurement report${selectedCount !== 1 ? 's' : ''} will be included`
          : 'No measurement reports selected'
        }
      </p>
      <p className="text-xs text-muted-foreground mt-1">
        PDFs will be merged with branded separator pages
      </p>
    </div>
  );
}

function PhotosPreview() {
  return (
    <div className="grid grid-cols-3 gap-2">
      {[1, 2, 3, 4, 5, 6].map((i) => (
        <div 
          key={i} 
          className="aspect-square bg-muted rounded-lg flex items-center justify-center"
        >
          <Image className="h-6 w-6 text-muted-foreground/50" />
        </div>
      ))}
    </div>
  );
}

function EstimatePreview({ config }: { config?: Record<string, any> }) {
  const selectedCount = config?.selectedEstimates?.length || 0;
  
  return (
    <div className="space-y-3">
      <div className="flex justify-between text-sm">
        <span className="text-muted-foreground">Materials</span>
        <span>$X,XXX.XX</span>
      </div>
      <div className="flex justify-between text-sm">
        <span className="text-muted-foreground">Labor</span>
        <span>$X,XXX.XX</span>
      </div>
      <Separator />
      <div className="flex justify-between font-medium">
        <span>Total</span>
        <span>$XX,XXX.XX</span>
      </div>
      {selectedCount > 1 && (
        <p className="text-xs text-muted-foreground text-center mt-2">
          + {selectedCount - 1} more estimate option{selectedCount > 2 ? 's' : ''}
        </p>
      )}
    </div>
  );
}

function MarketingPreview() {
  return (
    <div className="space-y-3 text-sm">
      <div className="flex items-center gap-2">
        <div className="w-2 h-2 rounded-full bg-green-500" />
        <span>Licensed & Insured</span>
      </div>
      <div className="flex items-center gap-2">
        <div className="w-2 h-2 rounded-full bg-green-500" />
        <span>Manufacturer Certified</span>
      </div>
      <div className="flex items-center gap-2">
        <div className="w-2 h-2 rounded-full bg-green-500" />
        <span>Warranty Included</span>
      </div>
      <div className="flex items-center gap-2">
        <div className="w-2 h-2 rounded-full bg-green-500" />
        <span>Financing Available</span>
      </div>
    </div>
  );
}

function SignaturePreview({ contactName }: { contactName: string }) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        By signing below, you agree to the terms and conditions of this proposal.
      </p>
      <div className="space-y-2">
        <div>
          <p className="text-xs text-muted-foreground">Signed By</p>
          <div className="border-b-2 border-dashed h-8 flex items-end pb-1">
            <span className="text-muted-foreground italic text-sm">{contactName}</span>
          </div>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Date</p>
          <div className="border-b-2 border-dashed h-8 flex items-end pb-1">
            <span className="text-muted-foreground italic text-sm">
              {new Date().toLocaleDateString()}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
