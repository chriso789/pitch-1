import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  Wrench, 
  Home, 
  Key, 
  Mail, 
  ArrowRight,
  Loader2,
  CheckCircle,
  Building2
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useNavigate } from "react-router-dom";

export function PortalAuthentication() {
  const [activeTab, setActiveTab] = useState<"crew" | "homeowner">("homeowner");
  const [crewToken, setCrewToken] = useState("");
  const [homeownerEmail, setHomeownerEmail] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const { toast } = useToast();
  const navigate = useNavigate();

  // Smart redirect: If user is already authenticated as staff, redirect to dashboard
  useEffect(() => {
    const checkExistingAuth = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user) {
          // User is already authenticated as staff, redirect to dashboard
          navigate('/dashboard', { replace: true });
          return;
        }
      } catch (error) {
        console.error('Auth check error:', error);
      } finally {
        setCheckingAuth(false);
      }
    };
    checkExistingAuth();
  }, [navigate]);

  const handleCrewLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!crewToken.trim()) {
      toast({
        title: "Token Required",
        description: "Please enter your crew access token",
        variant: "destructive"
      });
      return;
    }

    setIsLoading(true);
    try {
      // Validate crew token
      const { data: session, error } = await supabase
        .from("crew_portal_sessions")
        .select("*, crew_member:profiles(*)")
        .eq("token", crewToken.trim())
        .gt("expires_at", new Date().toISOString())
        .single();

      if (error || !session) {
        throw new Error("Invalid or expired access token");
      }

      // Update last active
      await supabase
        .from("crew_portal_sessions")
        .update({ last_active_at: new Date().toISOString() })
        .eq("id", session.id);

      // Store session info
      localStorage.setItem("crew_session", JSON.stringify({
        token: crewToken,
        crewMemberId: session.crew_member_id,
        tenantId: session.tenant_id,
        expiresAt: session.expires_at
      }));

      toast({
        title: "Welcome!",
        description: `Logged in as ${session.crew_member?.first_name || "Crew Member"}`
      });

      navigate("/crew");
    } catch (error: any) {
      toast({
        title: "Login Failed",
        description: error.message || "Invalid access token",
        variant: "destructive"
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleHomeownerLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!homeownerEmail.trim()) {
      toast({
        title: "Email Required",
        description: "Please enter your email address",
        variant: "destructive"
      });
      return;
    }

    setIsLoading(true);
    try {
      // Check if email exists in contacts
      const { data: contact, error: contactError } = await supabase
        .from("contacts")
        .select("id, first_name, tenant_id")
        .eq("email", homeownerEmail.trim().toLowerCase())
        .single();

      if (contactError || !contact) {
        throw new Error("No project found for this email address");
      }

      // Generate magic link token
      const token = crypto.randomUUID();
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // 24 hours

      // Create homeowner session
      const { error: sessionError } = await supabase
        .from("homeowner_portal_sessions")
        .insert({
          tenant_id: contact.tenant_id,
          contact_id: contact.id,
          token,
          email: homeownerEmail.trim().toLowerCase(),
          expires_at: expiresAt
        });

      if (sessionError) throw sessionError;

      // Store session immediately and navigate
      localStorage.setItem("homeowner_session", JSON.stringify({
        token,
        contactId: contact.id,
        tenantId: contact.tenant_id,
        email: homeownerEmail.trim().toLowerCase(),
        expiresAt
      }));
      
      toast({
        title: "Welcome!",
        description: `Logged in as ${contact.first_name || "Homeowner"}`
      });

      navigate("/homeowner");

    } catch (error: any) {
      toast({
        title: "Login Failed",
        description: error.message || "Unable to send login link",
        variant: "destructive"
      });
    } finally {
      setIsLoading(false);
    }
  };

  // Show loading while checking auth
  if (checkingAuth) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-background to-muted/30 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/30 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo/Branding - Customer Portal branded */}
        <div className="text-center mb-8">
          <div className="h-16 w-16 bg-emerald-500/10 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Home className="h-8 w-8 text-emerald-600" />
          </div>
          <h1 className="text-2xl font-bold">Customer Portal</h1>
          <p className="text-muted-foreground mt-2">
            Access your project information
          </p>
          <div className="mt-2 inline-flex items-center gap-1 px-3 py-1 rounded-full bg-emerald-500/10 text-emerald-600 text-xs font-medium">
            <Home className="h-3 w-3" />
            Homeowners & Crew Members
          </div>
        </div>

        <Card>
          <CardHeader className="pb-4">
            <CardTitle>Sign In</CardTitle>
            <CardDescription>
              Choose your portal type to continue
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "crew" | "homeowner")}>
              <TabsList className="grid w-full grid-cols-2 mb-6">
                <TabsTrigger value="homeowner" className="flex items-center gap-2">
                  <Home className="h-4 w-4" />
                  Homeowner
                </TabsTrigger>
                <TabsTrigger value="crew" className="flex items-center gap-2">
                  <Wrench className="h-4 w-4" />
                  Crew
                </TabsTrigger>
              </TabsList>

              <TabsContent value="homeowner">
                {emailSent ? (
                  <div className="text-center py-6">
                    <div className="h-16 w-16 bg-green-500/10 rounded-full flex items-center justify-center mx-auto mb-4">
                      <CheckCircle className="h-8 w-8 text-green-500" />
                    </div>
                    <h3 className="font-semibold text-lg mb-2">Check Your Email</h3>
                    <p className="text-muted-foreground text-sm mb-4">
                      We've sent a login link to<br />
                      <span className="font-medium text-foreground">{homeownerEmail}</span>
                    </p>
                    <Button 
                      variant="outline" 
                      onClick={() => setEmailSent(false)}
                      className="mt-2"
                    >
                      Use Different Email
                    </Button>
                  </div>
                ) : (
                  <form onSubmit={handleHomeownerLogin} className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="homeowner-email">Email Address</Label>
                      <div className="relative">
                        <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                          id="homeowner-email"
                          type="email"
                          placeholder="Enter your email"
                          value={homeownerEmail}
                          onChange={(e) => setHomeownerEmail(e.target.value)}
                          className="pl-10"
                        />
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Enter the email associated with your project
                      </p>
                    </div>
                    <Button type="submit" className="w-full" disabled={isLoading}>
                      {isLoading ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          Sending Link...
                        </>
                      ) : (
                        <>
                          Continue
                          <ArrowRight className="h-4 w-4 ml-2" />
                        </>
                      )}
                    </Button>
                  </form>
                )}
              </TabsContent>

              <TabsContent value="crew">
                <form onSubmit={handleCrewLogin} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="crew-token">Access Token</Label>
                    <div className="relative">
                      <Key className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="crew-token"
                        type="text"
                        placeholder="Enter your access token"
                        value={crewToken}
                        onChange={(e) => setCrewToken(e.target.value)}
                        className="pl-10 font-mono"
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Your unique token was provided by your supervisor
                    </p>
                  </div>
                  <Button type="submit" className="w-full" disabled={isLoading}>
                    {isLoading ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Verifying...
                      </>
                    ) : (
                      <>
                        Access Portal
                        <ArrowRight className="h-4 w-4 ml-2" />
                      </>
                    )}
                  </Button>
                </form>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>

        {/* Staff Login Link */}
        <div className="mt-6 p-4 rounded-lg border border-dashed border-primary/30 bg-primary/5">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 bg-primary/10 rounded-lg flex items-center justify-center flex-shrink-0">
              <Building2 className="h-5 w-5 text-primary" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium">Are you a staff member?</p>
              <p className="text-xs text-muted-foreground">Sales reps, managers, and admins</p>
            </div>
            <Button 
              variant="outline" 
              size="sm"
              onClick={() => navigate('/login')}
              className="flex-shrink-0"
            >
              Staff Login
              <ArrowRight className="h-3 w-3 ml-1" />
            </Button>
          </div>
        </div>

        {/* Help Text */}
        <div className="mt-4 text-center">
          <p className="text-sm text-muted-foreground">
            Need help accessing your portal?{" "}
            <a href="#" className="text-primary hover:underline">
              Contact Support
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}

export default PortalAuthentication;
