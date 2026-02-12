import { useState, useEffect, useRef, useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, X, ArrowRight } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useDebounce } from "@/hooks/useDebounce";

interface JobStage {
  name: string;
  key: string;
  color: string;
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
  const inputRef = useRef<HTMLInputElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);
  const debouncedQuery = useDebounce(searchQuery, 300);

  const stageMap = useMemo(() => {
    const map: Record<string, JobStage> = {};
    jobStages.forEach(s => { map[s.key] = s; });
    return map;
  }, [jobStages]);

  // Flatten all entries from the grouped pipeline data
  const allEntries = useMemo(() => {
    const entries: any[] = [];
    for (const [, stageEntries] of Object.entries(pipelineData)) {
      if (Array.isArray(stageEntries)) {
        entries.push(...stageEntries);
      }
    }
    return entries;
  }, [pipelineData]);

  const suggestions = useMemo(() => {
    if (debouncedQuery.length < 2) return [];
    const q = debouncedQuery.toLowerCase();
    return allEntries
      .filter(entry => {
        const name = `${entry.contacts?.first_name || ""} ${entry.contacts?.last_name || ""}`.toLowerCase();
        const clj = (entry.clj_formatted_number || "").toLowerCase();
        const addr = `${entry.contacts?.address_street || ""} ${entry.contacts?.address_city || ""} ${entry.contacts?.address_state || ""}`.toLowerCase();
        return name.includes(q) || clj.includes(q) || addr.includes(q);
      })
      .slice(0, 8);
  }, [debouncedQuery, allEntries]);

  useEffect(() => {
    setShowSuggestions(suggestions.length > 0 && debouncedQuery.length >= 2);
  }, [suggestions, debouncedQuery]);

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

  const handleSelect = (entry: any) => {
    setShowSuggestions(false);
    navigate(`/lead/${entry.id}`);
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
          {suggestions.map((entry) => {
            const stage = stageMap[entry.status];
            const name = `${entry.contacts?.first_name || ""} ${entry.contacts?.last_name || ""}`.trim();
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
