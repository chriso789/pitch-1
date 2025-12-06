import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import {
  FileText,
  AlertTriangle,
  ExternalLink,
  Phone,
  DollarSign,
  Clock,
  CheckCircle2,
  XCircle,
  Download,
  Building2,
} from 'lucide-react';
import { useCountyPermits, type CountyPermitData } from '@/hooks/useCountyPermits';
import { toast } from 'sonner';

interface PermitChecklistProps {
  countyName: string;
  jobId?: string;
  onChecklistUpdate?: (checkedDocs: string[]) => void;
  compact?: boolean;
}

export function PermitChecklist({ 
  countyName, 
  jobId, 
  onChecklistUpdate,
  compact = false 
}: PermitChecklistProps) {
  const { getCountyPermitData } = useCountyPermits();
  const [permitData, setPermitData] = useState<CountyPermitData | null>(null);
  const [loading, setLoading] = useState(true);
  const [checkedDocs, setCheckedDocs] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (countyName) {
      loadPermitData();
    }
  }, [countyName]);

  const loadPermitData = async () => {
    setLoading(true);
    try {
      const data = await getCountyPermitData(countyName);
      setPermitData(data);
    } catch (err) {
      console.error('Error loading permit data:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleDocCheck = (doc: string, checked: boolean) => {
    const newChecked = new Set(checkedDocs);
    if (checked) {
      newChecked.add(doc);
    } else {
      newChecked.delete(doc);
    }
    setCheckedDocs(newChecked);
    onChecklistUpdate?.(Array.from(newChecked));
  };

  if (loading) {
    return (
      <Card className={compact ? 'border-0 shadow-none' : ''}>
        <CardContent className="py-8 text-center text-muted-foreground">
          Loading permit requirements...
        </CardContent>
      </Card>
    );
  }

  if (!permitData?.county) {
    return (
      <Card className={compact ? 'border-0 shadow-none' : ''}>
        <CardContent className="py-8 text-center text-muted-foreground">
          <Building2 className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <p>County not found in Florida database</p>
          <p className="text-xs mt-1">This county may not be a Florida coastal county</p>
        </CardContent>
      </Card>
    );
  }

  const { county, requirements, forms } = permitData;
  const requiredDocs = requirements?.required_documents || [];
  const progress = requiredDocs.length > 0 
    ? (checkedDocs.size / requiredDocs.length) * 100 
    : 0;

  if (compact) {
    return (
      <div className="space-y-4">
        {/* County Info Badge */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="font-medium">
              {county.name} County
            </Badge>
            {county.is_hvhz && (
              <Badge variant="destructive">
                <AlertTriangle className="h-3 w-3 mr-1" />
                HVHZ
              </Badge>
            )}
          </div>
          {requirements?.permit_portal_url && (
            <Button variant="ghost" size="sm" asChild>
              <a 
                href={requirements.permit_portal_url} 
                target="_blank" 
                rel="noopener noreferrer"
              >
                <ExternalLink className="h-4 w-4" />
              </a>
            </Button>
          )}
        </div>

        {/* Quick Stats */}
        <div className="grid grid-cols-2 gap-2 text-sm">
          {requirements?.base_fee && (
            <div className="flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-muted-foreground" />
              <span>Fee: ${requirements.base_fee}</span>
            </div>
          )}
          {requirements?.typical_processing_days && (
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <span>{requirements.typical_processing_days} days</span>
            </div>
          )}
        </div>

        {/* Document Progress */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium">Documents</span>
            <span className="text-sm text-muted-foreground">
              {checkedDocs.size}/{requiredDocs.length}
            </span>
          </div>
          <Progress value={progress} className="h-2" />
        </div>

        {/* Document List */}
        <div className="space-y-2">
          {requiredDocs.map((doc, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <Checkbox
                id={`doc-${idx}`}
                checked={checkedDocs.has(doc)}
                onCheckedChange={(checked) => handleDocCheck(doc, !!checked)}
              />
              <label 
                htmlFor={`doc-${idx}`} 
                className={`text-sm cursor-pointer ${
                  checkedDocs.has(doc) ? 'line-through text-muted-foreground' : ''
                }`}
              >
                {doc}
              </label>
            </div>
          ))}
        </div>

        {/* Special Requirements Warning */}
        {requirements?.special_requirements && requirements.special_requirements.length > 0 && (
          <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
            <div className="flex items-center gap-2 text-amber-700 text-sm font-medium mb-1">
              <AlertTriangle className="h-4 w-4" />
              Special Requirements
            </div>
            <ul className="text-xs text-amber-600 space-y-1">
              {requirements.special_requirements.slice(0, 2).map((req, idx) => (
                <li key={idx}>• {req}</li>
              ))}
              {requirements.special_requirements.length > 2 && (
                <li className="text-amber-500">
                  +{requirements.special_requirements.length - 2} more...
                </li>
              )}
            </ul>
          </div>
        )}
      </div>
    );
  }

  // Full View
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Permit Checklist: {county.name} County
          </CardTitle>
          {county.is_hvhz && (
            <Badge variant="destructive">
              <AlertTriangle className="h-3 w-3 mr-1" />
              High Velocity Hurricane Zone
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Progress */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium">Document Collection Progress</span>
            <span className="text-sm font-medium">
              {checkedDocs.size} of {requiredDocs.length} complete
            </span>
          </div>
          <Progress value={progress} className="h-3" />
        </div>

        {/* Quick Info */}
        <div className="grid grid-cols-3 gap-4">
          <Card className="p-3 bg-muted/50">
            <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
              <DollarSign className="h-3 w-3" />
              Permit Fee
            </div>
            <div className="font-bold">
              {requirements?.base_fee ? `$${requirements.base_fee}` : 'Contact Office'}
            </div>
          </Card>
          <Card className="p-3 bg-muted/50">
            <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
              <Clock className="h-3 w-3" />
              Processing Time
            </div>
            <div className="font-bold">
              {requirements?.typical_processing_days 
                ? `${requirements.typical_processing_days} days` 
                : 'Varies'}
            </div>
          </Card>
          <Card className="p-3 bg-muted/50">
            <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
              <Building2 className="h-3 w-3" />
              Submission
            </div>
            <div className="font-bold">
              {requirements?.online_submission ? 'Online' : 'In-Person'}
            </div>
          </Card>
        </div>

        <Separator />

        {/* Required Documents */}
        <div>
          <h4 className="font-medium mb-3">Required Documents</h4>
          <div className="space-y-3">
            {requiredDocs.map((doc, idx) => (
              <div 
                key={idx} 
                className={`flex items-center justify-between p-3 rounded-lg border transition-colors ${
                  checkedDocs.has(doc) 
                    ? 'bg-green-50 border-green-200' 
                    : 'bg-muted/30 hover:bg-muted/50'
                }`}
              >
                <div className="flex items-center gap-3">
                  <Checkbox
                    id={`full-doc-${idx}`}
                    checked={checkedDocs.has(doc)}
                    onCheckedChange={(checked) => handleDocCheck(doc, !!checked)}
                  />
                  <label 
                    htmlFor={`full-doc-${idx}`} 
                    className={`cursor-pointer ${
                      checkedDocs.has(doc) ? 'line-through text-muted-foreground' : ''
                    }`}
                  >
                    {doc}
                  </label>
                </div>
                {checkedDocs.has(doc) ? (
                  <CheckCircle2 className="h-5 w-5 text-green-500" />
                ) : (
                  <XCircle className="h-5 w-5 text-muted-foreground/30" />
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Special Requirements */}
        {requirements?.special_requirements && requirements.special_requirements.length > 0 && (
          <>
            <Separator />
            <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg">
              <h4 className="font-medium flex items-center gap-2 text-amber-700 mb-3">
                <AlertTriangle className="h-4 w-4" />
                Special Requirements for {county.name} County
              </h4>
              <ul className="space-y-2">
                {requirements.special_requirements.map((req, idx) => (
                  <li key={idx} className="flex items-start gap-2 text-sm text-amber-700">
                    <span className="text-amber-500 mt-0.5">•</span>
                    {req}
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}

        {/* Downloadable Forms */}
        {forms.length > 0 && (
          <>
            <Separator />
            <div>
              <h4 className="font-medium mb-3">County Forms</h4>
              <div className="grid grid-cols-2 gap-2">
                {forms.map((form) => (
                  <Button 
                    key={form.id} 
                    variant="outline" 
                    className="justify-start h-auto py-3"
                    asChild
                  >
                    <a 
                      href={form.form_url || '#'} 
                      target="_blank" 
                      rel="noopener noreferrer"
                    >
                      <Download className="h-4 w-4 mr-2 shrink-0" />
                      <div className="text-left truncate">
                        <div className="text-sm truncate">{form.form_name}</div>
                        {form.form_type && (
                          <div className="text-xs text-muted-foreground capitalize">
                            {form.form_type}
                          </div>
                        )}
                      </div>
                    </a>
                  </Button>
                ))}
              </div>
            </div>
          </>
        )}

        {/* Contact & Portal */}
        <div className="flex items-center gap-3 pt-2">
          {requirements?.permit_portal_url && (
            <Button className="flex-1" asChild>
              <a 
                href={requirements.permit_portal_url} 
                target="_blank" 
                rel="noopener noreferrer"
              >
                <ExternalLink className="h-4 w-4 mr-2" />
                Open Permit Portal
              </a>
            </Button>
          )}
          {requirements?.department_phone && (
            <Button variant="outline" className="flex-1" asChild>
              <a href={`tel:${requirements.department_phone}`}>
                <Phone className="h-4 w-4 mr-2" />
                Call {requirements.department_phone}
              </a>
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default PermitChecklist;
