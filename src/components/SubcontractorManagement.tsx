import React, { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AlertTriangle, Plus, Star, Users, Calendar, DollarSign } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface Subcontractor {
  id: string;
  company_name: string;
  trade: string;
  contact_name: string;
  email: string;
  phone: string;
  w9_url: string;
  insurance_expiry_date: string;
  license_expiry_date: string;
  rating: number;
  is_active: boolean;
}

interface SubcontractorJob {
  id: string;
  subcontractor_id: string;
  project_id: string;
  trade: string;
  scheduled_date: string;
  status: string;
  cost: number;
  rating: number;
  feedback: string;
  subcontractors: {
    company_name: string;
  };
}

export default function SubcontractorManagement() {
  const [subcontractors, setSubcontractors] = useState<Subcontractor[]>([]);
  const [jobs, setJobs] = useState<SubcontractorJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [formData, setFormData] = useState({
    company_name: '',
    trade: '',
    contact_name: '',
    email: '',
    phone: '',
    license_number: ''
  });
  const { toast } = useToast();

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [subsResult, jobsResult] = await Promise.all([
        supabase
          .from('subcontractors')
          .select('*')
          .order('company_name'),
        supabase
          .from('subcontractor_jobs')
          .select(`
            *,
            subcontractors(company_name)
          `)
          .order('scheduled_date', { ascending: false })
      ]);

      if (subsResult.error) throw subsResult.error;
      if (jobsResult.error) throw jobsResult.error;

      setSubcontractors(subsResult.data || []);
      setJobs(jobsResult.data || []);
    } catch (error) {
      console.error('Error loading data:', error);
      toast({
        title: "Error",
        description: "Failed to load subcontractor data",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleAddSubcontractor = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const { error } = await supabase
        .from('subcontractors')
        .insert([{
          ...formData,
          tenant_id: (await supabase.auth.getUser()).data.user?.id
        }]);

      if (error) throw error;

      toast({
        title: "Success",
        description: "Subcontractor added successfully",
      });

      setShowAddDialog(false);
      setFormData({
        company_name: '',
        trade: '',
        contact_name: '',
        email: '',
        phone: '',
        license_number: ''
      });
      loadData();
    } catch (error) {
      console.error('Error adding subcontractor:', error);
      toast({
        title: "Error",
        description: "Failed to add subcontractor",
        variant: "destructive",
      });
    }
  };

  const getComplianceStatus = (sub: Subcontractor) => {
    const today = new Date();
    const insuranceExpiry = sub.insurance_expiry_date ? new Date(sub.insurance_expiry_date) : null;
    const licenseExpiry = sub.license_expiry_date ? new Date(sub.license_expiry_date) : null;
    const thirtyDaysFromNow = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);

    if (!insuranceExpiry || !licenseExpiry) {
      return <Badge variant="destructive">Missing Documents</Badge>;
    }

    if (insuranceExpiry < today || licenseExpiry < today) {
      return <Badge variant="destructive">Expired</Badge>;
    }

    if (insuranceExpiry < thirtyDaysFromNow || licenseExpiry < thirtyDaysFromNow) {
      return <Badge className="bg-yellow-500 hover:bg-yellow-600">Expiring Soon</Badge>;
    }

    return <Badge className="bg-green-500 hover:bg-green-600">Compliant</Badge>;
  };

  const renderStars = (rating: number) => {
    return Array.from({ length: 5 }, (_, i) => (
      <Star
        key={i}
        className={`h-4 w-4 ${i < rating ? 'text-yellow-400 fill-current' : 'text-gray-300'}`}
      />
    ));
  };

  if (loading) {
    return <div className="flex items-center justify-center h-64">Loading...</div>;
  }

  return (
    <div className="container mx-auto py-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold">Subcontractor Management</h1>
        <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              Add Subcontractor
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[425px]">
            <DialogHeader>
              <DialogTitle>Add New Subcontractor</DialogTitle>
              <DialogDescription>
                Enter the subcontractor details below.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleAddSubcontractor} className="space-y-4">
              <div>
                <Label htmlFor="company_name">Company Name</Label>
                <Input
                  id="company_name"
                  value={formData.company_name}
                  onChange={(e) => setFormData({ ...formData, company_name: e.target.value })}
                  required
                />
              </div>
              <div>
                <Label htmlFor="trade">Trade</Label>
                <Input
                  id="trade"
                  value={formData.trade}
                  onChange={(e) => setFormData({ ...formData, trade: e.target.value })}
                  required
                />
              </div>
              <div>
                <Label htmlFor="contact_name">Contact Name</Label>
                <Input
                  id="contact_name"
                  value={formData.contact_name}
                  onChange={(e) => setFormData({ ...formData, contact_name: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="phone">Phone</Label>
                <Input
                  id="phone"
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="license_number">License Number</Label>
                <Input
                  id="license_number"
                  value={formData.license_number}
                  onChange={(e) => setFormData({ ...formData, license_number: e.target.value })}
                />
              </div>
              <Button type="submit" className="w-full">Add Subcontractor</Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Tabs defaultValue="subcontractors" className="space-y-4">
        <TabsList>
          <TabsTrigger value="subcontractors">Subcontractors</TabsTrigger>
          <TabsTrigger value="jobs">Job History</TabsTrigger>
          <TabsTrigger value="performance">Performance</TabsTrigger>
        </TabsList>

        <TabsContent value="subcontractors">
          <div className="grid gap-4">
            {subcontractors.map((sub) => (
              <Card key={sub.id}>
                <CardHeader>
                  <div className="flex justify-between items-start">
                    <div>
                      <CardTitle className="flex items-center gap-2">
                        {sub.company_name}
                        {!sub.is_active && <Badge variant="secondary">Inactive</Badge>}
                      </CardTitle>
                      <CardDescription>
                        {sub.trade} • {sub.contact_name}
                      </CardDescription>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      {getComplianceStatus(sub)}
                      <div className="flex items-center gap-1">
                        {renderStars(Math.round(sub.rating))}
                        <span className="text-sm text-muted-foreground ml-1">
                          ({sub.rating.toFixed(1)})
                        </span>
                      </div>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                    <div>
                      <p className="font-medium">Contact</p>
                      <p className="text-muted-foreground">{sub.email}</p>
                      <p className="text-muted-foreground">{sub.phone}</p>
                    </div>
                    <div>
                      <p className="font-medium">Insurance</p>
                      <p className="text-muted-foreground">
                        {sub.insurance_expiry_date ? 
                          new Date(sub.insurance_expiry_date).toLocaleDateString() : 
                          'Not provided'
                        }
                      </p>
                    </div>
                    <div>
                      <p className="font-medium">License</p>
                      <p className="text-muted-foreground">
                        {sub.license_expiry_date ? 
                          new Date(sub.license_expiry_date).toLocaleDateString() : 
                          'Not provided'
                        }
                      </p>
                    </div>
                    <div>
                      <p className="font-medium">W9 Status</p>
                      <p className="text-muted-foreground">
                        {sub.w9_url ? 'On File' : 'Missing'}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="jobs">
          <Card>
            <CardHeader>
              <CardTitle>Recent Jobs</CardTitle>
              <CardDescription>
                Job history and performance tracking
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Subcontractor</TableHead>
                    <TableHead>Trade</TableHead>
                    <TableHead>Scheduled Date</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Cost</TableHead>
                    <TableHead>Rating</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {jobs.map((job) => (
                    <TableRow key={job.id}>
                      <TableCell>{job.subcontractors?.company_name}</TableCell>
                      <TableCell>{job.trade}</TableCell>
                      <TableCell>
                        {job.scheduled_date ? 
                          new Date(job.scheduled_date).toLocaleDateString() : 
                          'Not scheduled'
                        }
                      </TableCell>
                      <TableCell>
                        <Badge variant={
                          job.status === 'completed' ? 'default' :
                          job.status === 'in_progress' ? 'secondary' :
                          'outline'
                        }>
                          {job.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {job.cost ? `$${job.cost.toFixed(2)}` : 'TBD'}
                      </TableCell>
                      <TableCell>
                        {job.rating ? (
                          <div className="flex items-center gap-1">
                            {renderStars(job.rating)}
                          </div>
                        ) : (
                          'Not rated'
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="performance">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Active Subcontractors</CardTitle>
                <Users className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {subcontractors.filter(s => s.is_active).length}
                </div>
                <p className="text-xs text-muted-foreground">
                  {subcontractors.length} total registered
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Compliance Issues</CardTitle>
                <AlertTriangle className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-yellow-600">
                  {subcontractors.filter(s => {
                    const today = new Date();
                    const thirtyDaysFromNow = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);
                    const insuranceExpiry = s.insurance_expiry_date ? new Date(s.insurance_expiry_date) : null;
                    const licenseExpiry = s.license_expiry_date ? new Date(s.license_expiry_date) : null;
                    
                    return !insuranceExpiry || !licenseExpiry || 
                           insuranceExpiry < thirtyDaysFromNow || 
                           licenseExpiry < thirtyDaysFromNow;
                  }).length}
                </div>
                <p className="text-xs text-muted-foreground">
                  Require attention
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Avg Rating</CardTitle>
                <Star className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {subcontractors.length > 0 ? 
                    (subcontractors.reduce((sum, s) => sum + s.rating, 0) / subcontractors.length).toFixed(1) :
                    '0.0'
                  }
                </div>
                <p className="text-xs text-muted-foreground">
                  Overall performance
                </p>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}