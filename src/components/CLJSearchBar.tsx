import { useState, useEffect, useRef } from 'react';
import { Input } from '@/components/ui/input';
import { Search, User, Briefcase, Target, Building2 } from 'lucide-react';
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
import { cn } from '@/lib/utils';

// Entity type badge configuration
const ENTITY_CONFIG = {
  contact: {
    icon: User,
    label: 'Contact',
    badgeClass: 'bg-blue-100 text-blue-700 border-blue-200',
    iconClass: 'text-blue-500',
  },
  lead: {
    icon: Target,
    label: 'Lead',
    badgeClass: 'bg-orange-100 text-orange-700 border-orange-200',
    iconClass: 'text-orange-500',
  },
  job: {
    icon: Building2,
    label: 'Job',
    badgeClass: 'bg-green-100 text-green-700 border-green-200',
    iconClass: 'text-green-500',
  },
} as const;

interface SearchResult {
  entity_type: 'contact' | 'lead' | 'job';
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
          p_location_id: currentLocationId
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
      contact: `/contact/${result.entity_id}`,
      lead: `/lead/${result.entity_id}`,
      job: `/project/${result.entity_id}`
    };

    navigate(routes[result.entity_type]);
    setOpen(false);
    setSearchTerm('');
  };

  // Group results by type
  const contacts = results.filter(r => r.entity_type === 'contact');
  const leads = results.filter(r => r.entity_type === 'lead');
  const jobs = results.filter(r => r.entity_type === 'job');

  return (
    <div className="relative w-full md:max-w-sm">
      <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground z-10" />
      <Input
        ref={inputRef}
        placeholder="Search contacts, leads, jobs..."
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
          className="fixed left-3 right-3 top-[7.5rem] md:absolute md:top-full md:left-0 md:right-0 mt-1 bg-popover border border-border rounded-md shadow-lg z-[60] max-h-[60vh] md:max-h-[400px] overflow-y-auto"
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
                  {contacts.map((result) => {
                    const config = ENTITY_CONFIG.contact;
                    const Icon = config.icon;
                    return (
                      <CommandItem
                        key={`contact-${result.entity_id}`}
                        onSelect={() => handleSelect(result)}
                        className="flex items-center justify-between cursor-pointer"
                      >
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          <div className={cn("p-1 rounded", "bg-blue-50")}>
                            <Icon className={cn("h-4 w-4", config.iconClass)} />
                          </div>
                          <div className="flex flex-col min-w-0">
                            <span className="font-medium truncate">{result.entity_name}</span>
                            <span className="text-xs text-muted-foreground truncate">
                              {result.entity_subtext}
                            </span>
                          </div>
                        </div>
                        <Badge variant="outline" className={cn("text-xs shrink-0 ml-2", config.badgeClass)}>
                          {config.label}
                        </Badge>
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              )}
              
              {/* Leads Group */}
              {!loading && leads.length > 0 && (
                <CommandGroup heading="Leads">
                  {leads.map((result) => {
                    const config = ENTITY_CONFIG.lead;
                    const Icon = config.icon;
                    return (
                      <CommandItem
                        key={`lead-${result.entity_id}`}
                        onSelect={() => handleSelect(result)}
                        className="flex items-center justify-between cursor-pointer"
                      >
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          <div className={cn("p-1 rounded", "bg-orange-50")}>
                            <Icon className={cn("h-4 w-4", config.iconClass)} />
                          </div>
                          <div className="flex flex-col min-w-0">
                            <span className="font-medium truncate">{result.entity_name}</span>
                            <span className="text-xs text-muted-foreground truncate">
                              {result.entity_subtext}
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0 ml-2">
                          {result.clj_number && (
                            <Badge variant="secondary" className="text-xs">
                              {result.clj_number}
                            </Badge>
                          )}
                          <Badge variant="outline" className={cn("text-xs", config.badgeClass)}>
                            {config.label}
                          </Badge>
                        </div>
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              )}
              
              {/* Jobs Group */}
              {!loading && jobs.length > 0 && (
                <CommandGroup heading="Jobs">
                  {jobs.map((result) => {
                    const config = ENTITY_CONFIG.job;
                    const Icon = config.icon;
                    return (
                      <CommandItem
                        key={`job-${result.entity_id}`}
                        onSelect={() => handleSelect(result)}
                        className="flex items-center justify-between cursor-pointer"
                      >
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          <div className={cn("p-1 rounded", "bg-green-50")}>
                            <Icon className={cn("h-4 w-4", config.iconClass)} />
                          </div>
                          <div className="flex flex-col min-w-0">
                            <span className="font-medium truncate">{result.entity_name}</span>
                            <span className="text-xs text-muted-foreground truncate">
                              {result.entity_subtext}
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0 ml-2">
                          {result.clj_number && (
                            <Badge variant="secondary" className="text-xs">
                              {result.clj_number}
                            </Badge>
                          )}
                          <Badge variant="outline" className={cn("text-xs", config.badgeClass)}>
                            {config.label}
                          </Badge>
                        </div>
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              )}
            </CommandList>
          </Command>
        </div>
      )}
    </div>
  );
};
