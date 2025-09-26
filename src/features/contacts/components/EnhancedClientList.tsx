import React, { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { 
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { 
  Search, 
  Users, 
  Star, 
  TrendingUp, 
  Calendar,
  Eye,
  Phone,
  Mail,
  MapPin,
  Building,
  Settings,
  Briefcase,
  ArrowUpDown,
  Activity,
  Target,
  Award
} from "lucide-react";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import ContactFormDialog from "@/components/ContactFormDialog";

interface Contact {
  id: string;
  contact_number: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  company_name: string;
  address_street: string;
  address_city: string;
  address_state: string;
  address_zip: string;
  type: string;
  created_at: string;
  tags: string[];
  lead_source: string;
  lead_score: number;
  qualification_status: string;
  location_id: string;
}

interface Job {
  id: string;
  job_number: string;
  name: string;
  description: string;
  status: string;
  created_at: string;
  updated_at: string;
  contact_id: string;
  project_id: string;
  contact?: {
    first_name: string;
    last_name: string;
    email: string;
    phone: string;
    address_street: string;
    address_city: string;
    address_state: string;
    location_id: string;
  };
  projects?: {
    name: string;
    estimated_completion_date: string;
    status: string;
  };
}

type ViewType = 'contacts' | 'jobs';

export const EnhancedClientList = () => {
  const navigate = useNavigate();
  const [activeView, setActiveView] = useState<ViewType>('contacts');
  const [preferredView, setPreferredView] = useState<ViewType>('contacts');
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  
  const [filteredData, setFilteredData] = useState<Contact[] | Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [userProfile, setUserProfile] = useState<any>(null);
  const [sortField, setSortField] = useState<string>('created_at');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');

  useEffect(() => {
    loadUserPreferences();
    fetchData();
  }, []);

  useEffect(() => {
    setActiveView(preferredView);
  }, [preferredView]);

  useEffect(() => {
    filterData();
  }, [contacts, jobs, activeView, searchTerm, statusFilter]);

  const loadUserPreferences = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: profile } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .maybeSingle();

      setUserProfile(profile);

      const { data: setting } = await supabase
        .from('app_settings')
        .select('setting_value')
        .eq('user_id', user.id)
        .eq('setting_key', 'preferred_client_view')
        .maybeSingle();

      if (setting?.setting_value) {
        const preferred = setting.setting_value as ViewType;
        setPreferredView(preferred);
      }
    } catch (error) {
      console.error('Error loading user preferences:', error);
    }
  };

  const savePreferredView = async (view: ViewType) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { error } = await supabase
        .from('app_settings')
        .upsert({
          user_id: user.id,
          tenant_id: userProfile?.tenant_id,
          setting_key: 'preferred_client_view',
          setting_value: view
        });

      if (error) throw error;

      setPreferredView(view);
      toast.success(`Preferred view set to ${view === 'contacts' ? 'Contacts' : 'Jobs'}`);
    } catch (error) {
      console.error('Error saving preference:', error);
      toast.error('Failed to save preference');
    }
  };

  const fetchData = async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        console.log("No authenticated user found");
        return;
      }

      const { data: profile } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .maybeSingle();

      if (!profile) {
        console.log("No profile found for user");
        return;
      }

      console.log("User profile:", profile);
      setUserProfile(profile);

      // Query contacts with proper tenant filtering
      console.log("Fetching contacts...");
      const { data: contactsData, error: contactsError } = await supabase
        .from("contacts")
        .select("*")
        .eq('tenant_id', profile.tenant_id)
        .eq('is_deleted', false)
        .order("created_at", { ascending: false });

      if (contactsError) {
        console.error("Contacts query error:", contactsError);
        throw contactsError;
      }

      console.log("Contacts fetched:", contactsData?.length || 0);

      // Query jobs with proper tenant filtering and separately fetch contacts
      console.log("Fetching jobs...");
      const { data: jobsData, error: jobsError } = await supabase
        .from("jobs")
        .select("*")
        .eq('tenant_id', profile.tenant_id)
        .order("created_at", { ascending: false });

      if (jobsError) {
        console.error("Jobs query error:", jobsError);
        throw jobsError;
      }

      console.log("Jobs fetched:", jobsData?.length || 0);

      // Enhance jobs with contact information
      const enhancedJobs = await Promise.all(
        (jobsData || []).map(async (job) => {
          const { data: contactData } = await supabase
            .from("contacts")
            .select("first_name, last_name, email, phone, address_street, address_city, address_state, location_id")
            .eq("id", job.contact_id)
            .eq('tenant_id', profile.tenant_id)
            .maybeSingle();

          return {
            ...job,
            contact: contactData
          };
        })
      );

      setContacts(contactsData || []);
      setJobs(enhancedJobs || []);
    } catch (error) {
      console.error("Error fetching data:", error);
      toast.error("Failed to load client data");
    } finally {
      setLoading(false);
    }
  };

  const filterData = () => {
    if (activeView === 'contacts') {
      let filtered = contacts as Contact[];

      if (searchTerm) {
        filtered = filtered.filter(contact => {
          return (
            contact.first_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
            contact.last_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
            contact.email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
            contact.phone?.includes(searchTerm) ||
            contact.company_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
            contact.contact_number?.toLowerCase().includes(searchTerm.toLowerCase()) ||
            contact.address_street?.toLowerCase().includes(searchTerm.toLowerCase())
          );
        });
      }

      if (statusFilter !== "all") {
        filtered = filtered.filter(contact => contact.qualification_status === statusFilter);
      }

      filtered = sortData(filtered, activeView);
      setFilteredData(filtered);
    } else {
      let filtered = jobs as Job[];

      if (searchTerm) {
        filtered = filtered.filter(job => {
          return (
            job.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
            job.job_number?.toLowerCase().includes(searchTerm.toLowerCase()) ||
            `${job.contact?.first_name} ${job.contact?.last_name}`.toLowerCase().includes(searchTerm.toLowerCase()) ||
            job.contact?.address_street?.toLowerCase().includes(searchTerm.toLowerCase())
          );
        });
      }

      if (statusFilter !== "all") {
        filtered = filtered.filter(job => job.status === statusFilter);
      }

      filtered = sortData(filtered, activeView);
      setFilteredData(filtered);
    }
  };

  const sortData = (data: any[], viewType: ViewType) => {
    return [...data].sort((a, b) => {
      let aValue, bValue;
      
      if (viewType === 'contacts') {
        switch (sortField) {
          case 'name':
            aValue = `${a.first_name} ${a.last_name}`.toLowerCase();
            bValue = `${b.first_name} ${b.last_name}`.toLowerCase();
            break;
          case 'email':
            aValue = a.email?.toLowerCase() || '';
            bValue = b.email?.toLowerCase() || '';
            break;
          case 'phone':
            aValue = a.phone || '';
            bValue = b.phone || '';
            break;
          case 'company_name':
            aValue = a.company_name?.toLowerCase() || '';
            bValue = b.company_name?.toLowerCase() || '';
            break;
          case 'qualification_status':
            aValue = a.qualification_status?.toLowerCase() || '';
            bValue = b.qualification_status?.toLowerCase() || '';
            break;
          case 'lead_score':
            aValue = a.lead_score || 0;
            bValue = b.lead_score || 0;
            break;
          case 'created_at':
          default:
            aValue = new Date(a.created_at);
            bValue = new Date(b.created_at);
            break;
        }
      } else {
        switch (sortField) {
          case 'name':
            aValue = a.name?.toLowerCase() || '';
            bValue = b.name?.toLowerCase() || '';
            break;
          case 'contact_name':
            aValue = `${a.contacts?.first_name} ${a.contacts?.last_name}`.toLowerCase();
            bValue = `${b.contacts?.first_name} ${b.contacts?.last_name}`.toLowerCase();
            break;
          case 'status':
            aValue = a.status?.toLowerCase() || '';
            bValue = b.status?.toLowerCase() || '';
            break;
          case 'created_at':
          default:
            aValue = new Date(a.created_at);
            bValue = new Date(b.created_at);
            break;
        }
      }

      if (aValue < bValue) return sortDirection === 'asc' ? -1 : 1;
      if (aValue > bValue) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
  };

  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const getStatusColor = (status: string) => {
    const statusColors: { [key: string]: string } = {
      // Contact statuses
      lead: "bg-status-lead text-warning-foreground",
      qualified: "bg-status-project text-success-foreground", 
      unqualified: "bg-status-closed text-muted-foreground",
      hot: "bg-destructive text-destructive-foreground",
      warm: "bg-status-legal text-secondary-foreground",
      cold: "bg-muted text-muted-foreground",
      // Job statuses
      pending: "bg-status-lead text-warning-foreground",
      in_progress: "bg-status-project text-success-foreground",
      completed: "bg-status-completed text-success-foreground",
      cancelled: "bg-destructive text-destructive-foreground",
    };
    
    return statusColors[status] || "bg-muted text-muted-foreground";
  };

  const formatStatus = (status: string) => {
    return status?.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()) || '';
  };

  const handleContactCreated = (newContact: any) => {
    fetchData(); // Refresh the data
    toast.success(`Contact ${newContact.first_name} ${newContact.last_name} created successfully!`);
  };

  // Calculate statistics
  const totalContacts = contacts.length;
  const qualifiedContacts = contacts.filter(c => c.qualification_status === 'qualified').length;
  const hotContacts = contacts.filter(c => c.qualification_status === 'hot').length;
  const avgScore = contacts.length > 0 ? Math.round(contacts.reduce((sum, c) => sum + (c.lead_score || 0), 0) / contacts.length) : 0;

  const totalJobs = jobs.length;
  const activeJobs = jobs.filter(j => j.status === 'in_progress').length;
  const pendingJobs = jobs.filter(j => j.status === 'pending').length;
  const completedJobs = jobs.filter(j => j.status === 'completed').length;

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading client data...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight gradient-primary bg-clip-text text-transparent">
            Client Management
          </h1>
          <p className="text-muted-foreground mt-1">
            Manage your contacts and jobs with professional CRM tools
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => savePreferredView(activeView)}
            className="shadow-soft transition-smooth"
          >
            <Settings className="h-4 w-4 mr-2" />
            Set as Default
          </Button>
          <ContactFormDialog 
            onContactCreated={handleContactCreated}
            buttonText={`New ${activeView === 'contacts' ? 'Contact' : 'Job'}`}
          />
        </div>
      </div>

      {/* Statistics Dashboard */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="shadow-soft transition-smooth hover:shadow-medium">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">
                  Total {activeView === 'contacts' ? 'Contacts' : 'Jobs'}
                </p>
                <p className="text-2xl font-bold text-foreground">
                  {activeView === 'contacts' ? totalContacts : totalJobs}
                </p>
              </div>
              <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center">
                {activeView === 'contacts' ? (
                  <Users className="h-6 w-6 text-primary" />
                ) : (
                  <Briefcase className="h-6 w-6 text-primary" />
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-soft transition-smooth hover:shadow-medium">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">
                  {activeView === 'contacts' ? 'Qualified' : 'Active'}
                </p>
                <p className="text-2xl font-bold text-success">
                  {activeView === 'contacts' ? qualifiedContacts : activeJobs}
                </p>
              </div>
              <div className="h-12 w-12 rounded-lg bg-success/10 flex items-center justify-center">
                <Target className="h-6 w-6 text-success" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-soft transition-smooth hover:shadow-medium">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">
                  {activeView === 'contacts' ? 'Hot Leads' : 'Pending'}
                </p>
                <p className="text-2xl font-bold text-secondary">
                  {activeView === 'contacts' ? hotContacts : pendingJobs}
                </p>
              </div>
              <div className="h-12 w-12 rounded-lg bg-secondary/10 flex items-center justify-center">
                <Activity className="h-6 w-6 text-secondary" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-soft transition-smooth hover:shadow-medium">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">
                  {activeView === 'contacts' ? 'Avg Score' : 'Completed'}
                </p>
                <p className="text-2xl font-bold text-primary">
                  {activeView === 'contacts' ? `${avgScore}%` : completedJobs}
                </p>
              </div>
              <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center">
                <Award className="h-6 w-6 text-primary" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters and Controls */}
      <Card className="shadow-soft">
        <CardContent className="p-4">
          <div className="flex flex-col md:flex-row gap-4">
            {/* View Type Selector */}
            <div className="flex items-center gap-2">
              <Select value={activeView} onValueChange={(value: ViewType) => setActiveView(value)}>
                <SelectTrigger className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="contacts">
                    <div className="flex items-center gap-2">
                      <Users className="h-4 w-4" />
                      Contacts
                    </div>
                  </SelectItem>
                  <SelectItem value="jobs">
                    <div className="flex items-center gap-2">
                      <Briefcase className="h-4 w-4" />
                      Jobs
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Search */}
            <div className="flex-1">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
                <Input
                  placeholder={`Search ${activeView}...`}
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10 shadow-soft"
                />
              </div>
            </div>

            {/* Status Filter */}
            <div className="flex gap-2">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-40">
                  <SelectValue placeholder="Filter by status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  {activeView === 'contacts' ? (
                    <>
                      <SelectItem value="lead">Lead</SelectItem>
                      <SelectItem value="qualified">Qualified</SelectItem>
                      <SelectItem value="unqualified">Unqualified</SelectItem>
                      <SelectItem value="hot">Hot</SelectItem>
                      <SelectItem value="warm">Warm</SelectItem>
                      <SelectItem value="cold">Cold</SelectItem>
                    </>
                  ) : (
                    <>
                      <SelectItem value="pending">Pending</SelectItem>
                      <SelectItem value="in_progress">In Progress</SelectItem>
                      <SelectItem value="completed">Completed</SelectItem>
                      <SelectItem value="cancelled">Cancelled</SelectItem>
                    </>
                  )}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Main Data Table */}
      <Card className="shadow-medium">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {activeView === 'contacts' ? <Users className="h-5 w-5" /> : <Briefcase className="h-5 w-5" />}
            {activeView === 'contacts' ? 'Contacts' : 'Jobs'} ({filteredData.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {filteredData.length === 0 ? (
            <div className="text-center py-12">
              <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center mx-auto mb-4">
                {activeView === 'contacts' ? <Users className="h-8 w-8 text-muted-foreground" /> : <Briefcase className="h-8 w-8 text-muted-foreground" />}
              </div>
              <h3 className="text-lg font-semibold mb-2">No {activeView} found</h3>
              <p className="text-muted-foreground mb-4">
                {searchTerm || statusFilter !== "all" 
                  ? `No ${activeView} match your current filters.`
                  : `Get started by creating your first ${activeView === 'contacts' ? 'contact' : 'job'}.`
                }
              </p>
              {!searchTerm && statusFilter === "all" && (
                <ContactFormDialog 
                  onContactCreated={handleContactCreated}
                  buttonText={`Create First ${activeView === 'contacts' ? 'Contact' : 'Job'}`}
                  buttonVariant="outline"
                />
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-b">
                    {activeView === 'contacts' ? (
                      <>
                        <TableHead className="w-[50px]">#</TableHead>
                        <TableHead>
                          <Button variant="ghost" onClick={() => handleSort('name')} className="p-0 h-auto font-medium">
                            Name <ArrowUpDown className="ml-2 h-4 w-4" />
                          </Button>
                        </TableHead>
                        <TableHead>
                          <Button variant="ghost" onClick={() => handleSort('email')} className="p-0 h-auto font-medium">
                            Contact <ArrowUpDown className="ml-2 h-4 w-4" />
                          </Button>
                        </TableHead>
                        <TableHead>Company</TableHead>
                        <TableHead>
                          <Button variant="ghost" onClick={() => handleSort('qualification_status')} className="p-0 h-auto font-medium">
                            Status <ArrowUpDown className="ml-2 h-4 w-4" />
                          </Button>
                        </TableHead>
                        <TableHead>
                          <Button variant="ghost" onClick={() => handleSort('lead_score')} className="p-0 h-auto font-medium">
                            Score <ArrowUpDown className="ml-2 h-4 w-4" />
                          </Button>
                        </TableHead>
                        <TableHead>Address</TableHead>
                        <TableHead>Actions</TableHead>
                      </>
                    ) : (
                      <>
                        <TableHead className="w-[50px]">#</TableHead>
                        <TableHead>
                          <Button variant="ghost" onClick={() => handleSort('name')} className="p-0 h-auto font-medium">
                            Job Name <ArrowUpDown className="ml-2 h-4 w-4" />
                          </Button>
                        </TableHead>
                        <TableHead>
                          <Button variant="ghost" onClick={() => handleSort('contact_name')} className="p-0 h-auto font-medium">
                            Contact <ArrowUpDown className="ml-2 h-4 w-4" />
                          </Button>
                        </TableHead>
                        <TableHead>
                          <Button variant="ghost" onClick={() => handleSort('status')} className="p-0 h-auto font-medium">
                            Status <ArrowUpDown className="ml-2 h-4 w-4" />
                          </Button>
                        </TableHead>
                        <TableHead>Location</TableHead>
                        <TableHead>Created</TableHead>
                        <TableHead>Actions</TableHead>
                      </>
                    )}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredData.map((item: any, index) => (
                    <TableRow key={item.id} className="hover:bg-muted/50 transition-colors">
                      {activeView === 'contacts' ? (
                        <>
                          <TableCell className="font-mono text-xs text-muted-foreground">
                            {item.contact_number || `C-${String(index + 1).padStart(3, '0')}`}
                          </TableCell>
                          <TableCell>
                            <div className="font-medium">{item.first_name} {item.last_name}</div>
                            <div className="text-sm text-muted-foreground">{item.type}</div>
                          </TableCell>
                          <TableCell>
                            <div className="space-y-1">
                              {item.email && (
                                <div className="flex items-center gap-2 text-sm">
                                  <Mail className="h-3 w-3 text-muted-foreground" />
                                  <span className="truncate">{item.email}</span>
                                </div>
                              )}
                              {item.phone && (
                                <div className="flex items-center gap-2 text-sm">
                                  <Phone className="h-3 w-3 text-muted-foreground" />
                                  <span>{item.phone}</span>
                                </div>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            {item.company_name && (
                              <div className="flex items-center gap-2">
                                <Building className="h-3 w-3 text-muted-foreground" />
                                <span className="text-sm">{item.company_name}</span>
                              </div>
                            )}
                          </TableCell>
                          <TableCell>
                            <Badge className={getStatusColor(item.qualification_status)}>
                              {formatStatus(item.qualification_status)}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <Star className="h-4 w-4 text-warning fill-warning" />
                              <span className="font-medium">{item.lead_score || 0}</span>
                            </div>
                          </TableCell>
                          <TableCell>
                            {item.address_street && (
                              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                <MapPin className="h-3 w-3" />
                                <span className="truncate max-w-[200px]">
                                  {item.address_street}, {item.address_city}
                                </span>
                              </div>
                            )}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => navigate(`/contact/${item.id}`)}
                              >
                                <Eye className="h-4 w-4" />
                              </Button>
                              {item.phone && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => window.open(`tel:${item.phone}`)}
                                >
                                  <Phone className="h-4 w-4" />
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        </>
                      ) : (
                        <>
                          <TableCell className="font-mono text-xs text-muted-foreground">
                            {item.job_number || `J-${String(index + 1).padStart(3, '0')}`}
                          </TableCell>
                          <TableCell>
                            <div className="font-medium">{item.name}</div>
                            <div className="text-sm text-muted-foreground truncate max-w-[200px]">
                              {item.description}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="font-medium">
                              {item.contact?.first_name} {item.contact?.last_name}
                            </div>
                            <div className="text-sm text-muted-foreground">{item.contact?.email}</div>
                          </TableCell>
                          <TableCell>
                            <Badge className={getStatusColor(item.status)}>
                              {formatStatus(item.status)}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            {item.contact?.address_street && (
                              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                <MapPin className="h-3 w-3" />
                                <span className="truncate max-w-[200px]">
                                  {item.contact.address_street}
                                </span>
                              </div>
                            )}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                              <Calendar className="h-3 w-3" />
                              {new Date(item.created_at).toLocaleDateString()}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => navigate(`/job/${item.id}`)}
                              >
                                <Eye className="h-4 w-4" />
                              </Button>
                            </div>
                          </TableCell>
                        </>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default EnhancedClientList;