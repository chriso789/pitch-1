import { CrewPortal } from "@/components/crew/CrewPortal";
import { CrewLogin } from "@/components/crew/CrewLogin";
import { useAuth } from "@/contexts/AuthContext";
import { Loader2 } from "lucide-react";

const CrewPortalPage = () => {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) return <CrewLogin />;
  return <CrewPortal />;
};

export default CrewPortalPage;
