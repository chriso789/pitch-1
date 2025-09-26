import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useBrowserBackButton } from "@/hooks/useBrowserBackButton";
import { useNavigate } from "react-router-dom";

interface BackButtonProps {
  onClick?: () => void;
  label?: string;
  fallbackPath?: string;
  respectHistory?: boolean;
}

export const BackButton = ({ 
  onClick, 
  label = "Back", 
  fallbackPath = "/",
  respectHistory = true 
}: BackButtonProps) => {
  const navigate = useNavigate();
  const { goBack } = useBrowserBackButton({
    fallbackPath,
    onBackPress: onClick
  });

  const handleClick = () => {
    if (onClick) {
      onClick();
    } else if (respectHistory) {
      goBack();
    } else {
      navigate(fallbackPath);
    }
  };

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={handleClick}
      className="mb-4 text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="h-4 w-4 mr-2" />
      {label}
    </Button>
  );
};