import { useState, useEffect, useRef } from "react";
import { Input } from "@/components/ui/input";
import { Search, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";

interface Contact {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  address_street: string;
  address_city: string;
  address_state: string;
}

interface AutocompleteSearchProps {
  placeholder?: string;
  onSearchChange: (search: string) => void;
  onContactSelect?: (contact: Contact) => void;
  className?: string;
}

export const AutocompleteSearch = ({
  placeholder = "Search contacts...",
  onSearchChange,
  onContactSelect,
  className
}: AutocompleteSearchProps) => {
  const [search, setSearch] = useState("");
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);

  // Fetch contacts when search changes
  useEffect(() => {
    const fetchContacts = async () => {
      if (search.length < 2) {
        setContacts([]);
        setShowSuggestions(false);
        return;
      }

      setLoading(true);
      try {
        const { data, error } = await supabase
          .from('contacts')
          .select('id, first_name, last_name, email, phone, address_street, address_city, address_state')
          .or(`first_name.ilike.%${search}%,last_name.ilike.%${search}%,email.ilike.%${search}%`)
          .limit(8)
          .order('first_name', { ascending: true });

        if (error) throw error;
        setContacts(data || []);
        setShowSuggestions(true);
      } catch (error) {
        console.error('Error fetching contacts:', error);
        setContacts([]);
      } finally {
        setLoading(false);
      }
    };

    const debounceTimer = setTimeout(fetchContacts, 300);
    return () => clearTimeout(debounceTimer);
  }, [search]);

  // Handle clicking outside to close suggestions
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        suggestionsRef.current &&
        !suggestionsRef.current.contains(event.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(event.target as Node)
      ) {
        setShowSuggestions(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSearchChange = (value: string) => {
    setSearch(value);
    onSearchChange(value);
  };

  const handleContactSelect = (contact: Contact) => {
    const contactName = `${contact.first_name} ${contact.last_name}`;
    setSearch(contactName);
    setShowSuggestions(false);
    onSearchChange(contactName);
    onContactSelect?.(contact);
  };

  const formatContactDisplay = (contact: Contact) => {
    return `${contact.first_name} ${contact.last_name}`;
  };

  const formatContactSubtext = (contact: Contact) => {
    const parts = [];
    if (contact.email) parts.push(contact.email);
    if (contact.address_city && contact.address_state) {
      parts.push(`${contact.address_city}, ${contact.address_state}`);
    }
    return parts.join(' • ');
  };

  return (
    <div className={cn("relative", className)}>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          ref={inputRef}
          placeholder={placeholder}
          value={search}
          onChange={(e) => handleSearchChange(e.target.value)}
          onFocus={() => {
            if (contacts.length > 0) {
              setShowSuggestions(true);
            }
          }}
          className="pl-10"
        />
      </div>

      {showSuggestions && (
        <div
          ref={suggestionsRef}
          className="absolute z-50 w-full mt-1 bg-popover border rounded-md shadow-lg max-h-60 overflow-auto"
        >
          {loading && (
            <div className="p-3 text-sm text-muted-foreground">
              Searching contacts...
            </div>
          )}
          
          {!loading && contacts.length === 0 && search.length >= 2 && (
            <div className="p-3 text-sm text-muted-foreground">
              No contacts found
            </div>
          )}
          
          {!loading && contacts.map((contact) => (
            <div
              key={contact.id}
              onClick={() => handleContactSelect(contact)}
              className="flex items-center gap-3 p-3 hover:bg-muted cursor-pointer border-b border-border last:border-b-0"
            >
              <div className="flex-shrink-0">
                <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
                  <User className="h-4 w-4 text-primary" />
                </div>
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm">
                  {formatContactDisplay(contact)}
                </div>
                <div className="text-xs text-muted-foreground truncate">
                  {formatContactSubtext(contact)}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};