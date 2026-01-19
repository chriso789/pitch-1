import { useCallback } from 'react';
import { triggerAutomation, AUTOMATION_EVENTS, AutomationEventType } from '@/lib/automations/triggerAutomation';

/**
 * React hook for triggering automations from components
 */
export function useAutomationTrigger() {
  const trigger = useCallback(async (
    eventType: AutomationEventType,
    context: Record<string, any>
  ) => {
    return triggerAutomation(eventType, context);
  }, []);

  const triggerLeadCreated = useCallback(async (leadData: {
    contact_id: string;
    contact_email?: string;
    contact_phone?: string;
    contact_first_name?: string;
    contact_last_name?: string;
    lead_source?: string;
    sales_rep_id?: string;
    [key: string]: any;
  }) => {
    return trigger(AUTOMATION_EVENTS.LEAD_CREATED, leadData);
  }, [trigger]);

  const triggerLeadStatusChanged = useCallback(async (data: {
    contact_id: string;
    old_status: string;
    new_status: string;
    [key: string]: any;
  }) => {
    return trigger(AUTOMATION_EVENTS.LEAD_STATUS_CHANGED, data);
  }, [trigger]);

  const triggerPipelineStageChanged = useCallback(async (data: {
    pipeline_entry_id: string;
    contact_id: string;
    old_stage: string;
    new_stage: string;
    [key: string]: any;
  }) => {
    return trigger(AUTOMATION_EVENTS.PIPELINE_STAGE_CHANGED, data);
  }, [trigger]);

  const triggerAppointmentScheduled = useCallback(async (data: {
    appointment_id: string;
    contact_id: string;
    scheduled_date: string;
    appointment_type: string;
    [key: string]: any;
  }) => {
    return trigger(AUTOMATION_EVENTS.APPOINTMENT_SCHEDULED, data);
  }, [trigger]);

  const triggerContractSent = useCallback(async (data: {
    contract_id: string;
    contact_id: string;
    contact_email: string;
    contract_value?: number;
    [key: string]: any;
  }) => {
    return trigger(AUTOMATION_EVENTS.CONTRACT_SENT, data);
  }, [trigger]);

  const triggerContractSigned = useCallback(async (data: {
    contract_id: string;
    contact_id: string;
    contact_email: string;
    signed_at: string;
    [key: string]: any;
  }) => {
    return trigger(AUTOMATION_EVENTS.CONTRACT_SIGNED, data);
  }, [trigger]);

  const triggerPaymentReceived = useCallback(async (data: {
    payment_id: string;
    contact_id: string;
    amount: number;
    [key: string]: any;
  }) => {
    return trigger(AUTOMATION_EVENTS.PAYMENT_RECEIVED, data);
  }, [trigger]);

  const triggerJobMilestoneChanged = useCallback(async (data: {
    job_id: string;
    contact_id: string;
    old_milestone: string;
    new_milestone: string;
    [key: string]: any;
  }) => {
    return trigger(AUTOMATION_EVENTS.JOB_MILESTONE_CHANGED, data);
  }, [trigger]);

  return {
    trigger,
    triggerLeadCreated,
    triggerLeadStatusChanged,
    triggerPipelineStageChanged,
    triggerAppointmentScheduled,
    triggerContractSent,
    triggerContractSigned,
    triggerPaymentReceived,
    triggerJobMilestoneChanged,
    AUTOMATION_EVENTS,
  };
}
