import { useState } from 'react';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  FileText,
  MapPin,
  Building2,
  User,
  Ruler,
  Package,
  ClipboardList,
  FileCheck,
  Clock,
  CheckCircle2,
  AlertCircle,
  Download,
  RefreshCw,
  Loader2,
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import type { PermitExpediterJob } from '@/lib/permits/types';
import { PERMIT_STATUS_LABELS, PERMIT_STATUS_COLORS } from '@/lib/permits/types';

interface PermitCaseDetailSheetProps {
  job: PermitExpediterJob | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  permitCaseId?: string;
  onRefresh?: () => void;
}

export function PermitCaseDetailSheet({
  job,
  open,
  onOpenChange,
  permitCaseId,
  onRefresh,
}: PermitCaseDetailSheetProps) {
  const [activeTab, setActiveTab] = useState('overview');
  
  // Loading states for each action
  const [isDetectingJurisdiction, setIsDetectingJurisdiction] = useState(false);
  const [isFetchingProperty, setIsFetchingProperty] = useState(false);
  const [isBuildingApplication, setIsBuildingApplication] = useState(false);
  const [isGeneratingPacket, setIsGeneratingPacket] = useState(false);

  if (!job) return null;

  const handleDetectJurisdiction = async () => {
    if (!permitCaseId || !job?.job_id) {
      toast.error('Missing permit case or job ID');
      return;
    }
    
    setIsDetectingJurisdiction(true);
    try {
      const { data, error } = await supabase.functions.invoke('permit-detect-jurisdiction', {
        body: { permit_case_id: permitCaseId, job_id: job.job_id }
      });
      
      if (error) throw error;
      
      if (data?.authority) {
        toast.success(`Jurisdiction detected: ${data.authority.name}`);
      } else {
        toast.info('No jurisdiction boundary found - may require manual entry');
      }
      onRefresh?.();
    } catch (err: any) {
      console.error('Failed to detect jurisdiction:', err);
      toast.error(err?.message || 'Failed to detect jurisdiction');
    } finally {
      setIsDetectingJurisdiction(false);
    }
  };

  const handleFetchPropertyData = async () => {
    if (!permitCaseId || !job?.job_id) {
      toast.error('Missing permit case or job ID');
      return;
    }
    
    setIsFetchingProperty(true);
    try {
      const { data, error } = await supabase.functions.invoke('permit-fetch-property-data', {
        body: { 
          permit_case_id: permitCaseId, 
          job_id: job.job_id, 
          address: job.address 
        }
      });
      
      if (error) throw error;
      
      if (data?.parcel) {
        toast.success('Property data fetched successfully');
      } else {
        toast.info('No parcel data found for this address');
      }
      onRefresh?.();
    } catch (err: any) {
      console.error('Failed to fetch property data:', err);
      toast.error(err?.message || 'Failed to fetch property data');
    } finally {
      setIsFetchingProperty(false);
    }
  };

  const handleBuildApplication = async () => {
    if (!permitCaseId || !job?.job_id) {
      toast.error('Missing permit case or job ID');
      return;
    }
    
    setIsBuildingApplication(true);
    try {
      const { data, error } = await supabase.functions.invoke('permit-application-generator', {
        body: { 
          action: 'generate_application', 
          permit_case_id: permitCaseId, 
          job_id: job.job_id 
        }
      });
      
      if (error) throw error;
      
      toast.success('Permit application generated');
      onRefresh?.();
    } catch (err: any) {
      console.error('Failed to build application:', err);
      toast.error(err?.message || 'Failed to build permit application');
    } finally {
      setIsBuildingApplication(false);
    }
  };

  const handleGeneratePacket = async () => {
    if (!permitCaseId) {
      toast.error('Missing permit case ID');
      return;
    }
    
    setIsGeneratingPacket(true);
    try {
      // For now, show a placeholder toast - this will need a dedicated edge function
      toast.info('Permit packet generation coming soon');
      onRefresh?.();
    } catch (err: any) {
      console.error('Failed to generate packet:', err);
      toast.error(err?.message || 'Failed to generate permit packet');
    } finally {
      setIsGeneratingPacket(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-2xl">
        <SheetHeader>
          <div className="flex items-start justify-between">
            <div>
              <SheetTitle className="flex items-center gap-2">
                <MapPin className="h-5 w-5" />
                {job.address.split(',')[0]}
              </SheetTitle>
              <SheetDescription>
                {job.job_number && `#${job.job_number} · `}
                {job.contact_name}
              </SheetDescription>
            </div>
            <Badge className={PERMIT_STATUS_COLORS[job.status]}>
              {PERMIT_STATUS_LABELS[job.status]}
            </Badge>
          </div>
        </SheetHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="mt-6">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="property">Property</TabsTrigger>
            <TabsTrigger value="approvals">Approvals</TabsTrigger>
            <TabsTrigger value="timeline">Timeline</TabsTrigger>
          </TabsList>

          <ScrollArea className="h-[calc(100vh-220px)] mt-4">
            <TabsContent value="overview" className="space-y-4">
              {/* Jurisdiction Info */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Building2 className="h-4 w-4" />
                    Jurisdiction
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {job.jurisdiction_type ? (
                    <>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Type</span>
                        <Badge variant="outline">{job.jurisdiction_type}</Badge>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">
                          {job.jurisdiction_type === 'CITY' ? 'City' : 'County'}
                        </span>
                        <span className="font-medium">
                          {job.jurisdiction_type === 'CITY' ? job.city_name : job.county_name}
                        </span>
                      </div>
                      {job.portal_type && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Portal</span>
                          <span className="font-medium">{job.portal_type}</span>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <AlertCircle className="h-4 w-4" />
                      <span>Jurisdiction not yet detected</span>
                    </div>
                  )}
                  <Button 
                    variant="outline" 
                    size="sm" 
                    className="w-full mt-2"
                    onClick={handleDetectJurisdiction}
                    disabled={isDetectingJurisdiction}
                  >
                    {isDetectingJurisdiction ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <RefreshCw className="h-4 w-4 mr-2" />
                    )}
                    {isDetectingJurisdiction ? 'Detecting...' : 'Detect Jurisdiction'}
                  </Button>
                </CardContent>
              </Card>

              {/* Readiness Checklist */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <ClipboardList className="h-4 w-4" />
                    Permit Readiness
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <ChecklistItem
                    label="Property/Parcel Data"
                    checked={job.has_parcel_data}
                    description="Owner name, legal description, parcel ID"
                  />
                  <ChecklistItem
                    label="Roof Measurements"
                    checked={job.has_measurements}
                    description="Total area, pitch, linear features"
                  />
                  <ChecklistItem
                    label="Product Approvals"
                    checked={job.has_product_approvals}
                    description="FL Product Approval, Miami-Dade NOA"
                  />
                  <ChecklistItem
                    label="Contractor Documents"
                    checked={true}
                    description="License, insurance, worker's comp"
                  />
                </CardContent>
              </Card>

              {/* Actions */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <FileCheck className="h-4 w-4" />
                    Actions
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <Button 
                    className="w-full" 
                    disabled={!job.has_measurements || !job.has_parcel_data || isBuildingApplication}
                    onClick={handleBuildApplication}
                  >
                    {isBuildingApplication ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <FileText className="h-4 w-4 mr-2" />
                    )}
                    {isBuildingApplication ? 'Building...' : 'Build Permit Application'}
                  </Button>
                  <Button 
                    variant="outline" 
                    className="w-full"
                    disabled={isGeneratingPacket}
                    onClick={handleGeneratePacket}
                  >
                    {isGeneratingPacket ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Download className="h-4 w-4 mr-2" />
                    )}
                    {isGeneratingPacket ? 'Generating...' : 'Generate Permit Packet'}
                  </Button>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="property" className="space-y-4">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <MapPin className="h-4 w-4" />
                    Property Information
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <InfoRow label="Address" value={job.address} />
                  <InfoRow label="Parcel ID" value={job.parcel_id || 'Not available'} />
                  <Separator />
                  <div className="text-sm text-muted-foreground">
                    Fetch property data from the county property appraiser to populate
                    owner name, legal description, and other permit requirements.
                  </div>
                  <Button 
                    variant="outline" 
                    size="sm" 
                    className="w-full"
                    onClick={handleFetchPropertyData}
                    disabled={isFetchingProperty}
                  >
                    {isFetchingProperty ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <RefreshCw className="h-4 w-4 mr-2" />
                    )}
                    {isFetchingProperty ? 'Fetching...' : 'Fetch Property Data'}
                  </Button>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <User className="h-4 w-4" />
                    Owner Information
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <InfoRow label="Contact Name" value={job.contact_name} />
                  <div className="text-sm text-muted-foreground">
                    Owner name on title will be fetched from property appraiser records.
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Ruler className="h-4 w-4" />
                    Measurements
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {job.has_measurements ? (
                    <div className="text-sm text-muted-foreground">
                      Measurement data available. View detailed report in the measurements tab.
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <AlertCircle className="h-4 w-4" />
                        <span>No measurements available</span>
                      </div>
                      <Button variant="outline" size="sm" className="w-full">
                        Import Measurements
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="approvals" className="space-y-4">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Package className="h-4 w-4" />
                    Product Approvals
                  </CardTitle>
                  <CardDescription>
                    FL Product Approvals and Miami-Dade NOAs for materials used
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {job.has_product_approvals ? (
                    <div className="text-sm text-muted-foreground">
                      Product approvals are linked. View details below.
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <AlertCircle className="h-4 w-4" />
                        <span>No product approvals linked</span>
                      </div>
                      <div className="text-sm text-muted-foreground">
                        Link products from your estimate to validate FL Product Approvals
                        and Miami-Dade NOAs for permit requirements.
                      </div>
                      <Button variant="outline" size="sm" className="w-full">
                        Link Product Approvals
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="timeline" className="space-y-4">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Clock className="h-4 w-4" />
                    Event Timeline
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <TimelineEvent
                      type="CREATED"
                      message="Permit case created"
                      timestamp={job.created_at}
                    />
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </ScrollArea>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}

function ChecklistItem({
  label,
  checked,
  description,
}: {
  label: string;
  checked: boolean;
  description: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className={`mt-0.5 ${checked ? 'text-green-600' : 'text-muted-foreground'}`}>
        {checked ? (
          <CheckCircle2 className="h-5 w-5" />
        ) : (
          <AlertCircle className="h-5 w-5" />
        )}
      </div>
      <div>
        <div className={`font-medium ${!checked && 'text-muted-foreground'}`}>
          {label}
        </div>
        <div className="text-sm text-muted-foreground">{description}</div>
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-right max-w-[60%]">{value}</span>
    </div>
  );
}

function TimelineEvent({
  type,
  message,
  timestamp,
}: {
  type: string;
  message: string;
  timestamp: string;
}) {
  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center">
        <div className="w-2 h-2 rounded-full bg-primary" />
        <div className="w-px h-full bg-border" />
      </div>
      <div className="pb-4">
        <div className="font-medium">{message}</div>
        <div className="text-sm text-muted-foreground">
          {new Date(timestamp).toLocaleString()}
        </div>
      </div>
    </div>
  );
}