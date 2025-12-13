import React, { useState, useEffect, useRef } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { Search, User, MapPin, Phone, X, Check, Loader2, UserPlus } from "lucide-react";

interface Contact {
  id: string;
  first_name: string;
  last_name: string;
  email?: string;
  phone?: string;
  address_street?: string;
  address_city?: string;
  address_state?: string;
  address_zip?: string;
  latitude?: number;
  longitude?: number;
}

interface ContactSearchSelectProps {
  onContactSelect: (contact: Contact | null) => void;
  selectedContact: Contact | null;
  tenantId?: string;
}

export const ContactSearchSelect: React.FC<ContactSearchSelectProps> = ({
  onContactSelect,
  selectedContact,
  tenantId
}) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    const searchContacts = async () => {
      if (searchQuery.length < 2) {
        setContacts([]);
        return;
      }

      setLoading(true);
      try {
        let query = supabase
          .from('contacts')
          .select('id, first_name, last_name, email, phone, address_street, address_city, address_state, address_zip, latitude, longitude')
          .or(`first_name.ilike.%${searchQuery}%,last_name.ilike.%${searchQuery}%,phone.ilike.%${searchQuery}%,address_street.ilike.%${searchQuery}%`)
          .limit(10);

        if (tenantId) {
          query = query.eq('tenant_id', tenantId);
        }

        const { data, error } = await query;
        if (error) throw error;
        setContacts(data || []);
      } catch (error) {
        console.error('Error searching contacts:', error);
      } finally {
        setLoading(false);
      }
    };

    const debounce = setTimeout(searchContacts, 300);
    return () => clearTimeout(debounce);
  }, [searchQuery, tenantId]);

  const handleSelect = (contact: Contact) => {
    onContactSelect(contact);
    setShowDropdown(false);
    setSearchQuery("");
  };

  const handleClear = () => {
    onContactSelect(null);
    setSearchQuery("");
  };

  const formatAddress = (contact: Contact) => {
    const parts = [contact.address_street, contact.address_city, contact.address_state].filter(Boolean);
    return parts.join(', ');
  };

  if (selectedContact) {
    return (
      <Card className="border-primary bg-primary/5">
        <CardContent className="p-4">
          <div className="flex items-start justify-between">
            <div className="flex items-start gap-3">
              <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                <User className="h-5 w-5 text-primary" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h4 className="font-semibold">{selectedContact.first_name} {selectedContact.last_name}</h4>
                  <Badge variant="secondary" className="text-xs">
                    <Check className="h-3 w-3 mr-1" />
                    Linked
                  </Badge>
                </div>
                {selectedContact.phone && (
                  <p className="text-sm text-muted-foreground flex items-center gap-1">
                    <Phone className="h-3 w-3" />
                    {selectedContact.phone}
                  </p>
                )}
                {formatAddress(selectedContact) && (
                  <p className="text-sm text-muted-foreground flex items-center gap-1">
                    <MapPin className="h-3 w-3" />
                    {formatAddress(selectedContact)}
                  </p>
                )}
              </div>
            </div>
            <Button variant="ghost" size="sm" onClick={handleClear} className="h-8 w-8 p-0">
              <X className="h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search existing contacts by name, phone, or address..."
          value={searchQuery}
          onChange={(e) => {
            setSearchQuery(e.target.value);
            setShowDropdown(true);
          }}
          onFocus={() => setShowDropdown(true)}
          className="pl-9"
        />
        {loading && (
          <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
        )}
      </div>

      {showDropdown && searchQuery.length >= 2 && (
        <Card className="absolute z-50 w-full mt-1 shadow-lg max-h-72 overflow-y-auto">
          <CardContent className="p-2">
            {loading ? (
              <div className="p-4 text-center text-muted-foreground text-sm">
                Searching contacts...
              </div>
            ) : contacts.length > 0 ? (
              <div className="space-y-1">
                {contacts.map((contact) => (
                  <div
                    key={contact.id}
                    onClick={() => handleSelect(contact)}
                    className="p-3 rounded-md hover:bg-muted cursor-pointer transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                        <User className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">
                          {contact.first_name} {contact.last_name}
                        </p>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground">
                          {contact.phone && (
                            <span className="flex items-center gap-1">
                              <Phone className="h-3 w-3" />
                              {contact.phone}
                            </span>
                          )}
                          {formatAddress(contact) && (
                            <span className="flex items-center gap-1 truncate">
                              <MapPin className="h-3 w-3" />
                              {formatAddress(contact)}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-4 text-center">
                <p className="text-muted-foreground text-sm mb-2">No contacts found</p>
                <p className="text-xs text-muted-foreground">
                  Fill in the form below to create a new contact with this lead
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {!showDropdown && !selectedContact && (
        <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
          <UserPlus className="h-3 w-3" />
          Search for an existing contact, or fill in the form below to create a new one
        </p>
      )}
    </div>
  );
};

export default ContactSearchSelect;
