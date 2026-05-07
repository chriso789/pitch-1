/**
 * PITCH PDF Collaborative Engine v2
 * 
 * Foundation for multi-user collaborative editing using Yjs.
 * Manages sessions, participants, operation sync, and cursor tracking.
 * Full realtime UI is a future phase — this is the infrastructure layer.
 */

import { supabase } from '@/integrations/supabase/client';
import * as Y from 'yjs';

// ═══════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════

export interface CollabSession {
  id: string;
  pdf_document_id: string;
  session_key: string;
  participants: CollabParticipant[];
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CollabParticipant {
  user_id: string;
  display_name: string;
  color: string;
  cursor_position: { page: number; x: number; y: number } | null;
  joined_at: string;
  last_active_at: string;
}

export interface CollabOperation {
  id: string;
  user_id: string;
  operation_type: string;
  operation_payload: Record<string, unknown>;
  timestamp: string;
  applied: boolean;
}

// ═══════════════════════════════════════════════════════════════════
// ENGINE
// ═══════════════════════════════════════════════════════════════════

export class PdfCollaborativeEngine {
  private ydoc: Y.Doc;
  private operationArray: Y.Array<CollabOperation>;
  private awarenessMap: Y.Map<unknown>;
  private sessionId: string | null = null;
  private userId: string;
  private documentId: string;
  private onOperationCallback: ((op: CollabOperation) => void) | null = null;

  constructor(documentId: string, userId: string) {
    this.documentId = documentId;
    this.userId = userId;
    this.ydoc = new Y.Doc();
    this.operationArray = this.ydoc.getArray<CollabOperation>('operations');
    this.awarenessMap = this.ydoc.getMap('awareness');

    // Listen for remote operations
    this.operationArray.observe((event) => {
      if (this.onOperationCallback) {
        for (const item of event.changes.added) {
          const ops = item.content.getContent() as CollabOperation[];
          for (const op of ops) {
            if (op.user_id !== this.userId) {
              this.onOperationCallback(op);
            }
          }
        }
      }
    });
  }

  /**
   * Create or join a collaborative session.
   */
  async joinSession(displayName: string): Promise<CollabSession> {
    // Check for existing active session
    const { data: existing } = await (supabase as any)
      .from('pdf_collab_sessions')
      .select('*')
      .eq('pdf_document_id', this.documentId)
      .eq('is_active', true)
      .maybeSingle();

    if (existing) {
      this.sessionId = existing.id;
      // Add participant
      const participants = existing.participants || [];
      const alreadyJoined = participants.some((p: CollabParticipant) => p.user_id === this.userId);
      if (!alreadyJoined) {
        participants.push({
          user_id: this.userId,
          display_name: displayName,
          color: this.generateColor(),
          cursor_position: null,
          joined_at: new Date().toISOString(),
          last_active_at: new Date().toISOString(),
        });
        await (supabase as any)
          .from('pdf_collab_sessions')
          .update({ participants })
          .eq('id', existing.id);
      }
      return { ...existing, participants };
    }

    // Create new session
    const sessionKey = `collab_${this.documentId}_${Date.now()}`;
    const participants: CollabParticipant[] = [{
      user_id: this.userId,
      display_name: displayName,
      color: this.generateColor(),
      cursor_position: null,
      joined_at: new Date().toISOString(),
      last_active_at: new Date().toISOString(),
    }];

    const { data, error } = await (supabase as any)
      .from('pdf_collab_sessions')
      .insert({
        pdf_document_id: this.documentId,
        session_key: sessionKey,
        participants,
        is_active: true,
        operation_stream: [],
      })
      .select()
      .single();

    if (error) throw error;
    this.sessionId = data.id;
    return data;
  }

  /**
   * Push a local operation to the Yjs document and persist.
   */
  pushOperation(operationType: string, payload: Record<string, unknown>): void {
    const op: CollabOperation = {
      id: crypto.randomUUID(),
      user_id: this.userId,
      operation_type: operationType,
      operation_payload: payload,
      timestamp: new Date().toISOString(),
      applied: true,
    };

    this.ydoc.transact(() => {
      this.operationArray.push([op]);
    });

    // Persist to DB async
    this.persistOperation(op).catch(console.error);
  }

  /**
   * Update cursor position for awareness.
   */
  updateCursor(page: number, x: number, y: number): void {
    this.awarenessMap.set(this.userId, {
      cursor: { page, x, y },
      updated_at: new Date().toISOString(),
    });
  }

  /**
   * Register callback for remote operations.
   */
  onRemoteOperation(callback: (op: CollabOperation) => void): void {
    this.onOperationCallback = callback;
  }

  /**
   * Get all operations in the session.
   */
  getOperations(): CollabOperation[] {
    return this.operationArray.toArray();
  }

  /**
   * Get the Yjs document state as a binary update.
   */
  getStateVector(): Uint8Array {
    return Y.encodeStateAsUpdate(this.ydoc);
  }

  /**
   * Apply a remote state update.
   */
  applyUpdate(update: Uint8Array): void {
    Y.applyUpdate(this.ydoc, update);
  }

  /**
   * Leave the session.
   */
  async leaveSession(): Promise<void> {
    if (!this.sessionId) return;

    const { data } = await (supabase as any)
      .from('pdf_collab_sessions')
      .select('participants')
      .eq('id', this.sessionId)
      .single();

    if (data) {
      const participants = (data.participants || []).filter(
        (p: CollabParticipant) => p.user_id !== this.userId
      );

      if (participants.length === 0) {
        // Last participant — close session
        await (supabase as any)
          .from('pdf_collab_sessions')
          .update({ is_active: false, participants })
          .eq('id', this.sessionId);
      } else {
        await (supabase as any)
          .from('pdf_collab_sessions')
          .update({ participants })
          .eq('id', this.sessionId);
      }
    }

    this.ydoc.destroy();
    this.sessionId = null;
  }

  /**
   * Load active sessions for a document.
   */
  static async getActiveSessions(documentId: string): Promise<CollabSession[]> {
    const { data, error } = await (supabase as any)
      .from('pdf_collab_sessions')
      .select('*')
      .eq('pdf_document_id', documentId)
      .eq('is_active', true);
    if (error) throw error;
    return data || [];
  }

  // ── Private helpers ──

  private async persistOperation(op: CollabOperation): Promise<void> {
    if (!this.sessionId) return;

    const { data } = await (supabase as any)
      .from('pdf_collab_sessions')
      .select('operation_stream')
      .eq('id', this.sessionId)
      .single();

    if (data) {
      const stream = data.operation_stream || [];
      stream.push(op);
      // Keep only last 500 operations in DB (Yjs handles full history)
      const trimmed = stream.length > 500 ? stream.slice(-500) : stream;
      await (supabase as any)
        .from('pdf_collab_sessions')
        .update({ operation_stream: trimmed })
        .eq('id', this.sessionId);
    }
  }

  private generateColor(): string {
    const colors = ['#3B82F6', '#EF4444', '#10B981', '#F59E0B', '#8B5CF6', '#EC4899', '#14B8A6', '#F97316'];
    return colors[Math.floor(Math.random() * colors.length)];
  }
}
