import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { GlobalLayout } from '@/shared/components/layout/GlobalLayout';
import { ArrowLeft, Search, Download, Calendar, User, MapPin, Image as ImageIcon } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';

interface CanvassPhoto {
  id: string;
  file_url: string;
  thumbnail_url: string | null;
  created_at: string;
  property_address: string | null;
  uploaded_by: string | null;
  full_name?: string | null;
}

export default function StormCanvassPhotos() {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');
  const [dateFilter, setDateFilter] = useState<string>('all');

  // For now, show empty state since canvass_photos table may not exist
  // This can be enhanced when the photo storage is implemented
  const { data: photos, isLoading } = useQuery({
    queryKey: ['canvass-photos', dateFilter],
    queryFn: async () => {
      // Return empty array for now - photos feature to be fully implemented
      return [] as CanvassPhoto[];
    }
  });

  const filteredPhotos = photos?.filter(photo => 
    photo.property_address?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    photo.full_name?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <GlobalLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => navigate('/storm-canvass')}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold">Photo Gallery</h1>
              <p className="text-muted-foreground">
                View and manage storm damage photos
              </p>
            </div>
          </div>
          <Button variant="outline">
            <Download className="h-4 w-4 mr-2" />
            Export All
          </Button>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-4">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by address or rep..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
          <Select value={dateFilter} onValueChange={setDateFilter}>
            <SelectTrigger className="w-[180px]">
              <Calendar className="h-4 w-4 mr-2" />
              <SelectValue placeholder="Filter by date" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Time</SelectItem>
              <SelectItem value="today">Today</SelectItem>
              <SelectItem value="week">This Week</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Photo Grid */}
        {isLoading ? (
          <div className="text-center py-12 text-muted-foreground">
            Loading photos...
          </div>
        ) : !filteredPhotos?.length ? (
          <Card className="py-12">
            <CardContent className="text-center">
              <ImageIcon className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-lg font-medium mb-2">No photos yet</h3>
              <p className="text-muted-foreground mb-4">
                Photos captured during canvassing will appear here
              </p>
              <Button onClick={() => navigate('/storm-canvass/live')}>
                Start Canvassing
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {filteredPhotos.map((photo) => (
              <Card key={photo.id} className="overflow-hidden group cursor-pointer hover:ring-2 hover:ring-primary transition-all">
                <div className="aspect-square bg-muted relative">
                  <img
                    src={photo.thumbnail_url || photo.file_url}
                    alt={photo.property_address || 'Canvass photo'}
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                  <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-end p-3">
                    <div className="text-white text-xs space-y-1">
                      {photo.property_address && (
                        <div className="flex items-center gap-1">
                          <MapPin className="h-3 w-3" />
                          <span className="truncate">{photo.property_address}</span>
                        </div>
                      )}
                      {photo.full_name && (
                        <div className="flex items-center gap-1">
                          <User className="h-3 w-3" />
                          <span>{photo.full_name}</span>
                        </div>
                      )}
                      <div className="text-white/70">
                        {format(new Date(photo.created_at), 'MMM d, yyyy h:mm a')}
                      </div>
                    </div>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </GlobalLayout>
  );
}
