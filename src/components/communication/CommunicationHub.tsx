import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { 
  Phone, 
  MessageSquare, 
  Mail, 
  Play, 
  PhoneCall,
  MessageCircle,
  Send,
  User,
  Clock
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface CommunicationHubProps {
  contactId?: string;
  assignedRep?: {
    id: string;
    first_name: string;
    last_name: string;
  };
  className?: string;
}

const CommunicationHub: React.FC<CommunicationHubProps> = ({
  contactId,
  assignedRep,
  className
}) => {
  const [activeTab, setActiveTab] = useState('calls');

  // Mock data - in real implementation, fetch from Supabase
  const callHistory = [
    {
      id: '1',
      type: 'outbound',
      duration: '00:05:23',
      timestamp: '2024-01-15 14:30',
      status: 'completed',
      notes: 'Discussed roofing options and scheduled estimate'
    },
    {
      id: '2',
      type: 'inbound',
      duration: '00:02:45',
      timestamp: '2024-01-14 09:15',
      status: 'completed',
      notes: 'Customer inquiry about timeline'
    }
  ];

  const smsThread = [
    {
      id: '1',
      direction: 'inbound',
      message: 'Hi, when can we schedule the estimate?',
      timestamp: '2024-01-15 10:30',
      status: 'delivered'
    },
    {
      id: '2',
      direction: 'outbound',
      message: 'Hello! We can schedule anytime this week. What works best for you?',
      timestamp: '2024-01-15 10:35',
      status: 'delivered'
    }
  ];

  const emailThread = [
    {
      id: '1',
      subject: 'Roofing Estimate Request',
      from: 'customer@email.com',
      to: 'rep@company.com',
      timestamp: '2024-01-14 16:45',
      preview: 'I would like to get an estimate for roof replacement...'
    }
  ];

  return (
    <Card className={cn("border-primary/20", className)}>
      <CardHeader>
        <CardTitle className="flex items-center space-x-2">
          <MessageSquare className="h-5 w-5 text-primary" />
          <span>Communication Hub</span>
        </CardTitle>
        {assignedRep && (
          <div className="flex items-center space-x-2 text-sm text-muted-foreground">
            <User className="h-4 w-4" />
            <span>
              {assignedRep.first_name} {assignedRep.last_name} - Sales Rep
            </span>
          </div>
        )}
      </CardHeader>
      <CardContent>
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="calls" className="flex items-center space-x-1">
              <Phone className="h-4 w-4" />
              <span>Calls</span>
              <Badge variant="secondary" className="ml-1 text-xs">
                {callHistory.length}
              </Badge>
            </TabsTrigger>
            <TabsTrigger value="sms" className="flex items-center space-x-1">
              <MessageCircle className="h-4 w-4" />
              <span>SMS</span>
              <Badge variant="secondary" className="ml-1 text-xs">
                {smsThread.length}
              </Badge>
            </TabsTrigger>
            <TabsTrigger value="email" className="flex items-center space-x-1">
              <Mail className="h-4 w-4" />
              <span>Email</span>
              <Badge variant="secondary" className="ml-1 text-xs">
                {emailThread.length}
              </Badge>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="calls" className="space-y-4 mt-4">
            <div className="flex space-x-2">
              <Button size="sm" className="flex items-center space-x-1">
                <PhoneCall className="h-4 w-4" />
                <span>Call Now</span>
              </Button>
              <Button size="sm" variant="outline" className="flex items-center space-x-1">
                <Phone className="h-4 w-4" />
                <span>Schedule Call</span>
              </Button>
            </div>
            
            <div className="space-y-2">
              {callHistory.map((call) => (
                <div key={call.id} className="border rounded-lg p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <div className={cn(
                        "w-2 h-2 rounded-full",
                        call.type === 'outbound' ? "bg-success" : "bg-primary"
                      )} />
                      <span className="text-sm font-medium capitalize">
                        {call.type}
                      </span>
                      <Badge variant="outline" className="text-xs">
                        {call.duration}
                      </Badge>
                    </div>
                    <div className="flex items-center space-x-1 text-xs text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      <span>{call.timestamp}</span>
                    </div>
                  </div>
                  {call.notes && (
                    <p className="text-sm text-muted-foreground">{call.notes}</p>
                  )}
                  <Button size="sm" variant="ghost" className="h-6 px-2">
                    <Play className="h-3 w-3 mr-1" />
                    Play Recording
                  </Button>
                </div>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="sms" className="space-y-4 mt-4">
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {smsThread.map((message) => (
                <div 
                  key={message.id} 
                  className={cn(
                    "flex",
                    message.direction === 'outbound' ? "justify-end" : "justify-start"
                  )}
                >
                  <div className={cn(
                    "max-w-[70%] rounded-lg p-2 text-sm",
                    message.direction === 'outbound' 
                      ? "bg-primary text-primary-foreground" 
                      : "bg-accent"
                  )}>
                    <p>{message.message}</p>
                    <div className="text-xs opacity-70 mt-1">
                      {message.timestamp}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            
            <div className="flex space-x-2">
              <Button size="sm" className="flex items-center space-x-1 flex-1">
                <Send className="h-4 w-4" />
                <span>Send SMS</span>
              </Button>
            </div>
          </TabsContent>

          <TabsContent value="email" className="space-y-4 mt-4">
            <div className="space-y-2">
              {emailThread.map((email) => (
                <div key={email.id} className="border rounded-lg p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <h4 className="font-medium text-sm">{email.subject}</h4>
                    <div className="text-xs text-muted-foreground">
                      {email.timestamp}
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    <div>From: {email.from}</div>
                    <div>To: {email.to}</div>
                  </div>
                  <p className="text-sm text-muted-foreground">{email.preview}</p>
                  <Button size="sm" variant="ghost">
                    View Full Email
                  </Button>
                </div>
              ))}
            </div>
            
            <Button size="sm" className="flex items-center space-x-1">
              <Mail className="h-4 w-4" />
              <span>Compose Email</span>
            </Button>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
};

export default CommunicationHub;