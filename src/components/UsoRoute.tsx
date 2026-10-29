import { Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";

/**
 * Guard da página Uso do Companium (/uso): admin OU papel `usage_viewer` (liberado na
 * Administração, divisão "USO"). Usado DENTRO de <ProtectedRoute> (login/aprovação já
 * resolvidos). Sem acesso → redireciona pra home. Os dados também são travados no banco
 * (has_usage_access nas RPCs usage_*).
 */
export function UsoRoute({ children }: { children: React.ReactNode }) {
  const { canViewUso } = useAuth();
  if (!canViewUso) return <Navigate to="/" replace />;
  return <>{children}</>;
}
