/**
 * Unmatched Inbox Page
 * Shows inbound messages/calls that didn't match an existing contact
 */

import { useState } from 'react';
import { GlobalLayout } from '@/shared/components/layout/GlobalLayout';
import { UnmatchedInboxList } from '@/components/communications/UnmatchedInboxList';
import { UnmatchedInboxDetail } from '@/components/communications/UnmatchedInboxDetail';
import { Inbox } from 'lucide-react';

export interface UnmatchedInboundItem {
  id: string;
  tenant_id: string;
  from_e164: string;
  to_e164: string;
  channel: 'sms' | 'call';
  body: string | null;
  state: 'open' | 'linked' | 'ignored';
  event_type: string | null;
  received_at: string;
  notes: string | null;
  contact_id: string | null;
  conversation_id: string | null;
  location_id: string | null;
  media: any;
  raw_payload: any;
  location_name?: string | null;
  location_did?: string | null;
}

const UnmatchedInboxPage = () => {
  const [selectedItem, setSelectedItem] = useState<UnmatchedInboundItem | null>(null);

  const handleItemLinked = () => {
    // Clear selection and refresh list
    setSelectedItem(null);
  };

  return (
    <GlobalLayout>
      <div className="h-[calc(100vh-8rem)] flex flex-col">
        {/* Header */}
        <div className="border-b px-4 py-3 shrink-0">
          <div className="flex items-center gap-3">
            <Inbox className="h-5 w-5 text-muted-foreground" />
            <h1 className="text-xl font-semibold">Unmatched Inbox</h1>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Inbound messages and calls that haven't been linked to a contact
          </p>
        </div>

        {/* Main Content - Split View */}
        <div className="flex-1 flex overflow-hidden">
          {/* List Panel */}
          <div className="w-1/2 border-r overflow-hidden">
            <UnmatchedInboxList
              selectedId={selectedItem?.id}
              onSelect={setSelectedItem}
            />
          </div>

          {/* Detail Panel */}
          <div className="w-1/2 overflow-hidden">
            {selectedItem ? (
              <UnmatchedInboxDetail
                item={selectedItem}
                onLinked={handleItemLinked}
              />
            ) : (
              <div className="h-full flex items-center justify-center text-muted-foreground">
                <div className="text-center">
                  <Inbox className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>Select an item to view details</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </GlobalLayout>
  );
};

export default UnmatchedInboxPage;
