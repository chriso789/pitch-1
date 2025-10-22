import { useState, useEffect, useCallback, useRef } from 'react';
import { useToast } from '@/hooks/use-toast';

interface ContactDraft {
  timestamp: number;
  formData: any;
  addressData: any;
  assignedTo: string;
}

const DRAFT_KEY = 'contact_draft_latest';
const MAX_DRAFT_AGE_DAYS = 7;

export const useContactDraftPersistence = () => {
  const { toast } = useToast();
  const [hasDraft, setHasDraft] = useState(false);
  const [draftTimestamp, setDraftTimestamp] = useState<number | null>(null);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Load draft on mount
  const loadDraft = useCallback((): ContactDraft | null => {
    try {
      const savedDraft = localStorage.getItem(DRAFT_KEY);
      if (!savedDraft) return null;

      const draft: ContactDraft = JSON.parse(savedDraft);
      const ageInDays = (Date.now() - draft.timestamp) / (1000 * 60 * 60 * 24);

      // Remove drafts older than MAX_DRAFT_AGE_DAYS
      if (ageInDays > MAX_DRAFT_AGE_DAYS) {
        localStorage.removeItem(DRAFT_KEY);
        return null;
      }

      setHasDraft(true);
      setDraftTimestamp(draft.timestamp);
      return draft;
    } catch (error) {
      console.error('Error loading draft:', error);
      return null;
    }
  }, []);

  // Save draft with debouncing
  const saveDraft = useCallback((formData: any, addressData: any, assignedTo: string) => {
    // Clear existing timeout
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    // Debounce save by 500ms
    saveTimeoutRef.current = setTimeout(() => {
      try {
        const draft: ContactDraft = {
          timestamp: Date.now(),
          formData,
          addressData,
          assignedTo,
        };

        localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
        setHasDraft(true);
        setDraftTimestamp(draft.timestamp);
      } catch (error) {
        console.error('Error saving draft:', error);
      }
    }, 500);
  }, []);

  // Clear draft
  const clearDraft = useCallback(() => {
    try {
      localStorage.removeItem(DRAFT_KEY);
      setHasDraft(false);
      setDraftTimestamp(null);
      
      toast({
        title: "Draft Cleared",
        description: "Contact draft has been removed.",
      });
    } catch (error) {
      console.error('Error clearing draft:', error);
    }
  }, [toast]);

  // Save draft on error
  const saveDraftOnError = useCallback((formData: any, addressData: any, assignedTo: string, errorMessage: string) => {
    try {
      const draft: ContactDraft = {
        timestamp: Date.now(),
        formData,
        addressData,
        assignedTo,
      };

      localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
      setHasDraft(true);
      setDraftTimestamp(draft.timestamp);

      toast({
        title: "Draft Saved",
        description: "Your contact information has been saved as a draft.",
      });
    } catch (error) {
      console.error('Error saving draft on error:', error);
    }
  }, [toast]);

  // Show draft restored notification
  const showDraftRestoredNotification = useCallback(() => {
    if (draftTimestamp) {
      const date = new Date(draftTimestamp);
      const timeAgo = getTimeAgo(draftTimestamp);
      
      toast({
        title: "Draft Restored",
        description: `Your contact form from ${timeAgo} has been restored.`,
      });
    }
  }, [draftTimestamp, toast]);

  // Clean up timeout on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, []);

  return {
    hasDraft,
    draftTimestamp,
    loadDraft,
    saveDraft,
    clearDraft,
    saveDraftOnError,
    showDraftRestoredNotification,
  };
};

// Helper function to format time ago
function getTimeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} minutes ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours ago`;
  
  const days = Math.floor(seconds / 86400);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  
  return new Date(timestamp).toLocaleDateString();
}
