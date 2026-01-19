import { supabase } from '@/integrations/supabase/client';

/**
 * Trigger an automation event
 * Call this from various points in the application when events occur
 */
export async function triggerAutomation(
  eventType: string,
  context: Record<string, any>
): Promise<{ success: boolean; data?: any; error?: string }> {
  try {
    const { data, error } = await supabase.functions.invoke('automation-processor', {
      body: { event_type: eventType, context }
    });

    if (error) {
      console.error('Automation trigger failed:', error);
      return { success: false, error: error.message };
    }

    return { success: true, data };
  } catch (err) {
    console.error('Automation trigger error:', err);
    return { success: false, error: String(err) };
  }
}

// ============================================
// PREDEFINED EVENT TYPES
// ============================================

export const AUTOMATION_EVENTS = {
  // Lead Events
  LEAD_CREATED: 'lead_created',
  LEAD_STATUS_CHANGED: 'lead_status_changed',
  LEAD_ASSIGNED: 'lead_assigned',
  LEAD_SCORE_UPDATED: 'lead_score_updated',
  
  // Contact Events
  CONTACT_CREATED: 'contact_created',
  CONTACT_UPDATED: 'contact_updated',
  
  // Pipeline Events
  PIPELINE_STAGE_CHANGED: 'pipeline_stage_changed',
  PIPELINE_ENTRY_CREATED: 'pipeline_entry_created',
  
  // Contract Events
  CONTRACT_SENT: 'contract_sent',
  CONTRACT_SIGNED: 'contract_signed',
  CONTRACT_EXPIRED: 'contract_expired',
  CHANGE_ORDER_REQUESTED: 'change_order_requested',
  
  // Job Events
  JOB_CREATED: 'job_created',
  JOB_MILESTONE_CHANGED: 'job_milestone_changed',
  JOB_COMPLETED: 'job_completed',
  
  // Appointment Events
  APPOINTMENT_SCHEDULED: 'appointment_scheduled',
  APPOINTMENT_CONFIRMED: 'appointment_confirmed',
  APPOINTMENT_CANCELLED: 'appointment_cancelled',
  APPOINTMENT_COMPLETED: 'appointment_completed',
  
  // Financial Events
  PAYMENT_RECEIVED: 'payment_received',
  INVOICE_SENT: 'invoice_sent',
  INVOICE_OVERDUE: 'invoice_overdue',
  FINANCING_APPROVED: 'financing_approved',
  FINANCING_DENIED: 'financing_denied',
  
  // Material/Order Events
  MATERIAL_ORDERED: 'material_ordered',
  MATERIAL_DELIVERED: 'material_delivered',
  
  // Permit Events
  PERMIT_SUBMITTED: 'permit_submitted',
  PERMIT_APPROVED: 'permit_approved',
  PERMIT_DENIED: 'permit_denied',
  
  // Communication Events
  EMAIL_OPENED: 'email_opened',
  SMS_RECEIVED: 'sms_received',
  CALL_COMPLETED: 'call_completed',
  
  // Time-Based Events (processed by scheduler)
  DAYS_BEFORE_APPOINTMENT: 'days_before_appointment',
  DAYS_AFTER_QUOTE: 'days_after_quote',
  DAYS_AFTER_CONTRACT_SENT: 'days_after_contract_sent',
  LEAD_INACTIVE: 'lead_inactive',
} as const;

export type AutomationEventType = typeof AUTOMATION_EVENTS[keyof typeof AUTOMATION_EVENTS];

// ============================================
// CONVENIENCE TRIGGER FUNCTIONS
// ============================================

export async function triggerLeadCreated(leadData: {
  contact_id: string;
  contact_email?: string;
  contact_phone?: string;
  contact_first_name?: string;
  contact_last_name?: string;
  lead_source?: string;
  sales_rep_id?: string;
  sales_rep_email?: string;
  [key: string]: any;
}) {
  return triggerAutomation(AUTOMATION_EVENTS.LEAD_CREATED, leadData);
}

export async function triggerLeadStatusChanged(data: {
  contact_id: string;
  old_status: string;
  new_status: string;
  contact_email?: string;
  contact_phone?: string;
  sales_rep_id?: string;
  [key: string]: any;
}) {
  return triggerAutomation(AUTOMATION_EVENTS.LEAD_STATUS_CHANGED, data);
}

export async function triggerPipelineStageChanged(data: {
  pipeline_entry_id: string;
  contact_id: string;
  old_stage: string;
  new_stage: string;
  contact_email?: string;
  contact_phone?: string;
  sales_rep_id?: string;
  [key: string]: any;
}) {
  return triggerAutomation(AUTOMATION_EVENTS.PIPELINE_STAGE_CHANGED, data);
}

export async function triggerAppointmentScheduled(data: {
  appointment_id: string;
  contact_id: string;
  contact_email?: string;
  contact_phone?: string;
  contact_first_name?: string;
  scheduled_date: string;
  appointment_type: string;
  assigned_to?: string;
  assigned_email?: string;
  [key: string]: any;
}) {
  return triggerAutomation(AUTOMATION_EVENTS.APPOINTMENT_SCHEDULED, data);
}

export async function triggerContractSent(data: {
  contract_id: string;
  contact_id: string;
  contact_email: string;
  contact_phone?: string;
  contract_value?: number;
  [key: string]: any;
}) {
  return triggerAutomation(AUTOMATION_EVENTS.CONTRACT_SENT, data);
}

export async function triggerContractSigned(data: {
  contract_id: string;
  contact_id: string;
  contact_email: string;
  contract_value?: number;
  signed_at: string;
  [key: string]: any;
}) {
  return triggerAutomation(AUTOMATION_EVENTS.CONTRACT_SIGNED, data);
}

export async function triggerPaymentReceived(data: {
  payment_id: string;
  contact_id: string;
  contact_email: string;
  amount: number;
  job_id?: string;
  project_id?: string;
  [key: string]: any;
}) {
  return triggerAutomation(AUTOMATION_EVENTS.PAYMENT_RECEIVED, data);
}

export async function triggerJobMilestoneChanged(data: {
  job_id: string;
  contact_id: string;
  old_milestone: string;
  new_milestone: string;
  contact_email?: string;
  project_manager_id?: string;
  [key: string]: any;
}) {
  return triggerAutomation(AUTOMATION_EVENTS.JOB_MILESTONE_CHANGED, data);
}
