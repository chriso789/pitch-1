import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export interface CustomerProject {
  id: string;
  name: string;
  description?: string;
  status: string;
  customer_portal_status: string;
  permit_url?: string;
  certificate_of_completion_url?: string;
  warranty_url?: string;
  lien_waiver_url?: string;
  wind_mitigation_eligible?: boolean;
  created_at: string;
  estimated_completion_date?: string;
  clj_formatted_number?: string;
  pipeline_entries?: {
    contacts?: {
      first_name: string;
      last_name: string;
      email?: string;
      phone?: string;
      address_street?: string;
      address_city?: string;
      address_state?: string;
      address_zip?: string;
    };
  }[];
  // Payment-related fields
  payments?: {
    id: string;
    amount: number;
    status: string;
    created_at: string;
    description?: string;
    payment_method?: string;
  }[];
  payment_links?: {
    id: string;
    amount: number;
    status: string;
    stripe_payment_link_url: string;
    description?: string;
    created_at: string;
  }[];
  estimates?: {
    id: string;
    total_amount: number;
    status: string;
    estimate_number?: string;
  }[];
}

export interface CustomerMilestone {
  id: string;
  milestone_key: string;
  milestone_name: string;
  description?: string;
  document_url?: string;
  video_url?: string;
  is_complete: boolean;
  completed_at?: string;
  metadata: Record<string, any>;
  display_order: number;
}

export interface CustomerPhoto {
  id: string;
  file_url: string;
  file_name?: string;
  description?: string;
  uploaded_at: string;
}

export interface CustomerReward {
  points_balance: number;
  lifetime_points_earned: number;
}

export interface CustomerReferral {
  id: string;
  referred_name: string;
  referred_email?: string;
  referred_phone?: string;
  status: string;
  reward_points_earned: number;
  created_at: string;
}

export interface PortalMessage {
  id: string;
  message: string;
  sender_type: 'customer' | 'company' | 'ai';
  created_at: string;
}

export const JOB_STATUS_STAGES = [
  { key: 'contract_deposit', name: 'Contract/Deposit', icon: 'FileText', description: 'Contract signed and deposit received' },
  { key: 'permit_submitted', name: 'Permit App & NOC Submitted', icon: 'FileCheck', description: 'Building permit application submitted' },
  { key: 'permit_approved', name: 'Permit App Approved', icon: 'CheckCircle', description: 'Permit approved and ready for scheduling' },
  { key: 'job_scheduled', name: 'Job Scheduled', icon: 'Calendar', description: 'Work dates confirmed' },
  { key: 'install', name: 'Install', icon: 'Hammer', description: 'Installation in progress' },
  { key: 'final', name: 'Final', icon: 'ClipboardCheck', description: 'Final inspection and completion' },
  { key: 'paid_in_full', name: 'Paid in Full', icon: 'DollarSign', description: 'Project complete and paid' },
];

export const ADDITIONAL_SERVICES = [
  { id: 'gutters', name: 'Gutters', icon: '🏠' },
  { id: 'siding', name: 'Siding', icon: '🧱' },
  { id: 'windows', name: 'Windows', icon: '🪟' },
  { id: 'solar', name: 'Solar', icon: '☀️' },
  { id: 'hvac', name: 'HVAC', icon: '❄️' },
  { id: 'painting', name: 'Painting', icon: '🎨' },
  { id: 'fencing', name: 'Fencing', icon: '🏡' },
];

export function useCustomerPortal(token: string) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [project, setProject] = useState<CustomerProject | null>(null);
  const [milestones, setMilestones] = useState<CustomerMilestone[]>([]);
  const [photos, setPhotos] = useState<CustomerPhoto[]>([]);
  const [rewards, setRewards] = useState<CustomerReward | null>(null);
  const [referrals, setReferrals] = useState<CustomerReferral[]>([]);
  const [messages, setMessages] = useState<PortalMessage[]>([]);
  const [company, setCompany] = useState<any>(null);
  const [contact, setContact] = useState<any>(null);
  const [tokenData, setTokenData] = useState<any>(null);

  const fetchPortalData = useCallback(async () => {
    if (!token) return;
    
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('customer-portal-access', {
        body: { action: 'validate', token }
      });

      if (error || !data?.success) {
        throw new Error(data?.error || 'Failed to validate portal access');
      }

      // Merge payment_links into project for convenience
      const projectWithPayments = {
        ...data.project,
        payment_links: data.payment_links || [],
      };
      setProject(projectWithPayments);
      setCompany(data.company);
      setContact(data.contact);
      setTokenData(data);
      setMessages(data.messages || []);

      // Fetch milestones
      if (data.project?.id) {
        const { data: milestonesData } = await supabase.functions.invoke('customer-portal-access', {
          body: { action: 'get_milestones', token, project_id: data.project.id }
        });
        if (milestonesData?.milestones) {
          setMilestones(milestonesData.milestones);
        }

        // Fetch photos
        const { data: photosData } = await supabase.functions.invoke('customer-portal-access', {
          body: { action: 'get_photos', token, project_id: data.project.id }
        });
        if (photosData?.photos) {
          setPhotos(photosData.photos);
        }
      }

      // Fetch rewards
      if (data.contact?.id) {
        const { data: rewardsData } = await supabase.functions.invoke('customer-portal-access', {
          body: { action: 'get_rewards', token, contact_id: data.contact.id }
        });
        if (rewardsData?.rewards) {
          setRewards(rewardsData.rewards);
        }

        // Fetch referrals
        const { data: referralsData } = await supabase.functions.invoke('customer-portal-access', {
          body: { action: 'get_referrals', token, contact_id: data.contact.id }
        });
        if (referralsData?.referrals) {
          setReferrals(referralsData.referrals);
        }
      }
    } catch (error: any) {
      console.error('Portal data fetch error:', error);
      toast({
        title: 'Error loading portal',
        description: error.message,
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  }, [token, toast]);

  useEffect(() => {
    fetchPortalData();
  }, [fetchPortalData]);

  const sendMessage = async (message: string) => {
    try {
      const { data, error } = await supabase.functions.invoke('customer-portal-access', {
        body: { action: 'send_message', token, message }
      });

      if (error || !data?.success) {
        throw new Error(data?.error || 'Failed to send message');
      }

      setMessages(prev => [...prev, data.message]);
      return data.message;
    } catch (error: any) {
      toast({
        title: 'Error sending message',
        description: error.message,
        variant: 'destructive'
      });
      throw error;
    }
  };

  const submitReferral = async (referral: { name: string; email?: string; phone?: string }) => {
    try {
      const { data, error } = await supabase.functions.invoke('customer-portal-access', {
        body: { 
          action: 'submit_referral', 
          token,
          referral: {
            referred_name: referral.name,
            referred_email: referral.email,
            referred_phone: referral.phone
          }
        }
      });

      if (error || !data?.success) {
        throw new Error(data?.error || 'Failed to submit referral');
      }

      toast({
        title: 'Referral submitted!',
        description: 'You\'ve earned 100 points!',
      });

      await fetchPortalData();
      return data.referral;
    } catch (error: any) {
      toast({
        title: 'Error submitting referral',
        description: error.message,
        variant: 'destructive'
      });
      throw error;
    }
  };

  const redeemPoints = async (points: number, type: 'cash' | 'gift' | 'project_credit') => {
    try {
      const { data, error } = await supabase.functions.invoke('customer-portal-access', {
        body: { action: 'redeem_points', token, points, redemption_type: type }
      });

      if (error || !data?.success) {
        throw new Error(data?.error || 'Failed to redeem points');
      }

      toast({
        title: 'Redemption requested!',
        description: 'We\'ll process your request shortly.',
      });

      await fetchPortalData();
      return data.redemption;
    } catch (error: any) {
      toast({
        title: 'Error redeeming points',
        description: error.message,
        variant: 'destructive'
      });
      throw error;
    }
  };

  const requestAttorney = async (reason: string) => {
    try {
      const { data, error } = await supabase.functions.invoke('customer-portal-access', {
        body: { action: 'request_attorney', token, reason, project_id: project?.id }
      });

      if (error || !data?.success) {
        throw new Error(data?.error || 'Failed to submit request');
      }

      toast({
        title: 'Request submitted',
        description: 'An attorney will contact you soon.',
      });

      return data.request;
    } catch (error: any) {
      toast({
        title: 'Error submitting request',
        description: error.message,
        variant: 'destructive'
      });
      throw error;
    }
  };

  const requestServiceQuote = async (serviceType: string, description?: string) => {
    try {
      const { data, error } = await supabase.functions.invoke('customer-portal-access', {
        body: { 
          action: 'request_service_quote', 
          token, 
          service_type: serviceType, 
          description,
          project_id: project?.id 
        }
      });

      if (error || !data?.success) {
        throw new Error(data?.error || 'Failed to submit quote request');
      }

      toast({
        title: 'Quote requested!',
        description: 'We\'ll send you a quote shortly.',
      });

      return data.quote_request;
    } catch (error: any) {
      toast({
        title: 'Error requesting quote',
        description: error.message,
        variant: 'destructive'
      });
      throw error;
    }
  };

  const uploadPhoto = async (file: File, description?: string) => {
    try {
      const formData = new FormData();
      formData.append('file', file);
      if (description) formData.append('description', description);
      formData.append('token', token);
      formData.append('project_id', project?.id || '');

      // Upload to storage first
      const fileName = `customer-photos/${project?.id}/${Date.now()}-${file.name}`;
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('project-files')
        .upload(fileName, file, { upsert: true });

      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage
        .from('project-files')
        .getPublicUrl(fileName);

      // Save to database via edge function
      const { data, error } = await supabase.functions.invoke('customer-portal-access', {
        body: { 
          action: 'save_photo', 
          token,
          photo: {
            file_url: urlData.publicUrl,
            file_name: file.name,
            description,
            project_id: project?.id
          }
        }
      });

      if (error || !data?.success) {
        throw new Error(data?.error || 'Failed to save photo');
      }

      toast({
        title: 'Photo uploaded!',
        description: 'Your photo has been added.',
      });

      await fetchPortalData();
      return data.photo;
    } catch (error: any) {
      toast({
        title: 'Error uploading photo',
        description: error.message,
        variant: 'destructive'
      });
      throw error;
    }
  };

  return {
    loading,
    project,
    milestones,
    photos,
    rewards,
    referrals,
    messages,
    company,
    contact,
    sendMessage,
    submitReferral,
    redeemPoints,
    requestAttorney,
    requestServiceQuote,
    uploadPhoto,
    refetch: fetchPortalData,
  };
}
