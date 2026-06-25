import { useState, useEffect } from "react";
import { Navigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Loader2 } from "lucide-react";

interface HomeownerSession {
  token: string;
  contactId: string;
  tenantId: string;
  email: string;
  expiresAt: string;
}

interface HomeownerProtectedRouteProps {
  children: React.ReactNode;
}

export function HomeownerProtectedRoute({ children }: HomeownerProtectedRouteProps) {
  const [isValidating, setIsValidating] = useState(true);
  const [isValid, setIsValid] = useState(false);

  useEffect(() => {
    validateSession();
  }, []);

  const validateSession = async () => {
    try {
      // Check if user is logged in as staff first - allow admin access
      const { data: { session: authSession } } = await supabase.auth.getSession();
      if (authSession?.user) {
        setIsValid(true);
        setIsValidating(false);
        return;
      }

      // Otherwise, check homeowner session token
      const sessionData = localStorage.getItem("homeowner_session");
      
      if (!sessionData) {
        setIsValid(false);
        setIsValidating(false);
        return;
      }

      const session: HomeownerSession = JSON.parse(sessionData);

      // Check if session is expired locally first
      if (new Date(session.expiresAt) < new Date()) {
        localStorage.removeItem("homeowner_session");
        setIsValid(false);
        setIsValidating(false);
        return;
      }

      // Validate token server-side. Homeowners are not Supabase auth users, so
      // direct browser RLS checks can fail even when the custom portal session is valid.
      const { data: dbSession, error } = await supabase.functions.invoke("homeowner-password", {
        body: { action: "validate-session", token: session.token },
      });

      if (error || !dbSession?.success) {
        localStorage.removeItem("homeowner_session");
        setIsValid(false);
        setIsValidating(false);
        return;
      }

      setIsValid(true);
    } catch (error) {
      console.error("Session validation error:", error);
      setIsValid(false);
    } finally {
      setIsValidating(false);
    }
  };

  if (isValidating) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!isValid) {
    return <Navigate to="/portal/login" replace />;
  }

  return <>{children}</>;
}

export default HomeownerProtectedRoute;
