import { Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";

/**
 * Guard da página Marcos (2ª página da seção Gestão): por padrão restrito ao dono
 * (Bruno, por e-mail) — nem admin, nem quem tem acesso à Gestão entra sozinho. Só quem
 * ele liberou (papel marcos_viewer). Usado DENTRO de <ProtectedRoute> (login/aprovação já
 * resolvidos). Sem acesso → redireciona pra home.
 */
export function MarcosRoute({ children }: { children: React.ReactNode }) {
  const { canViewMarcos } = useAuth();
  if (!canViewMarcos) return <Navigate to="/" replace />;
  return <>{children}</>;
}
