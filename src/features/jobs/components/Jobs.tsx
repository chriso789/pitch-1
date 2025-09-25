import React, { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { 
  Search, 
  Plus, 
  MapPin, 
  Calendar, 
  DollarSign, 
  User,
  Filter,
  Eye
} from "lucide-react";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";

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
  tenant_id: string;
  created_by: string;
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

export const Jobs = () => {
  const navigate = useNavigate();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [filteredJobs, setFilteredJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  useEffect(() => {
    fetchJobs();
  }, []);

  useEffect(() => {
    filterJobs();
  }, [jobs, searchTerm, statusFilter]);

  const fetchJobs = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Get user profile for role-based filtering
      const { data: profile } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .maybeSingle();

      let query = supabase
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

      // Apply role-based filtering for users and managers
      if (profile?.role === 'user' || profile?.role === 'manager') {
        // Get user's location assignments
        const { data: locationAssignments } = await supabase
          .from('user_location_assignments')
          .select('location_id')
          .eq('user_id', user.id)
          .eq('is_active', true);

        const assignedLocationIds = locationAssignments?.map(assignment => assignment.location_id) || [];

        if (assignedLocationIds.length > 0) {
          // Filter jobs by contact location
          const { data: contactsInLocations } = await supabase
            .from('contacts')
            .select('id')
            .or(`location_id.in.(${assignedLocationIds.join(',')}),location_id.is.null`);

          const contactIds = contactsInLocations?.map(contact => contact.id) || [];
          
          if (contactIds.length > 0) {
            query = query.in('contact_id', contactIds);
          } else {
            // No contacts in assigned locations, return empty
            setJobs([]);
            setFilteredJobs([]);
            setLoading(false);
            return;
          }
        } else {
          // No locations assigned, show jobs for contacts without location
          const { data: contactsWithoutLocation } = await supabase
            .from('contacts')
            .select('id')
            .is('location_id', null);

          const contactIds = contactsWithoutLocation?.map(contact => contact.id) || [];
          
          if (contactIds.length > 0) {
            query = query.in('contact_id', contactIds);
          } else {
            setJobs([]);
            setFilteredJobs([]);
            setLoading(false);
            return;
          }
        }
      }
      // Admins and masters see all jobs (no additional filtering)

      const { data, error } = await query;

      if (error) throw error;
      setJobs((data as any) || []);
    } catch (error) {
      console.error("Error fetching jobs:", error);
      toast.error("Failed to load jobs");
    } finally {
      setLoading(false);
    }
  };

  const filterJobs = () => {
    let filtered = jobs;

    // Search filter
    if (searchTerm) {
      filtered = filtered.filter(job =>
        job.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        job.job_number.toLowerCase().includes(searchTerm.toLowerCase()) ||
        `${job.contacts?.first_name} ${job.contacts?.last_name}`.toLowerCase().includes(searchTerm.toLowerCase()) ||
        job.contacts?.address_street?.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }

    // Status filter
    if (statusFilter !== "all") {
      filtered = filtered.filter(job => job.status === statusFilter);
    }

    setFilteredJobs(filtered);
  };

  const getStatusColor = (status: string) => {
    switch (status.toLowerCase()) {
      case 'pending':
        return 'bg-yellow-100 text-yellow-800 border-yellow-300';
      case 'in_progress':
        return 'bg-blue-100 text-blue-800 border-blue-300';
      case 'completed':
        return 'bg-green-100 text-green-800 border-green-300';
      case 'cancelled':
        return 'bg-red-100 text-red-800 border-red-300';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-300';
    }
  };

  const formatStatus = (status: string) => {
    return status.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading jobs...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Jobs</h1>
          <p className="text-muted-foreground">
            Manage and track all your roofing jobs
          </p>
        </div>
        <Button onClick={() => navigate('/job/new')}>
          <Plus className="h-4 w-4 mr-2" />
          New Job
        </Button>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-1">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
                <Input
                  placeholder="Search jobs, job numbers, or customers..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>
            <div className="flex gap-2">
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="px-3 py-2 border border-input bg-background rounded-md text-sm"
              >
                <option value="all">All Statuses</option>
                <option value="pending">Pending</option>
                <option value="in_progress">In Progress</option>
                <option value="completed">Completed</option>
                <option value="cancelled">Cancelled</option>
              </select>
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
                <p className="text-sm font-medium text-muted-foreground">Total Jobs</p>
                <p className="text-2xl font-bold">{jobs.length}</p>
              </div>
              <div className="h-8 w-8 bg-primary/10 rounded-lg flex items-center justify-center">
                <User className="h-4 w-4 text-primary" />
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
                  {jobs.filter(job => job.status === 'pending').length}
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
                <p className="text-sm font-medium text-muted-foreground">In Progress</p>
                <p className="text-2xl font-bold">
                  {jobs.filter(job => job.status === 'in_progress').length}
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
                <p className="text-sm font-medium text-muted-foreground">Completed</p>
                <p className="text-2xl font-bold">
                  {jobs.filter(job => job.status === 'completed').length}
                </p>
              </div>
              <div className="h-8 w-8 bg-green-100 rounded-lg flex items-center justify-center">
                <DollarSign className="h-4 w-4 text-green-600" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Jobs List */}
      <div className="grid gap-4">
        {filteredJobs.length === 0 ? (
          <Card>
            <CardContent className="p-8 text-center">
              <div className="text-muted-foreground mb-4">
                <User className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <h3 className="text-lg font-semibold mb-2">No jobs found</h3>
                <p>
                  {searchTerm || statusFilter !== 'all'
                    ? "Try adjusting your search or filters"
                    : "Create your first job to get started"}
                </p>
              </div>
              {!searchTerm && statusFilter === 'all' && (
                <Button onClick={() => navigate('/job/new')}>
                  <Plus className="h-4 w-4 mr-2" />
                  Create First Job
                </Button>
              )}
            </CardContent>
          </Card>
        ) : (
          filteredJobs.map((job) => (
            <Card key={job.id} className="hover:shadow-md transition-shadow">
              <CardContent className="p-6">
                <div className="flex items-start justify-between">
                  <div className="flex-1 space-y-3">
                    <div className="flex items-center gap-3">
                      <h3 className="text-lg font-semibold">
                        {job.name}
                      </h3>
                      <Badge variant="outline" className="text-xs">
                        {job.job_number}
                      </Badge>
                      <Badge className={`text-xs ${getStatusColor(job.status)}`}>
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
                      onClick={() => navigate(`/job/${job.id}`)}
                    >
                      <Eye className="h-4 w-4 mr-2" />
                      View Details
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
};