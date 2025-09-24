import React, { useState, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { 
  Camera, 
  CheckCircle2, 
  AlertCircle, 
  Upload,
  RotateCcw,
  Home,
  Zap,
  Shield
} from 'lucide-react';

interface PhotoStep {
  id: string;
  title: string;
  description: string;
  category: 'overview' | 'damage' | 'components' | 'interior';
  icon: React.ReactNode;
  required: boolean;
  tips: string[];
}

interface CapturedPhoto {
  stepId: string;
  blob: Blob;
  dataUrl: string;
  analysis?: any;
}

const PhotoCaptureGuide: React.FC = () => {
  const { toast } = useToast();
  const [currentStep, setCurrentStep] = useState(0);
  const [capturedPhotos, setCapturedPhotos] = useState<CapturedPhoto[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  const photoSteps: PhotoStep[] = [
    {
      id: 'street_view',
      title: 'Street View - Full House',
      description: 'Capture the entire house from the street showing the full roof structure',
      category: 'overview',
      icon: <Home className="h-5 w-5" />,
      required: true,
      tips: [
        'Stand across the street for best perspective',
        'Include the entire roofline in frame',
        'Ensure good lighting - avoid shadows'
      ]
    },
    {
      id: 'front_roof',
      title: 'Front Roof Close-up',
      description: 'Close-up view of the front-facing roof section',
      category: 'overview',
      icon: <Shield className="h-5 w-5" />,
      required: true,
      tips: [
        'Show roof material clearly',
        'Capture any visible damage',
        'Include gutters and edges'
      ]
    },
    {
      id: 'roof_damage',
      title: 'Visible Damage',
      description: 'Any visible damage, wear, or problem areas',
      category: 'damage',
      icon: <AlertCircle className="h-5 w-5" />,
      required: false,
      tips: [
        'Focus on specific damage areas',
        'Multiple angles if severe',
        'Include reference objects for scale'
      ]
    },
    {
      id: 'gutters',
      title: 'Gutters & Downspouts',
      description: 'All gutter systems and downspouts around the house',
      category: 'components',
      icon: <Zap className="h-5 w-5" />,
      required: true,
      tips: [
        'Capture all gutter sections',
        'Show connection points',
        'Note any damage or separation'
      ]
    },
    {
      id: 'roof_vents',
      title: 'Roof Vents & Penetrations',
      description: 'All vents, chimneys, and roof penetrations',
      category: 'components',
      icon: <Shield className="h-5 w-5" />,
      required: true,
      tips: [
        'Capture each vent clearly',
        'Show flashing conditions',
        'Include any pipe boots or penetrations'
      ]
    },
    {
      id: 'interior_damage',
      title: 'Interior Water Damage (if any)',
      description: 'Any interior signs of water damage or leaks',
      category: 'interior',
      icon: <AlertCircle className="h-5 w-5" />,
      required: false,
      tips: [
        'Look for water stains on ceilings',
        'Check attic areas if accessible',
        'Document any active leaks'
      ]
    }
  ];

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const dataUrl = await readFileAsDataURL(file);
      const step = photoSteps[currentStep];
      
      const newPhoto: CapturedPhoto = {
        stepId: step.id,
        blob: file,
        dataUrl
      };

      setCapturedPhotos(prev => [...prev, newPhoto]);
      
      // Analyze the photo with AI
      await analyzePhoto(newPhoto, step);
      
      toast({
        title: "Photo Captured",
        description: `${step.title} photo added successfully`,
      });

      // Move to next step
      if (currentStep < photoSteps.length - 1) {
        setCurrentStep(currentStep + 1);
      }
    } catch (error) {
      console.error('Error processing photo:', error);
      toast({
        title: "Error",
        description: "Failed to process photo",
        variant: "destructive",
      });
    }
  };

  const analyzePhoto = async (photo: CapturedPhoto, step: PhotoStep) => {
    if (!photo.dataUrl) return;

    setIsAnalyzing(true);
    try {
      // Call OpenAI Vision API through edge function
      const { data, error } = await supabase.functions.invoke('ai-image-analyzer', {
        body: {
          image_data: photo.dataUrl,
          analysis_type: step.category,
          step_id: step.id,
          step_title: step.title
        }
      });

      if (error) throw error;

      // Update photo with analysis
      setCapturedPhotos(prev => 
        prev.map(p => 
          p.stepId === photo.stepId 
            ? { ...p, analysis: data }
            : p
        )
      );

      if (data.insights && data.insights.length > 0) {
        toast({
          title: "AI Analysis Complete",
          description: `Found: ${data.insights.map((i: any) => i.type).join(', ')}`,
        });
      }
    } catch (error) {
      console.error('Error analyzing photo:', error);
      // Don't show error toast for analysis failures - photos are still valid
    } finally {
      setIsAnalyzing(false);
    }
  };

  const uploadPhotos = async () => {
    if (capturedPhotos.length === 0) return;

    setIsUploading(true);
    try {
      const { data: user } = await supabase.auth.getUser();
      if (!user?.user) throw new Error('User not authenticated');

      const uploadedPhotos = [];

      for (const photo of capturedPhotos) {
        // Upload photo to Supabase storage
        const fileName = `inspection_${Date.now()}_${photo.stepId}.jpg`;
        const { data: uploadData, error: uploadError } = await supabase.storage
          .from('smartdoc-assets')
          .upload(fileName, photo.blob);

        if (uploadError) throw uploadError;

        // Save photo record to database
        const { data: photoRecord, error: dbError } = await supabase
          .from('documents')
          .insert({
            tenant_id: user.user.user_metadata?.tenant_id,
            filename: fileName,
            file_path: uploadData.path,
            document_type: 'inspection_photo',
            description: `${photoSteps.find(s => s.id === photo.stepId)?.title}`,
            mime_type: 'image/jpeg',
            file_size: photo.blob.size,
            uploaded_by: user.user.id,
            metadata: {
              step_id: photo.stepId,
              ai_analysis: photo.analysis,
              category: photoSteps.find(s => s.id === photo.stepId)?.category
            }
          })
          .select()
          .single();

        if (dbError) throw dbError;
        uploadedPhotos.push(photoRecord);
      }

      toast({
        title: "Photos Uploaded",
        description: `Successfully uploaded ${uploadedPhotos.length} inspection photos`,
      });

      // Reset the component
      setCapturedPhotos([]);
      setCurrentStep(0);

    } catch (error) {
      console.error('Error uploading photos:', error);
      toast({
        title: "Upload Failed",
        description: "Failed to upload photos. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsUploading(false);
    }
  };

  const readFileAsDataURL = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  const getStepStatus = (index: number) => {
    const hasPhoto = capturedPhotos.some(p => p.stepId === photoSteps[index].id);
    if (hasPhoto) return 'completed';
    if (index === currentStep) return 'current';
    return 'pending';
  };

  const progress = (capturedPhotos.length / photoSteps.length) * 100;
  const requiredSteps = photoSteps.filter(s => s.required);
  const requiredCompleted = requiredSteps.filter(s => 
    capturedPhotos.some(p => p.stepId === s.id)
  ).length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Camera className="h-6 w-6" />
            Roof Inspection Photo Guide
          </CardTitle>
          <div className="space-y-2">
            <Progress value={progress} className="w-full" />
            <div className="flex justify-between text-sm text-muted-foreground">
              <span>{capturedPhotos.length} of {photoSteps.length} photos captured</span>
              <span>{requiredCompleted} of {requiredSteps.length} required completed</span>
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* Current Step */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                {photoSteps[currentStep].icon}
                Step {currentStep + 1}: {photoSteps[currentStep].title}
                {photoSteps[currentStep].required && (
                  <Badge variant="destructive">Required</Badge>
                )}
              </CardTitle>
              <p className="text-muted-foreground mt-1">
                {photoSteps[currentStep].description}
              </p>
            </div>
            <Badge variant="outline">
              {photoSteps[currentStep].category}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {/* Tips */}
            <div>
              <h4 className="font-medium mb-2">Tips for this photo:</h4>
              <ul className="text-sm text-muted-foreground space-y-1">
                {photoSteps[currentStep].tips.map((tip, index) => (
                  <li key={index} className="flex items-start gap-2">
                    <span className="text-primary">•</span>
                    {tip}
                  </li>
                ))}
              </ul>
            </div>

            {/* Photo Capture Buttons */}
            <div className="flex gap-3">
              <Button
                onClick={() => cameraInputRef.current?.click()}
                className="flex-1"
                disabled={isAnalyzing}
              >
                <Camera className="h-4 w-4 mr-2" />
                Take Photo
              </Button>
              <Button
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
                disabled={isAnalyzing}
              >
                <Upload className="h-4 w-4 mr-2" />
                Upload
              </Button>
            </div>

            {/* Hidden File Inputs */}
            <input
              ref={cameraInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handleFileSelect}
              className="hidden"
            />
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleFileSelect}
              className="hidden"
            />

            {isAnalyzing && (
              <div className="text-center text-sm text-muted-foreground">
                AI is analyzing your photo...
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Step Overview */}
      <Card>
        <CardHeader>
          <CardTitle>Inspection Steps</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {photoSteps.map((step, index) => {
              const status = getStepStatus(index);
              const hasPhoto = capturedPhotos.some(p => p.stepId === step.id);
              
              return (
                <div
                  key={step.id}
                  className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-colors ${
                    status === 'current' 
                      ? 'bg-primary/10 border border-primary/20' 
                      : status === 'completed'
                      ? 'bg-green-50 border border-green-200'
                      : 'bg-muted/50'
                  }`}
                  onClick={() => setCurrentStep(index)}
                >
                  <div className={`p-2 rounded ${
                    status === 'completed' 
                      ? 'bg-green-500 text-white' 
                      : status === 'current'
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted'
                  }`}>
                    {status === 'completed' ? (
                      <CheckCircle2 className="h-4 w-4" />
                    ) : (
                      step.icon
                    )}
                  </div>
                  
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{step.title}</span>
                      {step.required && (
                        <Badge variant="outline">Required</Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {step.description}
                    </p>
                  </div>

                  {hasPhoto && (
                    <Badge variant="secondary">
                      Captured
                    </Badge>
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Actions */}
      {capturedPhotos.length > 0 && (
        <Card>
          <CardContent className="pt-6">
            <div className="flex gap-3">
              <Button
                onClick={uploadPhotos}
                disabled={isUploading || requiredCompleted < requiredSteps.length}
                className="flex-1"
              >
                {isUploading ? (
                  <>
                    <RotateCcw className="h-4 w-4 mr-2 animate-spin" />
                    Uploading...
                  </>
                ) : (
                  <>
                    <Upload className="h-4 w-4 mr-2" />
                    Upload Photos ({capturedPhotos.length})
                  </>
                )}
              </Button>
              
              <Button
                variant="outline"
                onClick={() => {
                  setCapturedPhotos([]);
                  setCurrentStep(0);
                }}
                disabled={isUploading}
              >
                <RotateCcw className="h-4 w-4 mr-2" />
                Start Over
              </Button>
            </div>
            
            {requiredCompleted < requiredSteps.length && (
              <p className="text-sm text-muted-foreground mt-2 text-center">
                Complete all required steps to upload photos
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default PhotoCaptureGuide;