/**
 * Power Dialer Integration Tests
 * Phase 1 - Week 1-2: Testing Infrastructure
 * Tests complete user flows from session start to completion
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { supabase } from '@/integrations/supabase/client';
import {
  createTestAgent,
  createTestDialerSession,
  cleanupPowerDialerData,
  getSessionMetrics,
} from '../utils/power-dialer-helpers';
import { createTestContact, cleanupTestData } from '../utils/db-helpers';

describe('Power Dialer Complete Flow Integration', () => {
  beforeEach(async () => {
    await cleanupPowerDialerData();
    await cleanupTestData();
  });

  afterEach(async () => {
    await cleanupPowerDialerData();
    await cleanupTestData();
  });

  it('should complete full dialing session workflow', async () => {
    // Step 1: Create AI agent
    const agent = await createTestAgent();
    expect(agent).toBeDefined();

    // Step 2: Create test contacts
    const contact1 = await createTestContact({ first_name: 'John', last_name: 'Doe' });
    const contact2 = await createTestContact({ first_name: 'Jane', last_name: 'Smith' });
    expect(contact1).toBeDefined();
    expect(contact2).toBeDefined();

    // Step 3: Start dialing session
    const { data: startData } = await supabase.functions.invoke('power-dialer-controller/start-session', {
      body: {
        mode: 'power',
        campaignId: null,
      },
    });

    const session = startData?.session;
    expect(session).toBeDefined();
    expect(session.status).toBe('active');

    // Step 4: Get first contact
    const { data: firstContact } = await supabase.functions.invoke('power-dialer-controller/next-contact', {
      body: {
        sessionId: session.id,
        mode: 'power',
      },
    });

    expect(firstContact?.contact).toBeDefined();

    // Step 5: Record disposition for first call
    await supabase.functions.invoke('power-dialer-controller/disposition', {
      body: {
        sessionId: session.id,
        contactId: contact1.id,
        disposition: 'answered',
        notes: 'Spoke with contact',
      },
    });

    // Step 6: Verify session metrics updated
    let metrics = await getSessionMetrics(session.id);
    expect(metrics.contacts_attempted).toBeGreaterThan(0);

    // Step 7: Get second contact
    const { data: secondContact } = await supabase.functions.invoke('power-dialer-controller/next-contact', {
      body: {
        sessionId: session.id,
        mode: 'power',
      },
    });

    expect(secondContact).toBeDefined();

    // Step 8: Record interested disposition
    await supabase.functions.invoke('power-dialer-controller/disposition', {
      body: {
        sessionId: session.id,
        contactId: contact2.id,
        disposition: 'interested',
        notes: 'Very interested, schedule follow-up',
      },
    });

    // Step 9: Verify conversion count increased
    metrics = await getSessionMetrics(session.id);
    expect(metrics.contacts_converted).toBeGreaterThan(0);

    // Step 10: Pause session
    await supabase.functions.invoke('power-dialer-controller/pause-session', {
      body: {
        sessionId: session.id,
      },
    });

    const { data: pausedSession } = await supabase
      .from('power_dialer_sessions' as any)
      .select('status')
      .eq('id', session.id)
      .single();

    expect(pausedSession.status).toBe('paused');

    // Step 11: Resume session
    await supabase.functions.invoke('power-dialer-controller/resume-session', {
      body: {
        sessionId: session.id,
      },
    });

    // Step 12: Stop session
    await supabase.functions.invoke('power-dialer-controller/stop-session', {
      body: {
        sessionId: session.id,
      },
    });

    const { data: completedSession } = await supabase
      .from('power_dialer_sessions' as any)
      .select('status, ended_at')
      .eq('id', session.id)
      .single();

    expect(completedSession.status).toBe('completed');
    expect(completedSession.ended_at).toBeDefined();
  });

  it('should handle session with no contacts available', async () => {
    const agent = await createTestAgent();

    const { data: startData } = await supabase.functions.invoke('power-dialer-controller/start-session', {
      body: {
        mode: 'power',
        campaignId: null,
      },
    });

    const session = startData?.session;

    const { data: noContact } = await supabase.functions.invoke('power-dialer-controller/next-contact', {
      body: {
        sessionId: session.id,
        mode: 'power',
      },
    });

    // Should handle gracefully
    expect(noContact).toBeDefined();
  });

  it('should track multiple dispositions correctly', async () => {
    const agent = await createTestAgent();
    const session = await createTestDialerSession(agent.id);
    
    const contacts = await Promise.all([
      createTestContact({ first_name: 'Contact1' }),
      createTestContact({ first_name: 'Contact2' }),
      createTestContact({ first_name: 'Contact3' }),
    ]);

    // Record various dispositions
    await supabase.functions.invoke('power-dialer-controller/disposition', {
      body: {
        sessionId: session.id,
        contactId: contacts[0].id,
        disposition: 'answered',
        notes: '',
      },
    });

    await supabase.functions.invoke('power-dialer-controller/disposition', {
      body: {
        sessionId: session.id,
        contactId: contacts[1].id,
        disposition: 'voicemail',
        notes: '',
      },
    });

    await supabase.functions.invoke('power-dialer-controller/disposition', {
      body: {
        sessionId: session.id,
        contactId: contacts[2].id,
        disposition: 'interested',
        notes: '',
      },
    });

    const metrics = await getSessionMetrics(session.id);
    
    expect(metrics.contacts_attempted).toBeGreaterThanOrEqual(3);
  });
});
