import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { bootstrapMobileSession, setupVisibilityListener } from "@/lib/mobileBootstrap";
import { startActivityLogger } from "@/lib/mobileActivityLogger";
import { Loader2 } from "lucide-react";

const MobileEntry = () => {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    sessionStorage.setItem("pitch_native_launch", "true");
    const cleanupLogger = startActivityLogger();
    const cleanupVisibility = setupVisibilityListener(() => {
      bootstrapMobileSession();
    });
    return () => {
      cleanupLogger();
      cleanupVisibility();
    };
  }, []);

  useEffect(() => {
    if (loading) return;
    if (user) {
      bootstrapMobileSession().then(({ valid }) => {
        if (valid) {
          navigate("/app/mobile/field", { replace: true });
        } else {
          navigate("/login", { replace: true });
        }
      });
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
