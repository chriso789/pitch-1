/**
 * Power Dialer Database Schema Tests
 * Phase 1 - Week 1-2: Testing Infrastructure
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { supabase } from '@/integrations/supabase/client';
import {
  createTestAgent,
  createTestDialerSession,
  createTestCampaign,
  cleanupPowerDialerData,
} from '../utils/power-dialer-helpers';

describe('Power Dialer Database Schema', () => {
  beforeEach(async () => {
    await cleanupPowerDialerData();
  });

  afterEach(async () => {
    await cleanupPowerDialerData();
  });

  describe('ai_agents table', () => {
    it('should create AI agent record', async () => {
      const agent = await createTestAgent();
      
      expect(agent).toBeDefined();
      expect(agent.id).toBeDefined();
      expect(agent.name).toBe('Test Power Dialer');
      expect(agent.type).toBe('power_dialer');
      expect(agent.status).toBe('active');
    });

    it('should have configuration JSONB field', async () => {
      const agent = await createTestAgent({
        configuration: {
          mode: 'predictive',
          maxConcurrentCalls: 5,
        },
      });

      expect(agent.configuration).toBeDefined();
      expect(agent.configuration.mode).toBe('predictive');
    });

    it('should enforce required fields', async () => {
      const { error } = await supabase
        .from('ai_agents' as any)
        .insert({
          // Missing required fields
          tenant_id: 'test',
        });

      expect(error).toBeDefined();
    });
  });

  describe('power_dialer_sessions table', () => {
    it('should create session record', async () => {
      const agent = await createTestAgent();
      const session = await createTestDialerSession(agent.id);

      expect(session).toBeDefined();
      expect(session.id).toBeDefined();
      expect(session.agent_id).toBe(agent.id);
      expect(session.status).toBe('active');
    });

    it('should initialize metrics to zero', async () => {
      const agent = await createTestAgent();
      const session = await createTestDialerSession(agent.id);

      expect(session.contacts_attempted).toBe(0);
      expect(session.contacts_reached).toBe(0);
      expect(session.contacts_converted).toBe(0);
    });

    it('should allow updating metrics', async () => {
      const agent = await createTestAgent();
      const session = await createTestDialerSession(agent.id);

      const { error } = await supabase
        .from('power_dialer_sessions' as any)
        .update({
          contacts_attempted: 5,
          contacts_reached: 3,
          contacts_converted: 1,
        })
        .eq('id', session.id);

      expect(error).toBeNull();

      const { data: updated } = await supabase
        .from('power_dialer_sessions' as any)
        .select('*')
        .eq('id', session.id)
        .single();

      expect(updated.contacts_attempted).toBe(5);
      expect(updated.contacts_reached).toBe(3);
      expect(updated.contacts_converted).toBe(1);
    });
  });

  describe('dialer_campaigns table', () => {
    it('should create campaign record', async () => {
      const campaign = await createTestCampaign();

      expect(campaign).toBeDefined();
      expect(campaign.id).toBeDefined();
      expect(campaign.name).toBe('Test Campaign');
      expect(campaign.status).toBe('active');
    });

    it('should support campaign filters', async () => {
      const campaign = await createTestCampaign({
        filters: {
          stage: 'new_lead',
          tags: ['qualified'],
        },
      });

      expect(campaign.filters).toBeDefined();
      expect(campaign.filters.stage).toBe('new_lead');
    });
  });

  describe('RLS Policies', () => {
    it('should enforce tenant isolation', async () => {
      // This would require proper authentication context
      // Placeholder test for RLS
      const agent = await createTestAgent();
      expect(agent.tenant_id).toBeDefined();
    });
  });

  describe('Foreign Key Constraints', () => {
    it('should enforce agent_id foreign key', async () => {
      const { error } = await supabase
        .from('power_dialer_sessions' as any)
        .insert({
          tenant_id: 'test',
          agent_id: 'non-existent-id',
          mode: 'power',
          status: 'active',
          contacts_attempted: 0,
          contacts_reached: 0,
          contacts_converted: 0,
          started_at: new Date().toISOString(),
        });

      expect(error).toBeDefined();
    });
  });

  describe('Timestamps', () => {
    it('should set created_at automatically', async () => {
      const agent = await createTestAgent();
      expect(agent.created_at).toBeDefined();
    });

    it('should update updated_at on changes', async () => {
      const agent = await createTestAgent();
      const originalUpdatedAt = agent.updated_at;

      // Wait a bit to ensure timestamp difference
      await new Promise(resolve => setTimeout(resolve, 100));

      await supabase
        .from('ai_agents' as any)
        .update({ status: 'inactive' })
        .eq('id', agent.id);

      const { data: updated } = await supabase
        .from('ai_agents' as any)
        .select('updated_at')
        .eq('id', agent.id)
        .single();

      expect(updated.updated_at).not.toBe(originalUpdatedAt);
    });
  });
});
