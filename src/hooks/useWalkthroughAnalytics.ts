/**
 * Walkthrough Analytics Hook
 * Tracks user progress through video walkthrough
 */

import { supabase } from '@/integrations/supabase/client';

export const useWalkthroughAnalytics = () => {
  const trackStepView = async (stepId: string, stepNumber: number) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: profile } = await supabase
        .from('profiles')
        .select('tenant_id')
        .eq('id', user.id)
        .single();

      // Log step view
      await supabase.from('walkthrough_analytics').insert({
        tenant_id: profile?.tenant_id,
        user_id: user.id,
        step_id: stepId,
        step_number: stepNumber,
        completed: false,
        time_spent: 0,
        dropped_off: false
      });
    } catch (error) {
      console.error('Failed to track walkthrough step:', error);
    }
  };

  const trackStepComplete = async (
    stepId: string, 
    stepNumber: number, 
    timeSpent: number
  ) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Update step completion
      await supabase
        .from('walkthrough_analytics')
        .update({
          completed: true,
          time_spent: timeSpent
        })
        .match({
          user_id: user.id,
          step_id: stepId
        });
    } catch (error) {
      console.error('Failed to track step completion:', error);
    }
  };

  const trackDropoff = async (stepId: string, stepNumber: number) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      await supabase
        .from('walkthrough_analytics')
        .update({ dropped_off: true })
        .match({
          user_id: user.id,
          step_id: stepId
        });
    } catch (error) {
      console.error('Failed to track dropoff:', error);
    }
  };

  const getWalkthroughProgress = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;

      const { data, error } = await supabase
        .from('walkthrough_analytics')
        .select('*')
        .eq('user_id', user.id)
        .order('step_number', { ascending: true });

      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Failed to get walkthrough progress:', error);
      return null;
    }
  };

  return {
    trackStepView,
    trackStepComplete,
    trackDropoff,
    getWalkthroughProgress
  };
};
