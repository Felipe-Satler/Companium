import { Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";

/**
 * Guard da seção Gestão: restrito ao dono (Bruno, por e-mail) e a quem ele liberou
 * (papel gestao_viewer) — ser admin NÃO basta. Usado DENTRO de <ProtectedRoute>
 * (login/aprovação já resolvidos). Sem acesso → redireciona pra home.
 */
export function GestaoRoute({ children }: { children: React.ReactNode }) {
  const { canViewGestao } = useAuth();
  if (!canViewGestao) return <Navigate to="/" replace />;
  return <>{children}</>;
}
