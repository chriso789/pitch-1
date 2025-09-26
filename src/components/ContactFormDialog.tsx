import React, { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Plus, UserPlus } from "lucide-react";
import ContactForm from "@/features/contacts/components/ContactForm";

interface ContactFormDialogProps {
  trigger?: React.ReactNode;
  onContactCreated?: (contact: any) => void;
  buttonText?: string;
  buttonVariant?: "default" | "outline" | "secondary" | "ghost" | "link" | "destructive";
}

export const ContactFormDialog: React.FC<ContactFormDialogProps> = ({
  trigger,
  onContactCreated,
  buttonText = "New Contact",
  buttonVariant = "default",
}) => {
  const [open, setOpen] = useState(false);

  const handleContactSubmit = (contact: any) => {
    onContactCreated?.(contact);
    setOpen(false);
  };

  const handleCancel = () => {
    setOpen(false);
  };

  const defaultTrigger = (
    <Button variant={buttonVariant} className="shadow-soft transition-smooth">
      <Plus className="h-4 w-4 mr-2" />
      {buttonText}
    </Button>
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || defaultTrigger}
      </DialogTrigger>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto bg-card border shadow-strong">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl font-semibold">
            <UserPlus className="h-5 w-5 text-primary" />
            Create New Contact
          </DialogTitle>
        </DialogHeader>
        <div className="mt-4">
          <ContactForm
            onSubmit={handleContactSubmit}
            onCancel={handleCancel}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default ContactFormDialog;