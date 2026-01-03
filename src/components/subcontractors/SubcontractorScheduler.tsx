import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Calendar, Users, MapPin, Clock, CheckCircle, Plus, Phone, Mail, Star } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useCompanySwitcher } from '@/hooks/useCompanySwitcher';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { format } from 'date-fns';

interface Subcontractor {
  id: string;
  company_name: string;
  contact_name: string;
  email?: string;
  phone?: string;
  specialties?: string[];
  hourly_rate?: number;
  day_rate?: number;
  rating?: number;
  status: string;
}

interface Assignment {
  id: string;
  subcontractor_id: string;
  project_id?: string;
  assignment_type: string;
  scheduled_date?: string;
  status: string;
  estimated_hours?: number;
  agreed_rate?: number;
}

interface SubcontractorSchedulerProps {
  projectId?: string;
  jobId?: string;
}

export const SubcontractorScheduler: React.FC<SubcontractorSchedulerProps> = ({
  projectId,
  jobId
}) => {
  const { activeCompany } = useCompanySwitcher();
  const queryClient = useQueryClient();
  const [isAssignOpen, setIsAssignOpen] = useState(false);
  const [selectedSubcontractor, setSelectedSubcontractor] = useState<string>('');
  const [assignmentType, setAssignmentType] = useState('roofing');
  const [scheduledDate, setScheduledDate] = useState('');
  const [estimatedHours, setEstimatedHours] = useState('8');

  const { data: subcontractors, isLoading: loadingSubs } = useQuery({
    queryKey: ['subcontractors', activeCompany?.tenant_id],
    queryFn: async () => {
      if (!activeCompany?.tenant_id) return [];

      const { data, error } = await supabase
        .from('subcontractor_profiles')
        .select('*')
        .eq('tenant_id', activeCompany.tenant_id)
        .eq('status', 'active')
        .order('company_name');

      if (error) throw error;
      return data as Subcontractor[];
    },
    enabled: !!activeCompany?.tenant_id
  });

  const { data: assignments, isLoading: loadingAssignments } = useQuery({
    queryKey: ['subcontractor-assignments', projectId, activeCompany?.tenant_id],
    queryFn: async () => {
      if (!activeCompany?.tenant_id) return [];

      let query = supabase
        .from('subcontractor_assignments')
        .select(`
          *,
          subcontractor:subcontractor_profiles(company_name, contact_name, phone)
        `)
        .eq('tenant_id', activeCompany.tenant_id);

      if (projectId) query = query.eq('project_id', projectId);

      const { data, error } = await query.order('scheduled_date', { ascending: true });
      if (error) throw error;
      return data;
    },
    enabled: !!activeCompany?.tenant_id
  });

  const assignMutation = useMutation({
    mutationFn: async () => {
      const sub = subcontractors?.find(s => s.id === selectedSubcontractor);
      
      const { error } = await supabase
        .from('subcontractor_assignments')
        .insert({
          tenant_id: activeCompany?.tenant_id,
          subcontractor_id: selectedSubcontractor,
          project_id: projectId,
          job_id: jobId,
          assignment_type: assignmentType,
          scheduled_date: scheduledDate,
          estimated_hours: parseFloat(estimatedHours),
          agreed_rate: sub?.hourly_rate || sub?.day_rate,
          rate_type: sub?.day_rate ? 'daily' : 'hourly',
          status: 'pending'
        });

      if (error) throw error;

      // Send notification
      await supabase.functions.invoke('subcontractor-notification', {
        body: {
          tenant_id: activeCompany?.tenant_id,
          subcontractor_id: selectedSubcontractor,
          notification_type: 'job_assignment'
        }
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['subcontractor-assignments'] });
      setIsAssignOpen(false);
      toast.success('Subcontractor assigned successfully');
      setSelectedSubcontractor('');
      setScheduledDate('');
    },
    onError: (error) => {
      console.error('Assignment error:', error);
      toast.error('Failed to assign subcontractor');
    }
  });

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'pending':
        return <Badge variant="secondary">Pending</Badge>;
      case 'accepted':
        return <Badge className="bg-blue-100 text-blue-800">Accepted</Badge>;
      case 'in_progress':
        return <Badge className="bg-yellow-100 text-yellow-800">In Progress</Badge>;
      case 'completed':
        return <Badge className="bg-green-100 text-green-800">Completed</Badge>;
      case 'declined':
        return <Badge variant="destructive">Declined</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  const renderStars = (rating?: number) => {
    if (!rating) return null;
    return (
      <div className="flex items-center gap-0.5">
        {[1, 2, 3, 4, 5].map(star => (
          <Star
            key={star}
            className={`h-3 w-3 ${star <= rating ? 'text-yellow-500 fill-yellow-500' : 'text-gray-300'}`}
          />
        ))}
      </div>
    );
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Subcontractor Schedule
          </CardTitle>
          <Dialog open={isAssignOpen} onOpenChange={setIsAssignOpen}>
            <DialogTrigger asChild>
              <Button size="sm">
                <Plus className="h-4 w-4 mr-2" />
                Assign Subcontractor
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Assign Subcontractor</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <Label>Subcontractor</Label>
                  <Select value={selectedSubcontractor} onValueChange={setSelectedSubcontractor}>
                    <SelectTrigger className="mt-1">
                      <SelectValue placeholder="Select subcontractor" />
                    </SelectTrigger>
                    <SelectContent>
                      {subcontractors?.map(sub => (
                        <SelectItem key={sub.id} value={sub.id}>
                          <div className="flex items-center gap-2">
                            <span>{sub.company_name}</span>
                            {sub.rating && (
                              <span className="text-xs text-muted-foreground">
                                ({sub.rating.toFixed(1)}★)
                              </span>
                            )}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Assignment Type</Label>
                  <Select value={assignmentType} onValueChange={setAssignmentType}>
                    <SelectTrigger className="mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="roofing">Roofing Installation</SelectItem>
                      <SelectItem value="tear_off">Tear Off</SelectItem>
                      <SelectItem value="repairs">Repairs</SelectItem>
                      <SelectItem value="gutters">Gutters</SelectItem>
                      <SelectItem value="siding">Siding</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="date">Scheduled Date</Label>
                    <Input
                      id="date"
                      type="date"
                      value={scheduledDate}
                      onChange={(e) => setScheduledDate(e.target.value)}
                    />
                  </div>
                  <div>
                    <Label htmlFor="hours">Estimated Hours</Label>
                    <Input
                      id="hours"
                      type="number"
                      value={estimatedHours}
                      onChange={(e) => setEstimatedHours(e.target.value)}
                    />
                  </div>
                </div>
                {selectedSubcontractor && (
                  <Card className="bg-muted">
                    <CardContent className="p-3">
                      <p className="text-sm font-medium">Rate Information</p>
                      {(() => {
                        const sub = subcontractors?.find(s => s.id === selectedSubcontractor);
                        return (
                          <div className="text-sm text-muted-foreground mt-1">
                            {sub?.hourly_rate && <p>Hourly: ${sub.hourly_rate}/hr</p>}
                            {sub?.day_rate && <p>Daily: ${sub.day_rate}/day</p>}
                            {sub?.specialties && <p>Specialties: {sub.specialties.join(', ')}</p>}
                          </div>
                        );
                      })()}
                    </CardContent>
                  </Card>
                )}
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setIsAssignOpen(false)}>
                    Cancel
                  </Button>
                  <Button 
                    onClick={() => assignMutation.mutate()}
                    disabled={!selectedSubcontractor || !scheduledDate || assignMutation.isPending}
                  >
                    Assign & Notify
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent>
        {loadingAssignments ? (
          <div className="text-center py-8 text-muted-foreground">Loading assignments...</div>
        ) : assignments && assignments.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Subcontractor</TableHead>
                <TableHead>Assignment</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Hours</TableHead>
                <TableHead>Status</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {assignments.map((assignment: any) => (
                <TableRow key={assignment.id}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <Avatar className="h-8 w-8">
                        <AvatarFallback>
                          {assignment.subcontractor?.company_name?.charAt(0) || 'S'}
                        </AvatarFallback>
                      </Avatar>
                      <div>
                        <p className="font-medium">{assignment.subcontractor?.company_name}</p>
                        <p className="text-sm text-muted-foreground">{assignment.subcontractor?.contact_name}</p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="capitalize">{assignment.assignment_type.replace('_', ' ')}</TableCell>
                  <TableCell>
                    {assignment.scheduled_date 
                      ? format(new Date(assignment.scheduled_date), 'MMM d, yyyy')
                      : '-'}
                  </TableCell>
                  <TableCell>{assignment.estimated_hours || '-'} hrs</TableCell>
                  <TableCell>{getStatusBadge(assignment.status)}</TableCell>
                  <TableCell>
                    {assignment.subcontractor?.phone && (
                      <Button variant="ghost" size="sm" asChild>
                        <a href={`tel:${assignment.subcontractor.phone}`}>
                          <Phone className="h-4 w-4" />
                        </a>
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <div className="text-center py-8 text-muted-foreground">
            <Calendar className="h-12 w-12 mx-auto mb-2 opacity-50" />
            <p>No subcontractors assigned</p>
            <p className="text-sm">Assign subcontractors to manage work on this project</p>
          </div>
        )}

        {/* Available Subcontractors */}
        {subcontractors && subcontractors.length > 0 && (
          <div className="mt-6">
            <h4 className="font-medium mb-3">Available Subcontractors</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {subcontractors.slice(0, 6).map(sub => (
                <Card key={sub.id} className="hover:shadow-md transition-shadow">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="font-medium">{sub.company_name}</p>
                        <p className="text-sm text-muted-foreground">{sub.contact_name}</p>
                        {renderStars(sub.rating)}
                      </div>
                      <Badge variant="outline" className="text-xs">
                        ${sub.hourly_rate || sub.day_rate}/{sub.day_rate ? 'day' : 'hr'}
                      </Badge>
                    </div>
                    {sub.specialties && sub.specialties.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {sub.specialties.slice(0, 3).map(s => (
                          <Badge key={s} variant="secondary" className="text-xs">{s}</Badge>
                        ))}
                      </div>
                    )}
                    <div className="flex gap-2 mt-3">
                      {sub.phone && (
                        <Button variant="ghost" size="sm" asChild>
                          <a href={`tel:${sub.phone}`}>
                            <Phone className="h-3 w-3" />
                          </a>
                        </Button>
                      )}
                      {sub.email && (
                        <Button variant="ghost" size="sm" asChild>
                          <a href={`mailto:${sub.email}`}>
                            <Mail className="h-3 w-3" />
                          </a>
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
