import React, { useEffect } from 'react';
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

export function PipelineStageManager() {
  const { toast } = useToast();

  useEffect(() => {
    initializeDefaultStages();
  }, []);

  const initializeDefaultStages = async () => {
    try {
      // Check if stages already exist
      const { data: existingStages } = await supabase
        .from('pipeline_stages')
        .select('id')
        .limit(1);

      if (existingStages && existingStages.length > 0) {
        return; // Stages already exist
      }

      // Get current user's tenant
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: profile } = await supabase
        .from('profiles')
        .select('tenant_id')
        .eq('id', user.id)
        .single();

      if (!profile?.tenant_id) return;

      // Create default pipeline stages
      const defaultStages = [
        { name: 'New Lead', description: 'Fresh leads that need initial contact', stage_order: 1, probability_percent: 10, color: '#ef4444' },
        { name: 'Contacted', description: 'Lead has been contacted but not qualified', stage_order: 2, probability_percent: 25, color: '#f59e0b' },
        { name: 'Qualified', description: 'Lead meets qualification criteria', stage_order: 3, probability_percent: 50, color: '#eab308' },
        { name: 'Appointment Set', description: 'Appointment scheduled with lead', stage_order: 4, probability_percent: 70, color: '#3b82f6' },
        { name: 'Proposal Sent', description: 'Estimate/proposal has been sent', stage_order: 5, probability_percent: 80, color: '#8b5cf6' },
        { name: 'Negotiating', description: 'In active negotiation phase', stage_order: 6, probability_percent: 90, color: '#06b6d4' },
        { name: 'Closed Won', description: 'Deal successfully closed', stage_order: 7, probability_percent: 100, color: '#10b981' },
        { name: 'Closed Lost', description: 'Deal lost or disqualified', stage_order: 8, probability_percent: 0, color: '#6b7280' }
      ];

      const stagesToInsert = defaultStages.map(stage => ({
        ...stage,
        tenant_id: profile.tenant_id
      }));

      const { error } = await supabase
        .from('pipeline_stages')
        .insert(stagesToInsert);

      if (error) {
        console.error('Error initializing pipeline stages:', error);
        return;
      }

      console.log('Default pipeline stages initialized successfully');
    } catch (error) {
      console.error('Error initializing pipeline stages:', error);
    }
  };

  return null; // This component doesn't render anything
}