import { useState, useCallback, useRef, useEffect } from 'react';
import { useNavigationGuard } from './useNavigationGuard';

interface FormNavigationGuardOptions {
  message?: string;
  onUnsavedChangesAttempt?: () => void;
}

export const useFormNavigationGuard = ({
  message = "You have unsaved changes. Are you sure you want to leave this form?",
  onUnsavedChangesAttempt
}: FormNavigationGuardOptions = {}) => {
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const originalFormData = useRef<any>(null);

  const { guardedNavigate, clearUnsavedChanges } = useNavigationGuard({
    hasUnsavedChanges: hasUnsavedChanges && !isSubmitting,
    message,
    onConfirmNavigation: () => {
      setHasUnsavedChanges(false);
      clearUnsavedChanges();
    },
    onCancelNavigation: onUnsavedChangesAttempt
  });

  // Initialize form tracking
  const initializeForm = useCallback((initialData: any) => {
    originalFormData.current = JSON.stringify(initialData);
    setHasUnsavedChanges(false);
  }, []);

  // Check if form has changes
  const checkForChanges = useCallback((currentData: any) => {
    if (originalFormData.current === null) {
      return;
    }
    
    const hasChanges = JSON.stringify(currentData) !== originalFormData.current;
    setHasUnsavedChanges(hasChanges);
  }, []);

  // Mark form as saved (clears unsaved changes)
  const markAsSaved = useCallback((newData?: any) => {
    if (newData) {
      originalFormData.current = JSON.stringify(newData);
    }
    setHasUnsavedChanges(false);
    setIsSubmitting(false);
    clearUnsavedChanges();
  }, [clearUnsavedChanges]);

  // Mark form as submitting (temporarily disables guard)
  const markAsSubmitting = useCallback(() => {
    setIsSubmitting(true);
  }, []);

  // Reset form to original state
  const resetForm = useCallback(() => {
    setHasUnsavedChanges(false);
    setIsSubmitting(false);
    clearUnsavedChanges();
  }, [clearUnsavedChanges]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      clearUnsavedChanges();
    };
  }, [clearUnsavedChanges]);

  return {
    hasUnsavedChanges: hasUnsavedChanges && !isSubmitting,
    isSubmitting,
    guardedNavigate,
    initializeForm,
    checkForChanges,
    markAsSaved,
    markAsSubmitting,
    resetForm
  };
};