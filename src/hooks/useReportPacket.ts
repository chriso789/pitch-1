import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

interface UpsertDraftParams {
  packetId?: string;
  subjectType: 'lead' | 'job' | 'contact' | 'pipeline_entry';
  subjectId: string;
  title: string;
  messageToClient?: string;
  sectionManifest: any[];
  expiresAt?: string;
}

interface SendPacketParams {
  packetId: string;
  to: string[];
  cc?: string[];
  subject: string;
  body: string;
}

export function useReportPacket() {
  const queryClient = useQueryClient();

  // Upsert draft mutation
  const upsertDraftMutation = useMutation({
    mutationFn: async (params: UpsertDraftParams) => {
      const { data, error } = await supabase.functions.invoke('report-packet-upsert-draft', {
        body: {
          packet_id: params.packetId,
          subject_type: params.subjectType,
          subject_id: params.subjectId,
          title: params.title,
          message_to_client: params.messageToClient,
          section_manifest: params.sectionManifest,
          expires_at: params.expiresAt,
        },
      });

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['report-packets'] });
    },
  });

  // Generate PDF mutation
  const generatePdfMutation = useMutation({
    mutationFn: async (packetId: string) => {
      const { data, error } = await supabase.functions.invoke('report-packet-generate-pdf', {
        body: { packet_id: packetId },
      });

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['report-packets'] });
    },
  });

  // Send packet mutation
  const sendPacketMutation = useMutation({
    mutationFn: async (params: SendPacketParams) => {
      const { data, error } = await supabase.functions.invoke('report-packet-send-resend', {
        body: {
          packet_id: params.packetId,
          to: params.to,
          cc: params.cc,
          subject: params.subject,
          body: params.body,
        },
      });

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['report-packets'] });
    },
  });

  return {
    // Upsert draft
    upsertDraft: upsertDraftMutation.mutateAsync,
    isUpsertingDraft: upsertDraftMutation.isPending,
    upsertDraftError: upsertDraftMutation.error,

    // Generate PDF
    generatePdf: generatePdfMutation.mutateAsync,
    isGeneratingPdf: generatePdfMutation.isPending,
    generatePdfError: generatePdfMutation.error,

    // Send packet
    sendPacket: sendPacketMutation.mutateAsync,
    isSendingPacket: sendPacketMutation.isPending,
    sendPacketError: sendPacketMutation.error,
  };
}
