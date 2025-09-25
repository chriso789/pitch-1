import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

interface BackButtonProps {
  onClick: () => void;
  label?: string;
}

export const BackButton = ({ onClick, label = "Back" }: BackButtonProps) => {
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={onClick}
      className="mb-4 text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="h-4 w-4 mr-2" />
      {label}
    </Button>
  );
};