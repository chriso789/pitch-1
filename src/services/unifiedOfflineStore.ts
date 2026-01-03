import { openDB, DBSchema, IDBPDatabase } from 'idb';

// Types for all offline data
export interface OfflineVoiceNote {
  id: string;
  propertyId: string;
  contactId?: string;
  audioBlob: Blob;
  duration: number;
  timestamp: string;
  latitude?: number;
  longitude?: number;
  transcription?: string;
  transcriptionStatus: 'pending' | 'transcribed' | 'failed';
  retryCount: number;
  syncStatus: 'pending' | 'syncing' | 'synced' | 'failed';
}

export interface OfflinePhoto {
  id: string;
  propertyId: string;
  contactId?: string;
  imageBlob: Blob;
  thumbnailBlob?: Blob;
  category: 'before' | 'after' | 'damage' | 'general';
  notes?: string;
  timestamp: string;
  latitude?: number;
  longitude?: number;
  damageAnalysis?: DamageAnalysisResult;
  retryCount: number;
  syncStatus: 'pending' | 'syncing' | 'synced' | 'failed';
}

export interface OfflineDisposition {
  id: string;
  propertyId: string;
  contactId?: string;
  disposition: string;
  notes?: string;
  timestamp: string;
  latitude?: number;
  longitude?: number;
  userId: string;
  retryCount: number;
  syncStatus: 'pending' | 'syncing' | 'synced' | 'failed';
}

export interface OfflineLead {
  id: string;
  firstName: string;
  lastName: string;
  phone?: string;
  email?: string;
  address: string;
  city?: string;
  state?: string;
  zip?: string;
  latitude?: number;
  longitude?: number;
  notes?: string;
  source: string;
  timestamp: string;
  retryCount: number;
  syncStatus: 'pending' | 'syncing' | 'synced' | 'failed';
}

export interface OfflineDoorKnock {
  id: string;
  propertyId: string;
  contactId?: string;
  outcome: string;
  notes?: string;
  timestamp: string;
  latitude?: number;
  longitude?: number;
  userId: string;
  retryCount: number;
  syncStatus: 'pending' | 'syncing' | 'synced' | 'failed';
}

export interface DamageAnalysisResult {
  damageDetected: boolean;
  damageTypes: Array<{
    type: string;
    confidence: number;
    severity: 'minor' | 'moderate' | 'severe';
    location?: { x: number; y: number; width: number; height: number };
    description: string;
  }>;
  overallSeverity: 'minor' | 'moderate' | 'severe' | 'none';
  estimatedCostMin: number;
  estimatedCostMax: number;
  confidence: number;
  recommendations: string[];
}

export interface SyncProgress {
  type: string;
  total: number;
  completed: number;
  failed: number;
  currentItem?: string;
}

interface UnifiedOfflineDB extends DBSchema {
  voiceNotes: {
    key: string;
    value: OfflineVoiceNote;
    indexes: { 'by-status': string; 'by-property': string; 'by-timestamp': string };
  };
  photos: {
    key: string;
    value: OfflinePhoto;
    indexes: { 'by-status': string; 'by-property': string; 'by-timestamp': string };
  };
  dispositions: {
    key: string;
    value: OfflineDisposition;
    indexes: { 'by-status': string; 'by-property': string; 'by-timestamp': string };
  };
  leads: {
    key: string;
    value: OfflineLead;
    indexes: { 'by-status': string; 'by-timestamp': string };
  };
  doorKnocks: {
    key: string;
    value: OfflineDoorKnock;
    indexes: { 'by-status': string; 'by-property': string; 'by-timestamp': string };
  };
  syncLog: {
    key: string;
    value: {
      id: string;
      type: string;
      itemId: string;
      action: 'sync_start' | 'sync_success' | 'sync_failed';
      timestamp: string;
      error?: string;
    };
    indexes: { 'by-timestamp': string };
  };
}

// Priority order for sync (most important first)
type SyncableStore = 'leads' | 'dispositions' | 'doorKnocks' | 'photos' | 'voiceNotes';
const SYNC_PRIORITY: SyncableStore[] = [
  'leads',
  'dispositions',
  'doorKnocks',
  'photos',
  'voiceNotes',
];

class UnifiedOfflineStore {
  private db: IDBPDatabase<UnifiedOfflineDB> | null = null;
  private syncInProgress = false;
  private syncCallbacks: Set<(progress: SyncProgress) => void> = new Set();

  async initialize(): Promise<void> {
    if (this.db) return;

    this.db = await openDB<UnifiedOfflineDB>('unified-offline-store', 1, {
      upgrade(db) {
        // Voice notes store
        if (!db.objectStoreNames.contains('voiceNotes')) {
          const store = db.createObjectStore('voiceNotes', { keyPath: 'id' });
          store.createIndex('by-status', 'syncStatus');
          store.createIndex('by-property', 'propertyId');
          store.createIndex('by-timestamp', 'timestamp');
        }

        // Photos store
        if (!db.objectStoreNames.contains('photos')) {
          const store = db.createObjectStore('photos', { keyPath: 'id' });
          store.createIndex('by-status', 'syncStatus');
          store.createIndex('by-property', 'propertyId');
          store.createIndex('by-timestamp', 'timestamp');
        }

        // Dispositions store
        if (!db.objectStoreNames.contains('dispositions')) {
          const store = db.createObjectStore('dispositions', { keyPath: 'id' });
          store.createIndex('by-status', 'syncStatus');
          store.createIndex('by-property', 'propertyId');
          store.createIndex('by-timestamp', 'timestamp');
        }

        // Leads store
        if (!db.objectStoreNames.contains('leads')) {
          const store = db.createObjectStore('leads', { keyPath: 'id' });
          store.createIndex('by-status', 'syncStatus');
          store.createIndex('by-timestamp', 'timestamp');
        }

        // Door knocks store
        if (!db.objectStoreNames.contains('doorKnocks')) {
          const store = db.createObjectStore('doorKnocks', { keyPath: 'id' });
          store.createIndex('by-status', 'syncStatus');
          store.createIndex('by-property', 'propertyId');
          store.createIndex('by-timestamp', 'timestamp');
        }

        // Sync log store
        if (!db.objectStoreNames.contains('syncLog')) {
          const store = db.createObjectStore('syncLog', { keyPath: 'id' });
          store.createIndex('by-timestamp', 'timestamp');
        }
      },
    });
  }

  // Voice Notes
  async saveVoiceNote(note: Omit<OfflineVoiceNote, 'id' | 'retryCount' | 'syncStatus'>): Promise<string> {
    await this.initialize();
    const id = crypto.randomUUID();
    const voiceNote: OfflineVoiceNote = {
      ...note,
      id,
      retryCount: 0,
      syncStatus: 'pending',
    };
    await this.db!.put('voiceNotes', voiceNote);
    return id;
  }

  async getVoiceNotesByProperty(propertyId: string): Promise<OfflineVoiceNote[]> {
    await this.initialize();
    return this.db!.getAllFromIndex('voiceNotes', 'by-property', propertyId);
  }

  async getPendingVoiceNotes(): Promise<OfflineVoiceNote[]> {
    await this.initialize();
    return this.db!.getAllFromIndex('voiceNotes', 'by-status', 'pending');
  }

  // Photos
  async savePhoto(photo: Omit<OfflinePhoto, 'id' | 'retryCount' | 'syncStatus'>): Promise<string> {
    await this.initialize();
    const id = crypto.randomUUID();
    const offlinePhoto: OfflinePhoto = {
      ...photo,
      id,
      retryCount: 0,
      syncStatus: 'pending',
    };
    await this.db!.put('photos', offlinePhoto);
    return id;
  }

  async getPhotosByProperty(propertyId: string): Promise<OfflinePhoto[]> {
    await this.initialize();
    return this.db!.getAllFromIndex('photos', 'by-property', propertyId);
  }

  async getPendingPhotos(): Promise<OfflinePhoto[]> {
    await this.initialize();
    return this.db!.getAllFromIndex('photos', 'by-status', 'pending');
  }

  // Dispositions
  async saveDisposition(disposition: Omit<OfflineDisposition, 'id' | 'retryCount' | 'syncStatus'>): Promise<string> {
    await this.initialize();
    const id = crypto.randomUUID();
    const offlineDisposition: OfflineDisposition = {
      ...disposition,
      id,
      retryCount: 0,
      syncStatus: 'pending',
    };
    await this.db!.put('dispositions', offlineDisposition);
    return id;
  }

  async getPendingDispositions(): Promise<OfflineDisposition[]> {
    await this.initialize();
    return this.db!.getAllFromIndex('dispositions', 'by-status', 'pending');
  }

  // Leads
  async saveLead(lead: Omit<OfflineLead, 'id' | 'retryCount' | 'syncStatus'>): Promise<string> {
    await this.initialize();
    const id = crypto.randomUUID();
    const offlineLead: OfflineLead = {
      ...lead,
      id,
      retryCount: 0,
      syncStatus: 'pending',
    };
    await this.db!.put('leads', offlineLead);
    return id;
  }

  async getPendingLeads(): Promise<OfflineLead[]> {
    await this.initialize();
    return this.db!.getAllFromIndex('leads', 'by-status', 'pending');
  }

  // Door Knocks
  async saveDoorKnock(knock: Omit<OfflineDoorKnock, 'id' | 'retryCount' | 'syncStatus'>): Promise<string> {
    await this.initialize();
    const id = crypto.randomUUID();
    const offlineKnock: OfflineDoorKnock = {
      ...knock,
      id,
      retryCount: 0,
      syncStatus: 'pending',
    };
    await this.db!.put('doorKnocks', offlineKnock);
    return id;
  }

  async getPendingDoorKnocks(): Promise<OfflineDoorKnock[]> {
    await this.initialize();
    return this.db!.getAllFromIndex('doorKnocks', 'by-status', 'pending');
  }

  // Get all pending counts
  async getPendingCounts(): Promise<Record<SyncableStore, number>> {
    await this.initialize();
    const counts: Record<SyncableStore, number> = {
      leads: 0,
      dispositions: 0,
      doorKnocks: 0,
      photos: 0,
      voiceNotes: 0,
    };
    
    for (const store of SYNC_PRIORITY) {
      const pending = await this.db!.getAllFromIndex(store, 'by-status', 'pending');
      counts[store] = pending.length;
    }
    
    return counts;
  }

  async getTotalPendingCount(): Promise<number> {
    const counts = await this.getPendingCounts();
    return Object.values(counts).reduce((a, b) => a + b, 0);
  }

  // Update item status
  private async updateStatus(
    store: SyncableStore,
    id: string,
    status: 'pending' | 'syncing' | 'synced' | 'failed',
    error?: string
  ): Promise<void> {
    await this.initialize();
    const item = await this.db!.get(store, id);
    if (item) {
      (item as any).syncStatus = status;
      if (status === 'syncing' || status === 'failed') {
        (item as any).retryCount = ((item as any).retryCount || 0) + 1;
      }
      await this.db!.put(store, item);

      // Log sync event
      await this.db!.put('syncLog', {
        id: crypto.randomUUID(),
        type: store as string,
        itemId: id,
        action: status === 'synced' ? 'sync_success' : status === 'failed' ? 'sync_failed' : 'sync_start',
        timestamp: new Date().toISOString(),
        error,
      });
    }
  }

  // Remove synced item
  private async removeSyncedItem(store: SyncableStore, id: string): Promise<void> {
    await this.initialize();
    await this.db!.delete(store, id);
  }

  // Subscribe to sync progress
  onSyncProgress(callback: (progress: SyncProgress) => void): () => void {
    this.syncCallbacks.add(callback);
    return () => this.syncCallbacks.delete(callback);
  }

  private notifyProgress(progress: SyncProgress): void {
    this.syncCallbacks.forEach(cb => cb(progress));
  }

  // Main sync function
  async syncAll(): Promise<{ success: number; failed: number; total: number }> {
    if (this.syncInProgress) {
      console.log('Sync already in progress');
      return { success: 0, failed: 0, total: 0 };
    }

    this.syncInProgress = true;
    let totalSuccess = 0;
    let totalFailed = 0;
    let totalItems = 0;

    try {
      const { supabase } = await import('@/integrations/supabase/client');

      for (const store of SYNC_PRIORITY) {
        const pending = await this.db!.getAllFromIndex(store, 'by-status', 'pending');
        totalItems += pending.length;

        this.notifyProgress({
          type: store as string,
          total: pending.length,
          completed: 0,
          failed: 0,
        });

        let completed = 0;
        let failed = 0;

        for (const item of pending) {
          const itemAny = item as any;
          if (itemAny.retryCount >= 5) {
            await this.updateStatus(store, itemAny.id, 'failed', 'Max retries exceeded');
            failed++;
            totalFailed++;
            continue;
          }

          try {
            await this.updateStatus(store, itemAny.id, 'syncing');

            switch (store) {
              case 'leads':
                await this.syncLead(supabase, item as OfflineLead);
                break;
              case 'dispositions':
                await this.syncDisposition(supabase, item as OfflineDisposition);
                break;
              case 'doorKnocks':
                await this.syncDoorKnock(supabase, item as OfflineDoorKnock);
                break;
              case 'photos':
                await this.syncPhoto(supabase, item as OfflinePhoto);
                break;
              case 'voiceNotes':
                await this.syncVoiceNote(supabase, item as OfflineVoiceNote);
                break;
            }

            await this.removeSyncedItem(store, itemAny.id);
            completed++;
            totalSuccess++;
          } catch (error: any) {
            console.error(`Sync error for ${store}:`, itemAny.id, error);
            await this.updateStatus(store, itemAny.id, 'failed', error.message);
            failed++;
            totalFailed++;
          }

          this.notifyProgress({
            type: store as string,
            total: pending.length,
            completed,
            failed,
            currentItem: itemAny.id,
          });
        }
      }
    } finally {
      this.syncInProgress = false;
    }

    return { success: totalSuccess, failed: totalFailed, total: totalItems };
  }

  private async syncLead(supabase: any, lead: OfflineLead): Promise<void> {
    const { error } = await supabase.from('contacts').insert({
      first_name: lead.firstName,
      last_name: lead.lastName,
      phone: lead.phone,
      email: lead.email,
      address_street: lead.address,
      address_city: lead.city,
      address_state: lead.state,
      address_zip: lead.zip,
      latitude: lead.latitude,
      longitude: lead.longitude,
      notes: lead.notes,
      lead_source: lead.source,
    });
    if (error) throw error;
  }

  private async syncDisposition(supabase: any, disposition: OfflineDisposition): Promise<void> {
    const { error } = await supabase.functions.invoke('canvass-dispositions', {
      body: {
        property_id: disposition.propertyId,
        contact_id: disposition.contactId,
        disposition: disposition.disposition,
        notes: disposition.notes,
        latitude: disposition.latitude,
        longitude: disposition.longitude,
      },
    });
    if (error) throw error;
  }

  private async syncDoorKnock(supabase: any, knock: OfflineDoorKnock): Promise<void> {
    const { error } = await supabase.from('canvass_activity_log').insert({
      activity_type: 'door_knock',
      location_id: knock.propertyId,
      contact_id: knock.contactId,
      user_id: knock.userId,
      latitude: knock.latitude,
      longitude: knock.longitude,
      activity_data: {
        outcome: knock.outcome,
        notes: knock.notes,
        offline_timestamp: knock.timestamp,
      },
    });
    if (error) throw error;
  }

  private async syncPhoto(supabase: any, photo: OfflinePhoto): Promise<void> {
    // Upload to storage
    const fileName = `${photo.propertyId}/${photo.id}.jpg`;
    const { error: uploadError } = await supabase.storage
      .from('canvass-photos')
      .upload(fileName, photo.imageBlob, { contentType: 'image/jpeg' });
    
    if (uploadError) throw uploadError;

    // Get public URL
    const { data: urlData } = supabase.storage
      .from('canvass-photos')
      .getPublicUrl(fileName);

    // Log activity
    const { error: activityError } = await supabase.from('canvass_activity_log').insert({
      activity_type: 'photo_capture',
      location_id: photo.propertyId,
      contact_id: photo.contactId,
      latitude: photo.latitude,
      longitude: photo.longitude,
      activity_data: {
        photo_url: urlData.publicUrl,
        category: photo.category,
        notes: photo.notes,
        damage_analysis: photo.damageAnalysis,
        offline_timestamp: photo.timestamp,
      },
    });
    if (activityError) throw activityError;
  }

  private async syncVoiceNote(supabase: any, note: OfflineVoiceNote): Promise<void> {
    // Upload audio to storage
    const fileName = `${note.propertyId}/voice-notes/${note.id}.webm`;
    const { error: uploadError } = await supabase.storage
      .from('canvass-media')
      .upload(fileName, note.audioBlob, { contentType: 'audio/webm' });
    
    if (uploadError) throw uploadError;

    // Get public URL
    const { data: urlData } = supabase.storage
      .from('canvass-media')
      .getPublicUrl(fileName);

    // Transcribe if needed
    let transcription = note.transcription;
    if (!transcription && note.transcriptionStatus === 'pending') {
      try {
        const base64Audio = await this.blobToBase64(note.audioBlob);
        const { data: transcribeData } = await supabase.functions.invoke('voice-transcribe', {
          body: { audio: base64Audio },
        });
        transcription = transcribeData?.transcription;
      } catch (e) {
        console.warn('Transcription failed during sync:', e);
      }
    }

    // Log activity
    const { error: activityError } = await supabase.from('canvass_activity_log').insert({
      activity_type: 'voice_note',
      location_id: note.propertyId,
      contact_id: note.contactId,
      latitude: note.latitude,
      longitude: note.longitude,
      activity_data: {
        voice_note_url: urlData.publicUrl,
        duration: note.duration,
        transcription,
        offline_timestamp: note.timestamp,
      },
    });
    if (activityError) throw activityError;
  }

  private blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64 = (reader.result as string).split(',')[1];
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  // Storage management
  async getStorageUsage(): Promise<{ used: number; available: number }> {
    if ('storage' in navigator && 'estimate' in navigator.storage) {
      const estimate = await navigator.storage.estimate();
      return {
        used: estimate.usage || 0,
        available: estimate.quota || 0,
      };
    }
    return { used: 0, available: 0 };
  }

  async clearSyncedItems(): Promise<void> {
    await this.initialize();
    for (const store of SYNC_PRIORITY) {
      const synced = await this.db!.getAllFromIndex(store, 'by-status', 'synced');
      for (const item of synced) {
        await this.db!.delete(store, (item as any).id);
      }
    }
  }

  async clearAllData(): Promise<void> {
    await this.initialize();
    for (const store of [...SYNC_PRIORITY, 'syncLog'] as const) {
      await this.db!.clear(store);
    }
  }
}

export const unifiedOfflineStore = new UnifiedOfflineStore();
