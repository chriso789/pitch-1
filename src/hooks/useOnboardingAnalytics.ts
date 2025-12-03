/**
 * Onboarding Analytics Hook
 * Tracks user progress through onboarding with detailed metrics
 */

import { useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface StepAnalytics {
  stepId: string;
  stepNumber: number;
  startTime: number;
}

export const useOnboardingAnalytics = (tenantId?: string, userId?: string) => {
  const currentStepRef = useRef<StepAnalytics | null>(null);

  const trackStepEntry = useCallback(async (stepId: string, stepNumber: number) => {
    // Record start time for time tracking
    currentStepRef.current = {
      stepId,
      stepNumber,
      startTime: Date.now(),
    };

    try {
      await (supabase.from('onboarding_analytics') as any).insert({
        tenant_id: tenantId,
        user_id: userId,
        step_id: stepId,
        step_number: stepNumber,
        completed: false,
        time_spent: 0,
        dropped_off: false,
        video_watched: false,
        video_watch_percent: 0,
      });
    } catch (error) {
      console.error('Failed to track step entry:', error);
    }
  }, [tenantId, userId]);

  const trackStepComplete = useCallback(async (stepId: string, stepNumber: number) => {
    const timeSpent = currentStepRef.current?.startTime 
      ? Math.floor((Date.now() - currentStepRef.current.startTime) / 1000)
      : 0;

    try {
      await (supabase.from('onboarding_analytics') as any)
        .update({
          completed: true,
          time_spent: timeSpent,
        })
        .match({
          user_id: userId,
          step_id: stepId,
        });
    } catch (error) {
      console.error('Failed to track step completion:', error);
    }
  }, [userId]);

  const trackDropoff = useCallback(async () => {
    if (!currentStepRef.current) return;

    const { stepId, startTime } = currentStepRef.current;
    const timeSpent = Math.floor((Date.now() - startTime) / 1000);

    try {
      await (supabase.from('onboarding_analytics') as any)
        .update({
          dropped_off: true,
          time_spent: timeSpent,
        })
        .match({
          user_id: userId,
          step_id: stepId,
        });
    } catch (error) {
      console.error('Failed to track dropoff:', error);
    }
  }, [userId]);

  const trackVideoWatch = useCallback(async (stepId: string, percent: number) => {
    try {
      await (supabase.from('onboarding_analytics') as any)
        .update({
          video_watched: percent >= 80,
          video_watch_percent: Math.round(percent),
        })
        .match({
          user_id: userId,
          step_id: stepId,
        });
    } catch (error) {
      console.error('Failed to track video watch:', error);
    }
  }, [userId]);

  const trackVideoComplete = useCallback(async (stepId: string) => {
    await trackVideoWatch(stepId, 100);
  }, [trackVideoWatch]);

  return {
    trackStepEntry,
    trackStepComplete,
    trackDropoff,
    trackVideoWatch,
    trackVideoComplete,
  };
};

// Fetch analytics data for dashboard
export const fetchOnboardingAnalytics = async () => {
  try {
    const { data, error } = await (supabase.from('onboarding_analytics') as any)
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error('Failed to fetch analytics:', error);
    return [];
  }
};

// Get aggregated stats
export const getOnboardingStats = async () => {
  try {
    const { data, error } = await (supabase.from('onboarding_analytics') as any)
      .select('step_id, step_number, completed, dropped_off, time_spent, video_watched');

    if (error) throw error;

    const analytics = data || [];
    
    // Group by step
    const stepStats = analytics.reduce((acc: any, item: any) => {
      if (!acc[item.step_id]) {
        acc[item.step_id] = {
          stepId: item.step_id,
          stepNumber: item.step_number,
          totalEntries: 0,
          completions: 0,
          dropoffs: 0,
          totalTimeSpent: 0,
          videoWatched: 0,
        };
      }
      
      acc[item.step_id].totalEntries++;
      if (item.completed) acc[item.step_id].completions++;
      if (item.dropped_off) acc[item.step_id].dropoffs++;
      acc[item.step_id].totalTimeSpent += item.time_spent || 0;
      if (item.video_watched) acc[item.step_id].videoWatched++;
      
      return acc;
    }, {});

    // Calculate rates
    const steps = Object.values(stepStats).map((step: any) => ({
      ...step,
      completionRate: step.totalEntries > 0 ? (step.completions / step.totalEntries) * 100 : 0,
      dropoffRate: step.totalEntries > 0 ? (step.dropoffs / step.totalEntries) * 100 : 0,
      avgTimeSpent: step.totalEntries > 0 ? step.totalTimeSpent / step.totalEntries : 0,
      videoWatchRate: step.totalEntries > 0 ? (step.videoWatched / step.totalEntries) * 100 : 0,
    }));

    // Sort by step number
    steps.sort((a: any, b: any) => a.stepNumber - b.stepNumber);

    // Overall stats
    const totalUsers = new Set(analytics.map((a: any) => a.user_id)).size;
    const completedUsers = analytics.filter((a: any) => a.step_id === 'complete' && a.completed).length;

    return {
      steps,
      totalUsers,
      completedUsers,
      overallCompletionRate: totalUsers > 0 ? (completedUsers / totalUsers) * 100 : 0,
    };
  } catch (error) {
    console.error('Failed to get stats:', error);
    return { steps: [], totalUsers: 0, completedUsers: 0, overallCompletionRate: 0 };
  }
};
