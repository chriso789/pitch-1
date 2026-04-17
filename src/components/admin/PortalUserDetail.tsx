/**
 * Portal User Detail Panel
 * Manage portal user — open as user, upload docs, request signatures, resend invite, verify access
 */

import React, { useRef, useState } from "react";
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
  Activity,
  Shield,
  ExternalLink,
  UserX,
  Send,
  Circle,
  Eye,
  Upload,
  FileSignature,
  CheckCircle2,
  Loader2,
  FileStack,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { PortalUser, usePortalActivity, useRevokePortalAccess } from "@/hooks/usePortalAdmin";
import { PortalPermissionsEditor } from "./PortalPermissionsEditor";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { RequestSignatureDialog } from "@/components/signatures/RequestSignatureDialog";
import { SmartDocPickerDialog } from "./SmartDocPickerDialog";

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
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [openingAsUser, setOpeningAsUser] = useState(false);
  const [resending, setResending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [smartDocOpen, setSmartDocOpen] = useState(false);
  const [sigDialog, setSigDialog] = useState<{ open: boolean; documentId: string; documentTitle: string }>({
    open: false,
    documentId: "",
    documentTitle: "",
  });

  const handleRevoke = async () => {
    if (!user) return;
    try {
      await revokeAccess.mutateAsync(user.contact_id);
      toast({ title: "Access Revoked", description: `Portal access for ${user.first_name} ${user.last_name} has been revoked.` });
      onOpenChange(false);
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    }
  };

  const callInvite = async (mode: "invite" | "resend" | "link_only") => {
    if (!user) throw new Error("No user");
    const { data, error } = await supabase.functions.invoke("homeowner-portal-invite", {
      body: { contact_id: user.contact_id, mode },
    });
    if (error) throw error;
    if ((data as any)?.error) throw new Error((data as any).error);
    return data as { success: boolean; portal_url: string };
  };

  const handleOpenAsUser = async () => {
    if (!user) return;
    setOpeningAsUser(true);
    try {
      const res = await callInvite("link_only");
      window.open(res.portal_url, "_blank", "noopener,noreferrer");
      toast({ title: "Portal opened", description: "Opened the homeowner's portal in a new tab." });
    } catch (e: any) {
      toast({ title: "Could not open portal", description: e.message, variant: "destructive" });
    } finally {
      setOpeningAsUser(false);
    }
  };

  const handleResendInvite = async () => {
    if (!user) return;
    setResending(true);
    try {
      await callInvite("resend");
      toast({ title: "Invite Resent", description: `Email sent to ${user.email}` });
    } catch (e: any) {
      toast({ title: "Failed to resend", description: e.message, variant: "destructive" });
    } finally {
      setResending(false);
    }
  };

  const handleUploadClick = () => fileInputRef.current?.click();

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // reset
    if (!file || !user) return;
    setUploading(true);
    try {
      const { data: { user: authUser } } = await supabase.auth.getUser();
      const { data: profile } = await supabase
        .from("profiles")
        .select("tenant_id, active_tenant_id")
        .eq("id", authUser?.id || "")
        .single();
      const tenantId = profile?.active_tenant_id || profile?.tenant_id;
      if (!tenantId) throw new Error("No tenant");

      const safeName = file.name.replace(/[^\w.\-]/g, "_");
      const path = `${tenantId}/${user.contact_id}/${Date.now()}_${safeName}`;
      const { error: upErr } = await supabase.storage.from("documents").upload(path, file, {
        cacheControl: "3600",
        upsert: false,
      });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from("documents").getPublicUrl(path);

      const { data: doc, error: docErr } = await supabase
        .from("documents")
        .insert({
          tenant_id: tenantId,
          contact_id: user.contact_id,
          project_id: user.project_id,
          filename: file.name,
          file_path: pub.publicUrl,
          file_size: file.size,
          mime_type: file.type,
          document_type: "homeowner_shared",
          is_visible_to_homeowner: true,
          uploaded_by: authUser?.id,
          description: `Shared with ${user.first_name} ${user.last_name} via Portal admin`,
        })
        .select()
        .single();
      if (docErr) throw docErr;

      toast({ title: "Document uploaded", description: `${file.name} is now visible in their portal.` });

      // Offer to immediately request signature
      setSigDialog({ open: true, documentId: doc.id, documentTitle: file.name });
    } catch (err: any) {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  if (!user) return null;

  // Verified access = they have actually logged in at least once
  const hasSignedIn = !!user.last_login || !!user.first_login;

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
    <>
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
                  {user.is_online ? "Online now" : hasSignedIn ? "Has signed in" : "Hasn't signed in yet"}
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

              {/* Quick Actions — primary admin tasks */}
              <div className="space-y-2">
                <h4 className="text-sm font-semibold mb-3">Quick Actions</h4>
                <div className="grid grid-cols-2 gap-2">
                  <Button variant="default" onClick={handleOpenAsUser} disabled={openingAsUser}>
                    {openingAsUser ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Eye className="h-4 w-4 mr-2" />}
                    Open Portal
                  </Button>
                  <Button variant="outline" onClick={handleResendInvite} disabled={resending}>
                    {resending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
                    Resend Invite
                  </Button>
                  <Button variant="outline" onClick={handleUploadClick} disabled={uploading}>
                    {uploading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}
                    Upload File
                  </Button>
                  <Button variant="outline" onClick={() => setSmartDocOpen(true)}>
                    <FileStack className="h-4 w-4 mr-2" />
                    Add SmartDoc
                  </Button>
                  <Button
                    variant="outline"
                    onClick={handleUploadClick}
                    disabled={uploading}
                    className="col-span-2"
                    title="Upload a document — you'll be prompted to request signature"
                  >
                    <FileSignature className="h-4 w-4 mr-2" />
                    Request Signature
                  </Button>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  onChange={handleFileSelected}
                  accept=".pdf,.doc,.docx,.png,.jpg,.jpeg"
                />
              </div>

              <Separator />

              {/* Access Status */}
              <div>
                <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
                  <Shield className="h-4 w-4" />
                  Access Verification
                </h4>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground">Has signed in</span>
                    {hasSignedIn ? (
                      <Badge className="bg-green-500/10 text-green-600 gap-1">
                        <CheckCircle2 className="h-3 w-3" /> Verified
                      </Badge>
                    ) : (
                      <Badge variant="outline">Not yet</Badge>
                    )}
                  </div>
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
                    {activities.map((activity) => (
                      <div
                        key={activity.id}
                        className="flex items-center justify-between text-sm py-1"
                      >
                        <span>{getActionLabel(activity.action_type)}</span>
                        <span className="text-muted-foreground text-xs">
                          {formatDistanceToNow(new Date(activity.created_at), { addSuffix: true })}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No recent activity</p>
                )}
              </div>

              <Separator />

              {/* Secondary actions */}
              <div className="space-y-2">
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
                        This will remove all active sessions for {user.first_name} {user.last_name}. They
                        will no longer be able to access the homeowner portal.
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
          </ScrollArea>
        </SheetContent>
      </Sheet>

      {sigDialog.open && (
        <RequestSignatureDialog
          open={sigDialog.open}
          onClose={() => setSigDialog({ open: false, documentId: "", documentTitle: "" })}
          documentId={sigDialog.documentId}
          documentType="smart_doc_instance"
          documentTitle={sigDialog.documentTitle}
          defaultRecipient={{
            name: `${user.first_name} ${user.last_name}`.trim(),
            email: user.email,
          }}
          onSuccess={() => {
            toast({ title: "Signature requested", description: `${user.first_name} will receive an email to sign.` });
            setSigDialog({ open: false, documentId: "", documentTitle: "" });
          }}
        />
      )}

      <SmartDocPickerDialog
        open={smartDocOpen}
        onOpenChange={setSmartDocOpen}
        contactId={user.contact_id}
        projectId={user.project_id}
        recipientName={`${user.first_name} ${user.last_name}`.trim()}
      />
    </>
  );
};
