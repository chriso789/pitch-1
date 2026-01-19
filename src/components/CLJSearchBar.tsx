import { useState, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { Search, User, Briefcase } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useNavigate } from 'react-router-dom';
import { useToast } from '@/hooks/use-toast';
import { Badge } from '@/components/ui/badge';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

interface SearchResult {
  entity_type: 'contact' | 'job';
  entity_id: string;
  entity_name: string;
  entity_subtext: string;
  clj_number: string;
  entity_status: string;
}

export const CLJSearchBar = () => {
  const [searchTerm, setSearchTerm] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => {
    const searchAll = async () => {
      if (searchTerm.length < 2) {
        setResults([]);
        return;
      }

      setLoading(true);
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        // Get tenant_id from profiles
        // @ts-ignore - Supabase type inference issue
        const profileQuery = await supabase
          .from('profiles')
          .select('tenant_id')
          .eq('user_id', user.id)
          .maybeSingle();
        
        const profile = profileQuery.data as { tenant_id: string | null } | null;

        if (!profile?.tenant_id) return;

        // Call the universal search RPC
        const { data, error } = await supabase.rpc('search_contacts_and_jobs', {
          p_tenant_id: profile.tenant_id,
          p_search_term: searchTerm,
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
  }, [searchTerm, toast]);

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
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <div className="relative w-full max-w-sm">
          <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search contacts, jobs..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9"
          />
        </div>
      </PopoverTrigger>
      <PopoverContent className="p-0 w-[400px]" align="start">
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
      </PopoverContent>
    </Popover>
  );
};
