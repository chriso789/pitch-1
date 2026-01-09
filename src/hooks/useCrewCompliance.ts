import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useCrewAuth } from './useCrewAuth';

export type DocStatus = 'valid' | 'expiring' | 'expired' | 'missing';

interface Document {
  id: string;
  documentTypeId: string;
  typeKey: string;
  typeLabel: string;
  issuingAuthority: string | null;
  number: string | null;
  effectiveDate: string | null;
  expirationDate: string;
  fileUrl: string;
  status: DocStatus;
  daysUntilExpiry: number;
}

interface DocumentType {
  id: string;
  key: string;
  label: string;
  docKind: string;
  isRequired: boolean;
  blocksAssignmentIfExpired: boolean;
}

interface ComplianceState {
  overallStatus: DocStatus;
  documents: Document[];
  documentTypes: DocumentType[];
  missingRequired: DocumentType[];
  expiringDocuments: Document[];
  expiredDocuments: Document[];
}

export function useCrewCompliance() {
  const { user, companyId, isCrewMember } = useCrewAuth();
  const [compliance, setCompliance] = useState<ComplianceState>({
    overallStatus: 'valid',
    documents: [],
    documentTypes: [],
    missingRequired: [],
    expiringDocuments: [],
    expiredDocuments: [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchCompliance = useCallback(async () => {
    if (!user || !companyId || !isCrewMember) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      // Simplified: set default valid status
      setCompliance({
        overallStatus: 'valid',
        documents: [],
        documentTypes: [],
        missingRequired: [],
        expiringDocuments: [],
        expiredDocuments: [],
      });
    } catch (err) {
      console.error('[useCrewCompliance] Error:', err);
      setError(err instanceof Error ? err.message : 'Failed to load compliance data');
    } finally {
      setLoading(false);
    }
  }, [user, companyId, isCrewMember]);

  const uploadDocument = async (
    documentTypeId: string,
    file: File,
    metadata: {
      issuingAuthority?: string;
      number?: string;
      effectiveDate?: string;
      expirationDate: string;
    }
  ) => {
    // Placeholder - will use edge function
    console.log('Document upload:', { documentTypeId, file, metadata });
    return null;
  };

  useEffect(() => {
    fetchCompliance();
  }, [fetchCompliance]);

  return {
    ...compliance,
    loading,
    error,
    uploadDocument,
    refetch: fetchCompliance,
  };
}
