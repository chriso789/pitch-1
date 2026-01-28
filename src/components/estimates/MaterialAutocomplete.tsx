import { useState, useEffect, useRef } from 'react';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Package, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

interface Material {
  id: string;
  code: string;
  name: string;
  uom: string;
  base_cost: number;
  default_markup_pct: number;
  coverage_per_unit: number;
  category_id: string;
  category_name?: string;
  category_section?: string;
  attributes: Record<string, any>;
  tenant_id?: string | null;
}

interface Category {
  id: string;
  code: string;
  name: string;
  section: string;
}

interface MaterialAutocompleteProps {
  value: string;
  onChange: (value: string) => void;
  onSelectMaterial: (material: Material) => void;
  placeholder?: string;
  autoFocus?: boolean;
  className?: string;
}

export function MaterialAutocomplete({
  value,
  onChange,
  onSelectMaterial,
  placeholder = 'Search materials...',
  autoFocus = false,
  className = '',
}: MaterialAutocompleteProps) {
  const [materials, setMaterials] = useState<Material[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Fetch materials on mount
  useEffect(() => {
    fetchMaterials();
  }, []);

  const fetchMaterials = async () => {
    setLoading(true);
    try {
      const [materialsRes, categoriesRes] = await Promise.all([
        supabase.rpc('api_get_materials' as any),
        supabase.rpc('api_get_material_categories' as any)
      ]);

      if (categoriesRes.data) {
        setCategories(categoriesRes.data as Category[]);
      }

      if (materialsRes.data) {
        const cats = (categoriesRes.data || []) as Category[];
        const catMap = new Map(cats.map(c => [c.id, c]));
        
        setMaterials((materialsRes.data as any[])
          .filter(m => m.active !== false)
          .map((m: any) => ({
            ...m,
            category_name: catMap.get(m.category_id)?.name,
            category_section: catMap.get(m.category_id)?.section || 'roof'
          }))
        );
      }
    } catch (error) {
      console.error('Error fetching materials:', error);
    } finally {
      setLoading(false);
    }
  };

  // Filter materials based on search
  const filtered = value.length >= 1
    ? materials.filter(m =>
        m.name.toLowerCase().includes(value.toLowerCase()) ||
        m.code.toLowerCase().includes(value.toLowerCase())
      ).slice(0, 10)
    : [];

  // Handle keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!showDropdown || filtered.length === 0) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setHighlightedIndex(prev => Math.min(prev + 1, filtered.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setHighlightedIndex(prev => Math.max(prev - 1, 0));
        break;
      case 'Enter':
        e.preventDefault();
        if (filtered[highlightedIndex]) {
          handleSelect(filtered[highlightedIndex]);
        }
        break;
      case 'Escape':
        setShowDropdown(false);
        break;
    }
  };

  const handleSelect = (material: Material) => {
    onSelectMaterial(material);
    onChange(material.name);
    setShowDropdown(false);
  };

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setShowDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Reset highlight when filtered results change
  useEffect(() => {
    setHighlightedIndex(0);
  }, [filtered.length]);

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <div className="relative">
        <Input
          ref={inputRef}
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            setShowDropdown(true);
          }}
          onFocus={() => value.length >= 1 && setShowDropdown(true)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          autoFocus={autoFocus}
          className="pr-8"
        />
        {loading && (
          <Loader2 className="absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
        )}
      </div>

      {showDropdown && filtered.length > 0 && (
        <div className="absolute z-50 w-full mt-1 bg-popover border rounded-md shadow-lg">
          <ScrollArea className="max-h-[240px]">
            <div className="py-1">
              {filtered.map((material, index) => (
                <div
                  key={material.id}
                  onClick={() => handleSelect(material)}
                  onMouseEnter={() => setHighlightedIndex(index)}
                  className={`px-3 py-2 cursor-pointer transition-colors ${
                    index === highlightedIndex ? 'bg-accent' : 'hover:bg-muted/50'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <Package className="h-4 w-4 text-muted-foreground shrink-0" />
                        <span className="font-medium truncate text-sm">{material.name}</span>
                        {material.tenant_id && (
                          <Badge variant="secondary" className="text-xs bg-primary/10 text-primary">
                            Custom
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground ml-6">
                        <span className="font-mono">{material.code}</span>
                        {material.category_name && (
                          <Badge variant="outline" className="text-xs py-0">{material.category_name}</Badge>
                        )}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="font-semibold text-sm">${(material.base_cost || 0).toFixed(2)}</div>
                      <div className="text-xs text-muted-foreground">per {material.uom}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
          <div className="border-t px-3 py-1.5 text-xs text-muted-foreground bg-muted/30">
            {filtered.length} result{filtered.length !== 1 ? 's' : ''} • ↑↓ to navigate • Enter to select
          </div>
        </div>
      )}

      {showDropdown && value.length >= 1 && filtered.length === 0 && !loading && (
        <div className="absolute z-50 w-full mt-1 bg-popover border rounded-md shadow-lg p-3 text-sm text-muted-foreground text-center">
          No materials found for "{value}"
          <p className="text-xs mt-1">You can still add a custom item</p>
        </div>
      )}
    </div>
  );
}
