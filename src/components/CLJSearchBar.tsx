import { useState, useEffect, useRef } from 'react';
import { Input } from '@/components/ui/input';
import { Search, User, Briefcase } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useNavigate } from 'react-router-dom';
import { useToast } from '@/hooks/use-toast';
import { Badge } from '@/components/ui/badge';
import { useLocation } from '@/contexts/LocationContext';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/ui/command";

interface SearchResult {
  entity_type: 'contact' | 'job';
  entity_id: string;
  entity_name: string;
  entity_subtext: string;
  clj_number: string;
  entity_status: string;
  match_score: number;
}

export const CLJSearchBar = () => {
  const [searchTerm, setSearchTerm] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const { toast } = useToast();
  const { currentLocationId } = useLocation();

  // Handle clicks outside to close dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current && 
        !dropdownRef.current.contains(event.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    const searchAll = async () => {
      if (searchTerm.length < 2) {
        setResults([]);
        setOpen(false);
        return;
      }

      setLoading(true);
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        // Get tenant_id from profiles
        const { data: profile } = await supabase
          .from('profiles')
          .select('tenant_id')
          .eq('id', user.id)
          .maybeSingle();

        if (!profile?.tenant_id) return;

        // Call the universal search RPC with location filter
        const { data, error } = await supabase.rpc('search_contacts_and_jobs', {
          p_tenant_id: profile.tenant_id,
          p_search_term: searchTerm,
          p_location_id: currentLocationId,
          p_limit: 10
        });

        if (error) throw error;
        setResults((data || []) as SearchResult[]);
        setOpen(true);
      } catch (error) {
        console.error('Search error:', error);
        toast({
          title: 'Search failed',
          description: 'Could not search contacts and jobs',
          variant: 'destructive'
        });
      } finally {
        setLoading(false);
      }
    };

    const timeoutId = setTimeout(searchAll, 300);
    return () => clearTimeout(timeoutId);
  }, [searchTerm, currentLocationId, toast]);

  const handleSelect = (result: SearchResult) => {
    const routes: Record<string, string> = {
      contact: `/contacts/${result.entity_id}`,
      job: `/projects/${result.entity_id}`
    };

    navigate(routes[result.entity_type]);
    setOpen(false);
    setSearchTerm('');
  };

  // Group results by type
  const contacts = results.filter(r => r.entity_type === 'contact');
  const jobs = results.filter(r => r.entity_type === 'job');

  return (
    <div className="relative w-full max-w-sm">
      <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground z-10" />
      <Input
        ref={inputRef}
        placeholder="Search contacts, jobs..."
        value={searchTerm}
        onChange={(e) => setSearchTerm(e.target.value)}
        onFocus={() => {
          if (searchTerm.length >= 2 && results.length > 0) {
            setOpen(true);
          }
        }}
        className="pl-9"
        autoComplete="off"
      />
      
      {/* Dropdown results - positioned absolutely below input */}
      {open && (
        <div 
          ref={dropdownRef}
          className="absolute top-full left-0 right-0 mt-1 bg-popover border rounded-md shadow-lg z-50 max-h-[400px] overflow-y-auto"
        >
          <Command>
            <CommandList>
              {loading && (
                <CommandEmpty>Searching...</CommandEmpty>
              )}
              {!loading && results.length === 0 && searchTerm.length >= 2 && (
                <CommandEmpty>No results found</CommandEmpty>
              )}
              
              {/* Contacts Group */}
              {!loading && contacts.length > 0 && (
                <CommandGroup heading="Contacts">
                  {contacts.map((result) => (
                    <CommandItem
                      key={`contact-${result.entity_id}`}
                      onSelect={() => handleSelect(result)}
                      className="flex items-center justify-between cursor-pointer"
                    >
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        <User className="h-4 w-4 text-blue-500 shrink-0" />
                        <div className="flex flex-col min-w-0">
                          <span className="font-medium truncate">{result.entity_name}</span>
                          <span className="text-xs text-muted-foreground truncate">
                            {result.entity_subtext}
                          </span>
                        </div>
                      </div>
                      <Badge variant="outline" className="text-xs shrink-0 ml-2">
                        {result.entity_status}
                      </Badge>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
              
              {/* Jobs Group */}
              {!loading && jobs.length > 0 && (
                <CommandGroup heading="Jobs">
                  {jobs.map((result) => (
                    <CommandItem
                      key={`job-${result.entity_id}`}
                      onSelect={() => handleSelect(result)}
                      className="flex items-center justify-between cursor-pointer"
                    >
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        <Briefcase className="h-4 w-4 text-green-500 shrink-0" />
                        <div className="flex flex-col min-w-0">
                          <span className="font-medium truncate">{result.entity_name}</span>
                          <span className="text-xs text-muted-foreground truncate">
                            {result.entity_subtext}
                          </span>
                        </div>
                      </div>
                      <Badge variant="outline" className="text-xs shrink-0 ml-2">
                        {result.clj_number || result.entity_status}
                      </Badge>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
            </CommandList>
          </Command>
        </div>
      )}
    </div>
  );
};
