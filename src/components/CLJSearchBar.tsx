import { useState, useEffect, useRef, useCallback } from 'react';
import { Input } from '@/components/ui/input';
import { Search, User, Briefcase, Target, Building2, Clock, X } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useActiveTenantId } from '@/hooks/useActiveTenantId';
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

const MAX_RECENTS = 5;
const getRecentsKey = (tenantId: string) => `pitch-recent-searches-${tenantId}`;

const loadRecents = (tenantId: string | null): SearchResult[] => {
  if (!tenantId) return [];
  try {
    return JSON.parse(localStorage.getItem(getRecentsKey(tenantId)) || '[]');
  } catch { return []; }
};

const saveRecent = (result: SearchResult, tenantId: string | null) => {
  if (!tenantId) return;
  const existing = loadRecents(tenantId);
  const filtered = existing.filter(r => r.entity_id !== result.entity_id);
  const updated = [result, ...filtered].slice(0, MAX_RECENTS);
  localStorage.setItem(getRecentsKey(tenantId), JSON.stringify(updated));
};

export const CLJSearchBar = () => {
  const [searchTerm, setSearchTerm] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [recents, setRecents] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const { toast } = useToast();
  const { currentLocationId } = useLocation();
  const { activeTenantId } = useActiveTenantId();

  // Re-resolve cached recent items against the live DB so renames (e.g. a
  // contact renamed from "Reed Alter" to "Brittany Jones", or a lead/project
  // renamed by a manager) immediately show the current name in the dropdown
  // instead of a stale localStorage snapshot.
  const refreshRecents = async (tenantId: string | null) => {
    const cached = loadRecents(tenantId);
    if (!tenantId || cached.length === 0) {
      setRecents(cached);
      return;
    }

    try {
      const contactIds = cached.filter(r => r.entity_type === 'contact').map(r => r.entity_id);
      const leadIds = cached.filter(r => r.entity_type === 'lead' || r.entity_type === 'job').map(r => r.entity_id);

      const [contactsRes, leadsRes] = await Promise.all([
        contactIds.length
          ? supabase.from('contacts').select('id, first_name, last_name, address_street').in('id', contactIds)
          : Promise.resolve({ data: [] as any[] }),
        leadIds.length
          ? supabase
              .from('pipeline_entries')
              .select('id, lead_name, contacts(first_name, last_name, address_street)')
              .in('id', leadIds)
          : Promise.resolve({ data: [] as any[] }),
      ]);

      const contactMap = new Map((contactsRes.data || []).map((c: any) => [c.id, c]));
      const leadMap = new Map((leadsRes.data || []).map((l: any) => [l.id, l]));

      const refreshed = cached.map(r => {
        if (r.entity_type === 'contact') {
          const c = contactMap.get(r.entity_id);
          if (!c) return r;
          const name = `${c.first_name || ''} ${c.last_name || ''}`.trim() || r.entity_name;
          return { ...r, entity_name: name, entity_subtext: c.address_street || r.entity_subtext };
        }
        if (r.entity_type === 'lead' || r.entity_type === 'job') {
          const l: any = leadMap.get(r.entity_id);
          if (!l) return r;
          // Lead/Project name takes precedence; fall back to contact name.
          const contactName = l.contacts
            ? `${l.contacts.first_name || ''} ${l.contacts.last_name || ''}`.trim()
            : '';
          const name = (l.lead_name && l.lead_name.trim()) || contactName || r.entity_name;
          return {
            ...r,
            entity_name: name,
            entity_subtext: l.contacts?.address_street || r.entity_subtext,
          };
        }
        return r;
      });

      setRecents(refreshed);
      // Persist refreshed names so the next open is instant and consistent.
      localStorage.setItem(getRecentsKey(tenantId), JSON.stringify(refreshed));
    } catch (err) {
      console.warn('[CLJSearch] Failed to refresh recents from DB', err);
      setRecents(cached);
    }
  };

  // Reload + refresh recents whenever the active company changes (so switching
  // tenants immediately swaps the list to that company's history).
  useEffect(() => {
    refreshRecents(activeTenantId);
  }, [activeTenantId]);

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
        // Don't close if recents are showing
        if (recents.length === 0) setOpen(false);
        return;
      }

      setLoading(true);
      try {
        if (!activeTenantId) {
          console.warn('[CLJSearch] No active tenant ID available — skipping search');
          return;
        }

        // Call the universal search RPC with location filter
        const { data, error } = await supabase.rpc('search_contacts_and_jobs', {
          p_tenant_id: activeTenantId,
          p_search_term: searchTerm,
          p_location_id: currentLocationId
        });

        console.log('[CLJSearch]', { searchTerm, activeTenantId, resultCount: data?.length ?? 0 });

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
  }, [searchTerm, currentLocationId, activeTenantId, toast]);

  const handleSelect = (result: SearchResult) => {
    const routes: Record<string, string> = {
      contact: `/contact/${result.entity_id}`,
      lead: `/lead/${result.entity_id}`,
      job: `/lead/${result.entity_id}`
    };

    saveRecent(result, activeTenantId);
    // Re-resolve names from DB so the freshly added recent reflects any
    // rename that happened after the original cache was written.
    refreshRecents(activeTenantId);
    navigate(routes[result.entity_type]);
    setOpen(false);
    setSearchTerm('');
  };

  const clearRecents = () => {
    if (activeTenantId) {
      localStorage.removeItem(getRecentsKey(activeTenantId));
    }
    setRecents([]);
    setOpen(false);
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
          } else if (searchTerm.length < 2) {
            const r = loadRecents(activeTenantId);
            if (r.length > 0) {
              setOpen(true);
              // Pull live names from DB on every focus so renames show up
              // immediately without requiring a tenant switch or reload.
              refreshRecents(activeTenantId);
            }
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
          <Command shouldFilter={false}>
            <CommandList>
              {loading && (
                <CommandEmpty>Searching...</CommandEmpty>
              )}
              {!loading && results.length === 0 && searchTerm.length >= 2 && (
                <CommandEmpty>No results found</CommandEmpty>
              )}

              {/* Recent Searches */}
              {recents.length > 0 && searchTerm.length < 2 && (
                <>
                  <div className="flex items-center justify-between px-2 py-1.5">
                    <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                      <Clock className="h-3.5 w-3.5" />
                      <span>Recent</span>
                    </div>
                    <button
                      onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); clearRecents(); }}
                      className="text-xs text-muted-foreground hover:text-foreground transition-colors px-1"
                    >
                      Clear
                    </button>
                  </div>
                  <CommandGroup>
                  {recents.map((result) => {
                    const config = ENTITY_CONFIG[result.entity_type];
                    const Icon = config.icon;
                    return (
                      <CommandItem
                        key={`recent-${result.entity_id}`}
                        onSelect={() => handleSelect(result)}
                        className="flex items-center justify-between cursor-pointer"
                      >
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          <div className={cn("p-1 rounded", result.entity_type === 'contact' ? 'bg-blue-50' : result.entity_type === 'lead' ? 'bg-orange-50' : 'bg-green-50')}>
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
