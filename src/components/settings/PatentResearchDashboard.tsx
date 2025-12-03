import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { 
  Search, 
  Plus, 
  FileText, 
  AlertTriangle, 
  Shield, 
  Lightbulb,
  ExternalLink,
  Filter,
  Download,
  Building2
} from "lucide-react";

interface IndustryPatent {
  id: string;
  patent_number: string;
  title: string;
  assignee: string | null;
  filing_date: string | null;
  grant_date: string | null;
  status: string | null;
  category: string | null;
  abstract: string | null;
  relevance_to_pitch: string | null;
  risk_level: string | null;
  notes: string | null;
}

interface PitchApplication {
  id: string;
  working_title: string;
  category: string;
  description: string | null;
  key_claims: string[] | null;
  status: string | null;
  priority_level: string | null;
  filed_date: string | null;
  application_number: string | null;
}

export const PatentResearchDashboard = () => {
  const [industryPatents, setIndustryPatents] = useState<IndustryPatent[]>([]);
  const [pitchApplications, setPitchApplications] = useState<PitchApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [riskFilter, setRiskFilter] = useState<string>("all");
  const [addPatentOpen, setAddPatentOpen] = useState(false);
  const [addApplicationOpen, setAddApplicationOpen] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const [patentsRes, applicationsRes] = await Promise.all([
        supabase.from('industry_patents').select('*').order('assignee'),
        supabase.from('pitch_patent_applications').select('*').order('priority_level')
      ]);

      if (patentsRes.error) throw patentsRes.error;
      if (applicationsRes.error) throw applicationsRes.error;

      setIndustryPatents(patentsRes.data || []);
      setPitchApplications(applicationsRes.data || []);
    } catch (error: any) {
      console.error('Error loading patent data:', error);
      toast({
        title: "Error loading data",
        description: error.message,
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const filteredPatents = industryPatents.filter(patent => {
    const matchesSearch = 
      patent.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      patent.patent_number.toLowerCase().includes(searchQuery.toLowerCase()) ||
      patent.assignee?.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = categoryFilter === "all" || patent.category === categoryFilter;
    const matchesRisk = riskFilter === "all" || patent.risk_level === riskFilter;
    return matchesSearch && matchesCategory && matchesRisk;
  });

  const categories = [...new Set(industryPatents.map(p => p.category).filter(Boolean))];
  const assignees = [...new Set(industryPatents.map(p => p.assignee).filter(Boolean))];

  const getRiskBadge = (risk: string | null) => {
    switch (risk) {
      case 'high': return <Badge variant="destructive">High Risk</Badge>;
      case 'medium': return <Badge className="bg-yellow-500">Medium Risk</Badge>;
      case 'low': return <Badge variant="secondary">Low Risk</Badge>;
      default: return <Badge variant="outline">No Risk</Badge>;
    }
  };

  const getStatusBadge = (status: string | null) => {
    switch (status) {
      case 'active': return <Badge className="bg-green-500">Active</Badge>;
      case 'expired': return <Badge variant="secondary">Expired</Badge>;
      case 'pending': return <Badge className="bg-blue-500">Pending</Badge>;
      default: return <Badge variant="outline">{status}</Badge>;
    }
  };

  const getPriorityBadge = (priority: string | null) => {
    switch (priority) {
      case 'critical': return <Badge variant="destructive">Critical</Badge>;
      case 'high': return <Badge className="bg-orange-500">High</Badge>;
      case 'medium': return <Badge className="bg-yellow-500">Medium</Badge>;
      default: return <Badge variant="secondary">Low</Badge>;
    }
  };

  const getAppStatusBadge = (status: string | null) => {
    switch (status) {
      case 'granted': return <Badge className="bg-green-500">Granted</Badge>;
      case 'filed': return <Badge className="bg-blue-500">Filed</Badge>;
      case 'pending': return <Badge className="bg-purple-500">Pending</Badge>;
      case 'drafting': return <Badge className="bg-yellow-500">Drafting</Badge>;
      case 'researching': return <Badge className="bg-cyan-500">Researching</Badge>;
      default: return <Badge variant="outline">Idea</Badge>;
    }
  };

  const highRiskCount = industryPatents.filter(p => p.risk_level === 'high').length;
  const mediumRiskCount = industryPatents.filter(p => p.risk_level === 'medium').length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <Shield className="h-6 w-6 text-primary" />
            Patent Research & IP Strategy
          </h2>
          <p className="text-muted-foreground">
            Track competitor patents and manage PITCH patent applications
          </p>
        </div>
        <Button variant="outline" onClick={() => {
          const csv = industryPatents.map(p => 
            `"${p.patent_number}","${p.title}","${p.assignee}","${p.category}","${p.risk_level}"`
          ).join('\n');
          const blob = new Blob([`"Patent #","Title","Assignee","Category","Risk"\n${csv}`], { type: 'text/csv' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = 'patent-research.csv';
          a.click();
        }}>
          <Download className="h-4 w-4 mr-2" />
          Export CSV
        </Button>
      </div>

      {/* Stats Overview */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-primary/10 rounded-lg">
                <FileText className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-bold">{industryPatents.length}</p>
                <p className="text-sm text-muted-foreground">Competitor Patents</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-destructive/10 rounded-lg">
                <AlertTriangle className="h-5 w-5 text-destructive" />
              </div>
              <div>
                <p className="text-2xl font-bold">{highRiskCount}</p>
                <p className="text-sm text-muted-foreground">High Risk</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-yellow-500/10 rounded-lg">
                <AlertTriangle className="h-5 w-5 text-yellow-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">{mediumRiskCount}</p>
                <p className="text-sm text-muted-foreground">Medium Risk</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-green-500/10 rounded-lg">
                <Lightbulb className="h-5 w-5 text-green-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">{pitchApplications.length}</p>
                <p className="text-sm text-muted-foreground">Our Applications</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="competitor">
        <TabsList>
          <TabsTrigger value="competitor">Competitor Patents ({industryPatents.length})</TabsTrigger>
          <TabsTrigger value="pitch">PITCH Applications ({pitchApplications.length})</TabsTrigger>
          <TabsTrigger value="byCompany">By Company</TabsTrigger>
        </TabsList>

        <TabsContent value="competitor" className="space-y-4">
          {/* Filters */}
          <div className="flex gap-4 items-center">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search patents..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="w-48">
                <Filter className="h-4 w-4 mr-2" />
                <SelectValue placeholder="Category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                {categories.map(cat => (
                  <SelectItem key={cat} value={cat!}>{cat}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={riskFilter} onValueChange={setRiskFilter}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder="Risk Level" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Risks</SelectItem>
                <SelectItem value="high">High Risk</SelectItem>
                <SelectItem value="medium">Medium Risk</SelectItem>
                <SelectItem value="low">Low Risk</SelectItem>
                <SelectItem value="none">No Risk</SelectItem>
              </SelectContent>
            </Select>
            <Button onClick={() => setAddPatentOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Add Patent
            </Button>
          </div>

          {/* Patents Table */}
          <Card>
            <ScrollArea className="h-[500px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Patent #</TableHead>
                    <TableHead>Title</TableHead>
                    <TableHead>Assignee</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Risk</TableHead>
                    <TableHead>Relevance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredPatents.map(patent => (
                    <TableRow key={patent.id}>
                      <TableCell className="font-mono text-sm">
                        <a 
                          href={`https://patents.google.com/patent/${patent.patent_number.replace(/[^A-Z0-9]/gi, '')}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary hover:underline flex items-center gap-1"
                        >
                          {patent.patent_number}
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      </TableCell>
                      <TableCell className="max-w-xs truncate" title={patent.title}>
                        {patent.title}
                      </TableCell>
                      <TableCell>{patent.assignee}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{patent.category}</Badge>
                      </TableCell>
                      <TableCell>{getStatusBadge(patent.status)}</TableCell>
                      <TableCell>{getRiskBadge(patent.risk_level)}</TableCell>
                      <TableCell className="max-w-xs text-sm text-muted-foreground truncate" title={patent.relevance_to_pitch || ''}>
                        {patent.relevance_to_pitch}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          </Card>
        </TabsContent>

        <TabsContent value="pitch" className="space-y-4">
          <div className="flex justify-end">
            <Button onClick={() => setAddApplicationOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              New Application Idea
            </Button>
          </div>

          <div className="grid gap-4">
            {pitchApplications.map(app => (
              <Card key={app.id}>
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div>
                      <CardTitle className="flex items-center gap-2">
                        <Lightbulb className="h-5 w-5 text-yellow-500" />
                        {app.working_title}
                      </CardTitle>
                      <CardDescription className="mt-1">
                        Category: {app.category}
                      </CardDescription>
                    </div>
                    <div className="flex gap-2">
                      {getPriorityBadge(app.priority_level)}
                      {getAppStatusBadge(app.status)}
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {app.description && (
                    <p className="text-sm text-muted-foreground">{app.description}</p>
                  )}
                  {app.key_claims && app.key_claims.length > 0 && (
                    <div>
                      <Label className="text-sm font-medium">Key Claims:</Label>
                      <ul className="list-disc list-inside mt-1 space-y-1">
                        {app.key_claims.map((claim, idx) => (
                          <li key={idx} className="text-sm text-muted-foreground">{claim}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {app.application_number && (
                    <p className="text-sm">
                      <span className="font-medium">Application #:</span> {app.application_number}
                    </p>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="byCompany" className="space-y-4">
          <div className="grid md:grid-cols-2 gap-4">
            {assignees.map(assignee => {
              const patents = industryPatents.filter(p => p.assignee === assignee);
              const highRisk = patents.filter(p => p.risk_level === 'high').length;
              return (
                <Card key={assignee}>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Building2 className="h-5 w-5" />
                      {assignee}
                    </CardTitle>
                    <CardDescription>
                      {patents.length} patents tracked • {highRisk} high risk
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ScrollArea className="h-40">
                      <ul className="space-y-2">
                        {patents.map(patent => (
                          <li key={patent.id} className="flex items-center justify-between text-sm">
                            <span className="truncate flex-1">{patent.title}</span>
                            {getRiskBadge(patent.risk_level)}
                          </li>
                        ))}
                      </ul>
                    </ScrollArea>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </TabsContent>
      </Tabs>

      {/* Add Patent Dialog */}
      <AddPatentDialog 
        open={addPatentOpen} 
        onOpenChange={setAddPatentOpen} 
        onSuccess={loadData}
      />

      {/* Add Application Dialog */}
      <AddApplicationDialog
        open={addApplicationOpen}
        onOpenChange={setAddApplicationOpen}
        onSuccess={loadData}
      />
    </div>
  );
};

// Add Patent Dialog Component
const AddPatentDialog = ({ open, onOpenChange, onSuccess }: { open: boolean; onOpenChange: (open: boolean) => void; onSuccess: () => void }) => {
  const [formData, setFormData] = useState({
    patent_number: '',
    title: '',
    assignee: '',
    category: '',
    status: 'active',
    risk_level: 'low',
    relevance_to_pitch: ''
  });
  const { toast } = useToast();

  const handleSubmit = async () => {
    try {
      const { error } = await supabase.from('industry_patents').insert(formData as any);
      if (error) throw error;
      toast({ title: "Patent added successfully" });
      onOpenChange(false);
      onSuccess();
      setFormData({ patent_number: '', title: '', assignee: '', category: '', status: 'active', risk_level: 'low', relevance_to_pitch: '' });
    } catch (error: any) {
      toast({ title: "Error adding patent", description: error.message, variant: "destructive" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Competitor Patent</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Patent Number</Label>
              <Input value={formData.patent_number} onChange={e => setFormData({...formData, patent_number: e.target.value})} placeholder="US8,078,436" />
            </div>
            <div>
              <Label>Assignee</Label>
              <Input value={formData.assignee} onChange={e => setFormData({...formData, assignee: e.target.value})} placeholder="Company name" />
            </div>
          </div>
          <div>
            <Label>Title</Label>
            <Input value={formData.title} onChange={e => setFormData({...formData, title: e.target.value})} placeholder="Patent title" />
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <Label>Category</Label>
              <Input value={formData.category} onChange={e => setFormData({...formData, category: e.target.value})} placeholder="e.g. roof_measurement" />
            </div>
            <div>
              <Label>Status</Label>
              <Select value={formData.status} onValueChange={v => setFormData({...formData, status: v})}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="expired">Expired</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Risk Level</Label>
              <Select value={formData.risk_level} onValueChange={v => setFormData({...formData, risk_level: v})}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="none">None</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label>Relevance to PITCH</Label>
            <Textarea value={formData.relevance_to_pitch} onChange={e => setFormData({...formData, relevance_to_pitch: e.target.value})} placeholder="How does this patent relate to our features?" />
          </div>
          <Button onClick={handleSubmit} className="w-full">Add Patent</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

// Add Application Dialog Component
const AddApplicationDialog = ({ open, onOpenChange, onSuccess }: { open: boolean; onOpenChange: (open: boolean) => void; onSuccess: () => void }) => {
  const [formData, setFormData] = useState({
    working_title: '',
    category: '',
    description: '',
    key_claims: '',
    priority_level: 'medium'
  });
  const { toast } = useToast();

  const handleSubmit = async () => {
    try {
      const { error } = await supabase.from('pitch_patent_applications').insert({
        working_title: formData.working_title,
        category: formData.category,
        description: formData.description,
        key_claims: formData.key_claims.split('\n').filter(c => c.trim()),
        priority_level: formData.priority_level
      } as any);
      if (error) throw error;
      toast({ title: "Application idea added successfully" });
      onOpenChange(false);
      onSuccess();
      setFormData({ working_title: '', category: '', description: '', key_claims: '', priority_level: 'medium' });
    } catch (error: any) {
      toast({ title: "Error adding application", description: error.message, variant: "destructive" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New Patent Application Idea</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Working Title</Label>
            <Input value={formData.working_title} onChange={e => setFormData({...formData, working_title: e.target.value})} placeholder="Descriptive patent title" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Category</Label>
              <Input value={formData.category} onChange={e => setFormData({...formData, category: e.target.value})} placeholder="e.g. ai_measurement" />
            </div>
            <div>
              <Label>Priority</Label>
              <Select value={formData.priority_level} onValueChange={v => setFormData({...formData, priority_level: v})}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="critical">Critical</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="low">Low</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label>Description</Label>
            <Textarea value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})} placeholder="Detailed description of the invention" />
          </div>
          <div>
            <Label>Key Claims (one per line)</Label>
            <Textarea value={formData.key_claims} onChange={e => setFormData({...formData, key_claims: e.target.value})} placeholder="Claim 1&#10;Claim 2&#10;Claim 3" rows={4} />
          </div>
          <Button onClick={handleSubmit} className="w-full">Add Application Idea</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
