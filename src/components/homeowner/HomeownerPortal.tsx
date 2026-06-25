import { useState, useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { 
  Home, 
  FileText, 
  DollarSign, 
  MessageSquare, 
  Image as ImageIcon,
  Calendar,
  CheckCircle,
  Clock,
  Download,
  Send,
  CreditCard,
  AlertCircle,
  ExternalLink,
  Phone,
  Mail,
  Building,
  ClipboardList
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { SimplifiedProjectTimeline } from "./SimplifiedProjectTimeline";
import { HomeownerAIChat } from "./HomeownerAIChat";
import { CustomerPaymentSection } from "@/features/portal/components/CustomerPaymentSection";

interface Project {
  id: string;
  name: string;
  status: string;
  start_date: string;
  end_date: string;
  progress_percentage: number;
  contract_amount: number;
  amount_paid: number;
  address: string;
}

interface Document {
  id: string;
  name: string;
  type: string;
  url: string;
  created_at: string;
}

interface Photo {
  id: string;
  url: string;
  caption: string;
  category: string;
  created_at: string;
}

interface Payment {
  id: string;
  amount: number;
  status: string;
  due_date: string;
  paid_at: string | null;
  description: string;
}

interface Message {
  id: string;
  message: string;
  sender_type: string;
  created_at: string;
}

interface ChangeOrder {
  id: string;
  title: string;
  description: string;
  cost_impact: number;
  status: string;
  created_at: string;
}

export function HomeownerPortal() {
  const [activeTab, setActiveTab] = useState("overview");
  const [project, setProject] = useState<Project | null>(null);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [changeOrders, setChangeOrders] = useState<ChangeOrder[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [newMessage, setNewMessage] = useState("");
  const [contactInfo, setContactInfo] = useState<any>(null);
  const [company, setCompany] = useState<any>(null);
  const [isUploading, setIsUploading] = useState(false);
  const { toast } = useToast();


  useEffect(() => {
    loadPortalData();
  }, []);

  const loadPortalData = async () => {
    try {
      setIsLoading(true);
      
      // Get session from localStorage
      const sessionData = localStorage.getItem("homeowner_session");
      if (!sessionData) {
        console.error("No homeowner session found");
        setIsLoading(false);
        return;
      }

      const session = JSON.parse(sessionData);

      // Homeowners use a custom portal session, not Supabase Auth, so load through
      // the Edge Function instead of browser-side RLS-protected table queries.
      const { data, error } = await supabase.functions.invoke("homeowner-password", {
        body: { action: "portal-data", token: session.token },
      });

      if (error || !data?.success) {
        console.error("Invalid or expired session");
        localStorage.removeItem("homeowner_session");
        setIsLoading(false);
        return;
      }

      setContactInfo(data.contact || null);
      setCompany(data.company || null);

      setProject(data.project || null);
      setPhotos(data.photos || []);
      setChangeOrders(data.changeOrders || []);
      setMessages(data.messages || []);
      setPayments((data.payments || []).map((payment: any) => ({
        id: payment.id,
        amount: Number(payment.amount || 0),
        status: payment.status || "pending",
        due_date: payment.created_at,
        paid_at: payment.payment_date || null,
        description: payment.description || "Payment",
      })));
      setDocuments(data.documents || []);
    } catch (error) {
      console.error("Error loading portal data:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const sendMessage = async () => {
    if (!newMessage.trim() || !project) return;

    try {
      const sessionData = localStorage.getItem("homeowner_session");
      const session = sessionData ? JSON.parse(sessionData) : null;
      const { error, data } = await supabase.functions.invoke("homeowner-password", {
        body: { action: "send-message", token: session?.token, project_id: project.id, message: newMessage },
      });

      if (error || !data?.success) throw new Error(data?.error || "Unable to send message");

      setNewMessage("");
      loadPortalData();
      toast({
        title: "Message Sent",
        description: "Your message has been delivered to the team"
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive"
      });
    }
  };

  const approveChangeOrder = async (changeOrderId: string) => {
    try {
      const sessionData = localStorage.getItem("homeowner_session");
      const session = sessionData ? JSON.parse(sessionData) : null;
      const { error, data } = await supabase.functions.invoke("homeowner-password", {
        body: { action: "approve-change-order", token: session?.token, change_order_id: changeOrderId },
      });

      if (error || !data?.success) throw new Error(data?.error || "Unable to approve change order");

      toast({
        title: "Change Order Approved",
        description: "Thank you for your approval"
      });
      loadPortalData();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive"
      });
    }
  };

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !project) return;
    if (file.size > 10 * 1024 * 1024) {
      toast({ title: "File too large", description: "Photos must be under 10MB", variant: "destructive" });
      return;
    }
    try {
      setIsUploading(true);
      const sessionData = localStorage.getItem("homeowner_session");
      const session = sessionData ? JSON.parse(sessionData) : null;
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const { data, error } = await supabase.functions.invoke("homeowner-password", {
        body: {
          action: "upload-photo",
          token: session?.token,
          project_id: project.id,
          file_base64: base64,
          file_name: file.name,
          mime_type: file.type,
        },
      });
      if (error || !data?.success) throw new Error(data?.error || "Upload failed");
      toast({ title: "Photo uploaded", description: "Your photo has been shared with the team." });
      loadPortalData();
    } catch (err: any) {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    } finally {
      setIsUploading(false);
    }
  };

  const getStatusColor = (status: string) => {

    switch (status?.toLowerCase()) {
      case "in_progress": return "bg-blue-500/10 text-blue-500";
      case "completed": return "bg-green-500/10 text-green-500";
      case "on_hold": return "bg-yellow-500/10 text-yellow-500";
      default: return "bg-muted text-muted-foreground";
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Card className="max-w-md w-full mx-4">
          <CardContent className="py-8 text-center">
            <AlertCircle className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
            <h2 className="text-xl font-semibold mb-2">No Active Project</h2>
            <p className="text-muted-foreground">
              We couldn't find an active project associated with your account.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="bg-card border-b border-border">
        <div className="max-w-6xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              {company?.logo_url ? (
                <img src={company.logo_url} alt={company.name || "Company"} className="h-12 w-12 rounded-lg object-contain bg-white border" />
              ) : (
                <div className="h-12 w-12 bg-primary/10 rounded-lg flex items-center justify-center">
                  <Building className="h-6 w-6 text-primary" />
                </div>
              )}
              <div>
                <h1 className="font-semibold text-foreground text-lg leading-tight">
                  {company?.name || "Project Portal"}
                </h1>
                <p className="text-sm text-muted-foreground">
                  Welcome back, {contactInfo?.first_name}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {company?.phone && (
                <a href={`tel:${company.phone}`} className="hidden sm:flex items-center gap-1 text-sm text-muted-foreground hover:text-primary">
                  <Phone className="h-3.5 w-3.5" />
                  {company.phone}
                </a>
              )}
              {company?.email && (
                <a href={`mailto:${company.email}`} className="hidden sm:flex items-center gap-1 text-sm text-muted-foreground hover:text-primary">
                  <Mail className="h-3.5 w-3.5" />
                  {company.email}
                </a>
              )}
              <Badge variant="outline" className={getStatusColor(project.status)}>
                {project.status?.replace("_", " ") || "Active"}
              </Badge>
            </div>
          </div>

        </div>
      </header>

      {/* Project Summary Banner */}
      <div className="bg-primary/5 border-b">
        <div className="max-w-6xl mx-auto px-4 py-6">
          <div className="grid md:grid-cols-4 gap-4">
            <div>
              <p className="text-sm text-muted-foreground">Project</p>
              <p className="font-semibold">{project.name}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Address</p>
              <p className="font-medium text-sm">{project.address}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Progress</p>
              <div className="flex items-center gap-2">
                <Progress value={project.progress_percentage} className="h-2 flex-1" />
                <span className="text-sm font-medium">{project.progress_percentage}%</span>
              </div>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Contract Value</p>
              <p className="font-semibold text-lg">${project.contract_amount.toLocaleString()}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-6xl mx-auto px-4 py-6">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="mb-6">
            <TabsTrigger value="overview" className="flex items-center gap-2">
              <Home className="h-4 w-4" />
              Overview
            </TabsTrigger>
            <TabsTrigger value="photos" className="flex items-center gap-2">
              <ImageIcon className="h-4 w-4" />
              Photos
            </TabsTrigger>
            <TabsTrigger value="documents" className="flex items-center gap-2">
              <FileText className="h-4 w-4" />
              Documents
            </TabsTrigger>
            <TabsTrigger value="payments" className="flex items-center gap-2">
              <DollarSign className="h-4 w-4" />
              Payments
            </TabsTrigger>
            <TabsTrigger value="messages" className="flex items-center gap-2">
              <MessageSquare className="h-4 w-4" />
              Messages
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-6">
            <div className="grid md:grid-cols-2 gap-6">
              {/* Project Timeline */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Calendar className="h-5 w-5 text-primary" />
                    Project Timeline
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">Start Date</span>
                    <span className="font-medium">
                      {project.start_date ? format(new Date(project.start_date), "MMM d, yyyy") : "TBD"}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">Expected Completion</span>
                    <span className="font-medium">
                      {project.end_date ? format(new Date(project.end_date), "MMM d, yyyy") : "TBD"}
                    </span>
                  </div>
                  <div className="pt-4">
                    <div className="flex justify-between text-sm mb-2">
                      <span>Overall Progress</span>
                      <span className="font-medium">{project.progress_percentage}%</span>
                    </div>
                    <Progress value={project.progress_percentage} className="h-3" />
                  </div>
                </CardContent>
              </Card>

              {/* Quick Actions */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Quick Actions</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <Button variant="outline" className="w-full justify-start" onClick={() => setActiveTab("messages")}>
                    <MessageSquare className="h-4 w-4 mr-2" />
                    Send a Message
                  </Button>
                  <Button variant="outline" className="w-full justify-start" onClick={() => setActiveTab("photos")}>
                    <ImageIcon className="h-4 w-4 mr-2" />
                    View Project Photos
                  </Button>
                  <Button variant="outline" className="w-full justify-start" onClick={() => setActiveTab("documents")}>
                    <FileText className="h-4 w-4 mr-2" />
                    View Documents
                  </Button>
                  <Button variant="outline" className="w-full justify-start" onClick={() => setActiveTab("payments")}>
                    <CreditCard className="h-4 w-4 mr-2" />
                    Make a Payment
                  </Button>
                </CardContent>
              </Card>
            </div>

            {/* Change Orders */}
            {changeOrders.filter(co => co.status === "pending").length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <AlertCircle className="h-5 w-5 text-yellow-500" />
                    Change Orders Requiring Approval
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {changeOrders.filter(co => co.status === "pending").map((co) => (
                    <div key={co.id} className="border rounded-lg p-4">
                      <div className="flex items-start justify-between">
                        <div>
                          <h4 className="font-medium">{co.title}</h4>
                          <p className="text-sm text-muted-foreground mt-1">{co.description}</p>
                          <p className="text-sm font-medium mt-2">
                            Cost Impact: <span className={co.cost_impact > 0 ? "text-red-500" : "text-green-500"}>
                              {co.cost_impact > 0 ? "+" : ""}${co.cost_impact.toLocaleString()}
                            </span>
                          </p>
                        </div>
                        <Button size="sm" onClick={() => approveChangeOrder(co.id)}>
                          <CheckCircle className="h-4 w-4 mr-1" />
                          Approve
                        </Button>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

            {/* Recent Photos */}
            {photos.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <ImageIcon className="h-5 w-5 text-primary" />
                    Recent Photos
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {photos.slice(0, 4).map((photo) => (
                      <div key={photo.id} className="aspect-square rounded-lg overflow-hidden bg-muted">
                        <img 
                          src={photo.url} 
                          alt={photo.caption}
                          className="w-full h-full object-cover"
                        />
                      </div>
                    ))}
                  </div>
                  {photos.length > 4 && (
                    <Button variant="link" className="mt-3" onClick={() => setActiveTab("photos")}>
                      View all {photos.length} photos →
                    </Button>
                  )}
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="photos" className="space-y-6">
            <Card>
              <CardHeader className="flex flex-row items-start justify-between gap-3">
                <div>
                  <CardTitle>Project Photos</CardTitle>
                  <CardDescription>
                    Photos from your project — share your own with the team too
                  </CardDescription>
                </div>
                <div>
                  <input
                    id="homeowner-photo-upload"
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handlePhotoUpload}
                    disabled={isUploading}
                  />
                  <Button
                    size="sm"
                    onClick={() => document.getElementById("homeowner-photo-upload")?.click()}
                    disabled={isUploading}
                  >
                    <ImageIcon className="h-4 w-4 mr-1" />
                    {isUploading ? "Uploading…" : "Upload Photo"}
                  </Button>
                </div>
              </CardHeader>
              <CardContent>

                {photos.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <ImageIcon className="h-12 w-12 mx-auto mb-3 opacity-50" />
                    <p>No photos have been uploaded yet</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    {photos.map((photo) => (
                      <Dialog key={photo.id}>
                        <DialogTrigger asChild>
                          <div className="aspect-square rounded-lg overflow-hidden bg-muted cursor-pointer hover:opacity-90 transition-opacity">
                            <img 
                              src={photo.url} 
                              alt={photo.caption}
                              className="w-full h-full object-cover"
                            />
                          </div>
                        </DialogTrigger>
                        <DialogContent className="max-w-3xl">
                          <DialogHeader>
                            <DialogTitle>{photo.caption || "Project Photo"}</DialogTitle>
                          </DialogHeader>
                          <img 
                            src={photo.url} 
                            alt={photo.caption}
                            className="w-full rounded-lg"
                          />
                          <p className="text-sm text-muted-foreground">
                            {format(new Date(photo.created_at), "MMMM d, yyyy 'at' h:mm a")}
                          </p>
                        </DialogContent>
                      </Dialog>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="documents" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Project Documents</CardTitle>
                <CardDescription>
                  Contracts, proposals, and other important documents
                </CardDescription>
              </CardHeader>
              <CardContent>
                {documents.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <FileText className="h-12 w-12 mx-auto mb-3 opacity-50" />
                    <p>No documents available yet</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {documents.map((doc) => (
                      <div key={doc.id} className="flex items-center justify-between p-3 border rounded-lg">
                        <div className="flex items-center gap-3">
                          <FileText className="h-5 w-5 text-primary" />
                          <div>
                            <p className="font-medium">{doc.name}</p>
                            <p className="text-sm text-muted-foreground">
                              {format(new Date(doc.created_at), "MMM d, yyyy")}
                            </p>
                          </div>
                        </div>
                        <Button size="sm" variant="outline">
                          <Download className="h-4 w-4 mr-1" />
                          Download
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="payments" className="space-y-6">
            <CustomerPaymentSection
              projectId={project.id}
              contactId={contactInfo?.id}
              token={localStorage.getItem("homeowner_session") ? JSON.parse(localStorage.getItem("homeowner_session")!).token : ""}
              payments={payments.map(p => ({
                id: p.id,
                amount: p.amount,
                status: p.paid_at ? 'completed' : p.status,
                created_at: p.due_date || p.paid_at || '',
                description: p.description,
                payment_method: undefined,
              }))}
              paymentLinks={[]}
              estimates={[]}
              totalProjectValue={project.contract_amount}
              amountPaid={project.amount_paid}
              onPaymentComplete={() => loadPortalData()}
            />
          </TabsContent>

          <TabsContent value="messages" className="space-y-6">
            <Card className="flex flex-col h-[500px]">
              <CardHeader>
                <CardTitle>Messages</CardTitle>
                <CardDescription>
                  Communicate directly with your project team
                </CardDescription>
              </CardHeader>
              <ScrollArea className="flex-1 px-6">
                {messages.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <MessageSquare className="h-12 w-12 mx-auto mb-3 opacity-50" />
                    <p>No messages yet. Start the conversation!</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {messages.map((msg) => (
                      <div 
                        key={msg.id}
                        className={`p-3 rounded-lg max-w-[80%] ${
                          msg.sender_type === "homeowner" 
                            ? "bg-primary/10 ml-auto" 
                            : "bg-muted"
                        }`}
                      >
                        <p className="text-sm">{msg.message}</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          {format(new Date(msg.created_at), "MMM d 'at' h:mm a")}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </ScrollArea>
              <div className="p-4 border-t">
                <div className="flex gap-2">
                  <Textarea 
                    placeholder="Type your message..." 
                    value={newMessage}
                    onChange={(e) => setNewMessage(e.target.value)}
                    className="min-h-[80px]"
                  />
                  <Button onClick={sendMessage} className="self-end">
                    <Send className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

export default HomeownerPortal;
