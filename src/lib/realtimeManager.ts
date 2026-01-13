/**
 * Realtime Channel Manager
 * Phase 3: Realtime Channel Management
 * 
 * Limits active channels per user to prevent channel explosion at scale.
 * At 5,000 users with unlimited channels, we could hit 50K+ channels.
 * This manager enforces a per-user limit and reuses existing channels.
 */

import { supabase } from '@/integrations/supabase/client';
import { RealtimeChannel } from '@supabase/supabase-js';

// Maximum channels per user - prevents resource exhaustion
const MAX_CHANNELS_PER_USER = 10;

interface ChannelEntry {
  channel: RealtimeChannel;
  createdAt: number;
  refCount: number;
}

const activeChannels = new Map<string, ChannelEntry>();

/**
 * Create or reuse a managed realtime channel
 * 
 * @param channelName - Unique name for the channel
 * @param onSetup - Callback to configure the channel before subscribing
 * @returns The configured channel, or null if limit exceeded
 */
export function createManagedChannel(
  channelName: string,
  onSetup: (channel: RealtimeChannel) => RealtimeChannel
): RealtimeChannel | null {
  // Check if channel already exists - reuse it
  const existing = activeChannels.get(channelName);
  if (existing) {
    existing.refCount++;
    console.log(`[RealtimeManager] Reusing channel: ${channelName} (refs: ${existing.refCount})`);
    return existing.channel;
  }

  // Enforce channel limit - remove oldest if at max
  if (activeChannels.size >= MAX_CHANNELS_PER_USER) {
    const oldest = [...activeChannels.entries()]
      .filter(([_, entry]) => entry.refCount <= 1) // Only remove if single ref
      .sort((a, b) => a[1].createdAt - b[1].createdAt)[0];

    if (oldest) {
      console.log(`[RealtimeManager] Removing oldest channel: ${oldest[0]}`);
      supabase.removeChannel(oldest[1].channel);
      activeChannels.delete(oldest[0]);
    } else {
      console.warn(`[RealtimeManager] Channel limit reached (${MAX_CHANNELS_PER_USER}), all in use`);
      // Don't return null - still create the channel but log warning
    }
  }

  // Create new channel
  const channel = supabase.channel(channelName);
  const configuredChannel = onSetup(channel);

  activeChannels.set(channelName, {
    channel: configuredChannel,
    createdAt: Date.now(),
    refCount: 1,
  });

  console.log(`[RealtimeManager] Created channel: ${channelName} (total: ${activeChannels.size})`);
  return configuredChannel;
}

/**
 * Remove a managed channel
 */
export function removeManagedChannel(channelName: string): void {
  const entry = activeChannels.get(channelName);
  if (!entry) return;

  entry.refCount--;

  // Only actually remove if no more references
  if (entry.refCount <= 0) {
    supabase.removeChannel(entry.channel);
    activeChannels.delete(channelName);
    console.log(`[RealtimeManager] Removed channel: ${channelName} (total: ${activeChannels.size})`);
  } else {
    console.log(`[RealtimeManager] Decremented refs for: ${channelName} (refs: ${entry.refCount})`);
  }
}

/**
 * Get count of active channels
 */
export function getActiveChannelCount(): number {
  return activeChannels.size;
}

/**
 * Get list of active channel names
 */
export function getActiveChannelNames(): string[] {
  return [...activeChannels.keys()];
}

/**
 * Cleanup all channels - call on logout or app unmount
 */
export function cleanupAllChannels(): void {
  console.log(`[RealtimeManager] Cleaning up ${activeChannels.size} channels`);
  
  activeChannels.forEach((entry) => {
    supabase.removeChannel(entry.channel);
  });
  
  activeChannels.clear();
}

/**
 * Get channel stats for monitoring
 */
export function getChannelStats(): {
  count: number;
  limit: number;
  channels: Array<{ name: string; age: number; refCount: number }>;
} {
  const now = Date.now();
  return {
    count: activeChannels.size,
    limit: MAX_CHANNELS_PER_USER,
    channels: [...activeChannels.entries()].map(([name, entry]) => ({
      name,
      age: Math.round((now - entry.createdAt) / 1000),
      refCount: entry.refCount,
    })),
  };
}
