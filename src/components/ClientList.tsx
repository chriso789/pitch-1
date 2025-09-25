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
  Search, 
  Plus, 
  MapPin, 
  Calendar, 
  DollarSign, 
  User,
  Eye,
  Phone,
  Mail,
  Building,
  Settings,
  Users,
  Briefcase
} from "lucide-react";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";

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
  contacts?: {
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

export const ClientList = () => {
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

      // Get user profile and preferences
      const { data: profile } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .maybeSingle();

      setUserProfile(profile);

      // Get user's preferred view setting
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
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Get user profile for role-based filtering
      const { data: profile } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .maybeSingle();

      // Fetch contacts with role-based filtering
      let contactsQuery = supabase
        .from("contacts")
        .select("*")
        .order("created_at", { ascending: false });

      // Fetch jobs with role-based filtering
      let jobsQuery = supabase
        .from("jobs")
        .select(`
          *,
          contacts (
            first_name,
            last_name,
            email,
            phone,
            address_street,
            address_city,
            address_state,
            location_id
          ),
          projects (
            name,
            estimated_completion_date,
            status
          )
        `)
        .order("created_at", { ascending: false });

      // Apply role-based filtering
      if (profile?.role === 'user' || profile?.role === 'manager') {
        // Get user's location assignments
        const { data: locationAssignments } = await supabase
          .from('user_location_assignments')
          .select('location_id')
          .eq('user_id', user.id)
          .eq('is_active', true);

        const assignedLocationIds = locationAssignments?.map(assignment => assignment.location_id) || [];

        if (assignedLocationIds.length > 0) {
          // Filter contacts by location
          contactsQuery = contactsQuery.or(`location_id.in.(${assignedLocationIds.join(',')}),location_id.is.null`);
          
          // Filter jobs by contact location
          const { data: contactsInLocations } = await supabase
            .from('contacts')
            .select('id')
            .or(`location_id.in.(${assignedLocationIds.join(',')}),location_id.is.null`);

          const contactIds = contactsInLocations?.map(contact => contact.id) || [];
          
          if (contactIds.length > 0) {
            jobsQuery = jobsQuery.in('contact_id', contactIds);
          } else {
            setJobs([]);
          }
        } else {
          // No locations assigned, show only items without location
          contactsQuery = contactsQuery.is('location_id', null);
          
          const { data: contactsWithoutLocation } = await supabase
            .from('contacts')
            .select('id')
            .is('location_id', null);

          const contactIds = contactsWithoutLocation?.map(contact => contact.id) || [];
          
          if (contactIds.length > 0) {
            jobsQuery = jobsQuery.in('contact_id', contactIds);
          } else {
            setJobs([]);
          }
        }
      }

      const [contactsResult, jobsResult] = await Promise.all([
        contactsQuery,
        jobsQuery
      ]);

      if (contactsResult.error) throw contactsResult.error;
      if (jobsResult.error) throw jobsResult.error;

      setContacts(contactsResult.data || []);
      setJobs((jobsResult.data as any) || []);
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

      // Search filter
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

      // Status filter
      if (statusFilter !== "all") {
        filtered = filtered.filter(contact => contact.qualification_status === statusFilter);
      }

      setFilteredData(filtered);
    } else {
      let filtered = jobs as Job[];

      // Search filter
      if (searchTerm) {
        filtered = filtered.filter(job => {
          return (
            job.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
            job.job_number?.toLowerCase().includes(searchTerm.toLowerCase()) ||
            `${job.contacts?.first_name} ${job.contacts?.last_name}`.toLowerCase().includes(searchTerm.toLowerCase()) ||
            job.contacts?.address_street?.toLowerCase().includes(searchTerm.toLowerCase())
          );
        });
      }

      // Status filter
      if (statusFilter !== "all") {
        filtered = filtered.filter(job => job.status === statusFilter);
      }

      setFilteredData(filtered);
    }
  };

  const getStatusColor = (status: string, type: 'contact' | 'job') => {
    if (type === 'contact') {
      switch (status) {
        case 'qualified': return 'bg-green-100 text-green-800 border-green-300';
        case 'unqualified': return 'bg-gray-100 text-gray-800 border-gray-300';
        case 'hot': return 'bg-red-100 text-red-800 border-red-300';
        case 'warm': return 'bg-yellow-100 text-yellow-800 border-yellow-300';
        case 'cold': return 'bg-blue-100 text-blue-800 border-blue-300';
        default: return 'bg-gray-100 text-gray-800 border-gray-300';
      }
    } else {
      switch (status?.toLowerCase()) {
        case 'pending': return 'bg-yellow-100 text-yellow-800 border-yellow-300';
        case 'in_progress': return 'bg-blue-100 text-blue-800 border-blue-300';
        case 'completed': return 'bg-green-100 text-green-800 border-green-300';
        case 'cancelled': return 'bg-red-100 text-red-800 border-red-300';
        default: return 'bg-gray-100 text-gray-800 border-gray-300';
      }
    }
  };

  const formatStatus = (status: string) => {
    return status?.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()) || 'Unknown';
  };

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
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Client List</h1>
          <p className="text-muted-foreground">
            Manage your contacts and jobs in one place
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => savePreferredView(activeView)}
          >
            <Settings className="h-4 w-4 mr-2" />
            Set as Default
          </Button>
          <Button onClick={() => {
            if (activeView === 'contacts') {
              navigate('/contact/new');
            } else {
              navigate('/job/new');
            }
          }}>
            <Plus className="h-4 w-4 mr-2" />
            New {activeView === 'contacts' ? 'Contact' : 'Job'}
          </Button>
        </div>
      </div>

      {/* View Switcher and Filters */}
      <Card>
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
                  className="pl-10"
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

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">
                  Total {activeView === 'contacts' ? 'Contacts' : 'Jobs'}
                </p>
                <p className="text-2xl font-bold">
                  {activeView === 'contacts' ? contacts.length : jobs.length}
                </p>
              </div>
              <div className="h-8 w-8 bg-primary/10 rounded-lg flex items-center justify-center">
                {activeView === 'contacts' ? (
                  <Users className="h-4 w-4 text-primary" />
                ) : (
                  <Briefcase className="h-4 w-4 text-primary" />
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {activeView === 'contacts' ? (
          <>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Qualified</p>
                    <p className="text-2xl font-bold">
                      {contacts.filter(c => c.qualification_status === 'qualified').length}
                    </p>
                  </div>
                  <div className="h-8 w-8 bg-green-100 rounded-lg flex items-center justify-center">
                    <User className="h-4 w-4 text-green-600" />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Hot Leads</p>
                    <p className="text-2xl font-bold">
                      {contacts.filter(c => c.qualification_status === 'hot').length}
                    </p>
                  </div>
                  <div className="h-8 w-8 bg-red-100 rounded-lg flex items-center justify-center">
                    <DollarSign className="h-4 w-4 text-red-600" />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Avg Score</p>
                    <p className="text-2xl font-bold">
                      {contacts.length > 0 
                        ? Math.round(contacts.reduce((sum, c) => sum + (c.lead_score || 0), 0) / contacts.length)
                        : 0
                      }
                    </p>
                  </div>
                  <div className="h-8 w-8 bg-blue-100 rounded-lg flex items-center justify-center">
                    <Calendar className="h-4 w-4 text-blue-600" />
                  </div>
                </div>
              </CardContent>
            </Card>
          </>
        ) : (
          <>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Active</p>
                    <p className="text-2xl font-bold">
                      {jobs.filter(j => j.status === 'in_progress').length}
                    </p>
                  </div>
                  <div className="h-8 w-8 bg-blue-100 rounded-lg flex items-center justify-center">
                    <MapPin className="h-4 w-4 text-blue-600" />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Pending</p>
                    <p className="text-2xl font-bold">
                      {jobs.filter(j => j.status === 'pending').length}
                    </p>
                  </div>
                  <div className="h-8 w-8 bg-yellow-100 rounded-lg flex items-center justify-center">
                    <Calendar className="h-4 w-4 text-yellow-600" />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Completed</p>
                    <p className="text-2xl font-bold">
                      {jobs.filter(j => j.status === 'completed').length}
                    </p>
                  </div>
                  <div className="h-8 w-8 bg-green-100 rounded-lg flex items-center justify-center">
                    <DollarSign className="h-4 w-4 text-green-600" />
                  </div>
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </div>

      {/* Data List */}
      <div className="grid gap-4">
        {filteredData.length === 0 ? (
          <Card>
            <CardContent className="p-8 text-center">
              <div className="text-muted-foreground mb-4">
                {activeView === 'contacts' ? (
                  <Users className="h-12 w-12 mx-auto mb-4 opacity-50" />
                ) : (
                  <Briefcase className="h-12 w-12 mx-auto mb-4 opacity-50" />
                )}
                <h3 className="text-lg font-semibold mb-2">
                  No {activeView} found
                </h3>
                <p>
                  {searchTerm || statusFilter !== 'all'
                    ? "Try adjusting your search or filters"
                    : `Create your first ${activeView === 'contacts' ? 'contact' : 'job'} to get started`}
                </p>
              </div>
              {!searchTerm && statusFilter === 'all' && (
                <Button onClick={() => {
                  if (activeView === 'contacts') {
                    navigate('/contact/new');
                  } else {
                    navigate('/job/new');
                  }
                }}>
                  <Plus className="h-4 w-4 mr-2" />
                  Create First {activeView === 'contacts' ? 'Contact' : 'Job'}
                </Button>
              )}
            </CardContent>
          </Card>
        ) : (
          filteredData.map((item) => (
            <Card key={item.id} className="hover:shadow-md transition-shadow">
              <CardContent className="p-6">
                {activeView === 'contacts' ? (
                  <ContactCard contact={item as Contact} onViewDetails={(id) => navigate(`/contact/${id}`)} />
                ) : (
                  <JobCard job={item as Job} onViewDetails={(id) => navigate(`/job/${id}`)} />
                )}
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
};

// Contact Card Component
const ContactCard = ({ contact, onViewDetails }: { contact: Contact; onViewDetails: (id: string) => void }) => (
  <div className="flex items-start justify-between">
    <div className="flex-1 space-y-3">
      <div className="flex items-center gap-3">
        <h3 className="text-lg font-semibold">
          {contact.first_name} {contact.last_name}
        </h3>
        <Badge variant="outline" className="text-xs">
          {contact.contact_number}
        </Badge>
        <Badge className={`text-xs ${getStatusColor(contact.qualification_status, 'contact')}`}>
          {formatStatus(contact.qualification_status)}
        </Badge>
        {contact.lead_score > 0 && (
          <Badge variant="secondary" className="text-xs">
            Score: {contact.lead_score}
          </Badge>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm text-muted-foreground">
        {contact.email && (
          <div className="flex items-center gap-2">
            <Mail className="h-4 w-4" />
            <span>{contact.email}</span>
          </div>
        )}
        
        {contact.phone && (
          <div className="flex items-center gap-2">
            <Phone className="h-4 w-4" />
            <span>{contact.phone}</span>
          </div>
        )}

        {contact.company_name && (
          <div className="flex items-center gap-2">
            <Building className="h-4 w-4" />
            <span>{contact.company_name}</span>
          </div>
        )}

        {contact.address_street && (
          <div className="flex items-center gap-2">
            <MapPin className="h-4 w-4" />
            <span>
              {contact.address_street}, {contact.address_city}, {contact.address_state}
            </span>
          </div>
        )}

        <div className="flex items-center gap-2">
          <Calendar className="h-4 w-4" />
          <span>
            Added: {new Date(contact.created_at).toLocaleDateString()}
          </span>
        </div>

        {contact.lead_source && (
          <div className="flex items-center gap-2">
            <User className="h-4 w-4" />
            <span>Source: {contact.lead_source}</span>
          </div>
        )}
      </div>

      {contact.tags && contact.tags.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          {contact.tags.map((tag, index) => (
            <Badge key={index} variant="outline" className="text-xs">
              {tag}
            </Badge>
          ))}
        </div>
      )}
    </div>

    <div className="flex items-center gap-2 ml-4">
      <Button
        variant="outline"
        size="sm"
        onClick={() => onViewDetails(contact.id)}
      >
        <Eye className="h-4 w-4 mr-2" />
        View Details
      </Button>
    </div>
  </div>
);

// Job Card Component
const JobCard = ({ job, onViewDetails }: { job: Job; onViewDetails: (id: string) => void }) => (
  <div className="flex items-start justify-between">
    <div className="flex-1 space-y-3">
      <div className="flex items-center gap-3">
        <h3 className="text-lg font-semibold">
          {job.name}
        </h3>
        <Badge variant="outline" className="text-xs">
          {job.job_number}
        </Badge>
        <Badge className={`text-xs ${getStatusColor(job.status, 'job')}`}>
          {formatStatus(job.status)}
        </Badge>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm text-muted-foreground">
        <div className="flex items-center gap-2">
          <User className="h-4 w-4" />
          <span>
            {job.contacts?.first_name} {job.contacts?.last_name}
          </span>
        </div>
        
        {job.contacts?.address_street && (
          <div className="flex items-center gap-2">
            <MapPin className="h-4 w-4" />
            <span>
              {job.contacts.address_street}, {job.contacts.address_city}, {job.contacts.address_state}
            </span>
          </div>
        )}

        <div className="flex items-center gap-2">
          <Calendar className="h-4 w-4" />
          <span>
            Created: {new Date(job.created_at).toLocaleDateString()}
          </span>
        </div>

        {job.projects?.estimated_completion_date && (
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4" />
            <span>
              Due: {new Date(job.projects.estimated_completion_date).toLocaleDateString()}
            </span>
          </div>
        )}
      </div>

      {job.description && (
        <p className="text-sm text-muted-foreground line-clamp-2">
          {job.description}
        </p>
      )}
    </div>

    <div className="flex items-center gap-2 ml-4">
      <Button
        variant="outline"
        size="sm"
        onClick={() => onViewDetails(job.id)}
      >
        <Eye className="h-4 w-4 mr-2" />
        View Details
      </Button>
    </div>
  </div>
);

// Helper functions (moved outside component)
const getStatusColor = (status: string, type: 'contact' | 'job') => {
  if (type === 'contact') {
    switch (status) {
      case 'qualified': return 'bg-green-100 text-green-800 border-green-300';
      case 'unqualified': return 'bg-gray-100 text-gray-800 border-gray-300';
      case 'hot': return 'bg-red-100 text-red-800 border-red-300';
      case 'warm': return 'bg-yellow-100 text-yellow-800 border-yellow-300';
      case 'cold': return 'bg-blue-100 text-blue-800 border-blue-300';
      default: return 'bg-gray-100 text-gray-800 border-gray-300';
    }
  } else {
    switch (status?.toLowerCase()) {
      case 'pending': return 'bg-yellow-100 text-yellow-800 border-yellow-300';
      case 'in_progress': return 'bg-blue-100 text-blue-800 border-blue-300';
      case 'completed': return 'bg-green-100 text-green-800 border-green-300';
      case 'cancelled': return 'bg-red-100 text-red-800 border-red-300';
      default: return 'bg-gray-100 text-gray-800 border-gray-300';
    }
  }
};

const formatStatus = (status: string) => {
  return status?.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()) || 'Unknown';
};