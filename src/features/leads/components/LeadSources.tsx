import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Plus, Edit, Trash2, BarChart3, DollarSign, Users, TrendingUp } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/components/ui/use-toast';

type LeadSourceCategory = 'online' | 'referral' | 'direct' | 'advertising' | 'social';

interface LeadSource {
  id: string;
  name: string;
  category: string;
  description: string;
  default_acquisition_cost: number;
  tracking_url: string;
  is_active: boolean;
  created_at: string;
  performance?: {
    leads_generated: number;
    qualified_leads: number;
    deals_closed: number;
    total_revenue: number;
    roi_percent: number;
  };
}

export const LeadSources = () => {
  const [leadSources, setLeadSources] = useState<LeadSource[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingSource, setEditingSource] = useState<LeadSource | null>(null);
  const { toast } = useToast();

  const [formData, setFormData] = useState({
    name: '',
    category: 'online' as LeadSourceCategory,
    description: '',
    default_acquisition_cost: 0,
    tracking_url: '',
    is_active: true
  });

  useEffect(() => {
    fetchLeadSources();
  }, []);

  const fetchLeadSources = async () => {
    try {
      const { data, error } = await supabase
        .from('lead_sources')
        .select(`
          *,
          lead_source_performance (
            leads_generated,
            qualified_leads,
            deals_closed,
            total_revenue,
            roi_percent
          )
        `)
        .order('created_at', { ascending: false });

      if (error) throw error;

      const sourcesWithPerformance = data.map(source => ({
        ...source,
        performance: source.lead_source_performance?.[0] || {
          leads_generated: 0,
          qualified_leads: 0,
          deals_closed: 0,
          total_revenue: 0,
          roi_percent: 0
        }
      }));

      setLeadSources(sourcesWithPerformance);
    } catch (error) {
      console.error('Error fetching lead sources:', error);
      toast({
        title: "Error",
        description: "Failed to fetch lead sources",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    try {
      const payload = {
        ...formData,
        tenant_id: (await supabase.auth.getUser()).data.user?.user_metadata?.tenant_id
      };

      let result;
      if (editingSource) {
        result = await supabase
          .from('lead_sources')
          .update(payload)
          .eq('id', editingSource.id);
      } else {
        result = await supabase
          .from('lead_sources')
          .insert(payload);
      }

      if (result.error) throw result.error;

      toast({
        title: "Success",
        description: `Lead source ${editingSource ? 'updated' : 'created'} successfully`,
      });

      setIsDialogOpen(false);
      resetForm();
      fetchLeadSources();
    } catch (error) {
      console.error('Error saving lead source:', error);
      toast({
        title: "Error",
        description: "Failed to save lead source",
        variant: "destructive",
      });
    }
  };

  const handleEdit = (source: LeadSource) => {
    setEditingSource(source);
    setFormData({
      name: source.name,
      category: source.category as LeadSourceCategory,
      description: source.description,
      default_acquisition_cost: source.default_acquisition_cost,
      tracking_url: source.tracking_url,
      is_active: source.is_active
    });
    setIsDialogOpen(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this lead source?')) return;

    try {
      const { error } = await supabase
        .from('lead_sources')
        .delete()
        .eq('id', id);

      if (error) throw error;

      toast({
        title: "Success",
        description: "Lead source deleted successfully",
      });

      fetchLeadSources();
    } catch (error) {
      console.error('Error deleting lead source:', error);
      toast({
        title: "Error",
        description: "Failed to delete lead source",
        variant: "destructive",
      });
    }
  };

  const resetForm = () => {
    setFormData({
      name: '',
      category: 'online' as LeadSourceCategory,
      description: '',
      default_acquisition_cost: 0,
      tracking_url: '',
      is_active: true
    });
    setEditingSource(null);
  };

  const getCategoryBadgeVariant = (category: string) => {
    const variants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
      online: "default",
      referral: "secondary",
      direct: "outline",
      advertising: "destructive",
      social: "default"
    };
    return variants[category] || "outline";
  };

  const totalLeads = leadSources.reduce((sum, source) => sum + (source.performance?.leads_generated || 0), 0);
  const totalRevenue = leadSources.reduce((sum, source) => sum + (source.performance?.total_revenue || 0), 0);
  const avgROI = leadSources.length > 0 ? 
    leadSources.reduce((sum, source) => sum + (source.performance?.roi_percent || 0), 0) / leadSources.length : 0;

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="h-8 bg-muted animate-pulse rounded" />
        <div className="h-64 bg-muted animate-pulse rounded" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center space-x-2">
              <Users className="h-5 w-5 text-primary" />
              <div>
                <p className="text-sm font-medium text-muted-foreground">Total Leads</p>
                <p className="text-2xl font-bold">{totalLeads.toLocaleString()}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center space-x-2">
              <DollarSign className="h-5 w-5 text-primary" />
              <div>
                <p className="text-sm font-medium text-muted-foreground">Total Revenue</p>
                <p className="text-2xl font-bold">${totalRevenue.toLocaleString()}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center space-x-2">
              <TrendingUp className="h-5 w-5 text-primary" />
              <div>
                <p className="text-sm font-medium text-muted-foreground">Average ROI</p>
                <p className="text-2xl font-bold">{avgROI.toFixed(1)}%</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center space-x-2">
              <BarChart3 className="h-5 w-5 text-primary" />
              <div>
                <p className="text-sm font-medium text-muted-foreground">Active Sources</p>
                <p className="text-2xl font-bold">{leadSources.filter(s => s.is_active).length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Lead Sources Table */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Lead Sources</CardTitle>
              <CardDescription>Manage and track your lead generation channels</CardDescription>
            </div>
            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
              <DialogTrigger asChild>
                <Button onClick={resetForm}>
                  <Plus className="h-4 w-4 mr-2" />
                  Add Lead Source
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>
                    {editingSource ? 'Edit Lead Source' : 'Add New Lead Source'}
                  </DialogTitle>
                  <DialogDescription>
                    Configure a new lead generation channel to track performance and ROI
                  </DialogDescription>
                </DialogHeader>
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="name">Source Name</Label>
                    <Input
                      id="name"
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      placeholder="e.g., Google Ads, Facebook, Referrals"
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="category">Category</Label>
                    <Select
                      value={formData.category}
                      onValueChange={(value: any) => setFormData({ ...formData, category: value })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="online">Online</SelectItem>
                        <SelectItem value="referral">Referral</SelectItem>
                        <SelectItem value="direct">Direct</SelectItem>
                        <SelectItem value="advertising">Advertising</SelectItem>
                        <SelectItem value="social">Social Media</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="description">Description</Label>
                    <Textarea
                      id="description"
                      value={formData.description}
                      onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                      placeholder="Brief description of this lead source"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="cost">Default Acquisition Cost ($)</Label>
                    <Input
                      id="cost"
                      type="number"
                      step="0.01"
                      value={formData.default_acquisition_cost}
                      onChange={(e) => setFormData({ 
                        ...formData, 
                        default_acquisition_cost: parseFloat(e.target.value) || 0 
                      })}
                      placeholder="0.00"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="tracking_url">Tracking URL (optional)</Label>
                    <Input
                      id="tracking_url"
                      type="url"
                      value={formData.tracking_url}
                      onChange={(e) => setFormData({ ...formData, tracking_url: e.target.value })}
                      placeholder="https://example.com/track"
                    />
                  </div>

                  <div className="flex items-center space-x-2">
                    <Switch
                      id="is_active"
                      checked={formData.is_active}
                      onCheckedChange={(checked) => setFormData({ ...formData, is_active: checked })}
                    />
                    <Label htmlFor="is_active">Active</Label>
                  </div>

                  <DialogFooter>
                    <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>
                      Cancel
                    </Button>
                    <Button type="submit">
                      {editingSource ? 'Update' : 'Create'}
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Leads</TableHead>
                <TableHead>Revenue</TableHead>
                <TableHead>ROI</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {leadSources.map((source) => (
                <TableRow key={source.id}>
                  <TableCell>
                    <div>
                      <div className="font-medium">{source.name}</div>
                      {source.description && (
                        <div className="text-sm text-muted-foreground">{source.description}</div>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={getCategoryBadgeVariant(source.category)}>
                      {source.category}
                    </Badge>
                  </TableCell>
                  <TableCell>{source.performance?.leads_generated || 0}</TableCell>
                  <TableCell>${(source.performance?.total_revenue || 0).toLocaleString()}</TableCell>
                  <TableCell>
                    <span className={`font-medium ${
                      (source.performance?.roi_percent || 0) > 0 ? 'text-green-600' : 'text-red-600'
                    }`}>
                      {(source.performance?.roi_percent || 0).toFixed(1)}%
                    </span>
                  </TableCell>
                  <TableCell>
                    <Badge variant={source.is_active ? "default" : "secondary"}>
                      {source.is_active ? "Active" : "Inactive"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center space-x-2">
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        onClick={() => handleEdit(source)}
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        onClick={() => handleDelete(source.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          
          {leadSources.length === 0 && (
            <div className="text-center py-8 text-muted-foreground">
              No lead sources configured yet. Add your first lead source to start tracking ROI.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};