import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Plus, Trash2, FileText, Send, Eye } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface Recipient {
  role: string;
  name: string;
  email: string;
  clientUserId?: string;
  authType: string;
}

interface DocGenField {
  key: string;
  value: string;
  label?: string;
}

interface SendForSignatureDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  contactId?: string;
  projectId?: string;
  pipelineEntryId?: string;
  crmObjectType?: string;
  crmObjectId?: string;
  onSuccess?: (agreementInstanceId: string) => void;
}

export default function SendForSignatureDrawer({
  isOpen,
  onClose,
  contactId,
  projectId,
  pipelineEntryId,
  crmObjectType,
  crmObjectId,
  onSuccess,
}: SendForSignatureDrawerProps) {
  const [templates, setTemplates] = useState<any[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<any>(null);
  const [recipients, setRecipients] = useState<Recipient[]>([
    { role: 'Signer1', name: '', email: '', authType: 'none' }
  ]);
  const [docGenFields, setDocGenFields] = useState<DocGenField[]>([]);
  const [emailSubject, setEmailSubject] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [currentStep, setCurrentStep] = useState(1);
  const [agreementInstanceId, setAgreementInstanceId] = useState<string>('');
  const { toast } = useToast();

  useEffect(() => {
    if (isOpen) {
      fetchTemplates();
    }
  }, [isOpen]);

  const fetchTemplates = async () => {
    try {
      const { data, error } = await supabase
        .from('agreement_templates')
        .select('*')
        .eq('is_active', true)
        .order('name');

      if (error) throw error;
      setTemplates(data || []);
    } catch (error: any) {
      toast({
        title: 'Error',
        description: 'Failed to fetch templates',
        variant: 'destructive',
      });
    }
  };

  const handleTemplateSelect = (templateSlug: string) => {
    const template = templates.find(t => t.slug === templateSlug);
    setSelectedTemplate(template);
    
    if (template) {
      // Set up default recipients based on template roles
      const templateRecipients = template.recipient_roles || [];
      if (templateRecipients.length > 0) {
        setRecipients(templateRecipients.map((role: any) => ({
          role: role.name,
          name: '',
          email: '',
          authType: 'none',
        })));
      }
      
      setEmailSubject(`Please sign: ${template.name}`);
      
      // Initialize doc gen fields if available
      const metadata = template.metadata || {};
      const fields = metadata.docgen_fields || [];
      setDocGenFields(fields.map((field: any) => ({
        key: field.key,
        value: '',
        label: field.label || field.key,
      })));
    }
  };

  const addRecipient = () => {
    setRecipients([...recipients, {
      role: `Signer${recipients.length + 1}`,
      name: '',
      email: '',
      authType: 'none'
    }]);
  };

  const removeRecipient = (index: number) => {
    setRecipients(recipients.filter((_, i) => i !== index));
  };

  const updateRecipient = (index: number, field: keyof Recipient, value: string) => {
    const updated = [...recipients];
    updated[index] = { ...updated[index], [field]: value };
    setRecipients(updated);
  };

  const updateDocGenField = (index: number, value: string) => {
    const updated = [...docGenFields];
    updated[index] = { ...updated[index], value };
    setDocGenFields(updated);
  };

  const createEnvelope = async () => {
    if (!selectedTemplate) return;

    setIsLoading(true);
    try {
      const response = await supabase.functions.invoke('docusign-create-envelope', {
        body: {
          template_slug: selectedTemplate.slug,
          crm_object_type: crmObjectType,
          crm_object_id: crmObjectId,
          contact_id: contactId,
          project_id: projectId,
          pipeline_entry_id: pipelineEntryId,
          recipients: recipients.map(r => ({
            ...r,
            clientUserId: r.authType === 'embedded' ? `client-${Date.now()}-${Math.random()}` : undefined,
          })),
          email_subject: emailSubject,
        },
      });

      if (response.error) throw response.error;
      
      const { agreement_instance_id } = response.data;
      setAgreementInstanceId(agreement_instance_id);
      setCurrentStep(2);

      toast({
        title: 'Success',
        description: 'Envelope created successfully',
      });
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to create envelope',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const updateDocGenFields = async () => {
    if (!agreementInstanceId) return;

    setIsLoading(true);
    try {
      const fieldsMap = docGenFields.reduce((acc, field) => {
        if (field.value.trim()) {
          acc[field.key] = field.value;
        }
        return acc;
      }, {} as Record<string, string>);

      const response = await supabase.functions.invoke('docusign-update-docgen', {
        body: {
          agreement_instance_id: agreementInstanceId,
          fields: fieldsMap,
        },
      });

      if (response.error) throw response.error;
      
      setCurrentStep(3);
      toast({
        title: 'Success',
        description: 'Document fields updated successfully',
      });
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to update document fields',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const sendEnvelope = async () => {
    if (!agreementInstanceId) return;

    setIsLoading(true);
    try {
      const response = await supabase.functions.invoke('docusign-send-envelope', {
        body: { agreement_instance_id: agreementInstanceId },
      });

      if (response.error) throw response.error;

      toast({
        title: 'Success',
        description: 'Document sent for signature!',
      });

      onSuccess?.(agreementInstanceId);
      onClose();
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to send envelope',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const openSenderView = async () => {
    if (!agreementInstanceId) return;

    try {
      const response = await supabase.functions.invoke('docusign-embedded-views', {
        body: {
          agreement_instance_id: agreementInstanceId,
          view_type: 'sender',
          return_url: window.location.href,
        },
      });

      if (response.error) throw response.error;

      // Open in a new window or iframe
      window.open(response.data.view_url, 'docusign-sender', 'width=1000,height=700');
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to open sender view',
        variant: 'destructive',
      });
    }
  };

  const resetForm = () => {
    setSelectedTemplate(null);
    setRecipients([{ role: 'Signer1', name: '', email: '', authType: 'none' }]);
    setDocGenFields([]);
    setEmailSubject('');
    setCurrentStep(1);
    setAgreementInstanceId('');
  };

  useEffect(() => {
    if (!isOpen) {
      resetForm();
    }
  }, [isOpen]);

  return (
    <Sheet open={isOpen} onOpenChange={onClose}>
      <SheetContent className="w-[600px] max-w-[90vw]">
        <SheetHeader>
          <SheetTitle>Send for Signature</SheetTitle>
          <SheetDescription>
            Create and send documents for electronic signature
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6">
          {/* Progress Steps */}
          <div className="flex items-center space-x-2 mb-6">
            {[1, 2, 3].map((step) => (
              <div key={step} className="flex items-center">
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                    currentStep >= step
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground'
                  }`}
                >
                  {step}
                </div>
                {step < 3 && (
                  <div
                    className={`w-8 h-0.5 ${
                      currentStep > step ? 'bg-primary' : 'bg-muted'
                    }`}
                  />
                )}
              </div>
            ))}
          </div>

          <ScrollArea className="h-[calc(100vh-200px)]">
            {currentStep === 1 && (
              <div className="space-y-6">
                {/* Template Selection */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <FileText className="h-4 w-4" />
                      Select Template
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <Select onValueChange={handleTemplateSelect}>
                      <SelectTrigger>
                        <SelectValue placeholder="Choose a document template" />
                      </SelectTrigger>
                      <SelectContent>
                        {templates.map((template) => (
                          <SelectItem key={template.id} value={template.slug}>
                            {template.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    {selectedTemplate && (
                      <div className="p-3 bg-muted rounded-lg">
                        <p className="text-sm font-medium">{selectedTemplate.name}</p>
                        {selectedTemplate.description && (
                          <p className="text-sm text-muted-foreground mt-1">
                            {selectedTemplate.description}
                          </p>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Recipients */}
                {selectedTemplate && (
                  <Card>
                    <CardHeader>
                      <CardTitle>Recipients</CardTitle>
                      <CardDescription>
                        Add signers and other recipients for this document
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {recipients.map((recipient, index) => (
                        <div key={index} className="border rounded-lg p-4 space-y-3">
                          <div className="flex items-center justify-between">
                            <Badge variant="outline">{recipient.role}</Badge>
                            {recipients.length > 1 && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => removeRecipient(index)}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            )}
                          </div>

                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <Label htmlFor={`name-${index}`}>Name</Label>
                              <Input
                                id={`name-${index}`}
                                value={recipient.name}
                                onChange={(e) => updateRecipient(index, 'name', e.target.value)}
                                placeholder="Recipient name"
                              />
                            </div>
                            <div>
                              <Label htmlFor={`email-${index}`}>Email</Label>
                              <Input
                                id={`email-${index}`}
                                type="email"
                                value={recipient.email}
                                onChange={(e) => updateRecipient(index, 'email', e.target.value)}
                                placeholder="email@example.com"
                              />
                            </div>
                          </div>

                          <div>
                            <Label htmlFor={`auth-${index}`}>Authentication</Label>
                            <Select
                              value={recipient.authType}
                              onValueChange={(value) => updateRecipient(index, 'authType', value)}
                            >
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="none">Email Only</SelectItem>
                                <SelectItem value="embedded">Embedded Signing</SelectItem>
                                <SelectItem value="sms">SMS Verification</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                      ))}

                      <Button
                        variant="outline"
                        onClick={addRecipient}
                        className="w-full"
                      >
                        <Plus className="h-4 w-4 mr-2" />
                        Add Recipient
                      </Button>
                    </CardContent>
                  </Card>
                )}

                {/* Email Subject */}
                {selectedTemplate && (
                  <Card>
                    <CardHeader>
                      <CardTitle>Email Settings</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div>
                        <Label htmlFor="email-subject">Email Subject</Label>
                        <Input
                          id="email-subject"
                          value={emailSubject}
                          onChange={(e) => setEmailSubject(e.target.value)}
                          placeholder="Please sign this document"
                        />
                      </div>
                    </CardContent>
                  </Card>
                )}

                {selectedTemplate && (
                  <Button
                    onClick={createEnvelope}
                    disabled={isLoading || !recipients.every(r => r.name && r.email)}
                    className="w-full"
                  >
                    {isLoading ? 'Creating...' : 'Create Envelope'}
                  </Button>
                )}
              </div>
            )}

            {currentStep === 2 && (
              <div className="space-y-6">
                <Card>
                  <CardHeader>
                    <CardTitle>Document Fields</CardTitle>
                    <CardDescription>
                      Fill in the dynamic content for your document
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {docGenFields.length > 0 ? (
                      docGenFields.map((field, index) => (
                        <div key={field.key}>
                          <Label htmlFor={`field-${index}`}>{field.label}</Label>
                          <Input
                            id={`field-${index}`}
                            value={field.value}
                            onChange={(e) => updateDocGenField(index, e.target.value)}
                            placeholder={`Enter ${field.label.toLowerCase()}`}
                          />
                        </div>
                      ))
                    ) : (
                      <p className="text-muted-foreground text-center py-4">
                        No dynamic fields configured for this template
                      </p>
                    )}

                    <Separator />

                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        onClick={openSenderView}
                        className="flex-1"
                      >
                        <Eye className="h-4 w-4 mr-2" />
                        Preview
                      </Button>
                      <Button
                        onClick={updateDocGenFields}
                        disabled={isLoading}
                        className="flex-1"
                      >
                        {isLoading ? 'Updating...' : 'Continue'}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}

            {currentStep === 3 && (
              <div className="space-y-6">
                <Card>
                  <CardHeader>
                    <CardTitle>Ready to Send</CardTitle>
                    <CardDescription>
                      Review and send your document for signature
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-2">
                      <p className="font-medium">Template: {selectedTemplate?.name}</p>
                      <p className="text-sm text-muted-foreground">
                        Recipients: {recipients.length}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        Subject: {emailSubject}
                      </p>
                    </div>

                    <Separator />

                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        onClick={openSenderView}
                        className="flex-1"
                      >
                        <Eye className="h-4 w-4 mr-2" />
                        Final Review
                      </Button>
                      <Button
                        onClick={sendEnvelope}
                        disabled={isLoading}
                        className="flex-1"
                      >
                        <Send className="h-4 w-4 mr-2" />
                        {isLoading ? 'Sending...' : 'Send for Signature'}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}
          </ScrollArea>
        </div>
      </SheetContent>
    </Sheet>
  );
}