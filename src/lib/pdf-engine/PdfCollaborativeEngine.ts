/**
 * PITCH PDF Collaborative Engine
 * Foundation for multi-user collaborative editing using Yjs-compatible operation streams.
 * Manages sessions, participants, and operation synchronization.
 * Full realtime UI is a future phase — this is the infrastructure layer.
 */

import { supabase } from '@/integrations/supabase/client';

export interface CollabSession {
  id: string;
  pdfDocumentId: string;
  sessionKey: string;
  participants: CollabParticipant[];
  isActive: boolean;
  createdAt: string;
}

export interface CollabParticipant {
  userId: string;
  displayName: string;
  color: string;
  cursor?: { pageNumber: number; x: number; y: number };
  joinedAt: string;
  lastSeenAt: string;
}

export interface CollabOperation {
  id: string;
  userId: string;
  timestamp: string;
  operationType: string;
  payload: Record<string, unknown>;
}

const PARTICIPANT_COLORS = [
  '#3B82F6', '#EF4444', '#10B981', '#F59E0B',
  '#8B5CF6', '#EC4899', '#06B6D4', '#F97316',
];

export class PdfCollaborativeEngine {
  /**
   * Create or join a collaborative session for a document.
   */
  static async getOrCreateSession(
    pdfDocumentId: string,
    userId: string,
    displayName: string
  ): Promise<CollabSession> {
    // Check for existing active session
    const { data: existing } = await (supabase as any)
      .from('pdf_collab_sessions')
      .select('*')
      .eq('pdf_document_id', pdfDocumentId)
      .eq('is_active', true)
      .maybeSingle();

    if (existing) {
      // Add participant if not already present
      const participants = (existing.participants || []) as CollabParticipant[];
      const alreadyJoined = participants.some(p => p.userId === userId);

      if (!alreadyJoined) {
        participants.push({
          userId,
          displayName,
          color: PARTICIPANT_COLORS[participants.length % PARTICIPANT_COLORS.length],
          joinedAt: new Date().toISOString(),
          lastSeenAt: new Date().toISOString(),
        });

        await (supabase as any)
          .from('pdf_collab_sessions')
          .update({ participants, updated_at: new Date().toISOString() })
          .eq('id', existing.id);
      }

      return this.mapSession(existing);
    }

    // Create new session
    const sessionKey = `pdf-${pdfDocumentId}-${Date.now()}`;
    const { data, error } = await (supabase as any)
      .from('pdf_collab_sessions')
      .insert({
        pdf_document_id: pdfDocumentId,
        session_key: sessionKey,
        participants: [{
          userId,
          displayName,
          color: PARTICIPANT_COLORS[0],
          joinedAt: new Date().toISOString(),
          lastSeenAt: new Date().toISOString(),
        }],
        is_active: true,
      })
      .select()
      .single();

    if (error) throw error;
    return this.mapSession(data);
  }

  /**
   * Leave a collaborative session.
   */
  static async leaveSession(sessionId: string, userId: string): Promise<void> {
    const { data } = await (supabase as any)
      .from('pdf_collab_sessions')
      .select('participants')
      .eq('id', sessionId)
      .single();

    if (!data) return;

    const participants = ((data.participants || []) as CollabParticipant[])
      .filter(p => p.userId !== userId);

    if (participants.length === 0) {
      // Close session if no participants
      await (supabase as any)
        .from('pdf_collab_sessions')
        .update({ is_active: false, participants, updated_at: new Date().toISOString() })
        .eq('id', sessionId);
    } else {
      await (supabase as any)
        .from('pdf_collab_sessions')
        .update({ participants, updated_at: new Date().toISOString() })
        .eq('id', sessionId);
    }
  }

  /**
   * Push an operation to the session's operation stream.
   */
  static async pushOperation(
    sessionId: string,
    operation: Omit<CollabOperation, 'id'>
  ): Promise<void> {
    const { data } = await (supabase as any)
      .from('pdf_collab_sessions')
      .select('operation_stream')
      .eq('id', sessionId)
      .single();

    if (!data) return;

    const stream = (data.operation_stream || []) as CollabOperation[];
    stream.push({ ...operation, id: crypto.randomUUID() });

    // Keep only last 1000 operations in stream
    const trimmed = stream.slice(-1000);

    await (supabase as any)
      .from('pdf_collab_sessions')
      .update({ operation_stream: trimmed, updated_at: new Date().toISOString() })
      .eq('id', sessionId);
  }

  /**
   * Subscribe to session changes via Supabase Realtime.
   * Returns an unsubscribe function.
   */
  static subscribeToSession(
    sessionId: string,
    onUpdate: (session: CollabSession) => void
  ): () => void {
    const channel = supabase
      .channel(`collab-${sessionId}`)
      .on(
        'postgres_changes' as any,
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'pdf_collab_sessions',
          filter: `id=eq.${sessionId}`,
        },
        (payload: any) => {
          onUpdate(PdfCollaborativeEngine.mapSession(payload.new));
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }

  private static mapSession(row: any): CollabSession {
    return {
      id: row.id,
      pdfDocumentId: row.pdf_document_id,
      sessionKey: row.session_key,
      participants: row.participants || [],
      isActive: row.is_active,
      createdAt: row.created_at,
    };
  }
}
