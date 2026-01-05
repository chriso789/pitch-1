import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { Search, Package, Loader2 } from 'lucide-react';
import { SRS_PRICELIST, SRSPricelistItem } from '@/data/srs-pricelist-data';

export interface MaterialSuggestion {
  name: string;
  item_code?: string;
  unit_cost: number;
  unit: string;
  description?: string;
  category?: string;
  brand?: string;
  source: 'pricelist' | 'template';
}

interface MaterialAutocompleteProps {
  value: string;
  onChange: (value: string) => void;
  onSelect: (material: MaterialSuggestion) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}

// Convert SRS unit of measure to our standard unit types
const mapUnitOfMeasure = (uom: string): string => {
  const mapping: Record<string, string> = {
    'SQ': 'square',
    'BD': 'bundle',
    'RL': 'roll',
    'PC': 'each',
    'EA': 'each',
    'BKT': 'each',
    'BAG': 'each',
    'Can': 'each',
    'Roll': 'roll',
  };
  return mapping[uom] || 'each';
};

// Fuzzy match function for search
const fuzzyMatch = (text: string, query: string): boolean => {
  if (!query) return true;
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  
  // Direct includes match
  if (lowerText.includes(lowerQuery)) return true;
  
  // Word prefix matching (e.g., "CERTA" matches "CertainTeed")
  const words = lowerText.split(/[\s\-_]+/);
  return words.some(word => word.startsWith(lowerQuery));
};

// Score results for sorting (higher = better match)
const scoreMatch = (item: SRSPricelistItem, query: string): number => {
  const lowerQuery = query.toLowerCase();
  let score = 0;
  
  // Exact product name match
  if (item.product.toLowerCase() === lowerQuery) score += 100;
  // Product name starts with query
  else if (item.product.toLowerCase().startsWith(lowerQuery)) score += 50;
  // Product name contains query
  else if (item.product.toLowerCase().includes(lowerQuery)) score += 30;
  
  // Brand match
  if (item.brand.toLowerCase().includes(lowerQuery)) score += 20;
  
  // Item code match
  if (item.item_code.toLowerCase().includes(lowerQuery)) score += 25;
  
  // Category match
  if (item.category.toLowerCase().includes(lowerQuery)) score += 10;
  
  return score;
};

export function MaterialAutocomplete({
  value,
  onChange,
  onSelect,
  placeholder = "Start typing product name...",
  className,
  disabled = false,
}: MaterialAutocompleteProps) {
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [suggestions, setSuggestions] = useState<MaterialSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Search function with debounce
  const searchMaterials = useCallback((query: string) => {
    if (!query || query.length < 2) {
      setSuggestions([]);
      return;
    }

    setLoading(true);

    // Search SRS_PRICELIST
    const results = SRS_PRICELIST
      .filter(item => 
        fuzzyMatch(item.product, query) ||
        fuzzyMatch(item.brand, query) ||
        fuzzyMatch(item.item_code, query) ||
        fuzzyMatch(item.category, query)
      )
      .map(item => ({
        item,
        score: scoreMatch(item, query)
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 10)
      .map(({ item }): MaterialSuggestion => ({
        name: item.product,
        item_code: item.item_code,
        unit_cost: item.unit_cost,
        unit: mapUnitOfMeasure(item.unit_of_measure),
        description: item.item_code,
        category: item.category,
        brand: item.brand,
        source: 'pricelist'
      }));

    setSuggestions(results);
    setLoading(false);
    setHighlightedIndex(-1);
  }, []);

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      searchMaterials(value);
    }, 300);

    return () => clearTimeout(timer);
  }, [value, searchMaterials]);

  // Click outside to close
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setShowSuggestions(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!showSuggestions || suggestions.length === 0) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setHighlightedIndex(prev => 
          prev < suggestions.length - 1 ? prev + 1 : 0
        );
        break;
      case 'ArrowUp':
        e.preventDefault();
        setHighlightedIndex(prev => 
          prev > 0 ? prev - 1 : suggestions.length - 1
        );
        break;
      case 'Enter':
        e.preventDefault();
        if (highlightedIndex >= 0 && suggestions[highlightedIndex]) {
          handleSelect(suggestions[highlightedIndex]);
        }
        break;
      case 'Escape':
        setShowSuggestions(false);
        break;
    }
  };

  const handleSelect = (material: MaterialSuggestion) => {
    onChange(material.name);
    onSelect(material);
    setShowSuggestions(false);
    setHighlightedIndex(-1);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    onChange(newValue);
    setShowSuggestions(true);
  };

  const handleFocus = () => {
    if (value.length >= 2) {
      setShowSuggestions(true);
    }
  };

  const formatPrice = (price: number, unit: string) => {
    return `$${price.toFixed(2)}/${unit === 'square' ? 'SQ' : unit === 'bundle' ? 'BD' : unit === 'roll' ? 'RL' : 'EA'}`;
  };

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
        <Input
          ref={inputRef}
          value={value}
          onChange={handleInputChange}
          onFocus={handleFocus}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          className="pl-9"
        />
        {loading && (
          <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
        )}
      </div>

      {showSuggestions && suggestions.length > 0 && (
        <div className="absolute z-50 w-full mt-1 bg-popover border border-border rounded-md shadow-lg max-h-[300px] overflow-auto">
          {suggestions.map((material, index) => (
            <div
              key={`${material.item_code}-${index}`}
              className={cn(
                "flex items-start gap-3 px-3 py-2 cursor-pointer transition-colors",
                index === highlightedIndex ? "bg-accent" : "hover:bg-muted/50"
              )}
              onClick={() => handleSelect(material)}
              onMouseEnter={() => setHighlightedIndex(index)}
            >
              <Package className="h-4 w-4 mt-1 text-muted-foreground flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{material.name}</p>
                <p className="text-xs text-muted-foreground truncate">
                  {material.item_code && <span className="font-mono">{material.item_code}</span>}
                  {material.item_code && material.category && <span> • </span>}
                  {material.category}
                  {material.brand && <span> • {material.brand}</span>}
                </p>
              </div>
              <div className="text-right flex-shrink-0">
                <p className="text-sm font-semibold text-primary">
                  {formatPrice(material.unit_cost, material.unit)}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      {showSuggestions && value.length >= 2 && suggestions.length === 0 && !loading && (
        <div className="absolute z-50 w-full mt-1 bg-popover border border-border rounded-md shadow-lg p-3">
          <p className="text-sm text-muted-foreground text-center">
            No materials found for "{value}"
          </p>
        </div>
      )}
    </div>
  );
}
