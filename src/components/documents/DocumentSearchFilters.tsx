import React, { useMemo } from 'react';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { Search, CalendarIcon, X } from 'lucide-react';
import { format, subDays, startOfYear } from 'date-fns';
import { cn } from '@/lib/utils';

interface Uploader {
  id: string;
  name: string;
}

interface DocumentSearchFiltersProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  categoryFilter: string;
  onCategoryChange: (category: string) => void;
  dateFrom: Date | undefined;
  dateTo: Date | undefined;
  onDateFromChange: (date: Date | undefined) => void;
  onDateToChange: (date: Date | undefined) => void;
  uploaderFilter: string;
  onUploaderChange: (uploaderId: string) => void;
  uploaders: Uploader[];
  categories: Array<{ value: string; label: string }>;
  resultCount: number;
  totalCount: number;
}

const DATE_PRESETS = [
  { label: 'Today', getDates: () => ({ from: new Date(), to: new Date() }) },
  { label: 'Last 7 days', getDates: () => ({ from: subDays(new Date(), 7), to: new Date() }) },
  { label: 'Last 30 days', getDates: () => ({ from: subDays(new Date(), 30), to: new Date() }) },
  { label: 'This year', getDates: () => ({ from: startOfYear(new Date()), to: new Date() }) },
];

export const DocumentSearchFilters: React.FC<DocumentSearchFiltersProps> = ({
  searchQuery,
  onSearchChange,
  categoryFilter,
  onCategoryChange,
  dateFrom,
  dateTo,
  onDateFromChange,
  onDateToChange,
  uploaderFilter,
  onUploaderChange,
  uploaders,
  categories,
  resultCount,
  totalCount,
}) => {
  const hasFilters = searchQuery || categoryFilter !== 'all' || dateFrom || dateTo || uploaderFilter !== 'all';

  const clearFilters = () => {
    onSearchChange('');
    onCategoryChange('all');
    onDateFromChange(undefined);
    onDateToChange(undefined);
    onUploaderChange('all');
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {/* Search Input */}
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search documents..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="pl-9"
          />
        </div>

        {/* Category Filter */}
        <Select value={categoryFilter} onValueChange={onCategoryChange}>
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {categories.map((cat) => (
              <SelectItem key={cat.value} value={cat.value}>
                {cat.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Date Range */}
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" className={cn("w-[180px] justify-start text-left font-normal", !dateFrom && !dateTo && "text-muted-foreground")}>
              <CalendarIcon className="mr-2 h-4 w-4" />
              {dateFrom ? (
                dateTo ? (
                  `${format(dateFrom, 'MMM d')} - ${format(dateTo, 'MMM d')}`
                ) : (
                  format(dateFrom, 'MMM d, yyyy')
                )
              ) : (
                'Date range'
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <div className="p-3 border-b">
              <div className="flex flex-wrap gap-1">
                {DATE_PRESETS.map((preset) => (
                  <Button
                    key={preset.label}
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      const { from, to } = preset.getDates();
                      onDateFromChange(from);
                      onDateToChange(to);
                    }}
                  >
                    {preset.label}
                  </Button>
                ))}
                {(dateFrom || dateTo) && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      onDateFromChange(undefined);
                      onDateToChange(undefined);
                    }}
                  >
                    Clear
                  </Button>
                )}
              </div>
            </div>
            <div className="flex">
              <div className="p-2">
                <p className="text-xs text-muted-foreground mb-1 px-2">From</p>
                <Calendar
                  mode="single"
                  selected={dateFrom}
                  onSelect={onDateFromChange}
                  initialFocus
                />
              </div>
              <div className="p-2 border-l">
                <p className="text-xs text-muted-foreground mb-1 px-2">To</p>
                <Calendar
                  mode="single"
                  selected={dateTo}
                  onSelect={onDateToChange}
                />
              </div>
            </div>
          </PopoverContent>
        </Popover>

        {/* Uploader Filter */}
        <Select value={uploaderFilter} onValueChange={onUploaderChange}>
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="Uploaded by" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Uploaders</SelectItem>
            {uploaders.map((uploader) => (
              <SelectItem key={uploader.id} value={uploader.id}>
                {uploader.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {hasFilters && (
          <Button variant="ghost" size="icon" onClick={clearFilters} title="Clear filters">
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>

      {hasFilters && (
        <p className="text-sm text-muted-foreground">
          Showing {resultCount} of {totalCount} documents
        </p>
      )}
    </div>
  );
};
