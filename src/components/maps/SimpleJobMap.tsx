import React, { useState, useEffect, useRef } from "react";
import { MapPin, Home, Briefcase, Filter, Layers, Phone, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FloatingWindow } from "../messaging/FloatingWindow";
import { cn } from "@/lib/utils";

interface JobLocation {
  id: string;
  type: 'contact' | 'job';
  name: string;
  address: string;
  lat: number;
  lng: number;
  status?: string;
  value?: number;
  phone?: string;
  email?: string;
  roofType?: string;
  priority?: string;
}

interface SimpleJobMapProps {
  isOpen: boolean;
  onClose: () => void;
  centerLocation?: { lat: number; lng: number };
  radiusMiles?: number;
  locations?: JobLocation[];
}

export const SimpleJobMap: React.FC<SimpleJobMapProps> = ({
  isOpen,
  onClose,
  centerLocation = { lat: 27.0820246, lng: -82.19621560000002 },
  radiusMiles = 50,
  locations = []
}) => {
  const [selectedLocation, setSelectedLocation] = useState<JobLocation | null>(null);
  const [filterType, setFilterType] = useState<'all' | 'contact' | 'job'>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');

  const getStatusColor = (status?: string) => {
    switch (status) {
      case 'lead': return 'bg-yellow-500';
      case 'legal': return 'bg-orange-500';
      case 'contingency': return 'bg-blue-500';
      case 'project': return 'bg-green-500';
      case 'completed': return 'bg-green-700';
      case 'lost': return 'bg-red-500';
      default: return 'bg-gray-500';
    }
  };

  const filteredLocations = locations.filter(location => {
    if (filterType !== 'all' && location.type !== filterType) return false;
    if (filterStatus !== 'all' && location.status !== filterStatus) return false;
    return true;
  });

  const filteredStatusOptions = [...new Set(locations.map(l => l.status).filter(Boolean))];

  return (
    <FloatingWindow
      title={`Job Map - ${radiusMiles} Mile Radius`}
      isOpen={isOpen}
      onClose={onClose}
      width={800}
      height={600}
      headerActions={
        <div className="flex items-center gap-2">
          <Select value={filterType} onValueChange={(value: any) => setFilterType(value)}>
            <SelectTrigger className="w-20 h-6 text-xs">
              <Filter className="h-3 w-3" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="contact">Contacts</SelectItem>
              <SelectItem value="job">Jobs</SelectItem>
            </SelectContent>
          </Select>
          
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="w-24 h-6 text-xs">
              <Layers className="h-3 w-3" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              {filteredStatusOptions.map(status => (
                <SelectItem key={status} value={status!}>
                  {status}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      }
    >
      <div className="flex h-full">
        {/* Simplified Map View */}
        <div className="flex-1 relative bg-muted/30 flex items-center justify-center">
          <div className="text-center space-y-4">
            <MapPin className="h-16 w-16 text-primary mx-auto" />
            <div>
              <h3 className="text-lg font-semibold">Interactive Map View</h3>
              <p className="text-sm text-muted-foreground">
                Google Maps integration will be loaded here
              </p>
              <p className="text-xs text-muted-foreground mt-2">
                {filteredLocations.length} locations in {radiusMiles} mile radius
              </p>
            </div>
          </div>
          
          {/* Legend */}
          <Card className="absolute top-4 left-4 w-48 shadow-strong">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Legend</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex items-center gap-2">
                <Home className="h-4 w-4 text-blue-600" />
                <span className="text-xs">Contacts ({filteredLocations.filter(l => l.type === 'contact').length})</span>
              </div>
              <div className="flex items-center gap-2">
                <Briefcase className="h-4 w-4 text-green-600" />
                <span className="text-xs">Jobs ({filteredLocations.filter(l => l.type === 'job').length})</span>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Location List */}
        <Card className="w-80 border-l rounded-none">
          <CardHeader>
            <CardTitle className="text-lg">Nearby Locations</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 max-h-[500px] overflow-y-auto">
            {filteredLocations.map((location) => (
              <div
                key={location.id}
                className={cn(
                  "p-3 rounded border cursor-pointer transition-colors",
                  selectedLocation?.id === location.id 
                    ? "bg-accent border-primary" 
                    : "hover:bg-accent/50"
                )}
                onClick={() => setSelectedLocation(location)}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <h4 className="font-medium text-sm truncate">{location.name}</h4>
                    <p className="text-xs text-muted-foreground">{location.address}</p>
                  </div>
                  <Badge variant={location.type === 'job' ? 'default' : 'secondary'} className="text-xs">
                    {location.type === 'job' ? 'Job' : 'Contact'}
                  </Badge>
                </div>
                
                {location.status && (
                  <div className="flex items-center gap-2 mt-2">
                    <Badge className={cn("text-white text-xs", getStatusColor(location.status))}>
                      {location.status}
                    </Badge>
                    {location.value && (
                      <span className="text-xs text-muted-foreground">
                        ${location.value.toLocaleString()}
                      </span>
                    )}
                  </div>
                )}
                
                {selectedLocation?.id === location.id && (
                  <div className="mt-3 space-y-2 pt-2 border-t">
                    {location.phone && (
                      <Button variant="outline" size="sm" className="w-full justify-start text-xs">
                        <Phone className="h-3 w-3 mr-2" />
                        {location.phone}
                      </Button>
                    )}
                    {location.email && (
                      <Button variant="outline" size="sm" className="w-full justify-start text-xs">
                        <Mail className="h-3 w-3 mr-2" />
                        {location.email}
                      </Button>
                    )}
                    <Button size="sm" className="w-full text-xs">
                      View Details
                    </Button>
                  </div>
                )}
              </div>
            ))}
            
            {filteredLocations.length === 0 && (
              <div className="text-center py-8 text-muted-foreground">
                <MapPin className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">No locations found</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </FloatingWindow>
  );
};