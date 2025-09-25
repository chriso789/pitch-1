import React, { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FilterBar } from "@/shared/components/FilterBar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LeadForm } from "./LeadForm";
import { Users, Phone, Mail, MapPin, Plus, Eye } from "lucide-react";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";

interface Contact {
  id: string;
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
  lead_source_details: any;
  acquisition_cost: number;
  referral_source: string;
  lead_score: number;
  qualification_status: string;
  last_scored_at: string;
  scoring_details: any;
}

export const Contacts = () => {
  const navigate = useNavigate();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [filteredContacts, setFilteredContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [showLeadForm, setShowLeadForm] = useState(false);

  useEffect(() => {
    fetchContacts();
  }, []);

  const fetchContacts = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Get user profile
      const { data: profile } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .maybeSingle();

      let query = supabase
        .from("contacts")
        .select("*")
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
          // Show contacts from assigned locations OR contacts without location
          query = query.or(`location_id.in.(${assignedLocationIds.join(',')}),location_id.is.null`);
        } else {
          // If no locations assigned, show only contacts without location
          query = query.is('location_id', null);
        }
      }
      // Admins and masters see all contacts (no additional filtering)

      const { data, error } = await query;

      if (error) throw error;
      setContacts(data || []);
      setFilteredContacts(data || []);
    } catch (error) {
      console.error("Error fetching contacts:", error);
      toast.error("Failed to load contacts");
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = (query: string) => {
    if (!query) {
      setFilteredContacts(contacts);
      return;
    }

    const filtered = contacts.filter((contact) => {
      const searchText = query.toLowerCase();
      return (
        contact.first_name?.toLowerCase().includes(searchText) ||
        contact.last_name?.toLowerCase().includes(searchText) ||
        contact.email?.toLowerCase().includes(searchText) ||
        contact.phone?.includes(searchText) ||
        contact.company_name?.toLowerCase().includes(searchText) ||
        contact.address_street?.toLowerCase().includes(searchText)
      );
    });
    
    setFilteredContacts(filtered);
  };

  const handleFilter = (filters: { key: string; value: string }[]) => {
    let filtered = [...contacts];

    const typeFilter = filters.find(f => f.key === 'type');
    if (typeFilter && typeFilter.value !== "all") {
      filtered = filtered.filter((contact) => contact.type === typeFilter.value);
    }

    setFilteredContacts(filtered);
  };

  const handleSort = ({ field, direction }: { field: string; direction: 'asc' | 'desc' }) => {
    const sorted = [...filteredContacts].sort((a, b) => {
      let aValue: any = a[field as keyof Contact] || '';
      let bValue: any = b[field as keyof Contact] || '';
      
      if (field === 'created_at') {
        aValue = new Date(aValue as string).getTime();
        bValue = new Date(bValue as string).getTime();
      } else if (typeof aValue === 'string') {
        aValue = aValue.toLowerCase();
        bValue = (bValue as string).toLowerCase();
      }
      
      if (direction === 'asc') {
        return aValue < bValue ? -1 : aValue > bValue ? 1 : 0;
      } else {
        return aValue > bValue ? -1 : aValue < bValue ? 1 : 0;
      }
    });
    
    setFilteredContacts(sorted);
  };

  const getContactTypeColor = (type: string) => {
    const colors = {
      "homeowner": "bg-primary/10 text-primary",
      "contractor": "bg-secondary/10 text-secondary",
      "supplier": "bg-accent/10 text-accent-foreground"
    };
    return colors[type as keyof typeof colors] || "bg-muted";
  };

  if (loading) {
    return <div className="p-6">Loading contacts...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold gradient-primary bg-clip-text text-transparent">
            Contacts
          </h1>
          <p className="text-muted-foreground">
            All contacts sorted by date entered
          </p>
        </div>
        <Button className="gradient-primary" onClick={() => setShowLeadForm(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Add New Lead
        </Button>
      </div>

      <Card className="shadow-soft border-0">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5 text-primary" />
            All Contacts ({filteredContacts.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <FilterBar
            searchPlaceholder="Search contacts..."
            filterOptions={[
              {
                key: 'type',
                label: 'Contact Type',
                options: [
                  { value: 'all', label: 'All Types' },
                  { value: 'homeowner', label: 'Homeowner' },
                  { value: 'contractor', label: 'Contractor' },
                  { value: 'supplier', label: 'Supplier' }
                ]
              }
            ]}
            sortOptions={[
              { value: 'created_at', label: 'Date Created' },
              { value: 'first_name', label: 'First Name' },
              { value: 'last_name', label: 'Last Name' },
              { value: 'company_name', label: 'Company' }
            ]}
            onSearchChange={handleSearch}
            onFilterChange={handleFilter}
            onSortChange={handleSort}
          />
          
          <div className="space-y-3">
            {filteredContacts.map((contact) => (
              <div
                key={contact.id}
                className="flex items-center justify-between p-4 rounded-lg border bg-card hover:bg-accent/50 transition-colors"
              >
                <div className="flex-1 space-y-2">
                  <div className="flex items-center gap-3">
                    <div>
                      <h4 className="font-semibold">
                        {contact.first_name} {contact.last_name}
                      </h4>
                      {contact.company_name && (
                        <p className="text-sm text-muted-foreground">
                          {contact.company_name}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge className={getContactTypeColor(contact.type)}>
                        {contact.type}
                      </Badge>
                      {contact.lead_score !== undefined && (
                        <div className="flex items-center space-x-1">
                          <div className={`w-2 h-2 rounded-full ${
                            contact.lead_score >= 80 ? 'bg-red-500' :
                            contact.lead_score >= 60 ? 'bg-orange-500' :
                            contact.lead_score >= 40 ? 'bg-yellow-500' : 'bg-blue-500'
                          }`} />
                          <span className="text-xs font-medium bg-muted px-2 py-1 rounded">
                            Score: {contact.lead_score}
                          </span>
                        </div>
                      )}
                      {contact.qualification_status && contact.qualification_status !== 'unqualified' && (
                        <Badge 
                          variant={
                            contact.qualification_status === 'hot' ? 'destructive' :
                            contact.qualification_status === 'warm' ? 'default' :
                            contact.qualification_status === 'qualified' ? 'secondary' : 'outline'
                          }
                          className="text-xs"
                        >
                          {contact.qualification_status.toUpperCase()}
                        </Badge>
                      )}
                    </div>
                  </div>
                  
                  <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
                    {contact.email && (
                      <div className="flex items-center gap-1">
                        <Mail className="h-3 w-3" />
                        {contact.email}
                      </div>
                    )}
                    {contact.phone && (
                      <div className="flex items-center gap-1">
                        <Phone className="h-3 w-3" />
                        {contact.phone}
                      </div>
                    )}
                    {contact.address_street && (
                      <div className="flex items-center gap-1">
                        <MapPin className="h-3 w-3" />
                        {contact.address_street}, {contact.address_city}, {contact.address_state}
                      </div>
                    )}
                    {contact.lead_source && (
                      <Badge variant="outline" className="text-xs">
                        Source: {contact.lead_source}
                      </Badge>
                    )}
                  </div>
                  
                  <div className="flex items-center gap-4 text-xs text-muted-foreground">
                    <span>Added: {new Date(contact.created_at).toLocaleDateString()}</span>
                    {contact.last_scored_at && (
                      <span>Scored: {new Date(contact.last_scored_at).toLocaleDateString()}</span>
                    )}
                  </div>
                </div>
                
                <div className="flex items-center gap-2 ml-4">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => navigate(`/contact/${contact.id}`)}
                  >
                    <Eye className="h-4 w-4 mr-2" />
                    View Details
                  </Button>
                </div>
              </div>
            ))}
            
            {filteredContacts.length === 0 && (
              <div className="text-center py-8 text-muted-foreground">
                No contacts found matching your criteria.
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Lead Form Dialog */}
      <LeadForm 
        open={showLeadForm} 
        onOpenChange={setShowLeadForm}
        onLeadCreated={() => {
          fetchContacts(); // Refresh contacts list
        }}
      />
    </div>
  );
};