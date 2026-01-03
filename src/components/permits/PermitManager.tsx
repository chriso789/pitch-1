import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { FileText, Building2, Calendar, CheckCircle, Clock, AlertTriangle, Plus, Search, ExternalLink } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useCompanySwitcher } from '@/hooks/useCompanySwitcher';
import { useQuery } from '@tanstack/react-query';

interface Permit {
  id: string;
  permit_number?: string;
  project_id?: string;
  county: string;
  permit_type: string;
  status: 'draft' | 'submitted' | 'pending_review' | 'approved' | 'denied' | 'expired';
  application_date?: string;
  approval_date?: string;
  expiration_date?: string;
  fee_amount?: number;
  inspector_name?: string;
  inspection_date?: string;
  notes?: string;
}

interface PermitManagerProps {
  projectId?: string;
  propertyAddress?: string;
  county?: string;
}

const PERMIT_STATUSES = {
  draft: { label: 'Draft', color: 'bg-gray-100 text-gray-800' },
  submitted: { label: 'Submitted', color: 'bg-blue-100 text-blue-800' },
  pending_review: { label: 'Pending Review', color: 'bg-yellow-100 text-yellow-800' },
  approved: { label: 'Approved', color: 'bg-green-100 text-green-800' },
  denied: { label: 'Denied', color: 'bg-red-100 text-red-800' },
  expired: { label: 'Expired', color: 'bg-orange-100 text-orange-800' },
};

export const PermitManager: React.FC<PermitManagerProps> = ({
  projectId,
  propertyAddress,
  county
}) => {
  const { activeCompany } = useCompanySwitcher();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [selectedCounty, setSelectedCounty] = useState(county || '');
  const [permitType, setPermitType] = useState('roofing');

  // Fetch existing permits for project - using mock data since permits table doesn't exist yet
  const { data: permits, isLoading, refetch } = useQuery({
    queryKey: ['permits', projectId, activeCompany?.tenant_id],
    queryFn: async () => {
      // Return empty array - permits table will be created in a future migration
      return [] as Permit[];
    },
    enabled: !!activeCompany?.tenant_id
  });

  // Fetch county requirements
  const { data: countyRequirements } = useQuery({
    queryKey: ['county-requirements', selectedCounty],
    queryFn: async () => {
      if (!selectedCounty) return null;
      
      const { data, error } = await supabase
        .from('county_permit_requirements')
        .select('*')
        .eq('county_id', selectedCounty)
        .single();
      
      if (error && error.code !== 'PGRST116') throw error;
      return data as any;
    },
    enabled: !!selectedCounty
  });

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'approved':
        return <CheckCircle className="h-4 w-4 text-green-500" />;
      case 'pending_review':
      case 'submitted':
        return <Clock className="h-4 w-4 text-yellow-500" />;
      case 'denied':
      case 'expired':
        return <AlertTriangle className="h-4 w-4 text-red-500" />;
      default:
        return <FileText className="h-4 w-4 text-gray-500" />;
    }
  };

  const handleCreatePermit = async () => {
    if (!activeCompany?.tenant_id) return;

    try {
      // Permits table doesn't exist yet - this is a placeholder
      console.log('Would create permit for', selectedCounty, permitType);

      setIsCreateOpen(false);
      refetch();
    } catch (error) {
      console.error('Error creating permit:', error);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5" />
            Permit Management
          </CardTitle>
          <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
            <DialogTrigger asChild>
              <Button size="sm">
                <Plus className="h-4 w-4 mr-2" />
                New Permit
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create Permit Application</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <Label htmlFor="county">County</Label>
                  <Input
                    id="county"
                    value={selectedCounty}
                    onChange={(e) => setSelectedCounty(e.target.value)}
                    placeholder="Enter county name"
                  />
                </div>
                <div>
                  <Label htmlFor="permitType">Permit Type</Label>
                  <Select value={permitType} onValueChange={setPermitType}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="roofing">Roofing Permit</SelectItem>
                      <SelectItem value="building">Building Permit</SelectItem>
                      <SelectItem value="electrical">Electrical Permit</SelectItem>
                      <SelectItem value="mechanical">Mechanical Permit</SelectItem>
                      <SelectItem value="solar">Solar Permit</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {propertyAddress && (
                  <div>
                    <Label>Property Address</Label>
                    <p className="text-sm text-muted-foreground mt-1">{propertyAddress}</p>
                  </div>
                )}
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setIsCreateOpen(false)}>
                    Cancel
                  </Button>
                  <Button onClick={handleCreatePermit}>
                    Create Application
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="permits">
          <TabsList>
            <TabsTrigger value="permits">Permits</TabsTrigger>
            <TabsTrigger value="requirements">Requirements</TabsTrigger>
            <TabsTrigger value="inspections">Inspections</TabsTrigger>
          </TabsList>

          <TabsContent value="permits">
            {isLoading ? (
              <div className="text-center py-8 text-muted-foreground">Loading permits...</div>
            ) : permits && permits.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Permit #</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>County</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Applied</TableHead>
                    <TableHead>Expires</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {permits.map((permit) => (
                    <TableRow key={permit.id}>
                      <TableCell className="font-mono">
                        {permit.permit_number || 'Pending'}
                      </TableCell>
                      <TableCell className="capitalize">{permit.permit_type}</TableCell>
                      <TableCell>{permit.county}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {getStatusIcon(permit.status)}
                          <Badge className={PERMIT_STATUSES[permit.status]?.color}>
                            {PERMIT_STATUSES[permit.status]?.label}
                          </Badge>
                        </div>
                      </TableCell>
                      <TableCell>
                        {permit.application_date 
                          ? new Date(permit.application_date).toLocaleDateString()
                          : '-'}
                      </TableCell>
                      <TableCell>
                        {permit.expiration_date 
                          ? new Date(permit.expiration_date).toLocaleDateString()
                          : '-'}
                      </TableCell>
                      <TableCell>
                        <Button variant="ghost" size="sm">
                          <ExternalLink className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <FileText className="h-12 w-12 mx-auto mb-2 opacity-50" />
                <p>No permits found</p>
                <p className="text-sm">Create a new permit application to get started</p>
              </div>
            )}
          </TabsContent>

          <TabsContent value="requirements">
            {countyRequirements ? (
              <div className="space-y-4">
                <Card>
                  <CardContent className="p-4">
                    <h4 className="font-medium mb-2">{selectedCounty} Requirements</h4>
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <span className="text-muted-foreground">Fee:</span>
                        <span className="ml-2 font-medium">
                          ${countyRequirements?.base_fee || 'Varies'}
                        </span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Processing Time:</span>
                        <span className="ml-2 font-medium">
                          {countyRequirements?.standard_processing_days || '5-10'} days
                        </span>
                      </div>
                    </div>
                    {countyRequirements.required_documents && (
                      <div className="mt-4">
                        <p className="text-sm font-medium mb-2">Required Documents:</p>
                        <ul className="list-disc list-inside text-sm text-muted-foreground">
                          {(countyRequirements.required_documents as string[]).map((doc, i) => (
                            <li key={i}>{doc}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <Search className="h-12 w-12 mx-auto mb-2 opacity-50" />
                <p>Enter a county name to see permit requirements</p>
              </div>
            )}
          </TabsContent>

          <TabsContent value="inspections">
            <div className="text-center py-8 text-muted-foreground">
              <Calendar className="h-12 w-12 mx-auto mb-2 opacity-50" />
              <p>No inspections scheduled</p>
              <p className="text-sm">Inspections will appear here once permits are approved</p>
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
};
