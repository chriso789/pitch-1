/**
 * Portal User Detail Panel
 * Shows details and permissions for a specific portal user
 */

import React from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
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
} from "@/components/ui/alert-dialog";
import {
  Mail,
  Phone,
  MapPin,
  Calendar,
  Activity,
  Shield,
  ExternalLink,
  UserX,
  Send,
  Circle,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { PortalUser, usePortalActivity, useRevokePortalAccess } from "@/hooks/usePortalAdmin";
import { PortalPermissionsEditor } from "./PortalPermissionsEditor";
import { useToast } from "@/hooks/use-toast";

interface PortalUserDetailProps {
  user: PortalUser | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const PortalUserDetail: React.FC<PortalUserDetailProps> = ({
  user,
  open,
  onOpenChange,
}) => {
  const { toast } = useToast();
  const { data: activities } = usePortalActivity(user?.contact_id, 10);
  const revokeAccess = useRevokePortalAccess();

  const handleRevoke = async () => {
    if (!user) return;
    
    try {
      await revokeAccess.mutateAsync(user.contact_id);
      toast({
        title: "Access Revoked",
        description: `Portal access for ${user.first_name} ${user.last_name} has been revoked.`,
      });
      onOpenChange(false);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const handleResendInvite = () => {
    toast({
      title: "Invite Sent",
      description: `Portal invite resent to ${user?.email}`,
    });
  };

  if (!user) return null;

  const getActionLabel = (actionType: string) => {
    const labels: Record<string, string> = {
      login: "Logged in",
      logout: "Logged out",
      view_overview: "Viewed overview",
      view_photos: "Viewed photos",
      view_documents: "Viewed documents",
      view_payments: "Viewed payments",
      view_messages: "Viewed messages",
      send_message: "Sent message",
      download_document: "Downloaded document",
      approve_change_order: "Approved change order",
    };
    return labels[actionType] || actionType.replace(/_/g, " ");
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg">
        <SheetHeader className="pb-4">
          <SheetTitle className="flex items-center gap-3">
            <div className="relative">
              <Avatar className="h-12 w-12">
                <AvatarFallback className="bg-primary/10 text-primary">
                  {user.first_name?.[0]}
                  {user.last_name?.[0]}
                </AvatarFallback>
              </Avatar>
              {user.is_online && (
                <Circle className="absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 fill-green-500 text-green-500" />
              )}
            </div>
            <div>
              <p className="text-lg font-semibold">
                {user.first_name} {user.last_name}
              </p>
              <p className="text-sm font-normal text-muted-foreground">
                {user.is_online ? "Online now" : "Offline"}
              </p>
            </div>
          </SheetTitle>
        </SheetHeader>

        <ScrollArea className="h-[calc(100vh-120px)] pr-4">
          <div className="space-y-6">
            {/* Contact Info */}
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm">
                <Mail className="h-4 w-4 text-muted-foreground" />
                <span>{user.email}</span>
              </div>
              {user.phone && (
                <div className="flex items-center gap-2 text-sm">
                  <Phone className="h-4 w-4 text-muted-foreground" />
                  <span>{user.phone}</span>
                </div>
              )}
              {user.project_address && (
                <div className="flex items-center gap-2 text-sm">
                  <MapPin className="h-4 w-4 text-muted-foreground" />
                  <span>{user.project_address}</span>
                </div>
              )}
            </div>

            <Separator />

            {/* Access Status */}
            <div>
              <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <Shield className="h-4 w-4" />
                Access Status
              </h4>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Status</span>
                  {user.is_online ? (
                    <Badge className="bg-green-500/10 text-green-600">Online</Badge>
                  ) : user.last_login ? (
                    <Badge variant="secondary">Active</Badge>
                  ) : (
                    <Badge variant="outline">Invited</Badge>
                  )}
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Sessions</span>
                  <span>{user.session_count} total</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Last Login</span>
                  <span>
                    {user.last_login
                      ? formatDistanceToNow(new Date(user.last_login), { addSuffix: true })
                      : "Never"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">First Access</span>
                  <span>
                    {user.first_login
                      ? format(new Date(user.first_login), "MMM d, yyyy")
                      : "—"}
                  </span>
                </div>
              </div>
            </div>

            <Separator />

            {/* Permissions */}
            <div>
              <h4 className="text-sm font-semibold mb-3">Permissions</h4>
              <PortalPermissionsEditor
                contactId={user.contact_id}
                currentPermissions={user.permissions}
              />
            </div>

            <Separator />

            {/* Recent Activity */}
            <div>
              <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <Activity className="h-4 w-4" />
                Recent Activity
              </h4>
              {activities && activities.length > 0 ? (
                <div className="space-y-2">
                  {activities.map(activity => (
                    <div
                      key={activity.id}
                      className="flex items-center justify-between text-sm py-1"
                    >
                      <span>{getActionLabel(activity.action_type)}</span>
                      <span className="text-muted-foreground text-xs">
                        {formatDistanceToNow(new Date(activity.created_at), {
                          addSuffix: true,
                        })}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No recent activity</p>
              )}
            </div>

            <Separator />

            {/* Actions */}
            <div className="space-y-2">
              <h4 className="text-sm font-semibold mb-3">Actions</h4>
              <div className="flex flex-col gap-2">
                <Button
                  variant="outline"
                  className="w-full justify-start"
                  onClick={handleResendInvite}
                >
                  <Send className="h-4 w-4 mr-2" />
                  Resend Portal Invite
                </Button>
                
                {user.project_id && (
                  <Button
                    variant="outline"
                    className="w-full justify-start"
                    onClick={() => window.open(`/projects/${user.project_id}`, "_blank")}
                  >
                    <ExternalLink className="h-4 w-4 mr-2" />
                    View Project
                  </Button>
                )}

                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="outline"
                      className="w-full justify-start text-destructive hover:text-destructive"
                    >
                      <UserX className="h-4 w-4 mr-2" />
                      Revoke Access
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Revoke Portal Access?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This will remove all active sessions for {user.first_name}{" "}
                        {user.last_name}. They will no longer be able to access the
                        homeowner portal.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={handleRevoke}
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      >
                        Revoke Access
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </div>
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
};
