import React, { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Search, User, FileText, Download, Send, CheckCircle, AlertCircle } from "lucide-react";

interface Contact {
  id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  address_street: string | null;
  address_city: string | null;
  address_state: string | null;
  address_zip: string | null;
}

interface TagPlacement {
  id: string;
  tag_key: string;
  x_position: number;
  y_position: number;
  width: number;
  height: number;
}

interface ApplyDocumentToLeadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  document: {
    id: string;
    filename: string;
    file_path: string;
  } | null;
}

export const ApplyDocumentToLeadDialog: React.FC<ApplyDocumentToLeadDialogProps> = ({
  open,
  onOpenChange,
  document,
}) => {
  const [searchTerm, setSearchTerm] = useState("");
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [tagPlacements, setTagPlacements] = useState<TagPlacement[]>([]);
  const [resolvedTags, setResolvedTags] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [step, setStep] = useState<"select" | "preview">("select");

  // Load contacts on search
  useEffect(() => {
    const loadContacts = async () => {
      if (!open) return;

      setLoading(true);
      try {
        let query = supabase
          .from("contacts")
          .select("id, first_name, last_name, email, phone, address_street, address_city, address_state, address_zip")
          .order("created_at", { ascending: false })
          .limit(20);

        if (searchTerm) {
          query = query.or(
            `first_name.ilike.%${searchTerm}%,last_name.ilike.%${searchTerm}%,email.ilike.%${searchTerm}%,phone.ilike.%${searchTerm}%`
          );
        }

        const { data, error } = await query;
        if (error) throw error;
        setContacts(data || []);
      } catch (error) {
        console.error("Error loading contacts:", error);
      } finally {
        setLoading(false);
      }
    };

    const debounce = setTimeout(loadContacts, 300);
    return () => clearTimeout(debounce);
  }, [open, searchTerm]);

  // Load tag placements when document changes
  useEffect(() => {
    const loadTagPlacements = async () => {
      if (!document?.id || !open) return;

      try {
        const { data, error } = await supabase
          .from("document_tag_placements")
          .select("id, tag_key, x_position, y_position, width, height")
          .eq("document_id", document.id);

        if (error) throw error;
        setTagPlacements(data || []);
      } catch (error) {
        console.error("Error loading tag placements:", error);
      }
    };

    loadTagPlacements();
  }, [document?.id, open]);

  // Resolve tags when contact is selected
  useEffect(() => {
    if (!selectedContact) {
      setResolvedTags({});
      return;
    }

    const resolved: Record<string, string> = {};
    tagPlacements.forEach((placement) => {
      const value = resolveTagValue(placement.tag_key, selectedContact);
      resolved[placement.tag_key] = value;
    });
    setResolvedTags(resolved);
  }, [selectedContact, tagPlacements]);

  const resolveTagValue = (tagKey: string, contact: Contact): string => {
    const parts = tagKey.split(".");
    const category = parts[0];
    const field = parts[1];

    if (category === "contact") {
      switch (field) {
        case "first_name":
          return contact.first_name || "";
        case "last_name":
          return contact.last_name || "";
        case "full_name":
          return `${contact.first_name || ""} ${contact.last_name || ""}`.trim();
        case "email":
          return contact.email || "";
        case "phone":
          return contact.phone || "";
        case "address":
          return contact.address_street || "";
        case "city":
          return contact.address_city || "";
        case "state":
          return contact.address_state || "";
        case "zip":
          return contact.address_zip || "";
        default:
          return `{{${tagKey}}}`;
      }
    }

    if (category === "today") {
      const now = new Date();
      if (field === "date") {
        return now.toLocaleDateString();
      }
      if (field === "date_long") {
        return now.toLocaleDateString("en-US", {
          weekday: "long",
          year: "numeric",
          month: "long",
          day: "numeric",
        });
      }
    }

    return `{{${tagKey}}}`;
  };

  const handleSelectContact = (contact: Contact) => {
    setSelectedContact(contact);
    setStep("preview");
  };

  const handleBack = () => {
    setSelectedContact(null);
    setStep("select");
  };

  const handleGeneratePdf = async () => {
    if (!document || !selectedContact) return;

    setGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke("merge-document-tags", {
        body: {
          document_id: document.id,
          contact_id: selectedContact.id,
        },
      });

      if (error) throw error;

      if (data?.pdf_url) {
        // Download the PDF
        window.open(data.pdf_url, "_blank");
        toast.success("PDF generated successfully");
      } else {
        toast.success("Document prepared - download starting...");
      }

      onOpenChange(false);
    } catch (error) {
      console.error("Error generating PDF:", error);
      toast.error("Failed to generate PDF. The document will be downloaded as-is.");
      
      // Fallback: download original document
      try {
        const { data } = await supabase.storage
          .from("smartdoc-assets")
          .download(document.file_path);

        if (data) {
          const url = URL.createObjectURL(data);
          const a = window.document.createElement("a");
          a.href = url;
          a.download = document.filename;
          window.document.body.appendChild(a);
          a.click();
          window.document.body.removeChild(a);
          URL.revokeObjectURL(url);
        }
      } catch (downloadError) {
        console.error("Error downloading document:", downloadError);
      }
    } finally {
      setGenerating(false);
    }
  };

  const handleClose = () => {
    setStep("select");
    setSelectedContact(null);
    setSearchTerm("");
    onOpenChange(false);
  };

  if (!document) return null;

  const hasTagPlacements = tagPlacements.length > 0;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-2xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            {step === "select" ? "Apply Document to Lead" : "Preview Document"}
          </DialogTitle>
        </DialogHeader>

        {step === "select" && (
          <>
            <div className="space-y-4">
              <div>
                <Label>Select a contact/lead</Label>
                <div className="relative mt-2">
                  <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search by name, email, or phone..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-9"
                  />
                </div>
              </div>

              {!hasTagPlacements && (
                <Card className="p-4 bg-amber-50 dark:bg-amber-950 border-amber-200 dark:border-amber-800">
                  <div className="flex items-start gap-3">
                    <AlertCircle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
                        No smart tags configured
                      </p>
                      <p className="text-sm text-amber-700 dark:text-amber-300">
                        This document doesn't have any smart tags placed. Use the "Edit Tags" button
                        to add smart tags that will auto-fill with lead data.
                      </p>
                    </div>
                  </div>
                </Card>
              )}

              <ScrollArea className="h-[300px]">
                <div className="space-y-2">
                  {loading ? (
                    <div className="flex items-center justify-center h-32">
                      <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
                    </div>
                  ) : contacts.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      No contacts found
                    </div>
                  ) : (
                    contacts.map((contact) => (
                      <Card
                        key={contact.id}
                        className="p-3 cursor-pointer hover:bg-accent transition-colors"
                        onClick={() => handleSelectContact(contact)}
                      >
                        <div className="flex items-center gap-3">
                          <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                            <User className="h-5 w-5 text-primary" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-medium truncate">
                              {contact.first_name} {contact.last_name}
                            </p>
                            <p className="text-sm text-muted-foreground truncate">
                              {contact.email || contact.phone || "No contact info"}
                            </p>
                          </div>
                        </div>
                      </Card>
                    ))
                  )}
                </div>
              </ScrollArea>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={handleClose}>
                Cancel
              </Button>
            </DialogFooter>
          </>
        )}

        {step === "preview" && selectedContact && (
          <>
            <div className="space-y-4">
              <Card className="p-4 bg-muted/50">
                <div className="flex items-center gap-3">
                  <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
                    <User className="h-6 w-6 text-primary" />
                  </div>
                  <div>
                    <p className="font-semibold">
                      {selectedContact.first_name} {selectedContact.last_name}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {selectedContact.email}
                    </p>
                  </div>
                </div>
              </Card>

              {hasTagPlacements ? (
                <div>
                  <Label className="mb-2 block">Tag Values Preview</Label>
                  <Card className="p-4">
                    <div className="space-y-3">
                      {tagPlacements.map((placement) => (
                        <div
                          key={placement.id}
                          className="flex items-center justify-between py-2 border-b last:border-0"
                        >
                          <span className="text-sm font-mono text-muted-foreground">
                            {`{{${placement.tag_key}}}`}
                          </span>
                          <div className="flex items-center gap-2">
                            {resolvedTags[placement.tag_key] ? (
                              <>
                                <CheckCircle className="h-4 w-4 text-green-600" />
                                <span className="text-sm font-medium">
                                  {resolvedTags[placement.tag_key]}
                                </span>
                              </>
                            ) : (
                              <>
                                <AlertCircle className="h-4 w-4 text-amber-500" />
                                <span className="text-sm text-muted-foreground italic">
                                  No value
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </Card>
                </div>
              ) : (
                <Card className="p-4">
                  <p className="text-sm text-muted-foreground">
                    The document will be downloaded as-is without any data merging.
                  </p>
                </Card>
              )}
            </div>

            <DialogFooter className="flex-col sm:flex-row gap-2">
              <Button variant="outline" onClick={handleBack}>
                Back
              </Button>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={handleGeneratePdf}
                  disabled={generating}
                  className="gap-2"
                >
                  <Download className="h-4 w-4" />
                  Download PDF
                </Button>
                <Button
                  onClick={() => {
                    toast.info("Send for signature functionality coming soon");
                  }}
                  className="gap-2"
                >
                  <Send className="h-4 w-4" />
                  Send for Signature
                </Button>
              </div>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
};
