import { useState, useEffect, useRef, useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, X, ArrowRight, Loader2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useDebounce } from "@/hooks/useDebounce";
import { supabase } from "@/integrations/supabase/client";

interface JobStage {
  name: string;
  key: string;
  color: string;
}

interface SearchResult {
  id: string;
  clj_formatted_number: string;
  status: string;
  lead_name: string | null;
  contacts: {
    first_name: string;
    last_name: string;
    address_city: string | null;
    address_state: string | null;
  };
}

interface PipelineSearchProps {
  pipelineData: Record<string, any[]>;
  jobStages: JobStage[];
  searchQuery: string;
  onSearchChange: (query: string) => void;
}

export const PipelineSearch = ({
  pipelineData,
  jobStages,
  searchQuery,
  onSearchChange,
}: PipelineSearchProps) => {
  const navigate = useNavigate();
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [suggestions, setSuggestions] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);
  const debouncedQuery = useDebounce(searchQuery, 300);

  const stageMap = useMemo(() => {
    const map: Record<string, JobStage> = {};
    jobStages.forEach(s => { map[s.key] = s; });
    return map;
  }, [jobStages]);

  // Independent Supabase search across ALL locations
  useEffect(() => {
    const searchPipeline = async () => {
      if (debouncedQuery.length < 2) {
        setSuggestions([]);
        setShowSuggestions(false);
        return;
      }

      setLoading(true);
      try {
        const q = `%${debouncedQuery}%`;
        
        // Search with left join (no !inner) so entries without contacts still appear
        const { data, error } = await supabase
          .from('pipeline_entries')
          .select(`
            id,
            clj_formatted_number,
            status,
            lead_name,
            contacts (
              first_name,
              last_name,
              address_city,
              address_state
            )
          `)
          .eq('is_deleted', false)
          .or(`lead_name.ilike.${q},clj_formatted_number.ilike.${q}`)
          .order('updated_at', { ascending: false })
          .limit(20);

        // Also search by contact fields separately
        const { data: contactData } = await supabase
          .from('pipeline_entries')
          .select(`
            id,
            clj_formatted_number,
            status,
            lead_name,
            contacts!inner (
              first_name,
              last_name,
              address_city,
              address_state
            )
          `)
          .eq('is_deleted', false)
          .or(`contacts.first_name.ilike.${q},contacts.last_name.ilike.${q},contacts.address_city.ilike.${q}`)
          .order('updated_at', { ascending: false })
          .limit(20);

        if (error) throw error;

        // Merge and deduplicate results
        const allData = [...(data || []), ...(contactData || [])];
        const seen = new Set<string>();
        const deduped = allData.filter(entry => {
          if (seen.has(entry.id)) return false;
          seen.add(entry.id);
          return true;
        }).slice(0, 10);

        const results: SearchResult[] = deduped.map(entry => ({
          id: entry.id,
          clj_formatted_number: entry.clj_formatted_number,
          status: entry.status,
          lead_name: entry.lead_name,
          contacts: Array.isArray(entry.contacts) ? entry.contacts[0] : entry.contacts,
        }));

        setSuggestions(results);
        setShowSuggestions(results.length > 0);
      } catch (error) {
        console.error('Pipeline search error:', error);
        setSuggestions([]);
      } finally {
        setLoading(false);
      }
    };

    searchPipeline();
  }, [debouncedQuery]);

  // Click outside to close
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        suggestionsRef.current && !suggestionsRef.current.contains(e.target as Node) &&
        inputRef.current && !inputRef.current.contains(e.target as Node)
      ) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleSelect = (entry: SearchResult) => {
    setShowSuggestions(false);
    navigate(`/lead/${entry.id}`);
  };

  const getDisplayName = (entry: SearchResult) => {
    if (entry.lead_name) return entry.lead_name;
    const c = entry.contacts;
    return `${c?.first_name || ""} ${c?.last_name || ""}`.trim() || "Unknown";
  };

  return (
    <div className="relative flex-1 w-full">
      <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
      <Input
        ref={inputRef}
        placeholder="Search leads by name, CLJ number, or address..."
        value={searchQuery}
        onChange={(e) => onSearchChange(e.target.value)}
        onFocus={() => {
          if (suggestions.length > 0) setShowSuggestions(true);
        }}
        className="pl-10"
      />
      {searchQuery && (
        <Button
          variant="ghost"
          size="sm"
          className="absolute right-2 top-1/2 transform -translate-y-1/2 h-6 w-6 p-0"
          onClick={() => onSearchChange("")}
        >
          <X className="h-4 w-4" />
        </Button>
      )}

      {showSuggestions && (
        <div
          ref={suggestionsRef}
          className="absolute z-50 w-full mt-1 bg-popover border border-border rounded-md shadow-lg max-h-72 overflow-auto"
        >
          {loading && (
            <div className="flex items-center gap-2 px-3 py-2.5 text-sm text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Searching...
            </div>
          )}
          {!loading && suggestions.map((entry) => {
            const stage = stageMap[entry.status];
            const name = getDisplayName(entry);
            const addr = [entry.contacts?.address_city, entry.contacts?.address_state]
              .filter(Boolean)
              .join(", ");
            return (
              <div
                key={entry.id}
                onClick={() => handleSelect(entry)}
                className="flex items-center gap-3 px-3 py-2.5 hover:bg-muted cursor-pointer border-b border-border last:border-b-0"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm truncate">{name}</span>
                    {stage && (
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full text-white ${stage.color}`}>
                        {stage.name}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                    {entry.clj_formatted_number && (
                      <span className="font-mono">{entry.clj_formatted_number}</span>
                    )}
                    {addr && <span>• {addr}</span>}
                  </div>
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
