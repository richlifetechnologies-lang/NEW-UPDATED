import { useEffect } from "react";
import { useLocation } from "wouter";

export default function SubAdminStreamPage() {
  const [, setLocation] = useLocation();
  useEffect(() => {
    setLocation("/subadmin/dashboard");
  }, [setLocation]);
  return null;
}
