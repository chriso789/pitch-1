import { useState, useCallback, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import type { Json } from '@/integrations/supabase/types';

interface ProductionGate {
  id: string;
  gateName: string;
  gateKey: string;
  requiredDocumentTypes: string[];
  requiredPhotoCategories: string[];
  requiredChecklistItems: string[];
  description: string;
  orderIndex: number;
  allowManagerBypass: boolean;
}

interface GateValidationResult {
  passed: boolean;
  gateName: string;
  gateKey: string;
  missingItems: {
    documents: string[];
    photos: string[];
    checklists: string[];
  };
  canBypass: boolean;
  bypassRequiresReason: boolean;
}

interface ProductionGateStatus {
  fromStage: string;
  toStage: string;
  validationStatus: string;
  validatedAt?: string;
  validatedBy?: string;
  bypassReason?: string;
  bypassedBy?: string;
  validationResults?: Json;
}

// Default production gates for roofing projects
const DEFAULT_GATES: ProductionGate[] = [
  {
    id: 'gate-1',
    gateName: 'Pre-Work Documentation',
    gateKey: 'pre_work',
    requiredDocumentTypes: ['permit', 'noc'],
    requiredPhotoCategories: ['before', 'damage'],
    requiredChecklistItems: ['material_delivery_confirmed', 'customer_notified'],
    description: 'Required before work can begin',
    orderIndex: 1,
    allowManagerBypass: true,
  },
  {
    id: 'gate-2',
    gateName: 'Work Started Verification',
    gateKey: 'work_started',
    requiredDocumentTypes: [],
    requiredPhotoCategories: ['progress'],
    requiredChecklistItems: ['crew_arrived', 'safety_check_complete'],
    description: 'Verify crew has arrived and work has begun',
    orderIndex: 2,
    allowManagerBypass: true,
  },
  {
    id: 'gate-3',
    gateName: 'Quality Check',
    gateKey: 'quality_check',
    requiredDocumentTypes: [],
    requiredPhotoCategories: ['during', 'progress'],
    requiredChecklistItems: ['qc_inspection_passed'],
    description: 'Required before work can be marked complete',
    orderIndex: 3,
    allowManagerBypass: true,
  },
  {
    id: 'gate-4',
    gateName: 'Completion Documentation',
    gateKey: 'completion',
    requiredDocumentTypes: ['warranty_registration', 'final_invoice'],
    requiredPhotoCategories: ['after', 'completed'],
    requiredChecklistItems: ['customer_walkthrough', 'cleanup_complete'],
    description: 'Required before project can be invoiced',
    orderIndex: 4,
    allowManagerBypass: false, // Must be fully validated
  },
];

// Map gate keys to stage transitions
const GATE_TO_STAGES: Record<string, { from: string; to: string }> = {
  'pre_work': { from: 'scheduled', to: 'in_progress' },
  'work_started': { from: 'in_progress', to: 'work_started' },
  'quality_check': { from: 'work_started', to: 'quality_check' },
  'completion': { from: 'quality_check', to: 'completed' },
};

/**
 * Hook for managing production stage gates
 * Enforces document/photo requirements before stage transitions
 */
export const useProductionGates = (projectId: string | null) => {
  const [gates] = useState<ProductionGate[]>(DEFAULT_GATES);
  const [gateStatuses, setGateStatuses] = useState<ProductionGateStatus[]>([]);
  const [loading, setLoading] = useState(false);
  const [userRole, setUserRole] = useState<string>('');
  const { toast } = useToast();

  // Load gate statuses for the project
  useEffect(() => {
    if (!projectId) return;
    
    const loadGateStatuses = async () => {
      setLoading(true);
      try {
        const { data, error } = await supabase
          .from('production_gate_validations')
          .select('*')
          .eq('project_id', projectId);

        if (error) throw error;

        setGateStatuses(data?.map(g => ({
          fromStage: g.from_stage,
          toStage: g.to_stage,
          validationStatus: g.validation_status,
          validatedAt: g.validated_at || undefined,
          validatedBy: g.validated_by || undefined,
          bypassReason: g.bypass_reason || undefined,
          bypassedBy: g.bypassed_by || undefined,
          validationResults: g.validation_results,
        })) || []);

        // Get user role
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          const { data: profile } = await supabase
            .from('profiles')
            .select('role')
            .eq('id', user.id)
            .single();
          setUserRole(profile?.role || '');
        }
      } catch (error) {
        console.error('Error loading gate statuses:', error);
      } finally {
        setLoading(false);
      }
    };

    loadGateStatuses();
  }, [projectId]);

  /**
   * Validate a specific gate for a project
   */
  const validateGate = useCallback(async (
    gateKey: string
  ): Promise<GateValidationResult> => {
    if (!projectId) {
      return {
        passed: false,
        gateName: 'Unknown',
        gateKey,
        missingItems: { documents: [], photos: [], checklists: [] },
        canBypass: false,
        bypassRequiresReason: true,
      };
    }

    const gate = gates.find(g => g.gateKey === gateKey);
    if (!gate) {
      return {
        passed: false,
        gateName: 'Unknown Gate',
        gateKey,
        missingItems: { documents: [], photos: [], checklists: [] },
        canBypass: false,
        bypassRequiresReason: true,
      };
    }

    try {
      // Check documents
      const { data: documents } = await supabase
        .from('documents')
        .select('document_type')
        .eq('project_id', projectId);

      const uploadedDocTypes = documents?.map(d => d.document_type) || [];
      const missingDocs = gate.requiredDocumentTypes.filter(
        dt => !uploadedDocTypes.includes(dt)
      );

      // Check photos from project_photos - use workflow_status or ai_tags to determine category
      const { data: projectPhotos } = await supabase
        .from('project_photos')
        .select('workflow_status, ai_tags')
        .eq('project_id', projectId);

      // Extract photo categories from workflow_status and ai_tags
      const uploadedPhotoCategories: string[] = [];
      projectPhotos?.forEach(p => {
        if (p.workflow_status) uploadedPhotoCategories.push(p.workflow_status);
        if (p.ai_tags) uploadedPhotoCategories.push(...p.ai_tags);
      });
      const uniquePhotoCategories = [...new Set(uploadedPhotoCategories)];
      const missingPhotos = gate.requiredPhotoCategories.filter(
        pc => !uniquePhotoCategories.includes(pc)
      );

      // Check checklists (from production workflow stage_data)
      const { data: workflow } = await supabase
        .from('production_workflows')
        .select('stage_data, noc_uploaded, permit_application_submitted')
        .eq('project_id', projectId)
        .maybeSingle();

      // Parse stage_data for checklist items
      const stageData = (workflow?.stage_data as Record<string, any>) || {};
      const checklistData: Record<string, boolean> = {
        ...(stageData.checklist || {}),
        noc_uploaded: workflow?.noc_uploaded || false,
        permit_application_submitted: workflow?.permit_application_submitted || false,
      };
      const missingChecklists = gate.requiredChecklistItems.filter(
        ci => !checklistData[ci]
      );

      const passed = missingDocs.length === 0 && 
                     missingPhotos.length === 0 && 
                     missingChecklists.length === 0;

      const isManager = ['master', 'owner', 'corporate', 'office_admin', 'regional_manager'].includes(userRole);
      const canBypass = gate.allowManagerBypass && isManager;

      return {
        passed,
        gateName: gate.gateName,
        gateKey: gate.gateKey,
        missingItems: {
          documents: missingDocs,
          photos: missingPhotos,
          checklists: missingChecklists,
        },
        canBypass,
        bypassRequiresReason: true,
      };

    } catch (error) {
      console.error('Error validating gate:', error);
      return {
        passed: false,
        gateName: gate.gateName,
        gateKey: gate.gateKey,
        missingItems: { documents: [], photos: [], checklists: [] },
        canBypass: false,
        bypassRequiresReason: true,
      };
    }
  }, [projectId, gates, userRole]);

  /**
   * Record gate validation or bypass
   */
  const recordGateValidation = useCallback(async (
    gateKey: string,
    isBypassed: boolean = false,
    bypassReason?: string
  ): Promise<boolean> => {
    if (!projectId) return false;

    const stageTransition = GATE_TO_STAGES[gateKey];
    if (!stageTransition) return false;

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { data: profile } = await supabase
        .from('profiles')
        .select('tenant_id')
        .eq('id', user.id)
        .single();

      if (!profile?.tenant_id) throw new Error('No tenant found');

      // Insert or update the gate validation record
      const { error } = await supabase
        .from('production_gate_validations')
        .insert({
          tenant_id: profile.tenant_id,
          project_id: projectId,
          from_stage: stageTransition.from,
          to_stage: stageTransition.to,
          validation_status: isBypassed ? 'bypassed' : 'validated',
          validated_at: !isBypassed ? new Date().toISOString() : null,
          validated_by: !isBypassed ? user.id : null,
          bypass_reason: bypassReason || null,
          bypassed_by: isBypassed ? user.id : null,
          validation_results: { gate_key: gateKey, validated_at: new Date().toISOString() }
        });

      if (error) throw error;

      toast({
        title: isBypassed ? 'Gate Bypassed' : 'Gate Validated',
        description: isBypassed 
          ? `Gate bypassed with reason: ${bypassReason}`
          : `Production gate "${gateKey}" has been validated`,
      });

      // Refresh statuses
      setGateStatuses(prev => {
        const existing = prev.find(g => g.fromStage === stageTransition.from && g.toStage === stageTransition.to);
        const newStatus: ProductionGateStatus = {
          fromStage: stageTransition.from,
          toStage: stageTransition.to,
          validationStatus: isBypassed ? 'bypassed' : 'validated',
          validatedAt: !isBypassed ? new Date().toISOString() : undefined,
          validatedBy: !isBypassed ? user.id : undefined,
          bypassReason: bypassReason,
          bypassedBy: isBypassed ? user.id : undefined,
        };
        
        if (existing) {
          return prev.map(g => 
            (g.fromStage === stageTransition.from && g.toStage === stageTransition.to) 
              ? newStatus 
              : g
          );
        }
        return [...prev, newStatus];
      });

      return true;

    } catch (error: any) {
      console.error('Error recording gate validation:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to record gate validation',
        variant: 'destructive'
      });
      return false;
    }
  }, [projectId, toast]);

  /**
   * Check if a production stage transition is allowed
   */
  const canTransitionToStage = useCallback(async (
    toStage: string
  ): Promise<{ allowed: boolean; blockedByGate?: string; missingItems?: GateValidationResult['missingItems'] }> => {
    // Map stages to required gates
    const stageGateMap: Record<string, string> = {
      'in_progress': 'pre_work',
      'work_started': 'work_started',
      'quality_check': 'quality_check',
      'completed': 'completion',
      'invoiced': 'completion',
    };

    const requiredGate = stageGateMap[toStage];
    if (!requiredGate) {
      return { allowed: true };
    }

    const stageTransition = GATE_TO_STAGES[requiredGate];
    if (!stageTransition) {
      return { allowed: true };
    }

    // Check if gate is already validated or bypassed
    const existingStatus = gateStatuses.find(
      g => g.fromStage === stageTransition.from && g.toStage === stageTransition.to
    );
    if (existingStatus?.validationStatus === 'validated' || existingStatus?.validationStatus === 'bypassed') {
      return { allowed: true };
    }

    // Validate the gate
    const validation = await validateGate(requiredGate);
    
    if (validation.passed) {
      // Auto-record validation
      await recordGateValidation(requiredGate, false);
      return { allowed: true };
    }

    return {
      allowed: false,
      blockedByGate: validation.gateName,
      missingItems: validation.missingItems,
    };
  }, [gateStatuses, validateGate, recordGateValidation]);

  return {
    gates,
    gateStatuses,
    loading,
    userRole,
    validateGate,
    recordGateValidation,
    canTransitionToStage,
  };
};

export default useProductionGates;
