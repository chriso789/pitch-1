import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useFormNavigationGuard } from '@/hooks/useFormNavigationGuard';
import { useToast } from '@/hooks/use-toast';

// Example component showing how to use navigation guard with forms
export const NavigationExample: React.FC = () => {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    description: ''
  });
  
  const { toast } = useToast();
  
  const {
    hasUnsavedChanges,
    isSubmitting,
    guardedNavigate,
    initializeForm,
    checkForChanges,
    markAsSaved,
    markAsSubmitting,
    resetForm
  } = useFormNavigationGuard({
    message: "You have unsaved changes in this form. Are you sure you want to leave?",
    onUnsavedChangesAttempt: () => {
      toast({
        title: "Unsaved Changes",
        description: "Please save your changes before navigating away.",
        variant: "default"
      });
    }
  });

  // Initialize form tracking on component mount
  useEffect(() => {
    initializeForm(formData);
  }, []); // Only run on mount

  // Check for changes whenever form data changes
  useEffect(() => {
    checkForChanges(formData);
  }, [formData, checkForChanges]);

  const handleInputChange = (field: string, value: string) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const handleSave = async () => {
    markAsSubmitting();
    
    try {
      // Simulate API call
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Mark as saved with new data
      markAsSaved(formData);
      
      toast({
        title: "Saved Successfully",
        description: "Your changes have been saved.",
      });
    } catch (error) {
      toast({
        title: "Save Failed", 
        description: "Failed to save changes. Please try again.",
        variant: "destructive"
      });
    }
  };

  const handleNavigateAway = () => {
    // This will show confirmation if there are unsaved changes
    guardedNavigate('/');
  };

  const handleReset = () => {
    setFormData({ name: '', email: '', description: '' });
    resetForm();
  };

  return (
    <Card className="max-w-md mx-auto">
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          Form with Navigation Guard
          {hasUnsavedChanges && (
            <span className="text-sm text-orange-500 font-normal">
              • Unsaved changes
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <Label htmlFor="name">Name</Label>
          <Input
            id="name"
            value={formData.name}
            onChange={(e) => handleInputChange('name', e.target.value)}
            placeholder="Enter your name"
          />
        </div>
        
        <div>
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            value={formData.email}
            onChange={(e) => handleInputChange('email', e.target.value)}
            placeholder="Enter your email"
          />
        </div>
        
        <div>
          <Label htmlFor="description">Description</Label>
          <Input
            id="description"
            value={formData.description}
            onChange={(e) => handleInputChange('description', e.target.value)}
            placeholder="Enter description"
          />
        </div>
        
        <div className="flex gap-2 pt-4">
          <Button 
            onClick={handleSave}
            disabled={!hasUnsavedChanges || isSubmitting}
            className="flex-1"
          >
            {isSubmitting ? 'Saving...' : 'Save'}
          </Button>
          
          <Button 
            variant="outline"
            onClick={handleReset}
            disabled={isSubmitting}
          >
            Reset
          </Button>
        </div>
        
        <div className="pt-2 border-t">
          <Button 
            variant="ghost" 
            onClick={handleNavigateAway}
            className="w-full"
          >
            Navigate Away (Test Guard)
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};