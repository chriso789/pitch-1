import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Phone, MessageSquare, Mail, MapPin, Star } from 'lucide-react';

interface ContactData {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  address?: string;
  leadScore?: number;
  status?: string;
  type?: string;
}

interface ContactHeaderProps {
  contact: ContactData;
  onCall?: () => void;
  onText?: () => void;
  onEmail?: () => void;
}

export const ContactHeader = ({ contact, onCall, onText, onEmail }: ContactHeaderProps) => {
  const initials = contact.name
    .split(' ')
    .map(n => n[0])
    .join('')
    .toUpperCase();

  const getStatusColor = (status: string) => {
    switch (status?.toLowerCase()) {
      case 'qualified':
        return 'bg-green-500/10 text-green-600 border-green-200';
      case 'hot':
        return 'bg-red-500/10 text-red-600 border-red-200';
      case 'warm':
        return 'bg-orange-500/10 text-orange-600 border-orange-200';
      case 'cold':
        return 'bg-blue-500/10 text-blue-600 border-blue-200';
      default:
        return 'bg-muted text-muted-foreground';
    }
  };

  return (
    <Card className="mb-6 border-l-4 border-l-primary">
      <CardContent className="p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Avatar className="h-16 w-16 ring-2 ring-primary/10">
              <AvatarFallback className="text-lg font-semibold bg-primary/10 text-primary">
                {initials}
              </AvatarFallback>
            </Avatar>
            
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <h2 className="text-2xl font-bold text-foreground">{contact.name}</h2>
                {contact.leadScore && contact.leadScore > 0 && (
                  <div className="flex items-center gap-1">
                    <Star className="h-4 w-4 text-yellow-500 fill-current" />
                    <Badge variant="secondary" className="text-xs">
                      {contact.leadScore}% Score
                    </Badge>
                  </div>
                )}
              </div>
              
              <div className="flex items-center gap-4 text-muted-foreground">
                {contact.phone && (
                  <div className="flex items-center gap-1">
                    <Phone className="h-4 w-4" />
                    <span>{contact.phone}</span>
                  </div>
                )}
                {contact.email && (
                  <div className="flex items-center gap-1">
                    <Mail className="h-4 w-4" />
                    <span>{contact.email}</span>
                  </div>
                )}
                {contact.address && (
                  <div className="flex items-center gap-1">
                    <MapPin className="h-4 w-4" />
                    <span className="text-sm">{contact.address}</span>
                  </div>
                )}
              </div>
              
              <div className="flex gap-2">
                {contact.status && (
                  <Badge variant="outline" className={getStatusColor(contact.status)}>
                    {contact.status}
                  </Badge>
                )}
                <Badge variant="outline" className="text-xs">
                  {contact.type === 'job' ? 'Job Contact' : 'Direct Contact'}
                </Badge>
              </div>
            </div>
          </div>
          
          <div className="flex flex-col gap-2">
            {contact.phone && (
              <Button onClick={onCall} className="gap-2">
                <Phone className="h-4 w-4" />
                Call Now
              </Button>
            )}
            {contact.phone && (
              <Button onClick={onText} variant="outline" size="sm" className="gap-2">
                <MessageSquare className="h-4 w-4" />
                Text
              </Button>
            )}
            {contact.email && (
              <Button onClick={onEmail} variant="outline" size="sm" className="gap-2">
                <Mail className="h-4 w-4" />
                Email
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
};