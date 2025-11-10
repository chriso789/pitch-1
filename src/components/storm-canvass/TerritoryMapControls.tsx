import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Filter, X } from 'lucide-react';
import { ActivityFilters } from '@/hooks/useStormCanvass';

interface TerritoryMapControlsProps {
  onFiltersChange: (filters: ActivityFilters) => void;
  users: Array<{ id: string; first_name: string; last_name: string }>;
  locations: Array<{ id: string; name: string }>;
  dispositions: Array<{ id: string; name: string }>;
}

export const TerritoryMapControls = ({
  onFiltersChange,
  users,
  locations,
  dispositions,
}: TerritoryMapControlsProps) => {
  const [filters, setFilters] = useState<ActivityFilters>({});
  const [isExpanded, setIsExpanded] = useState(true);

  const handleFilterChange = (key: keyof ActivityFilters, value: string | undefined) => {
    const newFilters = { ...filters, [key]: value || undefined };
    setFilters(newFilters);
    onFiltersChange(newFilters);
  };

  const clearFilters = () => {
    setFilters({});
    onFiltersChange({});
  };

  const hasActiveFilters = Object.values(filters).some((v) => v !== undefined);

  return (
    <Card className="absolute top-4 left-4 z-10 w-80 shadow-lg">
      <CardContent className="pt-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4" />
            <h3 className="font-semibold">Filters</h3>
          </div>
          <div className="flex gap-2">
            {hasActiveFilters && (
              <Button variant="ghost" size="sm" onClick={clearFilters}>
                <X className="h-4 w-4 mr-1" />
                Clear
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsExpanded(!isExpanded)}
            >
              {isExpanded ? '−' : '+'}
            </Button>
          </div>
        </div>

        {isExpanded && (
          <div className="space-y-4">
            <div>
              <Label htmlFor="startDate">Start Date</Label>
              <Input
                id="startDate"
                type="date"
                value={filters.startDate || ''}
                onChange={(e) => handleFilterChange('startDate', e.target.value)}
              />
            </div>

            <div>
              <Label htmlFor="endDate">End Date</Label>
              <Input
                id="endDate"
                type="date"
                value={filters.endDate || ''}
                onChange={(e) => handleFilterChange('endDate', e.target.value)}
              />
            </div>

            <div>
              <Label htmlFor="user">Rep</Label>
              <Select
                value={filters.userId || 'all'}
                onValueChange={(value) =>
                  handleFilterChange('userId', value === 'all' ? undefined : value)
                }
              >
                <SelectTrigger id="user">
                  <SelectValue placeholder="All Reps" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Reps</SelectItem>
                  {users.map((user) => (
                    <SelectItem key={user.id} value={user.id}>
                      {user.first_name} {user.last_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="location">Territory</Label>
              <Select
                value={filters.locationId || 'all'}
                onValueChange={(value) =>
                  handleFilterChange('locationId', value === 'all' ? undefined : value)
                }
              >
                <SelectTrigger id="location">
                  <SelectValue placeholder="All Territories" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Territories</SelectItem>
                  {locations.map((location) => (
                    <SelectItem key={location.id} value={location.id}>
                      {location.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="disposition">Disposition</Label>
              <Select
                value={filters.dispositionId || 'all'}
                onValueChange={(value) =>
                  handleFilterChange('dispositionId', value === 'all' ? undefined : value)
                }
              >
                <SelectTrigger id="disposition">
                  <SelectValue placeholder="All Dispositions" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Dispositions</SelectItem>
                  {dispositions.map((disposition) => (
                    <SelectItem key={disposition.id} value={disposition.id}>
                      {disposition.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
