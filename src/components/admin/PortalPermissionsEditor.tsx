/**
 * Portal Permissions Editor Component
 * Toggle controls for homeowner portal permissions
 */

import React, { useState, useEffect } from "react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Loader2, Save } from "lucide-react";
import {
  PortalPermissions,
  DEFAULT_PERMISSIONS,
  useUpdatePortalPermissions,
} from "@/hooks/usePortalAdmin";
import { useToast } from "@/hooks/use-toast";

interface PortalPermissionsEditorProps {
  contactId: string;
  currentPermissions: PortalPermissions | null;
  compact?: boolean;
}

type PermissionKey = keyof Omit<PortalPermissions, 'id' | 'contact_id' | 'visible_document_categories' | 'visible_photo_categories'>;

const PERMISSION_LABELS: Record<PermissionKey, { label: string; description: string }> = {
  can_view_project_status: {
    label: "View Project Status",
    description: "See project progress and status",
  },
  can_view_timeline: {
    label: "View Timeline",
    description: "See project milestones and schedule",
  },
  can_view_photos: {
    label: "View Photos",
    description: "Access project photo gallery",
  },
  can_view_documents: {
    label: "View Documents",
    description: "See contracts and proposals",
  },
  can_download_documents: {
    label: "Download Documents",
    description: "Download document files",
  },
  can_view_estimates: {
    label: "View Estimates",
    description: "See detailed cost estimates",
  },
  can_view_payments: {
    label: "View Payments",
    description: "See payment schedule and history",
  },
  can_send_messages: {
    label: "Send Messages",
    description: "Communicate with the team",
  },
  can_approve_change_orders: {
    label: "Approve Change Orders",
    description: "Approve scope changes",
  },
  can_use_ai_chat: {
    label: "AI Chat Access",
    description: "Use AI assistant",
  },
};

export const PortalPermissionsEditor: React.FC<PortalPermissionsEditorProps> = ({
  contactId,
  currentPermissions,
  compact = false,
}) => {
  const { toast } = useToast();
  const updatePermissions = useUpdatePortalPermissions();
  
  const [permissions, setPermissions] = useState<Omit<PortalPermissions, 'id' | 'contact_id'>>({
    ...DEFAULT_PERMISSIONS,
  });
  const [hasChanges, setHasChanges] = useState(false);

  // Initialize with current permissions
  useEffect(() => {
    if (currentPermissions) {
      setPermissions({
        can_view_project_status: currentPermissions.can_view_project_status,
        can_view_timeline: currentPermissions.can_view_timeline,
        can_view_photos: currentPermissions.can_view_photos,
        can_view_documents: currentPermissions.can_view_documents,
        can_download_documents: currentPermissions.can_download_documents,
        can_view_estimates: currentPermissions.can_view_estimates,
        can_view_payments: currentPermissions.can_view_payments,
        can_send_messages: currentPermissions.can_send_messages,
        can_approve_change_orders: currentPermissions.can_approve_change_orders,
        can_use_ai_chat: currentPermissions.can_use_ai_chat,
        visible_document_categories: currentPermissions.visible_document_categories,
        visible_photo_categories: currentPermissions.visible_photo_categories,
      });
    }
    setHasChanges(false);
  }, [currentPermissions]);

  const handleToggle = (key: PermissionKey) => {
    setPermissions(prev => ({
      ...prev,
      [key]: !prev[key],
    }));
    setHasChanges(true);
  };

  const handleSave = async () => {
    try {
      await updatePermissions.mutateAsync({
        contactId,
        permissions,
      });
      setHasChanges(false);
      toast({
        title: "Permissions Updated",
        description: "Portal permissions have been saved.",
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const permissionKeys = Object.keys(PERMISSION_LABELS) as PermissionKey[];

  return (
    <div className="space-y-4">
      <div className={`space-y-3 ${compact ? "grid grid-cols-2 gap-x-4 gap-y-2" : ""}`}>
        {permissionKeys.map(key => (
          <div
            key={key}
            className={`flex items-center justify-between ${compact ? "" : "py-1"}`}
          >
            <div className={compact ? "" : "space-y-0.5"}>
              <Label htmlFor={key} className="text-sm font-medium cursor-pointer">
                {PERMISSION_LABELS[key].label}
              </Label>
              {!compact && (
                <p className="text-xs text-muted-foreground">
                  {PERMISSION_LABELS[key].description}
                </p>
              )}
            </div>
            <Switch
              id={key}
              checked={permissions[key] as boolean}
              onCheckedChange={() => handleToggle(key)}
            />
          </div>
        ))}
      </div>

      {hasChanges && (
        <Button
          onClick={handleSave}
          disabled={updatePermissions.isPending}
          className="w-full"
          size="sm"
        >
          {updatePermissions.isPending ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Save className="h-4 w-4 mr-2" />
          )}
          Save Permissions
        </Button>
      )}
    </div>
  );
};
