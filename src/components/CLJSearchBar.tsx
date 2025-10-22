import { useState, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { Search, ExternalLink } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useNavigate } from 'react-router-dom';
import { useToast } from '@/hooks/use-toast';
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
  entity_type: 'contact' | 'lead' | 'job';
  entity_id: string;
  clj_number: string;
  entity_name: string;
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
    const searchCLJ = async () => {
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

        const tenantId = profileQuery.data?.tenant_id;
        if (!tenantId) return;

        // Call the RPC function using REST API
        const SUPABASE_URL = "https://alxelfrbjzkmtnsulcei.supabase.co";
        const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFseGVsZnJianprbXRuc3VsY2VpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTgxNTYyNzcsImV4cCI6MjA3MzczMjI3N30.ouuzXBD8iercLbbxtueioRppHsywgpgxEdDqt6AaMtM";
        
        const { data: session } = await supabase.auth.getSession();
        const response = await fetch(
          `${SUPABASE_URL}/rest/v1/rpc/search_by_clj_number`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'apikey': SUPABASE_KEY,
              'Authorization': `Bearer ${session.session?.access_token}`
            },
            body: JSON.stringify({
              tenant_id_param: tenantId,
              clj_search: searchTerm
            })
          }
        );

        if (!response.ok) throw new Error('Search failed');
        const data = await response.json();
        setResults((data || []) as SearchResult[]);
        setOpen(true);
      } catch (error) {
        console.error('Search error:', error);
        toast({
          title: 'Search failed',
          description: 'Could not search by C-L-J number',
          variant: 'destructive'
        });
      } finally {
        setLoading(false);
      }
    };

    const timeoutId = setTimeout(searchCLJ, 300);
    return () => clearTimeout(timeoutId);
  }, [searchTerm, toast]);

  const handleSelect = (result: SearchResult) => {
    const routes = {
      contact: `/contacts/${result.entity_id}`,
      lead: `/pipeline?highlight=${result.entity_id}`,
      job: `/projects/${result.entity_id}`
    };

    navigate(routes[result.entity_type]);
    setOpen(false);
    setSearchTerm('');
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <div className="relative w-full max-w-sm">
          <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by C-L-J (e.g., 1-2-3)"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9 font-mono"
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
            {!loading && results.length > 0 && (
              <CommandGroup heading="Results">
                {results.map((result) => (
                  <CommandItem
                    key={`${result.entity_type}-${result.entity_id}`}
                    onSelect={() => handleSelect(result)}
                    className="flex items-center justify-between"
                  >
                    <div className="flex flex-col">
                      <span className="font-medium">{result.entity_name}</span>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span className="font-mono">{result.clj_number}</span>
                        <span>•</span>
                        <span className="capitalize">{result.entity_type}</span>
                        <span>•</span>
                        <span>{result.entity_status}</span>
                      </div>
                    </div>
                    <ExternalLink className="h-4 w-4" />
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
