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
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface DocumentRenameDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  document: {
    id: string;
    filename: string;
  } | null;
  onRenameComplete: () => void;
}

export const DocumentRenameDialog: React.FC<DocumentRenameDialogProps> = ({
  open,
  onOpenChange,
  document,
  onRenameComplete,
}) => {
  const [newFilename, setNewFilename] = useState("");
  const [saving, setSaving] = useState(false);

  // Extract name and extension
  const getFileParts = (filename: string) => {
    const lastDot = filename.lastIndexOf(".");
    if (lastDot === -1) return { name: filename, ext: "" };
    return {
      name: filename.substring(0, lastDot),
      ext: filename.substring(lastDot),
    };
  };

  useEffect(() => {
    if (document && open) {
      const { name } = getFileParts(document.filename);
      setNewFilename(name);
    }
  }, [document, open]);

  const handleSave = async () => {
    if (!document || !newFilename.trim()) {
      toast.error("Please enter a filename");
      return;
    }

    setSaving(true);
    try {
      const { ext } = getFileParts(document.filename);
      const fullFilename = newFilename.trim() + ext;

      const { error } = await supabase
        .from("documents")
        .update({ filename: fullFilename })
        .eq("id", document.id);

      if (error) throw error;

      toast.success("Document renamed successfully");
      onRenameComplete();
      onOpenChange(false);
    } catch (error) {
      console.error("Error renaming document:", error);
      toast.error("Failed to rename document");
    } finally {
      setSaving(false);
    }
  };

  if (!document) return null;

  const { ext } = getFileParts(document.filename);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Rename Document</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="filename">Filename</Label>
            <div className="flex items-center gap-2">
              <Input
                id="filename"
                value={newFilename}
                onChange={(e) => setNewFilename(e.target.value)}
                placeholder="Enter new filename"
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSave();
                }}
              />
              <span className="text-muted-foreground text-sm font-mono">
                {ext}
              </span>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
