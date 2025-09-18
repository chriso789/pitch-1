import React, { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FilterBar } from "@/components/FilterBar";
import { Badge } from "@/components/ui/badge";
import { Users, Phone, Mail, MapPin } from "lucide-react";
import { toast } from "sonner";

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
}

export const Contacts = () => {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [filteredContacts, setFilteredContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchContacts();
  }, []);

  const fetchContacts = async () => {
    try {
      const { data, error } = await supabase
        .from("contacts")
        .select("*")
        .order("created_at", { ascending: false });

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
                    <Badge className={getContactTypeColor(contact.type)}>
                      {contact.type}
                    </Badge>
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
                  </div>
                  
                  <p className="text-xs text-muted-foreground">
                    Added: {new Date(contact.created_at).toLocaleDateString()}
                  </p>
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
    </div>
  );
};