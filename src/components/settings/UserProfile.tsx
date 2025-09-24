import React, { useState, useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Progress } from "@/components/ui/progress";
import { 
  User, 
  Phone, 
  Mail, 
  Building, 
  Camera, 
  Share2, 
  Download,
  ArrowLeft,
  Edit3,
  Save,
  X,
  DollarSign,
  TrendingUp,
  Target,
  Upload
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface UserProfileProps {
  userId: string;
  onClose: () => void;
}

interface UserData {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  role: string;
  company_name: string;
  title: string;
  phone: string;
  is_active: boolean;
  is_developer: boolean;
  metadata: any;
  avatar_url?: string;
  photo_url?: string;
  personal_overhead_rate?: number;
  pay_structure_display?: any;
}

export const UserProfile: React.FC<UserProfileProps> = ({ userId, onClose }) => {
  const [user, setUser] = useState<UserData | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [showBusinessCard, setShowBusinessCard] = useState(false);
  const [uploading, setUploading] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  useEffect(() => {
    loadUser();
  }, [userId]);

  const loadUser = async () => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();

      if (error) throw error;
      setUser(data);
    } catch (error) {
      console.error('Error loading user:', error);
      toast({
        title: "Error",
        description: "Failed to load user profile.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const updateUser = async () => {
    if (!user) return;

    try {
      const { error } = await supabase
        .from('profiles')
        .update({
          first_name: user.first_name,
          last_name: user.last_name,
          company_name: user.company_name,
          title: user.title,
          phone: user.phone,
          metadata: user.metadata
        })
        .eq('id', userId);

      if (error) throw error;

      toast({
        title: "Profile Updated",
        description: "User profile has been updated successfully.",
      });
      setEditing(false);
    } catch (error) {
      console.error('Error updating user:', error);
      toast({
        title: "Error",
        description: "Failed to update user profile.",
        variant: "destructive",
      });
    }
  };

  const handlePhotoUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !user) return;

    setUploading(true);
    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `${userId}/photo.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(fileName, file, { upsert: true });

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('avatars')
        .getPublicUrl(fileName);

      const { error: updateError } = await supabase
        .from('profiles')
        .update({ photo_url: publicUrl, avatar_url: publicUrl } as any)
        .eq('id', userId);

      if (updateError) throw updateError;

      setUser({ ...user, photo_url: publicUrl, avatar_url: publicUrl });
      toast({
        title: "Photo Updated",
        description: "Profile photo has been updated successfully.",
      });
    } catch (error) {
      console.error('Error uploading photo:', error);
      toast({
        title: "Error",
        description: "Failed to upload photo.",
        variant: "destructive",
      });
    } finally {
      setUploading(false);
    }
  };

  const generateBusinessCard = () => {
    if (!user || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Set canvas size for business card (3.5 x 2 inches at 300 DPI)
    canvas.width = 1050;
    canvas.height = 600;

    // Clear canvas with white background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Add gradient background
    const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
    gradient.addColorStop(0, '#f8fafc');
    gradient.addColorStop(1, '#e2e8f0');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Add company logo area (placeholder)
    ctx.fillStyle = '#3b82f6';
    ctx.fillRect(50, 50, 100, 50);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 16px Arial';
    ctx.fillText('LOGO', 75, 80);

    // Add user name
    ctx.fillStyle = '#1e293b';
    ctx.font = 'bold 36px Arial';
    ctx.fillText(`${user.first_name} ${user.last_name}`, 50, 180);

    // Add title
    ctx.fillStyle = '#64748b';
    ctx.font = '24px Arial';
    ctx.fillText(user.title || 'Team Member', 50, 220);

    // Add company
    ctx.fillStyle = '#3b82f6';
    ctx.font = 'bold 20px Arial';
    ctx.fillText(user.company_name || 'Company', 50, 260);

    // Add contact info
    ctx.fillStyle = '#475569';
    ctx.font = '18px Arial';
    
    // Email
    ctx.fillText(`✉ ${user.email}`, 50, 320);
    
    // Phone
    if (user.phone) {
      ctx.fillText(`📞 ${user.phone}`, 50, 350);
    }

    // Add border
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 2;
    ctx.strokeRect(0, 0, canvas.width, canvas.height);
  };

  const downloadBusinessCard = () => {
    if (!canvasRef.current) return;

    const link = document.createElement('a');
    link.download = `${user?.first_name}_${user?.last_name}_business_card.png`;
    link.href = canvasRef.current.toDataURL();
    link.click();
  };

  const shareBusinessCard = async () => {
    if (!canvasRef.current) return;

    try {
      const canvas = canvasRef.current;
      canvas.toBlob(async (blob) => {
        if (!blob) return;

        if (navigator.share && navigator.canShare({ files: [new File([blob], 'business_card.png', { type: 'image/png' })] })) {
          await navigator.share({
            title: `${user?.first_name} ${user?.last_name} - Business Card`,
            text: `Contact information for ${user?.first_name} ${user?.last_name}`,
            files: [new File([blob], 'business_card.png', { type: 'image/png' })]
          });
        } else {
          // Fallback to download
          downloadBusinessCard();
          toast({
            description: "Business card downloaded. You can now share it via text or airdrop.",
          });
        }
      }, 'image/png');
    } catch (error) {
      console.error('Error sharing business card:', error);
      toast({
        title: "Error",
        description: "Failed to share business card.",
        variant: "destructive",
      });
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="text-center py-8 text-muted-foreground">
            Loading user profile...
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!user) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="text-center py-8 text-muted-foreground">
            User not found.
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Button variant="ghost" onClick={onClose} className="flex items-center gap-2">
          <ArrowLeft className="h-4 w-4" />
          Back to Users
        </Button>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => setShowBusinessCard(true)}
            className="flex items-center gap-2"
          >
            <Share2 className="h-4 w-4" />
            Business Card
          </Button>
          {editing ? (
            <div className="flex items-center gap-2">
              <Button onClick={updateUser} className="flex items-center gap-2">
                <Save className="h-4 w-4" />
                Save
              </Button>
              <Button variant="outline" onClick={() => setEditing(false)}>
                <X className="h-4 w-4" />
                Cancel
              </Button>
            </div>
          ) : (
            <Button onClick={() => setEditing(true)} className="flex items-center gap-2">
              <Edit3 className="h-4 w-4" />
              Edit Profile
            </Button>
          )}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-4">
            <div className="relative">
              <Avatar className="h-16 w-16">
                <AvatarImage src={user.avatar_url} />
                <AvatarFallback>
                  {user.first_name?.[0]}{user.last_name?.[0]}
                </AvatarFallback>
              </Avatar>
              {editing && (
                <Button
                  size="sm"
                  className="absolute -bottom-2 -right-2 h-8 w-8 rounded-full"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                >
                  <Camera className="h-3 w-3" />
                </Button>
              )}
            </div>
            <div>
              <h2 className="text-2xl font-bold">
                {user.first_name} {user.last_name}
              </h2>
              <div className="flex items-center gap-2 mt-1">
                <Badge variant={user.is_active ? "default" : "secondary"}>
                  {user.is_active ? "Active" : "Inactive"}
                </Badge>
                <Badge variant="outline">{user.role}</Badge>
              </div>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="first_name">First Name</Label>
                <Input
                  id="first_name"
                  value={user.first_name}
                  onChange={(e) => setUser({ ...user, first_name: e.target.value })}
                  disabled={!editing}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="last_name">Last Name</Label>
                <Input
                  id="last_name"
                  value={user.last_name}
                  onChange={(e) => setUser({ ...user, last_name: e.target.value })}
                  disabled={!editing}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  value={user.email}
                  disabled
                  className="bg-muted"
                />
              </div>
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="title">Title</Label>
                <Input
                  id="title"
                  value={user.title}
                  onChange={(e) => setUser({ ...user, title: e.target.value })}
                  disabled={!editing}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="phone">Phone</Label>
                <Input
                  id="phone"
                  value={user.phone}
                  onChange={(e) => setUser({ ...user, phone: e.target.value })}
                  disabled={!editing}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="company">Company</Label>
                <Input
                  id="company"
                  value={user.company_name}
                  onChange={(e) => setUser({ ...user, company_name: e.target.value })}
                  disabled={!editing}
                />
              </div>

              {user.role === 'rep' && (
                <div className="space-y-2">
                  <Label htmlFor="overhead_rate">Personal Overhead Rate (%)</Label>
                  <Input
                    id="overhead_rate"
                    type="number"
                    step="0.1"
                    value={user.personal_overhead_rate || 0}
                    onChange={(e) => setUser({ ...user, personal_overhead_rate: parseFloat(e.target.value) || 0 })}
                    disabled={!editing}
                  />
                  <p className="text-xs text-muted-foreground">
                    This rate will be applied to all projects for commission calculations
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Sales Rep Pay Structure Display */}
          {user.role === 'rep' && (
            <>
              <hr />
              <div className="space-y-4">
                <h3 className="text-lg font-semibold flex items-center gap-2">
                  <DollarSign className="h-5 w-5" />
                  Pay Structure & Performance
                </h3>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Commission Structure */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">Commission Structure</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="flex justify-between items-center">
                        <span className="text-muted-foreground">Personal Overhead Rate:</span>
                        <span className="font-semibold">{user.personal_overhead_rate || 0}%</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-muted-foreground">Payment Method:</span>
                        <Badge variant="outline">Percentage of Sales</Badge>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-muted-foreground">Commission Tier:</span>
                        <Badge>Standard 5%</Badge>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Performance Metrics */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">Performance Metrics</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {performanceMetrics ? (
                        <>
                          <div className="flex justify-between items-center">
                            <span className="text-muted-foreground">Total Sales:</span>
                            <span className="font-semibold">${performanceMetrics.total_sales?.toLocaleString() || 0}</span>
                          </div>
                          <div className="flex justify-between items-center">
                            <span className="text-muted-foreground">Commissions Earned:</span>
                            <span className="font-semibold text-success">${performanceMetrics.total_commission?.toLocaleString() || 0}</span>
                          </div>
                          <div className="flex justify-between items-center">
                            <span className="text-muted-foreground">Conversion Rate:</span>
                            <span className="font-semibold">{performanceMetrics.conversion_rate || 0}%</span>
                          </div>
                        </>
                      ) : (
                        <p className="text-muted-foreground text-sm">Performance data loading...</p>
                      )}
                    </CardContent>
                  </Card>
                </div>

                {/* Commission History */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Recent Commission History</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {commissionHistory.length > 0 ? (
                      <div className="space-y-2">
                        {commissionHistory.slice(0, 5).map((commission) => (
                          <div key={commission.id} className="flex justify-between items-center p-2 bg-muted/30 rounded">
                            <div>
                              <p className="font-medium text-sm">
                                Project Commission
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {new Date(commission.calculated_at).toLocaleDateString()}
                              </p>
                            </div>
                            <div className="text-right">
                              <p className="font-semibold text-success">
                                ${commission.commission_amount.toLocaleString()}
                              </p>
                              <Badge variant="outline" className="text-xs">
                                {commission.status}
                              </Badge>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-muted-foreground text-sm text-center py-4">
                        No commission history available yet
                      </p>
                    )}
                  </CardContent>
                </Card>
              </div>
            </>
          )}
              <div className="space-y-2">
                <Label htmlFor="title">Title</Label>
                <Input
                  id="title"
                  value={user.title || ""}
                  onChange={(e) => setUser({ ...user, title: e.target.value })}
                  disabled={!editing}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="company_name">Company</Label>
                <Input
                  id="company_name"
                  value={user.company_name || ""}
                  onChange={(e) => setUser({ ...user, company_name: e.target.value })}
                  disabled={!editing}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="phone">Phone</Label>
                <Input
                  id="phone"
                  value={user.phone || ""}
                  onChange={(e) => setUser({ ...user, phone: e.target.value })}
                  disabled={!editing}
                />
              </div>
            </div>
          </div>

          {editing && (
            <div className="space-y-2">
              <Label htmlFor="notes">Notes</Label>
              <Textarea
                id="notes"
                value={user.metadata?.notes || ""}
                onChange={(e) => setUser({ 
                  ...user, 
                  metadata: { ...user.metadata, notes: e.target.value }
                })}
                placeholder="Add notes about this user..."
                rows={3}
              />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Hidden file input for avatar upload */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handlePhotoUpload}
        className="hidden"
      />

      {/* Business Card Dialog */}
      <Dialog open={showBusinessCard} onOpenChange={setShowBusinessCard}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Business Card Preview</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="border rounded-lg p-4 bg-muted/30">
              <canvas
                ref={canvasRef}
                className="w-full h-auto border rounded"
                style={{ maxWidth: '100%', height: 'auto' }}
              />
            </div>
            <div className="flex items-center gap-2">
              <Button
                onClick={() => {
                  generateBusinessCard();
                  setTimeout(downloadBusinessCard, 100);
                }}
                className="flex items-center gap-2"
              >
                <Download className="h-4 w-4" />
                Download
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  generateBusinessCard();
                  setTimeout(shareBusinessCard, 100);
                }}
                className="flex items-center gap-2"
              >
                <Share2 className="h-4 w-4" />
                Share
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};