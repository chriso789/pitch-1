import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Loader2 } from "lucide-react";

/**
 * /app/mobile — Entry point for native iOS WKWebView.
 * Sets a sessionStorage flag and redirects to /dashboard or /login.
 */
const MobileEntry = () => {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    // Mark that we launched from the native app
    sessionStorage.setItem("pitch_native_launch", "true");
  }, []);

  useEffect(() => {
    if (loading) return;
    if (user) {
      navigate("/dashboard", { replace: true });
    } else {
      navigate("/login", { replace: true });
    }
  }, [user, loading, navigate]);

  return (
    <div className="flex items-center justify-center min-h-screen bg-background">
      <div className="flex flex-col items-center gap-4">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-muted-foreground">Loading PitchCRM...</p>
      </div>
    </div>
  );
};

export default MobileEntry;
