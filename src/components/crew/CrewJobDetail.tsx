import { useState } from 'react';
import { useCrewJob } from '@/hooks/useCrewJob';
import { useCrewPhotos } from '@/hooks/useCrewPhotos';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Checkbox } from '@/components/ui/checkbox';
import { 
  ArrowLeft, 
  MapPin, 
  Clock, 
  Camera, 
  CheckSquare,
  AlertTriangle,
  CheckCircle,
  FileWarning,
  Upload,
  Loader2,
  ExternalLink
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { toast } from 'sonner';
import { CrewPhotoUpload } from './CrewPhotoUpload';

interface CrewJobDetailProps {
  jobId: string;
  onBack: () => void;
}

const STATUS_OPTIONS = [
  { value: 'assigned', label: 'Assigned' },
  { value: 'en_route', label: 'En Route' },
  { value: 'on_site', label: 'On Site' },
  { value: 'work_started', label: 'Working' },
  { value: 'waiting', label: 'Waiting' },
  { value: 'completed', label: 'Completed' },
] as const;

export function CrewJobDetail({ jobId, onBack }: CrewJobDetailProps) {
  const { 
    job, 
    photoBuckets, 
    checklistItems, 
    completionStatus, 
    loading, 
    error,
    updateStatus,
    toggleChecklistItem,
    refetch
  } = useCrewJob(jobId);
  
  const { uploadPhotoWithGPS, uploading } = useCrewPhotos(jobId);
  const [selectedBucket, setSelectedBucket] = useState<string | null>(null);
  const [updatingStatus, setUpdatingStatus] = useState(false);

  const handleStatusChange = async (newStatus: string) => {
    if (!job || updatingStatus) return;
    
    try {
      setUpdatingStatus(true);
      await updateStatus(newStatus as any);
    } finally {
      setUpdatingStatus(false);
    }
  };

  const handlePhotoUpload = async (file: File, bucketId: string) => {
    const result = await uploadPhotoWithGPS({
      jobId,
      bucketId,
      file,
    });

    if (result) {
      refetch();
    }
  };

  const handleOpenMaps = () => {
    if (!job?.scopeSummary) return;
    // Extract address from scope summary first line
    const address = job.scopeSummary.split('\n')[0];
    const encodedAddress = encodeURIComponent(address);
    window.open(`https://maps.google.com/maps?q=${encodedAddress}`, '_blank');
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !job) {
    return (
      <div className="min-h-screen bg-background">
        <header className="sticky top-0 z-50 bg-background border-b">
          <div className="px-4 py-3 flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={onBack}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <span className="font-semibold">Job Details</span>
          </div>
        </header>
        <div className="p-4">
          <Card className="bg-red-500/5 border-red-500/10">
            <CardContent className="p-4 text-red-600 text-sm">
              {error || 'Job not found'}
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-20">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-background border-b">
        <div className="px-4 py-3 flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={onBack}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <span className="font-semibold flex-1">Job Details</span>
        </div>
      </header>

      <div className="p-4 space-y-4">
        {/* Address & Map */}
        <Card>
          <CardContent className="p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-start gap-2">
                <MapPin className="h-5 w-5 text-muted-foreground mt-0.5" />
                <div>
                  <p className="font-medium">
                    {job.scopeSummary?.split('\n')[0] || 'Job Site'}
                  </p>
                  {job.scheduledDate && (
                    <p className="text-sm text-muted-foreground">
                      {format(parseISO(job.scheduledDate), 'EEEE, MMMM d, yyyy')}
                    </p>
                  )}
                </div>
              </div>
              <Button variant="outline" size="sm" onClick={handleOpenMaps}>
                <ExternalLink className="h-4 w-4 mr-1" />
                Map
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Arrival Window */}
        {job.arrivalWindowStart && (
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2">
                <Clock className="h-5 w-5 text-muted-foreground" />
                <div>
                  <p className="text-sm text-muted-foreground">Arrival Window</p>
                  <p className="font-medium">
                    {job.arrivalWindowStart.slice(0, 5)} - {job.arrivalWindowEnd?.slice(0, 5)}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Status Selector */}
        <Card>
          <CardHeader className="py-3 px-4">
            <CardTitle className="text-sm font-medium">Status</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <div className="flex flex-wrap gap-2">
              {STATUS_OPTIONS.map((option) => (
                <Button
                  key={option.value}
                  variant={job.status === option.value ? 'default' : 'outline'}
                  size="sm"
                  disabled={updatingStatus || job.isLocked || option.value === 'completed'}
                  onClick={() => handleStatusChange(option.value)}
                >
                  {option.label}
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Compliance Gate */}
        <Card className={!completionStatus.canComplete ? 'border-yellow-500/30' : 'border-green-500/30'}>
          <CardHeader className="py-3 px-4">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              {completionStatus.canComplete ? (
                <CheckCircle className="h-4 w-4 text-green-500" />
              ) : (
                <AlertTriangle className="h-4 w-4 text-yellow-500" />
              )}
              Completion Status
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span>Documents</span>
              {completionStatus.docsValid ? (
                <Badge variant="outline" className="bg-green-500/10 text-green-600">
                  <CheckCircle className="h-3 w-3 mr-1" />
                  Valid
                </Badge>
              ) : (
                <Badge variant="outline" className="bg-red-500/10 text-red-600">
                  <FileWarning className="h-3 w-3 mr-1" />
                  Issue
                </Badge>
              )}
            </div>
            <div className="flex items-center justify-between text-sm">
              <span>Photos</span>
              <span className="text-muted-foreground">
                {photoBuckets.reduce((acc, b) => acc + b.currentCount, 0)}/
                {photoBuckets.reduce((acc, b) => acc + b.requiredCount, 0)}
              </span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span>Checklist</span>
              <span className="text-muted-foreground">
                {checklistItems.filter(i => i.isChecked).length}/{checklistItems.length}
              </span>
            </div>

            {completionStatus.blockingReasons.length > 0 && (
              <div className="mt-3 pt-3 border-t space-y-1">
                {completionStatus.blockingReasons.map((reason, i) => (
                  <p key={i} className="text-xs text-red-600 flex items-start gap-1">
                    <span>•</span>
                    <span>{reason}</span>
                  </p>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Scope of Work */}
        {job.scopeSummary && (
          <Card>
            <CardHeader className="py-3 px-4">
              <CardTitle className="text-sm font-medium">Scope of Work</CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <div className="text-sm whitespace-pre-wrap">
                {job.scopeSummary}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Special Instructions */}
        {job.specialInstructions && (
          <Card className="border-yellow-500/30 bg-yellow-500/5">
            <CardHeader className="py-3 px-4">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-yellow-500" />
                Special Instructions
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <p className="text-sm">{job.specialInstructions}</p>
            </CardContent>
          </Card>
        )}

        {/* Required Photos */}
        <Card>
          <CardHeader className="py-3 px-4">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Camera className="h-4 w-4" />
              Required Photos
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <div className="grid grid-cols-2 gap-2">
              {photoBuckets.map((bucket) => (
                <div
                  key={bucket.id}
                  className={`p-3 rounded-lg border cursor-pointer transition-colors ${
                    bucket.currentCount >= bucket.requiredCount
                      ? 'bg-green-500/5 border-green-500/20'
                      : 'bg-muted/50 hover:bg-muted'
                  }`}
                  onClick={() => setSelectedBucket(bucket.id)}
                >
                  <p className="text-sm font-medium truncate">{bucket.label}</p>
                  <p className="text-xs text-muted-foreground">
                    {bucket.currentCount >= bucket.requiredCount ? (
                      <span className="text-green-600">✓ {bucket.currentCount}/{bucket.requiredCount}</span>
                    ) : (
                      `${bucket.currentCount}/${bucket.requiredCount}`
                    )}
                  </p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Photo Upload Modal */}
        {selectedBucket && (
          <CrewPhotoUpload
            jobId={jobId}
            bucketId={selectedBucket}
            bucketLabel={photoBuckets.find(b => b.id === selectedBucket)?.label || 'Photo'}
            onUpload={(file) => handlePhotoUpload(file, selectedBucket)}
            uploading={uploading}
            onClose={() => setSelectedBucket(null)}
          />
        )}

        {/* Checklist */}
        <Card>
          <CardHeader className="py-3 px-4">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <CheckSquare className="h-4 w-4" />
              Checklist
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-3">
            {checklistItems.map((item) => (
              <div 
                key={item.id}
                className="flex items-start gap-3"
              >
                <Checkbox
                  id={item.id}
                  checked={item.isChecked}
                  onCheckedChange={(checked) => {
                    if (item.requiresPhoto && !item.proofPhotoId && checked) {
                      toast.error('This item requires a photo proof');
                      return;
                    }
                    toggleChecklistItem(item.id, !!checked);
                  }}
                  disabled={item.requiresPhoto && !item.proofPhotoId}
                />
                <div className="flex-1">
                  <label 
                    htmlFor={item.id}
                    className={`text-sm cursor-pointer ${item.isChecked ? 'line-through text-muted-foreground' : ''}`}
                  >
                    {item.label}
                    {item.requiresPhoto && (
                      <Badge variant="outline" className="ml-2 text-xs">
                        📷 Required
                      </Badge>
                    )}
                  </label>
                  {item.helpText && (
                    <p className="text-xs text-muted-foreground mt-0.5">{item.helpText}</p>
                  )}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Mark Complete Button */}
        <div className="fixed bottom-0 left-0 right-0 p-4 bg-background border-t">
          <Button
            className="w-full"
            size="lg"
            disabled={!completionStatus.canComplete || updatingStatus || job.isLocked}
            onClick={() => handleStatusChange('completed')}
          >
            {updatingStatus ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : completionStatus.canComplete ? (
              <CheckCircle className="h-4 w-4 mr-2" />
            ) : (
              <AlertTriangle className="h-4 w-4 mr-2" />
            )}
            {completionStatus.canComplete ? 'Mark Complete' : 'Requirements Not Met'}
          </Button>
        </div>
      </div>
    </div>
  );
}
