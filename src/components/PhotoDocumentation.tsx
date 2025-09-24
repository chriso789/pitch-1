import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Camera, MapPin, Clock, CheckCircle, XCircle, Upload, Filter } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface ProjectPhoto {
  id: string;
  project_id: string;
  task_id: string;
  filename: string;
  storage_path: string;
  gps_latitude: number;
  gps_longitude: number;
  gps_accuracy: number;
  capture_timestamp: string;
  workflow_status: string;
  ai_tags: string[];
  ai_description: string;
  qc_notes: string;
  created_at: string;
}

interface Project {
  id: string;
  name: string;
  project_number: string;
}

export default function PhotoDocumentation() {
  const [photos, setPhotos] = useState<ProjectPhoto[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPhoto, setSelectedPhoto] = useState<ProjectPhoto | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterProject, setFilterProject] = useState<string>('all');
  const [uploadingFiles, setUploadingFiles] = useState<File[]>([]);
  const { toast } = useToast();

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [photosResult, projectsResult] = await Promise.all([
        supabase
          .from('project_photos')
          .select('*')
          .order('created_at', { ascending: false }),
        supabase
          .from('projects')
          .select('id, name, project_number')
          .order('name')
      ]);

      if (photosResult.error) throw photosResult.error;
      if (projectsResult.error) throw projectsResult.error;

      setPhotos(photosResult.data || []);
      setProjects(projectsResult.data || []);
    } catch (error) {
      console.error('Error loading data:', error);
      toast({
        title: "Error",
        description: "Failed to load photo data",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleFileUpload = useCallback(async (files: FileList | null, projectId: string) => {
    if (!files) return;

    const validFiles = Array.from(files).filter(file => 
      file.type.startsWith('image/') && file.size <= 10 * 1024 * 1024 // 10MB limit
    );

    if (validFiles.length === 0) {
      toast({
        title: "Error",
        description: "Please select valid image files (max 10MB each)",
        variant: "destructive",
      });
      return;
    }

    setUploadingFiles(validFiles);

    try {
      for (const file of validFiles) {
        // Extract EXIF data if available
        const gpsData = await extractGPSFromFile(file);
        
        // Generate unique filename
        const fileExt = file.name.split('.').pop();
        const fileName = `${Date.now()}-${Math.random().toString(36).substring(2)}.${fileExt}`;
        const filePath = `project-photos/${projectId}/${fileName}`;

        // Upload to Supabase Storage
        const { error: uploadError } = await supabase.storage
          .from('smartdoc-assets')
          .upload(filePath, file);

        if (uploadError) throw uploadError;

        // Save metadata to database
        const user = await supabase.auth.getUser();
        const { error: dbError } = await supabase
          .from('project_photos')
          .insert({
            tenant_id: user.data.user?.id || '',
            project_id: projectId,
            filename: file.name,
            storage_path: filePath,
            mime_type: file.type,
            file_size: file.size,
            gps_latitude: gpsData?.latitude,
            gps_longitude: gpsData?.longitude,
            gps_accuracy: gpsData?.accuracy,
            capture_timestamp: gpsData?.timestamp || new Date().toISOString(),
            workflow_status: gpsData?.latitude ? 'captured' : 'qc_pending',
            ai_tags: [],
            uploaded_by: user.data.user?.id
          });

        if (dbError) throw dbError;
      }

      toast({
        title: "Success",
        description: `${validFiles.length} photo(s) uploaded successfully`,
      });

      loadData();
    } catch (error) {
      console.error('Error uploading photos:', error);
      toast({
        title: "Error",
        description: "Failed to upload photos",
        variant: "destructive",
      });
    } finally {
      setUploadingFiles([]);
    }
  }, [toast]);

  const extractGPSFromFile = async (file: File): Promise<{
    latitude?: number;
    longitude?: number;
    accuracy?: number;
    timestamp?: string;
  } | null> => {
    // This is a simplified version. In a real app, you'd use a library like piexifjs
    // For now, we'll simulate GPS extraction
    return new Promise((resolve) => {
      // Simulate async GPS extraction
      setTimeout(() => {
        // In practice, you'd read EXIF data here
        // For demo purposes, we'll generate random coordinates near a central location
        const hasGPS = Math.random() > 0.3; // 70% chance of having GPS
        
        if (hasGPS) {
          resolve({
            latitude: 40.7128 + (Math.random() - 0.5) * 0.1, // NYC area
            longitude: -74.0060 + (Math.random() - 0.5) * 0.1,
            accuracy: Math.random() * 10 + 1,
            timestamp: new Date().toISOString()
          });
        } else {
          resolve(null);
        }
      }, 500);
    });
  };

  const handleQCApproval = async (photoId: string, approved: boolean, notes?: string) => {
    try {
      const { error } = await supabase
        .from('project_photos')
        .update({
          workflow_status: approved ? 'approved' : 'rejected',
          qc_notes: notes,
          qc_approved_by: (await supabase.auth.getUser()).data.user?.id,
          qc_approved_at: new Date().toISOString()
        })
        .eq('id', photoId);

      if (error) throw error;

      toast({
        title: "Success",
        description: `Photo ${approved ? 'approved' : 'rejected'}`,
      });

      loadData();
      setSelectedPhoto(null);
    } catch (error) {
      console.error('Error updating photo status:', error);
      toast({
        title: "Error",
        description: "Failed to update photo status",
        variant: "destructive",
      });
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'captured':
        return <Badge className="bg-blue-500 hover:bg-blue-600">Captured</Badge>;
      case 'qc_pending':
        return <Badge className="bg-yellow-500 hover:bg-yellow-600">QC Pending</Badge>;
      case 'approved':
        return <Badge className="bg-green-500 hover:bg-green-600">Approved</Badge>;
      case 'rejected':
        return <Badge variant="destructive">Rejected</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const filteredPhotos = photos.filter(photo => {
    const statusMatch = filterStatus === 'all' || photo.workflow_status === filterStatus;
    const projectMatch = filterProject === 'all' || photo.project_id === filterProject;
    return statusMatch && projectMatch;
  });

  const gpsStats = {
    total: photos.length,
    withGPS: photos.filter(p => p.gps_latitude && p.gps_longitude).length,
    pendingQC: photos.filter(p => p.workflow_status === 'qc_pending').length
  };

  const gpsPercentage = gpsStats.total > 0 ? (gpsStats.withGPS / gpsStats.total * 100).toFixed(1) : '0';

  if (loading) {
    return <div className="flex items-center justify-center h-64">Loading...</div>;
  }

  return (
    <div className="container mx-auto py-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold">Photo Documentation</h1>
        <div className="flex gap-2">
          <Input
            type="file"
            multiple
            accept="image/*"
            className="hidden"
            id="photo-upload"
            onChange={(e) => {
              if (projects.length > 0) {
                handleFileUpload(e.target.files, projects[0].id); // Default to first project
              }
            }}
          />
          <Label htmlFor="photo-upload" className="cursor-pointer">
            <Button asChild>
              <span>
                <Upload className="h-4 w-4 mr-2" />
                Upload Photos
              </span>
            </Button>
          </Label>
        </div>
      </div>

      {/* Statistics */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Photos</CardTitle>
            <Camera className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{gpsStats.total}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">GPS Tagged</CardTitle>
            <MapPin className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
                <div className="text-2xl font-bold text-green-600">{gpsPercentage}%</div>
            <p className="text-xs text-muted-foreground">
              {gpsStats.withGPS} of {gpsStats.total} photos
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Pending QC</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-yellow-600">{gpsStats.pendingQC}</div>
            <p className="text-xs text-muted-foreground">
              Awaiting review
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avg QC Time</CardTitle>
            <CheckCircle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">&lt; 5min</div>
            <p className="text-xs text-muted-foreground">
              Target latency
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex gap-4 mb-6">
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Filter by status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="captured">Captured</SelectItem>
            <SelectItem value="qc_pending">QC Pending</SelectItem>
            <SelectItem value="approved">Approved</SelectItem>
            <SelectItem value="rejected">Rejected</SelectItem>
          </SelectContent>
        </Select>

        <Select value={filterProject} onValueChange={setFilterProject}>
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="Filter by project" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Projects</SelectItem>
            {projects.map((project) => (
              <SelectItem key={project.id} value={project.id}>
                {project.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Photo Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {filteredPhotos.map((photo) => (
          <Card 
            key={photo.id} 
            className="cursor-pointer hover:shadow-lg transition-shadow"
            onClick={() => setSelectedPhoto(photo)}
          >
            <CardHeader className="pb-2">
              <div className="flex justify-between items-start">
                <div className="text-xs text-muted-foreground truncate">
                  {photo.filename}
                </div>
                {getStatusBadge(photo.workflow_status)}
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="aspect-video bg-muted rounded-md mb-2 flex items-center justify-center">
                <Camera className="h-8 w-8 text-muted-foreground" />
              </div>
              <div className="space-y-1 text-xs">
                <div className="flex items-center gap-1">
                  <MapPin className="h-3 w-3" />
                  <span className={photo.gps_latitude ? 'text-green-600' : 'text-red-600'}>
                    {photo.gps_latitude ? 'GPS Tagged' : 'No GPS'}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  <span className="text-muted-foreground">
                    {new Date(photo.created_at).toLocaleDateString()}
                  </span>
                </div>
                {photo.ai_tags && photo.ai_tags.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {photo.ai_tags.slice(0, 2).map((tag, index) => (
                      <Badge key={index} variant="outline" className="text-xs">
                        {tag}
                      </Badge>
                    ))}
                    {photo.ai_tags.length > 2 && (
                      <Badge variant="outline" className="text-xs">
                        +{photo.ai_tags.length - 2}
                      </Badge>
                    )}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Photo Detail Dialog */}
      <Dialog open={!!selectedPhoto} onOpenChange={() => setSelectedPhoto(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Photo Details</DialogTitle>
            <DialogDescription>
              Review and manage photo documentation
            </DialogDescription>
          </DialogHeader>
          {selectedPhoto && (
            <div className="space-y-4">
              <div className="aspect-video bg-muted rounded-md flex items-center justify-center">
                <Camera className="h-16 w-16 text-muted-foreground" />
              </div>
              
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <Label>Filename</Label>
                  <p className="text-muted-foreground">{selectedPhoto.filename}</p>
                </div>
                <div>
                  <Label>Status</Label>
                  <div className="mt-1">{getStatusBadge(selectedPhoto.workflow_status)}</div>
                </div>
                <div>
                  <Label>GPS Location</Label>
                  <p className="text-muted-foreground">
                    {selectedPhoto.gps_latitude && selectedPhoto.gps_longitude
                      ? `${selectedPhoto.gps_latitude.toFixed(6)}, ${selectedPhoto.gps_longitude.toFixed(6)}`
                      : 'Not available'
                    }
                  </p>
                </div>
                <div>
                  <Label>Capture Time</Label>
                  <p className="text-muted-foreground">
                    {new Date(selectedPhoto.capture_timestamp).toLocaleString()}
                  </p>
                </div>
              </div>

              {selectedPhoto.ai_tags && selectedPhoto.ai_tags.length > 0 && (
                <div>
                  <Label>AI Tags</Label>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {selectedPhoto.ai_tags.map((tag, index) => (
                      <Badge key={index} variant="outline">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {selectedPhoto.workflow_status === 'qc_pending' && (
                <div className="flex gap-2 pt-4">
                  <Button
                    onClick={() => handleQCApproval(selectedPhoto.id, true)}
                    size="sm"
                    className="bg-green-600 hover:bg-green-700"
                  >
                    <CheckCircle className="h-4 w-4 mr-2" />
                    Approve
                  </Button>
                  <Button
                    onClick={() => handleQCApproval(selectedPhoto.id, false, 'Rejected during QC review')}
                    size="sm"
                    variant="destructive"
                  >
                    <XCircle className="h-4 w-4 mr-2" />
                    Reject
                  </Button>
                </div>
              )}

              {selectedPhoto.qc_notes && (
                <div>
                  <Label>QC Notes</Label>
                  <p className="text-muted-foreground text-sm mt-1">
                    {selectedPhoto.qc_notes}
                  </p>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}