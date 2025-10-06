import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

const Index = () => {
  const navigate = useNavigate();

  useEffect(() => {
    // Redirect to dashboard on load
    navigate("/dashboard", { replace: true });
  }, [navigate]);

  return null;
};

export default Index;
