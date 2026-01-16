/**
 * Follow Up Hub
 * Central dashboard for follow-ups and communications - SMS, Calls, Voicemail, Recordings, Email Activity
 */

import { useState } from 'react';
import { 
  Phone, MessageSquare, Voicemail, Mic, PhoneCall,
  Inbox, Settings, RefreshCw, Mail
} from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { UnifiedInbox } from '@/components/communications/UnifiedInbox';
import { SMSThreadList } from '@/components/communications/SMSThreadList';
import { SMSConversationThread } from '@/components/communications/SMSConversationThread';
import { RecordingLibrary } from '@/components/communications/RecordingLibrary';
import { GlobalSoftphone } from '@/components/communications/GlobalSoftphone';
import { SoftphonePanel } from '@/components/telephony/SoftphonePanel';
import { EmailActivityDashboard } from '@/components/communications/EmailActivityDashboard';
import { useCommunications, SMSThread, UnifiedInboxItem } from '@/hooks/useCommunications';
import { GlobalLayout } from '@/shared/components/layout/GlobalLayout';

const CommunicationsHub = () => {
  const [activeTab, setActiveTab] = useState('inbox');
  const [selectedThread, setSelectedThread] = useState<SMSThread | null>(null);
  const [selectedInboxItem, setSelectedInboxItem] = useState<UnifiedInboxItem | null>(null);
  const [softphoneOpen, setSoftphoneOpen] = useState(false);
  const [callNumber, setCallNumber] = useState('');
  const [callContactName, setCallContactName] = useState('');
  
  const { 
    unreadCounts, 
    refetchInbox, 
    refetchThreads, 
    refetchRecordings 
  } = useCommunications();

  const handleRefresh = () => {
    refetchInbox();
    refetchThreads();
    refetchRecordings();
  };

  const handleCallContact = (phoneNumber: string, contactName?: string) => {
    setCallNumber(phoneNumber);
    setCallContactName(contactName || '');
    setSoftphoneOpen(true);
  };

  const handleSelectInboxItem = (item: UnifiedInboxItem) => {
    setSelectedInboxItem(item);
    
    // If it's an SMS, switch to SMS tab and find/select the thread
    if (item.channel === 'sms' && item.phone_number) {
      setActiveTab('sms');
    }
  };

  const handleSelectThread = (thread: SMSThread) => {
    setSelectedThread(thread);
  };

  return (
    <GlobalLayout>
    <div className="h-[calc(100vh-8rem)] flex flex-col">
      {/* Header */}
      <div className="border-b px-4 py-3 shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-semibold">Follow Up Hub</h1>
            {unreadCounts.total > 0 && (
              <Badge variant="destructive">{unreadCounts.total} unread</Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleRefresh}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Refresh
            </Button>
            <Button 
              size="sm" 
              onClick={() => {
                setCallNumber('');
                setCallContactName('');
                setSoftphoneOpen(true);
              }}
            >
              <PhoneCall className="h-4 w-4 mr-2" />
              New Call
            </Button>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-hidden">
        <Tabs 
          value={activeTab} 
          onValueChange={setActiveTab} 
          className="h-full flex flex-col"
        >
          <div className="border-b px-4 shrink-0">
            <TabsList className="h-12">
              <TabsTrigger value="inbox" className="gap-2">
                <Inbox className="h-4 w-4" />
                Inbox
                {unreadCounts.total > 0 && (
                  <Badge variant="secondary" className="h-5 px-1.5">
                    {unreadCounts.total}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="sms" className="gap-2">
                <MessageSquare className="h-4 w-4" />
                SMS
                {unreadCounts.sms > 0 && (
                  <Badge variant="secondary" className="h-5 px-1.5">
                    {unreadCounts.sms}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="calls" className="gap-2">
                <Phone className="h-4 w-4" />
                Calls
              </TabsTrigger>
              <TabsTrigger value="recordings" className="gap-2">
                <Mic className="h-4 w-4" />
                Recordings
              </TabsTrigger>
              <TabsTrigger value="email-activity" className="gap-2">
                <Mail className="h-4 w-4" />
                Email Activity
              </TabsTrigger>
            </TabsList>
          </div>

          {/* Unified Inbox */}
          <TabsContent value="inbox" className="flex-1 m-0 overflow-hidden">
            <div className="h-full grid grid-cols-1 lg:grid-cols-2 gap-0 lg:divide-x">
              <div className="h-full overflow-hidden">
                <UnifiedInbox 
                  onSelectItem={handleSelectInboxItem}
                  onCallContact={(phone) => handleCallContact(phone)}
                  selectedItemId={selectedInboxItem?.id}
                />
              </div>
              <div className="h-full hidden lg:block">
                {selectedInboxItem ? (
                  <div className="h-full p-4">
                    {selectedInboxItem.channel === 'sms' ? (
                      <SMSConversationThread
                        phoneNumber={selectedInboxItem.phone_number || undefined}
                        contactName={selectedInboxItem.contact 
                          ? `${selectedInboxItem.contact.first_name} ${selectedInboxItem.contact.last_name}`
                          : undefined
                        }
                        onCall={(phone) => handleCallContact(phone, selectedInboxItem.contact 
                          ? `${selectedInboxItem.contact.first_name} ${selectedInboxItem.contact.last_name}`
                          : undefined
                        )}
                      />
                    ) : (
                      <div className="h-full flex items-center justify-center text-muted-foreground">
                        <div className="text-center">
                          <Phone className="h-12 w-12 mx-auto mb-4 opacity-50" />
                          <p>Call details coming soon</p>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="h-full flex items-center justify-center text-muted-foreground">
                    <div className="text-center">
                      <Inbox className="h-12 w-12 mx-auto mb-4 opacity-50" />
                      <p>Select a message to view details</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </TabsContent>

          {/* SMS Tab */}
          <TabsContent value="sms" className="flex-1 m-0 overflow-hidden">
            <div className="h-full grid grid-cols-1 lg:grid-cols-2 gap-0 lg:divide-x">
              <div className="h-full overflow-hidden">
                <SMSThreadList 
                  onSelectThread={handleSelectThread}
                  selectedThreadId={selectedThread?.id}
                />
              </div>
              <div className="h-full overflow-hidden">
                <SMSConversationThread
                  thread={selectedThread || undefined}
                  onBack={() => setSelectedThread(null)}
                  onCall={(phone) => handleCallContact(phone, selectedThread?.contact 
                    ? `${selectedThread.contact.first_name} ${selectedThread.contact.last_name}`
                    : undefined
                  )}
                />
              </div>
            </div>
          </TabsContent>

          {/* Calls Tab */}
          <TabsContent value="calls" className="flex-1 m-0 overflow-hidden p-4">
            <SoftphonePanel />
          </TabsContent>

          {/* Recordings Tab */}
          <TabsContent value="recordings" className="flex-1 m-0 overflow-hidden p-4">
            <RecordingLibrary />
          </TabsContent>

          {/* Email Activity Tab */}
          <TabsContent value="email-activity" className="flex-1 m-0 overflow-hidden">
            <EmailActivityDashboard />
          </TabsContent>
        </Tabs>
      </div>

      {/* Global Softphone */}
      <GlobalSoftphone
        isOpen={softphoneOpen}
        onClose={() => setSoftphoneOpen(false)}
        initialNumber={callNumber}
        contactName={callContactName}
      />
    </div>
    </GlobalLayout>
  );
};

export default CommunicationsHub;
