import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, Users, Check, X, Merge } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

interface PotentialDuplicate {
  id: string;
  contact_id_1: string;
  contact_id_2: string;
  similarity_score: number;
  match_fields: any;
  status: string;
  created_at: string;
  contact1: {
    first_name: string;
    last_name: string;
    email: string;
    phone: string;
    address_street: string;
  };
  contact2: {
    first_name: string;
    last_name: string;
    email: string;
    phone: string;
    address_street: string;
  };
}

export const DuplicateDetection = () => {
  const [duplicates, setDuplicates] = useState<PotentialDuplicate[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchPotentialDuplicates();
  }, []);

  const fetchPotentialDuplicates = async () => {
    try {
      const { data, error } = await supabase
        .from('potential_duplicates')
        .select(`
          *,
          contact1:contacts!contact_id_1(first_name, last_name, email, phone, address_street),
          contact2:contacts!contact_id_2(first_name, last_name, email, phone, address_street)
        `)
        .eq('status', 'pending')
        .order('similarity_score', { ascending: false });

      if (error) throw error;
      setDuplicates(data as any || []);
    } catch (error) {
      console.error('Error fetching duplicates:', error);
      toast.error('Failed to load potential duplicates');
    } finally {
      setLoading(false);
    }
  };

  const updateDuplicateStatus = async (duplicateId: string, status: string) => {
    try {
      const { error } = await supabase
        .from('potential_duplicates')
        .update({ 
          status, 
          reviewed_by: (await supabase.auth.getUser()).data.user?.id,
          reviewed_at: new Date().toISOString()
        })
        .eq('id', duplicateId);

      if (error) throw error;
      
      setDuplicates(prev => prev.filter(d => d.id !== duplicateId));
      toast.success(`Marked as ${status.replace('_', ' ')}`);
    } catch (error) {
      console.error('Error updating duplicate status:', error);
      toast.error('Failed to update status');
    }
  };

  const mergeContacts = async (duplicateRecord: PotentialDuplicate) => {
    try {
      const { data, error } = await supabase.functions.invoke('duplicate-merger', {
        body: {
          action: 'merge_contacts',
          data: {
            duplicate_id: duplicateRecord.id,
            primary_contact_id: duplicateRecord.contact_id_1,
            duplicate_contact_id: duplicateRecord.contact_id_2
          }
        }
      });

      if (error) throw error;
      
      setDuplicates(prev => prev.filter(d => d.id !== duplicateRecord.id));
      toast.success('Contacts merged successfully');
    } catch (error) {
      console.error('Error merging contacts:', error);
      toast.error('Failed to merge contacts');
    }
  };

  const getMatchFieldColor = (field: string) => {
    switch (field) {
      case 'email': return 'bg-red-100 text-red-800';
      case 'phone': return 'bg-orange-100 text-orange-800';
      case 'name': return 'bg-blue-100 text-blue-800';
      case 'address': return 'bg-green-100 text-green-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const formatSimilarityScore = (score: number) => {
    return `${Math.round(score * 100)}% match`;
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="text-center">Loading potential duplicates...</div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-orange-500" />
            Duplicate Detection
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4" />
              {duplicates.length} potential duplicates found
            </div>
          </div>
        </CardContent>
      </Card>

      {duplicates.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-center">
            <div className="text-muted-foreground">
              No potential duplicates found. Your contact database is clean! ✨
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {duplicates.map((duplicate) => (
            <Card key={duplicate.id} className="border-orange-200">
              <CardContent className="p-6">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-4">
                      <Badge variant="secondary" className="bg-orange-100 text-orange-800">
                        {formatSimilarityScore(duplicate.similarity_score)}
                      </Badge>
                      <div className="flex gap-1">
                        {duplicate.match_fields.map((field) => (
                          <Badge 
                            key={field} 
                            variant="outline" 
                            className={getMatchFieldColor(field)}
                          >
                            {field}
                          </Badge>
                        ))}
                      </div>
                    </div>

                    <div className="grid md:grid-cols-2 gap-6">
                      <div className="space-y-2">
                        <h4 className="font-medium text-sm text-muted-foreground">Contact 1</h4>
                        <div className="space-y-1">
                          <div className="font-medium">
                            {duplicate.contact1.first_name} {duplicate.contact1.last_name}
                          </div>
                          {duplicate.contact1.email && (
                            <div className="text-sm text-muted-foreground">
                              📧 {duplicate.contact1.email}
                            </div>
                          )}
                          {duplicate.contact1.phone && (
                            <div className="text-sm text-muted-foreground">
                              📱 {duplicate.contact1.phone}
                            </div>
                          )}
                          {duplicate.contact1.address_street && (
                            <div className="text-sm text-muted-foreground">
                              📍 {duplicate.contact1.address_street}
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="space-y-2">
                        <h4 className="font-medium text-sm text-muted-foreground">Contact 2</h4>
                        <div className="space-y-1">
                          <div className="font-medium">
                            {duplicate.contact2.first_name} {duplicate.contact2.last_name}
                          </div>
                          {duplicate.contact2.email && (
                            <div className="text-sm text-muted-foreground">
                              📧 {duplicate.contact2.email}
                            </div>
                          )}
                          {duplicate.contact2.phone && (
                            <div className="text-sm text-muted-foreground">
                              📱 {duplicate.contact2.phone}
                            </div>
                          )}
                          {duplicate.contact2.address_street && (
                            <div className="text-sm text-muted-foreground">
                              📍 {duplicate.contact2.address_street}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="flex gap-2 ml-6">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => updateDuplicateStatus(duplicate.id, 'not_duplicate')}
                    >
                      <X className="h-4 w-4 mr-1" />
                      Not Duplicate
                    </Button>
                    
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => updateDuplicateStatus(duplicate.id, 'confirmed_duplicate')}
                    >
                      <Check className="h-4 w-4 mr-1" />
                      Confirm
                    </Button>

                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button size="sm" className="bg-orange-600 hover:bg-orange-700">
                          <Merge className="h-4 w-4 mr-1" />
                          Merge
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Merge Contacts</AlertDialogTitle>
                          <AlertDialogDescription>
                            Are you sure you want to merge these contacts? Contact 1 will be kept as the primary contact, and Contact 2 will be merged into it. This action cannot be undone.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction 
                            onClick={() => mergeContacts(duplicate)}
                            className="bg-orange-600 hover:bg-orange-700"
                          >
                            Merge Contacts
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};