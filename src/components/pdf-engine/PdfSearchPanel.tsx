import { useState, useCallback } from 'react';
import { useEffectiveTenantId } from '@/hooks/useEffectiveTenantId';
import { supabase } from '@/integrations/supabase/client';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Search, FileText, ArrowRight } from 'lucide-react';

interface SearchResult {
  id: string;
  pdf_document_id: string;
  page_id: string | null;
  content_text: string;
  page_number?: number;
  document_title?: string;
}

interface PdfSearchPanelProps {
  currentDocumentId?: string;
  onJumpToPage?: (pageNumber: number) => void;
}

export function PdfSearchPanel({ currentDocumentId, onJumpToPage }: PdfSearchPanelProps) {
  const tenantId = useEffectiveTenantId();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [scope, setScope] = useState<'current' | 'all'>('current');

  const handleSearch = useCallback(async () => {
    if (!query.trim() || !tenantId) return;
    setIsSearching(true);
    try {
      let q = (supabase as any)
        .from('pdf_search_index')
        .select('*')
        .eq('tenant_id', tenantId)
        .ilike('content_text', `%${query.trim()}%`)
        .limit(50);

      if (scope === 'current' && currentDocumentId) {
        q = q.eq('pdf_document_id', currentDocumentId);
      }

      const { data, error } = await q;
      if (error) throw error;
      setResults(data || []);
    } catch (err) {
      console.warn('[PdfSearchPanel] Search error:', err);
      setResults([]);
    } finally {
      setIsSearching(false);
    }
  }, [query, tenantId, scope, currentDocumentId]);

  const highlightMatch = (text: string) => {
    if (!query.trim()) return text;
    const idx = text.toLowerCase().indexOf(query.toLowerCase());
    if (idx === -1) return text.slice(0, 120);
    const start = Math.max(0, idx - 30);
    const end = Math.min(text.length, idx + query.length + 30);
    const snippet = text.slice(start, end);
    return (start > 0 ? '...' : '') + snippet + (end < text.length ? '...' : '');
  };

  return (
    <div className="space-y-3 p-2">
      <div className="flex gap-1">
        <Input
          placeholder="Search PDF text..."
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSearch()}
          className="h-8 text-xs"
        />
        <Button size="sm" className="h-8" onClick={handleSearch} disabled={isSearching}>
          <Search className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="flex gap-1">
        <Button
          variant={scope === 'current' ? 'default' : 'outline'}
          size="sm" className="h-6 text-[10px]"
          onClick={() => setScope('current')}
        >
          This PDF
        </Button>
        <Button
          variant={scope === 'all' ? 'default' : 'outline'}
          size="sm" className="h-6 text-[10px]"
          onClick={() => setScope('all')}
        >
          All PDFs
        </Button>
      </div>

      <ScrollArea className="h-[400px]">
        {results.length === 0 && !isSearching && (
          <p className="text-xs text-muted-foreground text-center py-4">
            {query ? 'No results found' : 'Enter a search term'}
          </p>
        )}
        {isSearching && (
          <p className="text-xs text-muted-foreground text-center py-4 animate-pulse">Searching...</p>
        )}
        <div className="space-y-1.5">
          {results.map(r => (
            <button
              key={r.id}
              className="w-full text-left p-2 rounded border hover:bg-muted/50 transition-colors"
              onClick={() => {
                const pageNum = (r as any).page_number || 1;
                onJumpToPage?.(pageNum);
              }}
            >
              <div className="flex items-center gap-1 mb-0.5">
                <FileText className="h-3 w-3 text-muted-foreground" />
                <span className="text-[10px] text-muted-foreground">
                  Page {(r as any).page_number || '?'}
                </span>
                <ArrowRight className="h-2.5 w-2.5 text-muted-foreground ml-auto" />
              </div>
              <p className="text-xs break-words">{highlightMatch(r.content_text)}</p>
            </button>
          ))}
        </div>
      </ScrollArea>

      {results.length > 0 && (
        <Badge variant="secondary" className="text-[10px]">
          {results.length} result{results.length !== 1 ? 's' : ''}
        </Badge>
      )}
    </div>
  );
}
