import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { X, Filter, Search } from "lucide-react";
import { AutocompleteSearch } from "@/components/ui/autocomplete-search";

interface FilterOption {
  key: string;
  label: string;
  value: string;
}

interface FilterBarProps {
  searchPlaceholder?: string;
  filterOptions: {
    key: string;
    label: string;
    options: { value: string; label: string }[];
  }[];
  onSearchChange: (search: string) => void;
  onFilterChange: (filters: FilterOption[]) => void;
  onSortChange: (sort: { field: string; direction: 'asc' | 'desc' }) => void;
  sortOptions: { value: string; label: string }[];
  useAutocomplete?: boolean;
}

export const FilterBar = ({
  searchPlaceholder = "Search...",
  filterOptions,
  onSearchChange,
  onFilterChange,
  onSortChange,
  sortOptions,
  useAutocomplete = false
}: FilterBarProps) => {
  const [search, setSearch] = useState("");
  const [activeFilters, setActiveFilters] = useState<FilterOption[]>([]);
  const [sortField, setSortField] = useState("");
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  const handleSearchChange = (value: string) => {
    setSearch(value);
    onSearchChange(value);
  };

  const addFilter = (key: string, label: string, value: string, valueLabel: string) => {
    const newFilter = { key, label: `${label}: ${valueLabel}`, value };
    const existingIndex = activeFilters.findIndex(f => f.key === key);
    
    let newFilters;
    if (existingIndex >= 0) {
      newFilters = [...activeFilters];
      newFilters[existingIndex] = newFilter;
    } else {
      newFilters = [...activeFilters, newFilter];
    }
    
    setActiveFilters(newFilters);
    onFilterChange(newFilters);
  };

  const removeFilter = (key: string) => {
    const newFilters = activeFilters.filter(f => f.key !== key);
    setActiveFilters(newFilters);
    onFilterChange(newFilters);
  };

  const handleSortChange = (value: string) => {
    setSortField(value);
    onSortChange({ field: value, direction: sortDirection });
  };

  const toggleSortDirection = () => {
    const newDirection = sortDirection === 'asc' ? 'desc' : 'asc';
    setSortDirection(newDirection);
    if (sortField) {
      onSortChange({ field: sortField, direction: newDirection });
    }
  };

  return (
    <div className="space-y-4">
      {/* Search and Sort Row */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          {useAutocomplete ? (
            <AutocompleteSearch
              placeholder={searchPlaceholder}
              onSearchChange={handleSearchChange}
            />
          ) : (
            <>
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={searchPlaceholder}
                value={search}
                onChange={(e) => handleSearchChange(e.target.value)}
                className="pl-10"
              />
            </>
          )}
        </div>
        
        <div className="flex gap-2">
          <Select value={sortField} onValueChange={handleSortChange}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Sort by..." />
            </SelectTrigger>
            <SelectContent>
              {sortOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          
          <Button
            variant="outline"
            size="sm"
            onClick={toggleSortDirection}
            disabled={!sortField}
            className="px-3"
          >
            {sortDirection === 'asc' ? '↑' : '↓'}
          </Button>
        </div>
      </div>

      {/* Filters Row */}
      <div className="flex flex-wrap gap-2">
        {filterOptions.map((filterGroup) => (
          <Select
            key={filterGroup.key}
            onValueChange={(value) => {
              const option = filterGroup.options.find(o => o.value === value);
              if (option) {
                addFilter(filterGroup.key, filterGroup.label, value, option.label);
              }
            }}
          >
            <SelectTrigger className="w-[150px]">
              <Filter className="h-4 w-4 mr-2" />
              <SelectValue placeholder={filterGroup.label} />
            </SelectTrigger>
            <SelectContent>
              {filterGroup.options.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ))}
      </div>

      {/* Active Filters Row */}
      {activeFilters.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {activeFilters.map((filter) => (
            <Badge
              key={filter.key}
              variant="secondary"
              className="cursor-pointer hover:bg-destructive hover:text-destructive-foreground"
              onClick={() => removeFilter(filter.key)}
            >
              {filter.label}
              <X className="h-3 w-3 ml-1" />
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
};