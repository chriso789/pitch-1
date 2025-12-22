import React, { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useLocation } from "@/contexts/LocationContext";
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
  Award,
  MoreHorizontal,
  Trash2,
  MessageSquare,
  Plus,
  CheckCircle2,
  Upload
} from "lucide-react";
import { ActionsSelector } from "@/components/ui/actions-selector";
import { FloatingChatWidget } from "@/components/messaging/FloatingChatWidget";
import { FloatingEmailComposer } from "@/components/messaging/FloatingEmailComposer";
import { SimpleJobMap } from "@/components/maps/SimpleJobMap";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import ContactFormDialog from "@/components/ContactFormDialog";
import EnhancedLeadCreationDialog from "@/components/EnhancedLeadCreationDialog";
import PermanentDeleteDialog from "@/components/PermanentDeleteDialog";
import TaskAssignmentDialog from "@/components/TaskAssignmentDialog";
import { ContactBulkImport } from "./ContactBulkImport";
import { TEST_IDS } from "../../../../tests/utils/test-ids";

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
  const { currentLocationId } = useLocation();
  const [activeView, setActiveView] = useState<ViewType>('contacts');
  const [preferredView, setPreferredView] = useState<ViewType>('contacts');
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [pipelineEntries, setPipelineEntries] = useState<any[]>([]);
  
  const [filteredData, setFilteredData] = useState<Contact[] | Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [repFilter, setRepFilter] = useState("all");
  const [locationReps, setLocationReps] = useState<{id: string, first_name: string, last_name: string}[]>([]);
  const [userProfile, setUserProfile] = useState<any>(null);
  const [sortField, setSortField] = useState<string>('created_at');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [pipelineLeads, setPipelineLeads] = useState<any[]>([]);
  const [selectedContactForJob, setSelectedContactForJob] = useState<Contact | null>(null);
  const [showJobDialog, setShowJobDialog] = useState(false);
  
  // Enhanced messaging and mapping state
  const [activeChatContact, setActiveChatContact] = useState<{ id: string; name: string; phone: string } | null>(null);
  const [activeEmailContact, setActiveEmailContact] = useState<{ id: string; name: string; email: string } | null>(null);
  const [mapCenter, setMapCenter] = useState<{ lat: number; lng: number; address: string } | null>(null);
  
  // Import dialog state
  const [showImportDialog, setShowImportDialog] = useState(false);

  // Refetch data when location changes
  useEffect(() => {
    loadUserPreferences();
  }, []);

  useEffect(() => {
    fetchData();
  }, [currentLocationId]);

  useEffect(() => {
    setActiveView(preferredView);
  }, [preferredView]);

  useEffect(() => {
    // Set default sort field based on active view
    if (activeView === 'jobs') {
      setSortField('job_number');
      setSortDirection('asc');
    } else {
      setSortField('created_at');
      setSortDirection('desc');
    }
  }, [activeView]);

  useEffect(() => {
    filterData();
  }, [contacts, jobs, activeView, searchTerm, statusFilter, repFilter, sortField, sortDirection]);

  // Fetch reps assigned to current location
  useEffect(() => {
    const fetchLocationReps = async () => {
      if (!currentLocationId || !userProfile?.tenant_id) {
        setLocationReps([]);
        return;
      }
      
      try {
        const { data, error } = await supabase
          .from('user_location_assignments')
          .select('user_id, profiles!inner(id, first_name, last_name)')
          .eq('location_id', currentLocationId)
          .eq('tenant_id', userProfile.tenant_id);
        
        if (error) {
          console.error('Error fetching location reps:', error);
          return;
        }
        
        const reps = (data || []).map((assignment: any) => ({
          id: assignment.profiles.id,
          first_name: assignment.profiles.first_name || '',
          last_name: assignment.profiles.last_name || ''
        }));
        
        setLocationReps(reps);
      } catch (error) {
        console.error('Error fetching location reps:', error);
      }
    };
    
    fetchLocationReps();
  }, [currentLocationId, userProfile?.tenant_id]);

  // Reset rep filter when location changes
  useEffect(() => {
    setRepFilter("all");
  }, [currentLocationId]);

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

  const fetchData = useCallback(async () => {
    console.log("fetchData called with currentLocationId:", currentLocationId);
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

      // Query contacts with proper tenant filtering (master sees all)
      console.log("Fetching contacts...");
      console.log("Current location filter:", currentLocationId);
      const isMaster = profile.role === 'master';
      let contactsQuery = supabase
        .from("contacts")
        .select("*");
      
      if (!isMaster) {
        contactsQuery = contactsQuery.eq('tenant_id', profile.tenant_id);
      }
      
      // Apply location filter if a specific location is selected
      if (currentLocationId) {
        contactsQuery = contactsQuery.eq('location_id', currentLocationId);
      }
      
      // Paginated fetch to bypass Supabase 1000 row server limit
      const BATCH_SIZE = 1000;
      let allContacts: any[] = [];
      let from = 0;
      let hasMore = true;
      let batchNumber = 0;

      while (hasMore) {
        batchNumber++;
        const { data: batchData, error: batchError } = await supabase
          .from("contacts")
          .select("*")
          .eq('is_deleted', false)
          .match(isMaster ? {} : { tenant_id: profile.tenant_id })
          .match(currentLocationId ? { location_id: currentLocationId } : {})
          .order("created_at", { ascending: false })
          .range(from, from + BATCH_SIZE - 1);

        if (batchError) {
          console.error("Contacts batch query error:", batchError);
          throw batchError;
        }

        if (batchData && batchData.length > 0) {
          allContacts = [...allContacts, ...batchData];
          console.log(`Batch ${batchNumber}: fetched ${batchData.length} contacts (total: ${allContacts.length})`);
          from += BATCH_SIZE;
          hasMore = batchData.length === BATCH_SIZE;
        } else {
          hasMore = false;
        }
      }

      const contactsData = allContacts;
      console.log("All contacts fetched:", contactsData.length, "in", batchNumber, "batches at", new Date().toISOString());

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
      console.log("Raw jobs data:", jobsData);

      // Enhance jobs with contact information
      const enhancedJobs = await Promise.all(
        (jobsData || []).map(async (job) => {
          console.log(`Fetching contact for job ${job.job_number}, contact_id:`, job.contact_id);
          const { data: contactData, error: contactError } = await supabase
            .from("contacts")
            .select("first_name, last_name, email, phone, address_street, address_city, address_state, location_id")
            .eq("id", job.contact_id)
            .eq('tenant_id', profile.tenant_id)
            .maybeSingle();

          if (contactError) {
            console.error(`Error fetching contact for job ${job.job_number}:`, contactError);
          }

          console.log(`Contact data for job ${job.job_number}:`, contactData);

          return {
            ...job,
            contact: contactData || null,
            name: job.name || (contactData ? `${contactData.first_name || ''} ${contactData.last_name || ''}`.trim() : 'Unnamed Job')
          };
        })
      );

      console.log("Enhanced jobs:", enhancedJobs);

      // Fetch pipeline entries with contact and communication data
      console.log("Fetching pipeline entries...");
      const { data: pipelineData, error: pipelineError } = await supabase
        .from("pipeline_entries")
        .select(`
          *,
          contacts:contact_id (
            contact_number,
            first_name,
            last_name,
            address_street,
            address_city,
            address_state,
            address_zip
          )
        `)
        .eq('tenant_id', profile.tenant_id)
        .eq('created_by', user.id)
        .order("created_at", { ascending: false });

      if (pipelineError) {
        console.error("Pipeline query error:", pipelineError);
      }

      console.log("Pipeline entries fetched:", pipelineData?.length || 0);

      // Enhance pipeline entries with communication data and calculations
      const enhancedPipelineData = await Promise.all(
        (pipelineData || []).map(async (pe) => {
          // Get last communication date
          const { data: lastComm } = await supabase
            .from('communication_history')
            .select('created_at')
            .eq('contact_id', pe.contact_id)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

          const daysSinceComm = lastComm 
            ? Math.floor((Date.now() - new Date(lastComm.created_at).getTime()) / (1000 * 60 * 60 * 24))
            : null;

          // Calculate days since lead was created (this shows how long the lead has been active)
          const daysInStatus = Math.floor((Date.now() - new Date(pe.created_at).getTime()) / (1000 * 60 * 60 * 24));

          return {
            ...pe,
            days_since_communication: daysSinceComm,
            days_in_status: daysInStatus
          };
        })
      );

      // Filter active leads for the sales rep (lead, contingency, legal, ready_for_approval)
      const leadStatuses = ['lead', 'contingency', 'legal', 'ready_for_approval'];
      const userPipelineLeads = enhancedPipelineData.filter(pe => 
        leadStatuses.includes(pe.status)
      );
      console.log("Active pipeline leads:", userPipelineLeads.length);

      setContacts(contactsData || []);
      setJobs(enhancedJobs || []);
      setPipelineEntries(enhancedPipelineData || []);
      setPipelineLeads(userPipelineLeads);
    } catch (error) {
      console.error("Error fetching data:", error);
      toast.error("Failed to load client data");
    } finally {
      setLoading(false);
    }
  }, [currentLocationId]);

  const filterData = () => {
    console.log(`=== FilterData called ===`);
    console.log(`Active view: ${activeView}`);
    console.log(`Search term: "${searchTerm}"`);
    console.log(`Status filter: "${statusFilter}"`);
    
    if (activeView === 'contacts') {
      let filtered = contacts as Contact[];
      console.log(`Total contacts: ${filtered.length}`);

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

      // Filter by representative
      if (repFilter !== "all") {
        if (repFilter === "unassigned") {
          filtered = filtered.filter((contact: any) => !contact.assigned_to);
        } else {
          filtered = filtered.filter((contact: any) => contact.assigned_to === repFilter);
        }
      }

      filtered = sortData(filtered, activeView);
      console.log(`Filtered contacts: ${filtered.length}`);
      setFilteredData(filtered);
    } else {
      let filtered = jobs as Job[];
      console.log(`Total jobs: ${filtered.length}`);
      console.log(`Job statuses:`, filtered.map(j => ({ job_number: j.job_number, status: j.status })));

      if (searchTerm) {
        const beforeSearch = filtered.length;
        filtered = filtered.filter(job => {
          return (
            job.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
            job.job_number?.toLowerCase().includes(searchTerm.toLowerCase()) ||
            `${job.contact?.first_name} ${job.contact?.last_name}`.toLowerCase().includes(searchTerm.toLowerCase()) ||
            job.contact?.address_street?.toLowerCase().includes(searchTerm.toLowerCase())
          );
        });
        console.log(`After search filter: ${filtered.length} (from ${beforeSearch})`);
      }

      if (statusFilter !== "all") {
        const beforeStatus = filtered.length;
        console.log(`Filtering by status: "${statusFilter}"`);
        filtered = filtered.filter(job => {
          console.log(`Job ${job.job_number} status: "${job.status}" === "${statusFilter}"?`, job.status === statusFilter);
          return job.status === statusFilter;
        });
        console.log(`After status filter: ${filtered.length} (from ${beforeStatus})`);
      }

      filtered = sortData(filtered, activeView);
      console.log(`Final filtered jobs: ${filtered.length}`);
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
          case 'job_number':
            // Extract numeric part for proper sorting
            aValue = parseInt(a.job_number?.replace(/\D/g, '') || '0');
            bValue = parseInt(b.job_number?.replace(/\D/g, '') || '0');
            break;
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
            aValue = new Date(a.created_at);
            bValue = new Date(b.created_at);
            break;
          default:
            aValue = parseInt(a.job_number?.replace(/\D/g, '') || '0');
            bValue = parseInt(b.job_number?.replace(/\D/g, '') || '0');
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

  const handleAddJob = (contact: Contact) => {
    setSelectedContactForJob(contact);
    setShowJobDialog(true);
  };

  const handleJobCreated = (newJob: any) => {
    fetchData(); // Refresh the data
    setSelectedContactForJob(null);
    setShowJobDialog(false);
    toast.success(`Job "${newJob.name}" created successfully!`);
  };

  const [deleteDialog, setDeleteDialog] = useState({ open: false, contactId: '', contactName: '' });

  const handleDeleteContact = async (contactId: string, contactName: string) => {
    setDeleteDialog({ open: true, contactId, contactName });
  };

  const confirmPermanentDelete = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        toast.error('Authentication required');
        return;
      }

      // Permanently delete the contact from the database
      const { error } = await supabase
        .from('contacts')
        .delete()
        .eq('id', deleteDialog.contactId);

      if (error) throw error;

      toast.success(`Contact ${deleteDialog.contactName} permanently removed`);
      fetchData();
    } catch (error) {
      console.error('Error deleting contact:', error);
      toast.error('Failed to delete contact');
    }
  };

  const handleDeleteJob = async (jobId: string, jobName: string) => {
    if (!confirm(`Are you sure you want to delete job "${jobName}"? This action cannot be undone.`)) {
      return;
    }

    try {
      const { error } = await supabase
        .from('jobs')
        .delete()
        .eq('id', jobId);

      if (error) throw error;

      toast.success(`Job "${jobName}" deleted successfully`);
      fetchData();
    } catch (error) {
      console.error('Error deleting job:', error);
      toast.error('Failed to delete job');
    }
  };

  const handleCall = (contact: Contact | Job) => {
    let contactData;
    
    if ('first_name' in contact) {
      // It's a Contact
      contactData = {
        id: contact.id,
        name: `${contact.first_name} ${contact.last_name}`,
        phone: contact.phone,
        email: contact.email,
        address: contact.address_street ? `${contact.address_street}, ${contact.address_city}, ${contact.address_state}` : '',
        leadScore: contact.lead_score || 0,
        status: contact.qualification_status || 'unknown',
        type: 'contact'
      };
    } else {
      // It's a Job
      contactData = {
        id: contact.id,
        name: contact.name || 'Unknown Job',
        phone: contact.contact?.phone,
        email: contact.contact?.email,
        address: '',
        leadScore: 0,
        status: contact.status || 'unknown',
        type: 'job'
      };
    }
    
    // Navigate to main page with dialer section and contact
    navigate(`/?section=dialer&contact=${contactData.id}`, { 
      state: { preloadedContact: contactData } 
    });
  };

  const handleText = (phone: string) => {
    if (phone) {
      window.open(`sms:${phone}`);
    } else {
      toast.error('No phone number available');
    }
  };

  const handleEmail = (email: string) => {
    if (email) {
      window.open(`mailto:${email}`);
    } else {
      toast.error('No email address available');
    }
  };

  const handleMapSurroundingJobs = (address: string) => {
    if (address) {
      const encodedAddress = encodeURIComponent(address);
      window.open(`https://www.google.com/maps/search/roofing+jobs+near+${encodedAddress}`, '_blank');
    } else {
      toast.error('No address available');
    }
  };

  const [taskDialogState, setTaskDialogState] = useState<{
    open: boolean;
    contactId?: string;
    projectId?: string;
  }>({ open: false });

  const handleTaskCreated = (task: any) => {
    toast.success(`Task "${task.title}" created successfully!`);
    setTaskDialogState({ open: false });
  };

  const ActionsDropdown = ({ item, type }: { item: any, type: 'contact' | 'job' }) => {
    const actions = [
      {
        label: "View Details Page",
        icon: Eye,
        onClick: () => navigate(type === 'contact' ? `/contact/${item.id}` : `/job/${item.id}`)
      },
      ...(type === 'contact' && item.phone ? [{
        label: "Call",
        icon: Phone,
        onClick: () => handleCall(item)
      }] : []),
      ...(type === 'job' && item.contact?.phone ? [{
        label: "Call Contact", 
        icon: Phone,
        onClick: () => handleCall(item)
      }] : []),
      ...(type === 'contact' && item.phone ? [{
        label: "Text",
        icon: MessageSquare,
        onClick: () => setActiveChatContact({ 
          id: item.id, 
          name: `${item.first_name} ${item.last_name}`, 
          phone: item.phone 
        })
      }] : []),
      ...(type === 'job' && item.contact?.phone ? [{
        label: "Text Contact",
        icon: MessageSquare,
        onClick: () => setActiveChatContact({ 
          id: item.contact.id, 
          name: `${item.contact.first_name} ${item.contact.last_name}`, 
          phone: item.contact.phone 
        })
      }] : []),
      ...(type === 'contact' && item.email ? [{
        label: "Email",
        icon: Mail,
        onClick: () => setActiveEmailContact({ 
          id: item.id, 
          name: `${item.first_name} ${item.last_name}`, 
          email: item.email 
        })
      }] : []),
      ...(type === 'job' && item.contact?.email ? [{
        label: "Email Contact",
        icon: Mail,
        onClick: () => setActiveEmailContact({ 
          id: item.contact.id, 
          name: `${item.contact.first_name} ${item.contact.last_name}`, 
          email: item.contact.email 
        })
      }] : []),
      ...(type === 'contact' ? [{
        label: "Add Job",
        icon: Plus,
        onClick: () => handleAddJob(item)
      }] : []),
      {
        label: "Assign Task",
        icon: CheckCircle2,
        onClick: () => setTaskDialogState({
          open: true,
          contactId: type === 'contact' ? item.id : item.contact_id,
          projectId: type === 'job' ? item.project_id : undefined,
        }),
        separator: true
      },
      {
        label: "Map Surrounding Jobs",
        icon: MapPin,
        onClick: () => setMapCenter({
          lat: item.latitude || 27.0820246,
          lng: item.longitude || -82.19621560000002,
          address: type === 'contact' 
            ? `${item.address_street}, ${item.address_city}, ${item.address_state}` 
            : `${item.contact?.address_street}, ${item.contact?.address_city}, ${item.contact?.address_state}`
        })
      },
      {
        label: "Delete",
        icon: Trash2,
        onClick: () => type === 'contact' 
          ? handleDeleteContact(item.id, `${item.first_name} ${item.last_name}`) 
          : handleDeleteJob(item.id, item.name),
        variant: 'destructive' as const,
        separator: true
      }
    ];

    return <ActionsSelector actions={actions} />;
  };

  // Calculate statistics
  const totalContacts = contacts.length;
  
  // Count contacts created within last 2 weeks
  const twoWeeksAgo = new Date();
  twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
  const recentContacts = contacts.filter(c => new Date(c.created_at) >= twoWeeksAgo).length;
  
  // Count active leads: pipeline entries created by this rep that haven't progressed past "ready_for_approval"
  const statusesBeforeApproval = ['lead', 'qualified', 'measurement', 'estimate', 'negotiation', 'proposal'];
  const activeLeads = pipelineEntries.filter(pe => statusesBeforeApproval.includes(pe.status)).length;
  
  const avgScore = contacts.length > 0 ? Math.round(contacts.reduce((sum, c) => sum + (c.lead_score || 0), 0) / contacts.length) : 0;

  const totalJobs = jobs.length;
  const activeJobs = jobs.filter(j => j.status === 'in_progress').length;
  const pendingJobs = jobs.filter(j => j.status === 'pending').length;
  const completedJobs = jobs.filter(j => j.status === 'completed').length;
  
  // Calculate leads converted to jobs (pipeline entries with status 'project')
  const leadsConvertedToJobs = pipelineEntries.filter(pe => pe.status === 'project').length;

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
            onClick={() => setShowImportDialog(true)}
            className="shadow-soft transition-smooth"
          >
            <Upload className="h-4 w-4 mr-2" />
            Import CSV
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => savePreferredView(activeView)}
            className="shadow-soft transition-smooth"
          >
            <Settings className="h-4 w-4 mr-2" />
            Set as Default
          </Button>
          <EnhancedLeadCreationDialog 
            onLeadCreated={fetchData}
          />
          <ContactFormDialog 
            onContactCreated={handleContactCreated}
            buttonText="New Contact"
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
                  Leads Converted to Jobs
                </p>
                <p className="text-2xl font-bold text-success">
                  {leadsConvertedToJobs}
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
                  {activeView === 'contacts' ? 'New (2 Weeks)' : 'Active'}
                </p>
                <p className="text-2xl font-bold text-success">
                  {activeView === 'contacts' ? recentContacts : activeJobs}
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
                  {activeView === 'contacts' ? 'Leads' : 'Pending'}
                </p>
                <p className="text-2xl font-bold text-secondary">
                  {activeView === 'contacts' ? activeLeads : pendingJobs}
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
                  data-testid={TEST_IDS.contacts.searchInput}
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
                <SelectTrigger 
                  className="w-40"
                  data-testid={TEST_IDS.contacts.filterType}
                >
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

              {/* Rep Filter - Only show for contacts view */}
              {activeView === 'contacts' && locationReps.length > 0 && (
                <Select value={repFilter} onValueChange={setRepFilter}>
                  <SelectTrigger className="w-48">
                    <SelectValue placeholder="Filter by Rep" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Reps</SelectItem>
                    {locationReps.map((rep) => (
                      <SelectItem key={rep.id} value={rep.id}>
                        {rep.first_name} {rep.last_name}
                      </SelectItem>
                    ))}
                    <SelectItem value="unassigned">Unassigned</SelectItem>
                  </SelectContent>
                </Select>
              )}
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
            <div className="py-8">
              {activeView === 'jobs' && pipelineLeads.length > 0 ? (
                <div className="px-6">
                  <div className="text-center mb-6">
                    <h3 className="text-lg font-semibold">Your Active Leads ({pipelineLeads.length})</h3>
                    <p className="text-sm text-muted-foreground">Leads in your pipeline that need attention</p>
                  </div>
                  <div className="grid gap-4 max-w-4xl mx-auto">
                    {pipelineLeads.map((lead) => {
                      const lastName = lead.contacts?.last_name || 'Unknown';
                      const address = [
                        lead.contacts?.address_street,
                        lead.contacts?.address_city,
                        lead.contacts?.address_state,
                        lead.contacts?.address_zip
                      ].filter(Boolean).join(', ') || 'No address';

                      return (
                        <Card key={lead.id} className="p-4 hover:shadow-md transition-shadow">
                          <div className="space-y-2">
                            {/* Top row: Contact number, Last name, Status */}
                            <div className="flex items-center justify-between gap-3">
                              <div className="flex items-center gap-3 flex-wrap">
                                <span className="text-sm font-mono text-muted-foreground">
                                  {lead.contacts?.contact_number || 'N/A'}
                                </span>
                                <h4 className="font-medium">{lastName}</h4>
                                <Badge variant="secondary" className="text-xs">
                                  {lead.status.replace('_', ' ')}
                                </Badge>
                              </div>
                            </div>
                            
                            {/* Address row */}
                            <div className="text-sm text-muted-foreground">
                              <MapPin className="h-3 w-3 inline mr-1" />
                              {address}
                            </div>
                            
                            {/* Bottom row: Metrics and actions */}
                            <div className="flex items-center justify-between gap-3 flex-wrap">
                              <div className="flex items-center gap-4 text-xs text-muted-foreground">
                                <span className="flex items-center gap-1">
                                  <Calendar className="h-3 w-3" />
                                  {lead.days_in_status} {lead.days_in_status === 1 ? 'day' : 'days'} old
                                </span>
                                <span className="flex items-center gap-1">
                                  <Activity className="h-3 w-3" />
                                  {lead.days_since_communication !== null 
                                    ? `${lead.days_since_communication} days since contact`
                                    : 'Never contacted'}
                                </span>
                                {lead.estimated_value && (
                                  <span className="font-medium">
                                    ${lead.estimated_value.toLocaleString()}
                                  </span>
                                )}
                              </div>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => navigate(`/lead/${lead.id}`)}
                              >
                                View Details
                              </Button>
                            </div>
                          </div>
                        </Card>
                      );
                    })}
                  </div>
                </div>
              ) : (
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
                        <TableHead>
                          <Button variant="ghost" onClick={() => handleSort('job_number')} className="p-0 h-auto font-medium">
                            Job # <ArrowUpDown className="ml-2 h-4 w-4" />
                          </Button>
                        </TableHead>
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
                        <TableHead className="text-right">Actions</TableHead>
                      </>
                    )}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredData.map((item: any, index) => (
                    <TableRow 
                      key={item.id} 
                      className="hover:bg-muted/50 transition-colors"
                      data-testid={TEST_IDS.contacts.listItem}
                    >
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
                            <ActionsDropdown item={item} type="contact" />
                          </TableCell>
                        </>
                      ) : (
                        <>
                          <TableCell className="font-mono text-sm font-medium">
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
                          <TableCell className="text-right">
                            <ActionsDropdown item={item} type="job" />
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

      <PermanentDeleteDialog
        open={deleteDialog.open}
        onOpenChange={(open) => setDeleteDialog(prev => ({ ...prev, open }))}
        itemName={deleteDialog.contactName}
        itemType="contact"
        onConfirm={confirmPermanentDelete}
      />

      <EnhancedLeadCreationDialog
        open={showJobDialog}
        onOpenChange={setShowJobDialog}
        contact={selectedContactForJob || undefined}
        onLeadCreated={handleJobCreated}
      />

      {/* Floating Chat Widget */}
      {activeChatContact && (
        <FloatingChatWidget
          isOpen={!!activeChatContact}
          onClose={() => setActiveChatContact(null)}
          contactName={activeChatContact.name}
          contactPhone={activeChatContact.phone}
          onSendMessage={(message) => {
            console.log('Sending message:', message, 'to:', activeChatContact.phone);
            // TODO: Implement iMessage sending via edge function
          }}
        />
      )}

      {/* Floating Email Composer */}
      {activeEmailContact && (
        <FloatingEmailComposer
          isOpen={!!activeEmailContact}
          onClose={() => setActiveEmailContact(null)}
          defaultRecipient={{
            id: activeEmailContact.id,
            name: activeEmailContact.name,
            email: activeEmailContact.email,
            type: 'contact'
          }}
          onSendEmail={(emailData) => {
            console.log('Sending email:', emailData);
            // TODO: Implement email sending via edge function
            setActiveEmailContact(null);
          }}
        />
      )}

      {/* Interactive Job Map */}
      {mapCenter && (
        <SimpleJobMap
          isOpen={!!mapCenter}
          onClose={() => setMapCenter(null)}
          centerLocation={{ lat: mapCenter.lat, lng: mapCenter.lng }}
          radiusMiles={50}
          locations={[
            ...contacts.map(contact => ({
              id: contact.id,
              type: 'contact' as const,
              name: `${contact.first_name} ${contact.last_name}`,
              address: `${contact.address_street}, ${contact.address_city}, ${contact.address_state}`,
              lat: mapCenter.lat,
              lng: mapCenter.lng,
              phone: contact.phone,
              email: contact.email,
              status: contact.qualification_status
            })),
            ...jobs.map(job => ({
              id: job.id,
              type: 'job' as const,
              name: job.name || `Job for ${job.contact?.first_name} ${job.contact?.last_name}`,
              address: `${job.contact?.address_street}, ${job.contact?.address_city}, ${job.contact?.address_state}`,
              lat: mapCenter.lat,
              lng: mapCenter.lng,
              phone: job.contact?.phone,
              email: job.contact?.email,
              status: job.status,
              value: 0,
              roofType: undefined,
              priority: undefined
            }))
          ]}
        />
      )}

      {/* Task Assignment Dialog */}
      {taskDialogState.open && (
        <TaskAssignmentDialog
          contactId={taskDialogState.contactId}
          projectId={taskDialogState.projectId}
          onTaskCreated={handleTaskCreated}
          trigger={<div style={{ display: 'none' }} />}
        />
      )}

      {/* Contact Import Dialog */}
      <ContactBulkImport
        open={showImportDialog}
        onOpenChange={setShowImportDialog}
        onImportComplete={fetchData}
        currentLocationId={currentLocationId}
      />
    </div>
  );
};

export default EnhancedClientList;