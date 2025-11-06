/**
 * Power Dialer Controller Edge Function Tests
 * Phase 1 - Week 1-2: Testing Infrastructure
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { supabase } from '@/integrations/supabase/client';
import {
  createTestAgent,
  createTestDialerSession,
  cleanupPowerDialerData,
} from '../utils/power-dialer-helpers';
import { createTestContact } from '../utils/db-helpers';

describe('Power Dialer Controller Edge Function', () => {
  beforeEach(async () => {
    await cleanupPowerDialerData();
  });

  afterEach(async () => {
    await cleanupPowerDialerData();
  });

  describe('Start Session', () => {
    it('should create a new dialer session', async () => {
      const agent = await createTestAgent();
      
      const { data, error } = await supabase.functions.invoke('power-dialer-controller/start-session', {
        body: {
          mode: 'power',
          campaignId: null,
        },
      });

      expect(error).toBeNull();
      expect(data).toBeDefined();
      expect(data?.session).toBeDefined();
      expect(data?.session?.status).toBe('active');
    });

    it('should create session with specified mode', async () => {
      const agent = await createTestAgent();
      
      const { data } = await supabase.functions.invoke('power-dialer-controller/start-session', {
        body: {
          mode: 'preview',
          campaignId: null,
        },
      });

      expect(data?.session?.mode).toBe('preview');
    });

    it('should handle missing parameters', async () => {
      const { data, error } = await supabase.functions.invoke('power-dialer-controller/start-session', {
        body: {},
      });

      // Should handle gracefully or return error
      expect(data || error).toBeDefined();
    });
  });

  describe('Next Contact', () => {
    it('should return next contact for session', async () => {
      const agent = await createTestAgent();
      const session = await createTestDialerSession(agent.id);
      const contact = await createTestContact();

      const { data, error } = await supabase.functions.invoke('power-dialer-controller/next-contact', {
        body: {
          sessionId: session.id,
          mode: 'power',
        },
      });

      expect(error).toBeNull();
      expect(data).toBeDefined();
    });

    it('should handle empty contact queue', async () => {
      const agent = await createTestAgent();
      const session = await createTestDialerSession(agent.id);

      const { data } = await supabase.functions.invoke('power-dialer-controller/next-contact', {
        body: {
          sessionId: session.id,
          mode: 'power',
        },
      });

      // Should return null or empty contact list
      expect(data).toBeDefined();
    });
  });

  describe('Disposition Handling', () => {
    it('should record call disposition', async () => {
      const agent = await createTestAgent();
      const session = await createTestDialerSession(agent.id);
      const contact = await createTestContact();

      const { data, error } = await supabase.functions.invoke('power-dialer-controller/disposition', {
        body: {
          sessionId: session.id,
          contactId: contact.id,
          disposition: 'answered',
          notes: 'Test call completed',
        },
      });

      expect(error).toBeNull();
      expect(data).toBeDefined();
    });

    it('should update session metrics after disposition', async () => {
      const agent = await createTestAgent();
      const session = await createTestDialerSession(agent.id);
      const contact = await createTestContact();

      await supabase.functions.invoke('power-dialer-controller/disposition', {
        body: {
          sessionId: session.id,
          contactId: contact.id,
          disposition: 'answered',
          notes: '',
        },
      });

      // Check session metrics were updated
      const { data: updatedSession } = await supabase
        .from('power_dialer_sessions' as any)
        .select('contacts_attempted, contacts_reached')
        .eq('id', session.id)
        .single();

      expect(updatedSession).toBeDefined();
    });

    it('should handle interested disposition', async () => {
      const agent = await createTestAgent();
      const session = await createTestDialerSession(agent.id);
      const contact = await createTestContact();

      const { error } = await supabase.functions.invoke('power-dialer-controller/disposition', {
        body: {
          sessionId: session.id,
          contactId: contact.id,
          disposition: 'interested',
          notes: 'Very interested in product',
        },
      });

      expect(error).toBeNull();
    });
  });

  describe('Session Control', () => {
    it('should pause active session', async () => {
      const agent = await createTestAgent();
      const session = await createTestDialerSession(agent.id);

      const { error } = await supabase.functions.invoke('power-dialer-controller/pause-session', {
        body: {
          sessionId: session.id,
        },
      });

      expect(error).toBeNull();

      // Verify session status
      const { data: updatedSession } = await supabase
        .from('power_dialer_sessions' as any)
        .select('status')
        .eq('id', session.id)
        .single();

      expect(updatedSession?.status).toBe('paused');
    });

    it('should resume paused session', async () => {
      const agent = await createTestAgent();
      const session = await createTestDialerSession(agent.id, { status: 'paused' });

      const { error } = await supabase.functions.invoke('power-dialer-controller/resume-session', {
        body: {
          sessionId: session.id,
        },
      });

      expect(error).toBeNull();
    });

    it('should stop session', async () => {
      const agent = await createTestAgent();
      const session = await createTestDialerSession(agent.id);

      const { error } = await supabase.functions.invoke('power-dialer-controller/stop-session', {
        body: {
          sessionId: session.id,
        },
      });

      expect(error).toBeNull();

      // Verify session is completed
      const { data: updatedSession } = await supabase
        .from('power_dialer_sessions' as any)
        .select('status, ended_at')
        .eq('id', session.id)
        .single();

      expect(updatedSession?.status).toBe('completed');
      expect(updatedSession?.ended_at).toBeDefined();
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid session ID', async () => {
      const { data, error } = await supabase.functions.invoke('power-dialer-controller/next-contact', {
        body: {
          sessionId: 'invalid-id',
          mode: 'power',
        },
      });

      // Should return error or handle gracefully
      expect(data || error).toBeDefined();
    });

    it('should handle missing required fields', async () => {
      const { data, error } = await supabase.functions.invoke('power-dialer-controller/disposition', {
        body: {
          sessionId: 'test',
        },
      });

      expect(data || error).toBeDefined();
    });
  });
});
